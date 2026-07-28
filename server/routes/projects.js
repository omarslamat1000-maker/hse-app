// المشاريع، الجولات الميدانية، قوائم التفتيش
const express = require('express');
const { all, get, run, nextRef, riskLevel, slaDays } = require('../db');
const { requireAuth, requireAdmin, requirePerm, can, noContractor, allowedProjectIds, canAccessProject } = require('../auth');
const { notifyUser, notifyAdmins } = require('../escalation');

const router = express.Router();
router.use(requireAuth);
const { logAudit } = require('./core');

// نطاق المشاريع للمستخدم الحالي (شرط SQL) — col هو اسم العمود المؤهل بالكامل
function projectScope(req, col = 'id') {
  if (req.user.role === 'admin') return { where: '1=1', params: [] };
  const ids = allowedProjectIds(req.user);
  if (!ids.length) return { where: '1=0', params: [] };
  return { where: `${col} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

// مسافة بالمتر بين إحداثيتين (هافرساين)
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ===== المشاريع =====
router.get('/projects', (req, res) => {
  const scope = projectScope(req, 'p.id');
  const includeArchived = req.query.archived === '1' && req.user.role === 'admin';
  const rows = all(
    `SELECT p.*, c.name AS contractor_name, s.name AS consultant_name
     FROM projects p
     LEFT JOIN parties c ON c.id = p.contractor_id
     LEFT JOIN parties s ON s.id = p.consultant_id
     WHERE ${scope.where} ${includeArchived ? '' : 'AND p.archived = 0'}
     ORDER BY p.id`, ...scope.params);
  // إحصاءات سريعة لكل مشروع
  for (const p of rows) {
    p.open_obs = get(`SELECT COUNT(*) AS c FROM observations WHERE project_id = ? AND status NOT IN ('closed','rejected') AND archived = 0`, p.id).c;
    p.incidents = get(`SELECT COUNT(*) AS c FROM incidents WHERE project_id = ? AND archived = 0`, p.id).c;
  }
  res.json(rows);
});

router.get('/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!canAccessProject(req.user, id)) return res.status(403).json({ error: 'لا تملك صلاحية على هذا المشروع' });
  const p = get(
    `SELECT p.*, c.name AS contractor_name, s.name AS consultant_name
     FROM projects p LEFT JOIN parties c ON c.id = p.contractor_id LEFT JOIN parties s ON s.id = p.consultant_id
     WHERE p.id = ?`, id);
  if (!p) return res.status(404).json({ error: 'المشروع غير موجود' });
  p.tours = all(`SELECT t.*, u.full_name AS observer_name FROM tours t JOIN users u ON u.id = t.observer_id
                 WHERE t.project_id = ? ORDER BY t.planned_date DESC LIMIT 50`, id);
  p.observations = all(`SELECT * FROM observations WHERE project_id = ? AND archived = 0 ORDER BY id DESC LIMIT 100`, id);
  p.incidents = all(`SELECT * FROM incidents WHERE project_id = ? AND archived = 0 ORDER BY occurred_at DESC`, id);
  p.actions = all(`SELECT * FROM actions WHERE project_id = ? AND archived = 0 ORDER BY id DESC LIMIT 100`, id);
  p.risks = all(`SELECT * FROM risks WHERE project_id = ? AND archived = 0 ORDER BY score DESC`, id);
  p.permits = all(`SELECT * FROM permits WHERE project_id = ? AND archived = 0 ORDER BY id DESC`, id);
  p.attachments = all(`SELECT * FROM attachments WHERE entity_type = 'project' AND entity_id = ?`, id);
  p.observers = all(`SELECT u.id, u.full_name FROM users u JOIN project_assignments a ON a.user_id = u.id WHERE a.project_id = ?`, id);
  res.json(p);
});

const PROJECT_FIELDS = ['code','name','description','type','location_text','lat','lng','geofence_radius','owner_entity',
  'contractor_id','consultant_id','project_manager','safety_officer','value','start_date','end_date',
  'progress_pct','workers_count','work_hours','status','risk_level','safety_plan_approved'];

router.post('/projects', requirePerm('manage_projects'), (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.name || !b.type) return res.status(400).json({ error: 'رمز المشروع واسمه ونوعه حقول إلزامية' });
  if (get(`SELECT id FROM projects WHERE code = ?`, b.code)) return res.status(409).json({ error: 'رمز المشروع مستخدم مسبقاً' });
  const cols = PROJECT_FIELDS.filter(f => b[f] !== undefined);
  run(`INSERT INTO projects (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    ...cols.map(f => b[f]));
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'project', id, b.name);
  res.status(201).json({ id });
});

router.put('/projects/:id', requirePerm('manage_projects'), (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM projects WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'المشروع غير موجود' });
  const b = req.body || {};
  const cols = PROJECT_FIELDS.filter(f => b[f] !== undefined);
  if (cols.length)
    run(`UPDATE projects SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, ...cols.map(f => b[f]), id);
  if (b.archived !== undefined) run(`UPDATE projects SET archived = ? WHERE id = ?`, b.archived ? 1 : 0, id);
  logAudit(req, 'update', 'project', id, p.name);
  res.json({ ok: true });
});

// حذف مشروع — يُسمح فقط إذا لم تكن له سجلات مرتبطة، وإلا فالأرشفة هي البديل
router.delete('/projects/:id', requirePerm('manage_projects'), (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM projects WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'المشروع غير موجود' });
  const related = {
    'جولات': get(`SELECT COUNT(*) AS c FROM tours WHERE project_id = ?`, id).c,
    'ملاحظات': get(`SELECT COUNT(*) AS c FROM observations WHERE project_id = ?`, id).c,
    'حوادث': get(`SELECT COUNT(*) AS c FROM incidents WHERE project_id = ?`, id).c,
    'إجراءات': get(`SELECT COUNT(*) AS c FROM actions WHERE project_id = ?`, id).c,
    'مخاطر': get(`SELECT COUNT(*) AS c FROM risks WHERE project_id = ?`, id).c,
    'تصاريح': get(`SELECT COUNT(*) AS c FROM permits WHERE project_id = ?`, id).c,
  };
  const found = Object.entries(related).filter(([, c]) => c > 0);
  if (found.length) {
    return res.status(409).json({
      error: `لا يمكن حذف المشروع لوجود سجلات مرتبطة (${found.map(([k, c]) => `${c} ${k}`).join('، ')}). قواعد العمل تمنع حذف السجلات — استخدم الأرشفة بدلاً من ذلك.`,
      can_archive: true,
    });
  }
  run(`DELETE FROM project_assignments WHERE project_id = ?`, id);
  run(`DELETE FROM attachments WHERE entity_type = 'project' AND entity_id = ?`, id);
  run(`DELETE FROM projects WHERE id = ?`, id);
  logAudit(req, 'delete', 'project', id, `حذف نهائي: ${p.name} (${p.code})`);
  res.json({ ok: true });
});

// ===== قوائم التفتيش =====
router.get('/checklists', (req, res) => {
  const templates = all(`SELECT * FROM checklist_templates ORDER BY name`);
  const items = all(`SELECT * FROM checklist_items ORDER BY template_id, sort_order`);
  for (const t of templates) t.items = items.filter(i => i.template_id === t.id);
  res.json(templates);
});

router.post('/checklists', requirePerm('edit_checklists'), (req, res) => {
  const { name, category, project_type = '', items = [] } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'اسم النموذج والفئة إلزاميان' });
  run(`INSERT INTO checklist_templates (name, category, project_type) VALUES (?,?,?)`, name, category, project_type);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  items.forEach((t, i) => t && run(`INSERT INTO checklist_items (template_id, text, sort_order) VALUES (?,?,?)`, id, String(t), i));
  logAudit(req, 'create', 'checklist', id, name);
  res.status(201).json({ id });
});

router.put('/checklists/:id', requirePerm('edit_checklists'), (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT * FROM checklist_templates WHERE id = ?`, id);
  if (!t) return res.status(404).json({ error: 'النموذج غير موجود' });
  const { name, category, active, items } = req.body || {};
  run(`UPDATE checklist_templates SET name = ?, category = ?, active = ? WHERE id = ?`,
    name ?? t.name, category ?? t.category, active === undefined ? t.active : (active ? 1 : 0), id);
  if (Array.isArray(items)) {
    // البنود المستخدمة في نتائج سابقة لا تحذف — تُحدّث القائمة بإضافة الجديد وتعطيل ترتيب القديم
    const used = new Set(all(`SELECT DISTINCT item_id FROM tour_results tr JOIN checklist_items ci ON ci.id = tr.item_id WHERE ci.template_id = ?`, id).map(r => r.item_id));
    const existing = all(`SELECT id FROM checklist_items WHERE template_id = ?`, id);
    for (const e of existing) if (!used.has(e.id)) run(`DELETE FROM checklist_items WHERE id = ?`, e.id);
    items.forEach((txt, i) => txt && run(`INSERT INTO checklist_items (template_id, text, sort_order) VALUES (?,?,?)`, id, String(txt), i));
  }
  logAudit(req, 'update', 'checklist', id, name ?? t.name);
  res.json({ ok: true });
});

// ===== الجولات =====
router.get('/tours', noContractor, (req, res) => {
  const scope = projectScope(req);
  const filters = [`t.project_id IN (SELECT id FROM projects WHERE ${scope.where})`];
  const params = [...scope.params];
  if (req.user.role === 'observer') { filters.push('t.observer_id = ?'); params.push(req.user.id); }
  const { status, project_id, observer_id, from, to } = req.query;
  if (status) { filters.push('t.status = ?'); params.push(status); }
  if (project_id) { filters.push('t.project_id = ?'); params.push(Number(project_id)); }
  if (observer_id && req.user.role === 'admin') { filters.push('t.observer_id = ?'); params.push(Number(observer_id)); }
  if (from) { filters.push('date(t.planned_date) >= date(?)'); params.push(from); }
  if (to) { filters.push('date(t.planned_date) <= date(?)'); params.push(to); }
  const rows = all(
    `SELECT t.*, p.name AS project_name, p.lat AS project_lat, p.lng AS project_lng, p.geofence_radius,
            u.full_name AS observer_name, ct.name AS template_name,
            (SELECT COUNT(*) FROM observations o WHERE o.tour_id = t.id) AS obs_count
     FROM tours t
     JOIN projects p ON p.id = t.project_id
     JOIN users u ON u.id = t.observer_id
     LEFT JOIN checklist_templates ct ON ct.id = t.template_id
     WHERE ${filters.join(' AND ')}
     ORDER BY t.planned_date DESC, t.id DESC LIMIT 500`, ...params);
  res.json(rows);
});

router.get('/tours/:id', noContractor, (req, res) => {
  const t = get(
    `SELECT t.*, p.name AS project_name, p.lat AS project_lat, p.lng AS project_lng, p.geofence_radius,
            u.full_name AS observer_name, ct.name AS template_name
     FROM tours t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id
     LEFT JOIN checklist_templates ct ON ct.id = t.template_id WHERE t.id = ?`, Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
  if (!canAccessProject(req.user, t.project_id)) return res.status(403).json({ error: 'لا تملك صلاحية' });
  if (t.observer_id !== req.user.id && !can(req.user, 'assign_tours'))
    return res.status(403).json({ error: 'هذه الجولة مكلف بها راصد آخر' });
  t.items = t.template_id
    ? all(`SELECT ci.*, tr.result, tr.note AS result_note, tr.severity AS result_severity
           FROM checklist_items ci
           LEFT JOIN tour_results tr ON tr.item_id = ci.id AND tr.tour_id = ?
           WHERE ci.template_id = ? ORDER BY ci.sort_order`, t.id, t.template_id)
    : [];
  t.observations = all(`SELECT * FROM observations WHERE tour_id = ? ORDER BY id`, t.id);
  res.json(t);
});

router.post('/tours', requirePerm('assign_tours'), (req, res) => {
  const { project_id, observer_id, template_id = null, site = '', planned_date, planned_period = 'morning', notes = '' } = req.body || {};
  if (!project_id || !observer_id || !planned_date)
    return res.status(400).json({ error: 'المشروع والراصد وتاريخ الجولة حقول إلزامية' });
  const assigned = get(`SELECT 1 AS ok FROM project_assignments WHERE user_id = ? AND project_id = ?`, observer_id, project_id);
  if (!assigned) return res.status(400).json({ error: 'الراصد غير مكلف بهذا المشروع — أضف التكليف أولاً من إدارة المستخدمين' });
  const ref = nextRef('TUR', 'tours');
  run(`INSERT INTO tours (ref, project_id, observer_id, template_id, site, planned_date, planned_period, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`, ref, project_id, observer_id, template_id, site, planned_date, planned_period, notes, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  const pname = get(`SELECT name FROM projects WHERE id = ?`, project_id).name;
  notifyUser(observer_id, 'تكليف بجولة جديدة', `تم تكليفك بجولة ${ref} على «${pname}» بتاريخ ${planned_date}.`, 'tour', 'tour', id);
  logAudit(req, 'create', 'tour', id, ref);
  res.status(201).json({ id, ref });
});

router.put('/tours/:id', requirePerm('assign_tours'), (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT * FROM tours WHERE id = ?`, id);
  if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
  const b = req.body || {};
  const fields = ['observer_id','template_id','site','planned_date','planned_period','notes','status'];
  const cols = fields.filter(f => b[f] !== undefined);
  if (cols.length) run(`UPDATE tours SET ${cols.map(f => `${f} = ?`).join(', ')} WHERE id = ?`, ...cols.map(f => b[f]), id);
  // إشعار الراصد عند إعادة الجدولة أو تغيير التكليف
  const newObserver = b.observer_id !== undefined ? Number(b.observer_id) : t.observer_id;
  if (b.planned_date && b.planned_date !== t.planned_date) {
    const pname = get(`SELECT name FROM projects WHERE id = ?`, t.project_id).name;
    notifyUser(newObserver, 'إعادة جدولة جولة',
      `أُعيدت جدولة الجولة ${t.ref} على «${pname}» إلى ${b.planned_date}.`, 'tour', 'tour', id);
  } else if (b.observer_id !== undefined && Number(b.observer_id) !== t.observer_id) {
    const pname = get(`SELECT name FROM projects WHERE id = ?`, t.project_id).name;
    notifyUser(newObserver, 'تكليف بجولة', `تم تكليفك بالجولة ${t.ref} على «${pname}» بتاريخ ${b.planned_date || t.planned_date}.`, 'tour', 'tour', id);
  }
  logAudit(req, 'update', 'tour', id, t.ref);
  res.json({ ok: true });
});

// بدء الجولة — تحقق جغرافي
router.post('/tours/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT t.*, p.lat AS plat, p.lng AS plng, p.geofence_radius AS radius, p.name AS pname
                 FROM tours t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`, id);
  if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
  if (t.observer_id !== req.user.id && !can(req.user, 'assign_tours'))
    return res.status(403).json({ error: 'هذه الجولة مكلف بها راصد آخر' });
  if (t.status !== 'planned') return res.status(400).json({ error: 'لا يمكن بدء جولة حالتها ليست «مخططة»' });
  const { lat, lng, geofence_note = '' } = req.body || {};
  let geofenceOk = null, note = geofence_note;
  if (lat != null && lng != null && t.plat != null) {
    const dist = Math.round(distanceMeters(Number(lat), Number(lng), t.plat, t.plng));
    geofenceOk = dist <= (t.radius || 500) ? 1 : 0;
    if (!geofenceOk) {
      if (!geofence_note)
        return res.status(422).json({
          error: `موقعك يبعد ${dist} م عن نطاق المشروع (${t.radius || 500} م). أدخل توضيحاً لتسجيل الاستثناء.`,
          distance: dist, requires_note: true,
        });
      note = `خارج النطاق (${dist} م): ${geofence_note}`;
      notifyAdmins('بدء جولة خارج النطاق الجغرافي',
        `الراصد ${req.user.full_name} بدأ الجولة ${t.ref} على «${t.pname}» من خارج النطاق — التوضيح: ${geofence_note}`,
        'warning', 'tour', id);
    }
  }
  run(`UPDATE tours SET status = 'in_progress', started_at = datetime('now'), start_lat = ?, start_lng = ?,
        geofence_ok = ?, geofence_note = ? WHERE id = ?`, lat ?? null, lng ?? null, geofenceOk, note, id);
  logAudit(req, 'tour_start', 'tour', id, t.ref);
  res.json({ ok: true, geofence_ok: geofenceOk });
});

// إنهاء الجولة
router.post('/tours/:id/finish', (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT * FROM tours WHERE id = ?`, id);
  if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
  if (t.observer_id !== req.user.id && !can(req.user, 'assign_tours'))
    return res.status(403).json({ error: 'هذه الجولة مكلف بها راصد آخر' });
  if (t.status !== 'in_progress') return res.status(400).json({ error: 'الجولة ليست قيد التنفيذ' });
  const { lat, lng, notes } = req.body || {};
  run(`UPDATE tours SET status = 'completed', ended_at = datetime('now'), end_lat = ?, end_lng = ?,
        notes = COALESCE(?, notes) WHERE id = ?`, lat ?? null, lng ?? null, notes ?? null, id);
  logAudit(req, 'tour_finish', 'tour', id, t.ref);
  res.json({ ok: true });
});

// حفظ نتائج قائمة التفتيش (دفعة واحدة أو تدريجياً)
router.post('/tours/:id/results', (req, res) => {
  const id = Number(req.params.id);
  const t = get(`SELECT * FROM tours WHERE id = ?`, id);
  if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
  if (t.observer_id !== req.user.id && !can(req.user, 'assign_tours'))
    return res.status(403).json({ error: 'هذه الجولة مكلف بها راصد آخر' });
  const results = Array.isArray(req.body?.results) ? req.body.results : [];
  for (const r of results) {
    if (!r.item_id || !['pass','fail','na','followup'].includes(r.result)) continue;
    run(`INSERT INTO tour_results (tour_id, item_id, result, note, severity) VALUES (?,?,?,?,?)
         ON CONFLICT(tour_id, item_id) DO UPDATE SET result = excluded.result, note = excluded.note, severity = excluded.severity`,
      id, Number(r.item_id), r.result, r.note || '', r.severity || '');
  }
  logAudit(req, 'tour_results', 'tour', id, `${results.length} بند`);
  res.json({ ok: true, saved: results.length });
});

module.exports = router;
