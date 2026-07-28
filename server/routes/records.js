// الملاحظات والمخالفات، المخاطر، الحوادث، الإجراءات التصحيحية، التصاريح، التقييمات
const express = require('express');
const { all, get, run, nextRef, riskLevel, slaDays } = require('../db');
const { requireAuth, requireAdmin, requirePerm, can, allowedProjectIds, canAccessProject } = require('../auth');
const { notifyAdmins, notifyUser } = require('../escalation');
const { logAudit } = require('./core');

const router = express.Router();
router.use(requireAuth);

function scopeIds(req) {
  return req.user.role === 'admin' ? null : allowedProjectIds(req.user);
}
function scopeFilter(req, col, filters, params) {
  const ids = scopeIds(req);
  if (ids) {
    if (!ids.length) { filters.push('1=0'); return; }
    filters.push(`${col} IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
}

// ===== سجل الإجراءات المتخذة (مشترك بين الوحدات) =====
const UPDATE_ENTITIES = {
  observation: { table: 'observations', final: ['closed', 'rejected'] },
  action: { table: 'actions', final: ['closed', 'rejected'] },
  incident: { table: 'incidents', final: ['closed'] },
  permit: { table: 'permits', final: ['closed', 'cancelled'] },
};

function resolveEntity(entityType, entityId) {
  const def = UPDATE_ENTITIES[entityType];
  if (!def) return null;
  const row = get(`SELECT * FROM ${def.table} WHERE id = ?`, Number(entityId));
  return row ? { def, row } : null;
}

function updatesCount(entityType, entityId) {
  return get(`SELECT COUNT(*) AS c FROM progress_updates WHERE entity_type = ? AND entity_id = ?`,
    entityType, Number(entityId)).c;
}

router.get('/updates', (req, res) => {
  const { entity_type, entity_id } = req.query;
  const ent = resolveEntity(entity_type, entity_id);
  if (!ent) return res.status(404).json({ error: 'السجل غير موجود' });
  if (!canAccessProject(req.user, ent.row.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const rows = all(
    `SELECT pu.*, u.full_name FROM progress_updates pu LEFT JOIN users u ON u.id = pu.created_by
     WHERE pu.entity_type = ? AND pu.entity_id = ? ORDER BY pu.id DESC`, entity_type, Number(entity_id));
  for (const r of rows)
    r.attachments = all(`SELECT * FROM attachments WHERE entity_type = 'update' AND entity_id = ?`, r.id);
  res.json(rows);
});

router.post('/updates', requirePerm('record_observations'), (req, res) => {
  const { entity_type, entity_id, body, progress } = req.body || {};
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'أدخل وصف الإجراء المتخذ' });
  const ent = resolveEntity(entity_type, entity_id);
  if (!ent) return res.status(404).json({ error: 'السجل غير موجود' });
  if (!canAccessProject(req.user, ent.row.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية على هذا المشروع' });
  if (ent.def.final.includes(ent.row.status))
    return res.status(400).json({ error: 'لا يمكن إضافة إجراءات على سجل مغلق أو ملغى — أعد فتحه أولاً' });
  const prog = progress === undefined || progress === null || progress === ''
    ? null : Math.min(100, Math.max(0, Number(progress)));
  run(`INSERT INTO progress_updates (entity_type, entity_id, body, progress, created_by) VALUES (?,?,?,?,?)`,
    entity_type, Number(entity_id), String(body).trim(), prog, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  // نسبة الإنجاز تُحدّث الإجراء التصحيحي نفسه
  if (entity_type === 'action' && prog !== null)
    run(`UPDATE actions SET progress = ? WHERE id = ?`, prog, Number(entity_id));
  logAudit(req, 'progress_update', entity_type, Number(entity_id), String(body).slice(0, 80));
  res.status(201).json({ id });
});

// ===== الملاحظات والمخالفات =====
// الانتقالات المسموحة لكل حالة
const OBS_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['pending_verification'],
  pending_verification: ['closed', 'reopened'],
  rejected: ['submitted'],
  reopened: ['assigned', 'in_progress'],
  closed: ['reopened'],
};
// الصلاحية المطلوبة لكل انتقال (من مصفوفة الصلاحيات)
const OBS_TRANSITION_PERM = {
  submitted: 'record_observations',
  under_review: 'approve_observations',
  approved: 'approve_observations',
  rejected: 'approve_observations',
  assigned: 'approve_observations',
  in_progress: 'approve_observations',
  pending_verification: 'approve_observations',
  closed: 'close_observations',
  reopened: null, // إعادة الفتح: من يملك التسجيل أو الإغلاق
};
function canTransitionObs(user, to) {
  const perm = OBS_TRANSITION_PERM[to];
  if (perm === null) return can(user, 'record_observations') || can(user, 'close_observations');
  return can(user, perm);
}

router.get('/observations', (req, res) => {
  const filters = ['o.archived = 0'];
  const params = [];
  scopeFilter(req, 'o.project_id', filters, params);
  const { status, severity, category, project_id, otype, observer_id, from, to, q, escalated, open_only, status_tag } = req.query;
  if (status_tag) { filters.push('o.status_tag = ?'); params.push(status_tag); }
  if (status) { filters.push('o.status = ?'); params.push(status); }
  if (severity) { filters.push('o.severity = ?'); params.push(severity); }
  if (category) { filters.push('o.category = ?'); params.push(category); }
  if (otype) { filters.push('o.otype = ?'); params.push(otype); }
  if (project_id) { filters.push('o.project_id = ?'); params.push(Number(project_id)); }
  if (observer_id) { filters.push('o.observer_id = ?'); params.push(Number(observer_id)); }
  if (from) { filters.push('date(o.created_at) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(o.created_at) <= date(?)'); params.push(to); }
  if (escalated === '1') filters.push('o.escalated = 1');
  if (open_only === '1') filters.push(`o.status NOT IN ('closed','rejected')`);
  if (q) { filters.push('(o.description LIKE ? OR o.ref LIKE ? OR o.site LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = all(
    `SELECT o.*, p.name AS project_name, u.full_name AS observer_name,
       CASE WHEN o.status NOT IN ('closed','rejected') AND o.due_date IS NOT NULL AND date(o.due_date) < date('now') THEN 1 ELSE 0 END AS overdue
     FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id
     WHERE ${filters.join(' AND ')}
     ORDER BY o.id DESC LIMIT 500`, ...params);
  res.json(rows);
});

router.get('/observations/:id', (req, res) => {
  const o = get(
    `SELECT o.*, p.name AS project_name, u.full_name AS observer_name
     FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id
     WHERE o.id = ?`, Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'الملاحظة غير موجودة' });
  if (!canAccessProject(req.user, o.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  o.history = all(
    `SELECT h.*, u.full_name FROM observation_history h LEFT JOIN users u ON u.id = h.by_user
     WHERE h.observation_id = ? ORDER BY h.id`, o.id);
  o.attachments = all(`SELECT * FROM attachments WHERE entity_type = 'observation' AND entity_id = ?`, o.id);
  o.actions = all(`SELECT * FROM actions WHERE source_type = 'observation' AND source_id = ?`, o.id);
  res.json(o);
});

router.post('/observations', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  const { project_id, category, description } = b;
  if (!project_id || !category || !description)
    return res.status(400).json({ error: 'المشروع والتصنيف والوصف حقول إلزامية' });
  if (!canAccessProject(req.user, project_id)) return res.status(403).json({ error: 'لا تملك صلاحية على هذا المشروع' });

  // منع التكرار: نفس المشروع + نفس الموقع + وصف مشابه خلال النافذة الزمنية
  const winDays = Number(get(`SELECT value FROM settings WHERE key = 'duplicate_window_days'`)?.value || 7);
  if (!b.force) {
    const dup = get(
      `SELECT ref, created_at FROM observations
       WHERE project_id = ? AND site = ? AND description = ? AND archived = 0
         AND created_at >= datetime('now', ?)`,
      Number(project_id), b.site || '', description, `-${winDays} days`);
    if (dup) {
      return res.status(409).json({
        error: `توجد ملاحظة مماثلة (${dup.ref}) لنفس المشروع والموقع والوصف خلال آخر ${winDays} أيام. أكد الحفظ إذا كانت ملاحظة جديدة فعلاً.`,
        duplicate_ref: dup.ref, requires_confirm: true,
      });
    }
  }

  const likelihood = Math.min(5, Math.max(1, Number(b.likelihood) || 3));
  const impact = Math.min(5, Math.max(1, Number(b.impact) || 3));
  const score = likelihood * impact;
  const severity = ['low','medium','high','critical'].includes(b.severity) ? b.severity : riskLevel(score);
  const due = b.due_date || new Date(Date.now() + slaDays(severity) * 864e5).toISOString().slice(0, 10);
  const status = b.status === 'draft' ? 'draft' : 'submitted';
  const ref = nextRef('OBS', 'observations');
  run(`INSERT INTO observations (ref, otype, project_id, tour_id, checklist_item_id, site, observer_id, category,
        description, lat, lng, responsible_party, severity, likelihood, impact, risk_score, reference_clause,
        immediate_action, corrective_action, due_date, status, work_stop)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ref, b.otype === 'violation' ? 'violation' : 'observation', Number(project_id),
    b.tour_id ?? null, b.checklist_item_id ?? null, b.site || '', req.user.id, category,
    description, b.lat ?? null, b.lng ?? null, b.responsible_party || 'contractor',
    severity, likelihood, impact, score, b.reference_clause || '',
    b.immediate_action || '', b.corrective_action || '', due, status, b.work_stop ? 1 : 0);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  run(`INSERT INTO observation_history (observation_id, from_status, to_status, by_user, note)
       VALUES (?,?,?,?,?)`, id, null, status, req.user.id, 'تسجيل الملاحظة');

  const pname = get(`SELECT name FROM projects WHERE id = ?`, project_id).name;
  // الملاحظة الحرجة ترسل فوراً لمدير النظام
  if (severity === 'critical' && status !== 'draft') {
    notifyAdmins('ملاحظة حرجة جديدة',
      `ملاحظة حرجة ${ref} في «${pname}»: ${description.slice(0, 120)}${b.work_stop ? ' — توصية بإيقاف العمل!' : ''}`,
      'critical', 'observation', id);
  }
  // إنشاء إجراء تصحيحي تلقائي عند الطلب أو للخطورة العالية
  if (b.auto_action || severity === 'high' || severity === 'critical') {
    const aref = nextRef('CAP', 'actions');
    run(`INSERT INTO actions (ref, source_type, source_id, project_id, description, required_action, assignee,
          priority, start_date, due_date, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,date('now'),?,'open',?)`,
      aref, 'observation', id, Number(project_id), description.slice(0, 200),
      b.corrective_action || 'معالجة الملاحظة وإرفاق أدلة التنفيذ.',
      b.responsible_party === 'consultant' ? 'الاستشاري' : 'المقاول', severity, due, req.user.id);
  }
  logAudit(req, 'create', 'observation', id, `${ref} (${severity})`);
  res.status(201).json({ id, ref, severity, due_date: due });
});

router.put('/observations/:id', (req, res) => {
  const id = Number(req.params.id);
  const o = get(`SELECT * FROM observations WHERE id = ?`, id);
  if (!o) return res.status(404).json({ error: 'الملاحظة غير موجودة' });
  if (!canAccessProject(req.user, o.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  // الراصد يعدل ملاحظاته فقط وقبل الاعتماد
  if (req.user.role === 'observer') {
    if (o.observer_id !== req.user.id) return res.status(403).json({ error: 'لا يمكنك تعديل ملاحظة راصد آخر' });
    if (!['draft', 'submitted', 'rejected'].includes(o.status))
      return res.status(400).json({ error: 'لا يمكن تعديل الملاحظة بعد اعتمادها' });
  }
  const b = req.body || {};
  const fields = ['otype','site','category','description','lat','lng','responsible_party','severity','likelihood',
    'impact','reference_clause','immediate_action','corrective_action','due_date','work_stop','status_tag'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (cols.length) {
    run(`UPDATE observations SET ${cols.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      ...cols.map(f => f === 'work_stop' ? (b[f] ? 1 : 0) : b[f]), id);
    if (b.likelihood !== undefined || b.impact !== undefined) {
      const cur = get(`SELECT likelihood, impact FROM observations WHERE id = ?`, id);
      run(`UPDATE observations SET risk_score = ? WHERE id = ?`, cur.likelihood * cur.impact, id);
    }
  }
  if (b.archived !== undefined && req.user.role === 'admin') {
    // السجلات المعتمدة لا تحذف — تؤرشف فقط
    run(`UPDATE observations SET archived = ? WHERE id = ?`, b.archived ? 1 : 0, id);
  }
  logAudit(req, 'update', 'observation', id, o.ref);
  res.json({ ok: true });
});

// تحويل حالة الملاحظة وفق سير الإجراءات
router.post('/observations/:id/transition', (req, res) => {
  const id = Number(req.params.id);
  const o = get(`SELECT * FROM observations WHERE id = ?`, id);
  if (!o) return res.status(404).json({ error: 'الملاحظة غير موجودة' });
  if (!canAccessProject(req.user, o.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const { to, note = '' } = req.body || {};
  const allowed = OBS_TRANSITIONS[o.status] || [];
  if (!allowed.includes(to))
    return res.status(400).json({ error: `لا يمكن الانتقال من «${o.status}» إلى «${to}»` });
  if (!canTransitionObs(req.user, to)) return res.status(403).json({ error: 'صلاحية غير كافية لهذا الانتقال' });

  if (to === 'rejected' && !note) return res.status(400).json({ error: 'سبب الرفض إلزامي' });
  if (to === 'reopened' && !note) return res.status(400).json({ error: 'سبب إعادة الفتح إلزامي' });
  if (to === 'pending_verification' && !updatesCount('observation', id))
    return res.status(400).json({ error: 'وثّق إجراءً متخذاً واحداً على الأقل في سجل «الإجراءات المتخذة» قبل طلب التحقق' });
  if (to === 'closed') {
    // لا يتم الإغلاق إلا بعد إرفاق دليل معالجة
    const evidence = get(
      `SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'observation' AND entity_id = ? AND kind IN ('after','evidence')`, id).c;
    if (!evidence) return res.status(400).json({ error: 'لا يمكن الإغلاق قبل إرفاق دليل المعالجة (صورة بعد المعالجة أو مستند إثبات)' });
  }

  const updates = { status: to };
  if (to === 'rejected') updates.reject_reason = note;
  if (to === 'reopened') updates.reopen_reason = note;
  if (to === 'closed') { updates.closed_at = new Date().toISOString().slice(0, 19).replace('T', ' '); }
  const setCols = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  run(`UPDATE observations SET ${setCols}, updated_at = datetime('now') WHERE id = ?`, ...Object.values(updates), id);
  if (to === 'closed') run(`UPDATE observations SET closed_by = ?, verified_by = ? WHERE id = ?`, req.user.id, req.user.id, id);
  run(`INSERT INTO observation_history (observation_id, from_status, to_status, by_user, note)
       VALUES (?,?,?,?,?)`, id, o.status, to, req.user.id, note);

  // إشعارات
  if (to === 'reopened')
    notifyAdmins('إعادة فتح ملاحظة', `تمت إعادة فتح الملاحظة ${o.ref} — السبب: ${note}`, 'warning', 'observation', id);
  if (to === 'closed')
    notifyUser(o.observer_id, 'إغلاق ملاحظة', `تم اعتماد إغلاق الملاحظة ${o.ref} بعد التحقق من أدلة المعالجة.`, 'info', 'observation', id);
  if (to === 'rejected')
    notifyUser(o.observer_id, 'رفض ملاحظة', `تم رفض الملاحظة ${o.ref} — السبب: ${note}`, 'warning', 'observation', id);

  logAudit(req, `transition:${o.status}->${to}`, 'observation', id, note || o.ref);
  res.json({ ok: true, status: to });
});

// ===== المخاطر =====
router.get('/risks', (req, res) => {
  const filters = ['r.archived = 0'];
  const params = [];
  scopeFilter(req, 'r.project_id', filters, params);
  const { project_id, status, level } = req.query;
  if (project_id) { filters.push('r.project_id = ?'); params.push(Number(project_id)); }
  if (status) { filters.push('r.status = ?'); params.push(status); }
  const rows = all(
    `SELECT r.*, p.name AS project_name FROM risks r JOIN projects p ON p.id = r.project_id
     WHERE ${filters.join(' AND ')} ORDER BY r.score DESC, r.id DESC LIMIT 500`, ...params);
  const withLevel = rows.map(r => ({ ...r, level: riskLevel(r.score), residual_level: r.residual_score ? riskLevel(r.residual_score) : null }));
  res.json(level ? withLevel.filter(r => r.level === level) : withLevel);
});

router.post('/risks', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.description || !b.likelihood || !b.impact)
    return res.status(400).json({ error: 'المشروع والوصف والاحتمالية والأثر حقول إلزامية' });
  if (!canAccessProject(req.user, b.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const L = Math.min(5, Math.max(1, Number(b.likelihood))), I = Math.min(5, Math.max(1, Number(b.impact)));
  const ref = nextRef('RSK', 'risks');
  run(`INSERT INTO risks (ref, project_id, description, causes, effects, current_controls, likelihood, impact, score,
        actions, owner, due_date, residual_likelihood, residual_impact, residual_score, status, monitoring_plan, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ref, Number(b.project_id), b.description, b.causes || '', b.effects || '', b.current_controls || '',
    L, I, L * I, b.actions || '', b.owner || '', b.due_date || null,
    b.residual_likelihood ?? null, b.residual_impact ?? null,
    b.residual_likelihood && b.residual_impact ? b.residual_likelihood * b.residual_impact : null,
    b.status || 'open', b.monitoring_plan || '', req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'risk', id, ref);
  res.status(201).json({ id, ref });
});

router.put('/risks/:id', (req, res) => {
  const id = Number(req.params.id);
  const r = get(`SELECT * FROM risks WHERE id = ?`, id);
  if (!r) return res.status(404).json({ error: 'الخطر غير موجود' });
  if (!canAccessProject(req.user, r.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const b = req.body || {};
  const fields = ['description','causes','effects','current_controls','likelihood','impact','actions','owner',
    'due_date','residual_likelihood','residual_impact','status','monitoring_plan','status_tag'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (cols.length) run(`UPDATE risks SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, ...cols.map(f => b[f]), id);
  const cur = get(`SELECT likelihood, impact, residual_likelihood, residual_impact FROM risks WHERE id = ?`, id);
  run(`UPDATE risks SET score = ?, residual_score = ? WHERE id = ?`,
    cur.likelihood * cur.impact,
    cur.residual_likelihood && cur.residual_impact ? cur.residual_likelihood * cur.residual_impact : null, id);
  if (b.archived !== undefined && req.user.role === 'admin')
    run(`UPDATE risks SET archived = ? WHERE id = ?`, b.archived ? 1 : 0, id);
  logAudit(req, 'update', 'risk', id, r.ref);
  res.json({ ok: true });
});

// ===== الحوادث =====
router.get('/incidents', (req, res) => {
  const filters = ['i.archived = 0'];
  const params = [];
  scopeFilter(req, 'i.project_id', filters, params);
  const { project_id, itype, status, from, to } = req.query;
  if (project_id) { filters.push('i.project_id = ?'); params.push(Number(project_id)); }
  if (itype) { filters.push('i.itype = ?'); params.push(itype); }
  if (status) { filters.push('i.status = ?'); params.push(status); }
  if (from) { filters.push('date(i.occurred_at) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(i.occurred_at) <= date(?)'); params.push(to); }
  res.json(all(
    `SELECT i.*, p.name AS project_name FROM incidents i JOIN projects p ON p.id = i.project_id
     WHERE ${filters.join(' AND ')} ORDER BY i.occurred_at DESC LIMIT 500`, ...params));
});

router.get('/incidents/:id', (req, res) => {
  const i = get(`SELECT i.*, p.name AS project_name FROM incidents i JOIN projects p ON p.id = i.project_id WHERE i.id = ?`,
    Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'الحادث غير موجود' });
  if (!canAccessProject(req.user, i.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  i.attachments = all(`SELECT * FROM attachments WHERE entity_type = 'incident' AND entity_id = ?`, i.id);
  i.actions = all(`SELECT * FROM actions WHERE source_type = 'incident' AND source_id = ?`, i.id);
  res.json(i);
});

const INCIDENT_FIELDS = ['itype','occurred_at','location','lat','lng','people_affected','description','injury_type',
  'injury_severity','lost_hours','immediate_action','investigation_team','rca_method','root_cause','direct_causes',
  'indirect_causes','lessons','status','status_tag','injured_id','injured_nationality','injured_occupation'];

router.post('/incidents', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.itype || !b.occurred_at || !b.description)
    return res.status(400).json({ error: 'المشروع والنوع والتاريخ والوصف حقول إلزامية' });
  if (!canAccessProject(req.user, b.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const ref = nextRef('INC', 'incidents');
  const cols = INCIDENT_FIELDS.filter(f => b[f] !== undefined);
  run(`INSERT INTO incidents (ref, project_id, created_by${cols.length ? ',' + cols.join(',') : ''})
       VALUES (?,?,?${cols.map(() => ',?').join('')})`,
    ref, Number(b.project_id), req.user.id, ...cols.map(f => b[f]));
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  const pname = get(`SELECT name FROM projects WHERE id = ?`, b.project_id).name;
  const seriousTypes = ['fatality', 'injury', 'fire', 'accident'];
  if (seriousTypes.includes(b.itype))
    notifyAdmins('تسجيل حادث جديد', `حادث ${ref} في «${pname}»: ${String(b.description).slice(0, 120)}`, 'critical', 'incident', id);
  logAudit(req, 'create', 'incident', id, ref);
  res.status(201).json({ id, ref });
});

router.put('/incidents/:id', (req, res) => {
  const id = Number(req.params.id);
  const i = get(`SELECT * FROM incidents WHERE id = ?`, id);
  if (!i) return res.status(404).json({ error: 'الحادث غير موجود' });
  if (!canAccessProject(req.user, i.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const b = req.body || {};
  // بوابة الإغلاق قبل أي تحديث للحالة
  if (b.status === 'closed') {
    if (!can(req.user, 'close_observations')) return res.status(403).json({ error: 'إغلاق الحادث يتطلب صلاحية اعتماد الإغلاق' });
    if (!updatesCount('incident', id))
      return res.status(400).json({ error: 'وثّق إجراءً متخذاً واحداً على الأقل في سجل «الإجراءات المتخذة» قبل إغلاق الحادث' });
  }
  const cols = INCIDENT_FIELDS.filter(f => b[f] !== undefined);
  if (cols.length) run(`UPDATE incidents SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, ...cols.map(f => b[f]), id);
  if (b.status === 'closed')
    run(`UPDATE incidents SET closed_at = datetime('now'), approved_by = ? WHERE id = ?`, req.user.id, id);
  if (b.archived !== undefined && req.user.role === 'admin')
    run(`UPDATE incidents SET archived = ? WHERE id = ?`, b.archived ? 1 : 0, id);
  // تعليم الحادث كمُبلّغ للتأمينات الاجتماعية GOSI
  if (b.gosi_reported !== undefined) {
    run(`UPDATE incidents SET gosi_reported = ?, gosi_reported_at = ? WHERE id = ?`,
      b.gosi_reported ? 1 : 0, b.gosi_reported ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, id);
    logAudit(req, 'gosi_report', 'incident', id, b.gosi_reported ? 'تم الإبلاغ للتأمينات' : 'إلغاء الإبلاغ');
  }
  logAudit(req, 'update', 'incident', id, i.ref);
  res.json({ ok: true });
});

// ===== اجتماعات التوعية Toolbox Talks =====
router.get('/talks', (req, res) => {
  const filters = ['1=1'];
  const params = [];
  scopeFilter(req, 't.project_id', filters, params);
  const { project_id, from, to } = req.query;
  if (project_id) { filters.push('t.project_id = ?'); params.push(Number(project_id)); }
  if (from) { filters.push('date(t.talk_date) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(t.talk_date) <= date(?)'); params.push(to); }
  res.json(all(
    `SELECT t.*, p.name AS project_name, u.full_name AS created_by_name
     FROM toolbox_talks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by
     WHERE ${filters.join(' AND ')} ORDER BY t.talk_date DESC, t.id DESC LIMIT 500`, ...params));
});

router.post('/talks', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.topic || !b.talk_date)
    return res.status(400).json({ error: 'المشروع والموضوع وتاريخ الاجتماع حقول إلزامية' });
  if (!canAccessProject(req.user, b.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية على هذا المشروع' });
  run(`INSERT INTO toolbox_talks (project_id, talk_date, topic, presenter, attendees_count, duration_min, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
    Number(b.project_id), b.talk_date, b.topic, b.presenter || '',
    Math.max(0, Number(b.attendees_count) || 0), Math.max(5, Number(b.duration_min) || 15), b.notes || '', req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'toolbox_talk', id, b.topic);
  res.status(201).json({ id });
});

router.delete('/talks/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT * FROM toolbox_talks WHERE id = ?`, id);
  if (!t) return res.status(404).json({ error: 'غير موجود' });
  run(`DELETE FROM toolbox_talks WHERE id = ?`, id);
  logAudit(req, 'delete', 'toolbox_talk', id, t.topic);
  res.json({ ok: true });
});

// ===== الإجراءات التصحيحية CAPA =====
const ACTION_TRANSITIONS = {
  open: ['in_progress'],
  in_progress: ['pending_verification'],
  pending_verification: ['closed', 'rejected', 'reopened'],
  rejected: ['in_progress'],
  reopened: ['in_progress'],
  closed: ['reopened'],
};

router.get('/actions', (req, res) => {
  const filters = ['a.archived = 0'];
  const params = [];
  scopeFilter(req, 'a.project_id', filters, params);
  const { project_id, status, priority, source_type, overdue, status_tag } = req.query;
  if (status_tag) { filters.push('a.status_tag = ?'); params.push(status_tag); }
  if (project_id) { filters.push('a.project_id = ?'); params.push(Number(project_id)); }
  if (status) { filters.push('a.status = ?'); params.push(status); }
  if (priority) { filters.push('a.priority = ?'); params.push(priority); }
  if (source_type) { filters.push('a.source_type = ?'); params.push(source_type); }
  if (overdue === '1') filters.push(`a.status NOT IN ('closed','rejected') AND a.due_date IS NOT NULL AND date(a.due_date) < date('now')`);
  res.json(all(
    `SELECT a.*, p.name AS project_name,
       CASE WHEN a.status NOT IN ('closed','rejected') AND a.due_date IS NOT NULL AND date(a.due_date) < date('now') THEN 1 ELSE 0 END AS overdue
     FROM actions a JOIN projects p ON p.id = a.project_id
     WHERE ${filters.join(' AND ')} ORDER BY a.id DESC LIMIT 500`, ...params));
});

router.post('/actions', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.description) return res.status(400).json({ error: 'المشروع والوصف حقول إلزامية' });
  if (!canAccessProject(req.user, b.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const ref = nextRef('CAP', 'actions');
  run(`INSERT INTO actions (ref, source_type, source_id, project_id, description, required_action, assignee,
        priority, start_date, due_date, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,'open',?)`,
    ref, b.source_type || 'manual', b.source_id ?? null, Number(b.project_id), b.description,
    b.required_action || '', b.assignee || '', b.priority || 'medium',
    b.start_date || new Date().toISOString().slice(0, 10), b.due_date || null, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'action', id, ref);
  res.status(201).json({ id, ref });
});

router.put('/actions/:id', (req, res) => {
  const id = Number(req.params.id);
  const a = get(`SELECT * FROM actions WHERE id = ?`, id);
  if (!a) return res.status(404).json({ error: 'الإجراء غير موجود' });
  if (!canAccessProject(req.user, a.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const b = req.body || {};
  const fields = ['description','required_action','assignee','priority','start_date','due_date','progress','status_tag'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (cols.length) run(`UPDATE actions SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, ...cols.map(f => b[f]), id);
  if (b.archived !== undefined && req.user.role === 'admin')
    run(`UPDATE actions SET archived = ? WHERE id = ?`, b.archived ? 1 : 0, id);
  logAudit(req, 'update', 'action', id, a.ref);
  res.json({ ok: true });
});

router.post('/actions/:id/transition', (req, res) => {
  const id = Number(req.params.id);
  const a = get(`SELECT * FROM actions WHERE id = ?`, id);
  if (!a) return res.status(404).json({ error: 'الإجراء غير موجود' });
  if (!canAccessProject(req.user, a.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const { to, note = '' } = req.body || {};
  const allowed = ACTION_TRANSITIONS[a.status] || [];
  if (!allowed.includes(to)) return res.status(400).json({ error: `لا يمكن الانتقال من «${a.status}» إلى «${to}»` });
  if (['closed', 'rejected', 'reopened'].includes(to) && !can(req.user, 'close_observations'))
    return res.status(403).json({ error: 'اعتماد الإغلاق أو الرفض من صلاحية مدير النظام' });
  if (to === 'pending_verification' && !updatesCount('action', id))
    return res.status(400).json({ error: 'وثّق إجراءً متخذاً واحداً على الأقل في سجل «الإجراءات المتخذة» قبل طلب التحقق' });
  if (to === 'closed') {
    const evidence = get(`SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'action' AND entity_id = ?`, id).c;
    const srcEvidence = a.source_type === 'observation' && a.source_id
      ? get(`SELECT COUNT(*) AS c FROM attachments WHERE entity_type = 'observation' AND entity_id = ? AND kind IN ('after','evidence')`, a.source_id).c
      : 0;
    if (!evidence && !srcEvidence)
      return res.status(400).json({ error: 'لا يمكن إغلاق الإجراء قبل إرفاق دليل التنفيذ' });
  }
  run(`UPDATE actions SET status = ?${to === 'closed' ? `, closed_at = datetime('now'), verified_by = ${req.user.id}, progress = 100` : ''} WHERE id = ?`, to, id);
  logAudit(req, `transition:${a.status}->${to}`, 'action', id, note || a.ref);
  res.json({ ok: true, status: to });
});

// ===== تصاريح العمل =====
const PERMIT_TRANSITIONS = {
  requested: ['under_review', 'cancelled'],
  under_review: ['approved', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['suspended', 'closed'],
  suspended: ['active', 'cancelled', 'closed'],
};

router.get('/permits', (req, res) => {
  const filters = ['pr.archived = 0'];
  const params = [];
  scopeFilter(req, 'pr.project_id', filters, params);
  const { project_id, status, ptype } = req.query;
  if (project_id) { filters.push('pr.project_id = ?'); params.push(Number(project_id)); }
  if (status) { filters.push('pr.status = ?'); params.push(status); }
  if (ptype) { filters.push('pr.ptype = ?'); params.push(ptype); }
  res.json(all(
    `SELECT pr.*, p.name AS project_name FROM permits pr JOIN projects p ON p.id = pr.project_id
     WHERE ${filters.join(' AND ')} ORDER BY pr.id DESC LIMIT 500`, ...params));
});

router.post('/permits', requirePerm('record_observations'), (req, res) => {
  const b = req.body || {};
  if (!b.project_id || !b.ptype) return res.status(400).json({ error: 'المشروع ونوع التصريح إلزاميان' });
  if (!canAccessProject(req.user, b.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const ref = nextRef('PRM', 'permits');
  run(`INSERT INTO permits (ref, project_id, ptype, description, requester, responsible, safety_requirements,
        valid_from, valid_to, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ref, Number(b.project_id), b.ptype, b.description || '', b.requester || '', b.responsible || '',
    b.safety_requirements || '', b.valid_from || null, b.valid_to || null, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'permit', id, ref);
  res.status(201).json({ id, ref });
});

router.put('/permits/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM permits WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'التصريح غير موجود' });
  if (!canAccessProject(req.user, p.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const b = req.body || {};
  const fields = ['description','requester','responsible','safety_requirements','valid_from','valid_to','field_verified','status_tag'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (cols.length) run(`UPDATE permits SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`,
    ...cols.map(f => f === 'field_verified' ? (b[f] ? 1 : 0) : b[f]), id);
  logAudit(req, 'update', 'permit', id, p.ref);
  res.json({ ok: true });
});

router.post('/permits/:id/transition', (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM permits WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'التصريح غير موجود' });
  if (!canAccessProject(req.user, p.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  const { to } = req.body || {};
  const allowed = PERMIT_TRANSITIONS[p.status] || [];
  if (!allowed.includes(to)) return res.status(400).json({ error: `لا يمكن الانتقال من «${p.status}» إلى «${to}»` });
  if (['under_review', 'approved', 'cancelled', 'suspended'].includes(to) && !can(req.user, 'approve_permits'))
    return res.status(403).json({ error: 'مراجعة أو اعتماد أو تعليق التصريح من صلاحية مدير النظام' });
  if (to === 'closed' && !updatesCount('permit', id))
    return res.status(400).json({ error: 'وثّق إجراءً متخذاً واحداً على الأقل في سجل «الإجراءات المتخذة» قبل إغلاق التصريح' });
  run(`UPDATE permits SET status = ? WHERE id = ?`, to, id);
  logAudit(req, `transition:${p.status}->${to}`, 'permit', id, p.ref);
  res.json({ ok: true, status: to });
});

// ===== تقييم المقاولين والاستشاريين =====
router.get('/evaluations', (req, res) => {
  const { party_id, period } = req.query;
  const filters = ['1=1'];
  const params = [];
  if (party_id) { filters.push('e.party_id = ?'); params.push(Number(party_id)); }
  if (period) { filters.push('e.period = ?'); params.push(period); }
  res.json(all(
    `SELECT e.*, pa.name AS party_name, pa.kind FROM evaluations e JOIN parties pa ON pa.id = e.party_id
     WHERE ${filters.join(' AND ')} ORDER BY e.period DESC, e.total DESC LIMIT 500`, ...params));
});

router.post('/evaluations', requirePerm('manage_projects'), (req, res) => {
  const { party_id, project_id = null, period, scores = {}, notes = '' } = req.body || {};
  if (!party_id || !period) return res.status(400).json({ error: 'الطرف والفترة إلزاميان' });
  const vals = Object.values(scores).map(Number).filter(n => !isNaN(n));
  const total = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  run(`INSERT INTO evaluations (party_id, project_id, period, scores, total, notes, created_by)
       VALUES (?,?,?,?,?,?,?)`, Number(party_id), project_id, period, JSON.stringify(scores), total, notes, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'evaluation', id, `${period} — ${total}`);
  res.status(201).json({ id, total });
});

module.exports = router;
