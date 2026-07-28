// لوحة المعلومات، المؤشرات، الخريطة، التقارير، التصدير والاستيراد، التحليل الذكي
const express = require('express');
const { all, get, run, riskLevel } = require('../db');
const { requireAuth, requireAdmin, requirePerm, allowedProjectIds } = require('../auth');
const { checkEscalations, escalationRules } = require('../escalation');
const { logAudit } = require('./core');

const router = express.Router();
router.use(requireAuth);

// بناء شرط النطاق + الفلاتر المشتركة (فترة، مشروع، مقاول...)
function buildFilters(req, alias, dateCol) {
  const filters = [];
  const params = [];
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  if (ids) {
    if (!ids.length) filters.push('1=0');
    else { filters.push(`${alias}.project_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  }
  const { project_id, from, to, contractor_id, project_type, observer_id } = req.query;
  if (project_id) { filters.push(`${alias}.project_id = ?`); params.push(Number(project_id)); }
  if (from) { filters.push(`date(${alias}.${dateCol}) >= date(?)`); params.push(from); }
  if (to) { filters.push(`date(${alias}.${dateCol}) <= date(?)`); params.push(to); }
  if (contractor_id) { filters.push(`${alias}.project_id IN (SELECT id FROM projects WHERE contractor_id = ?)`); params.push(Number(contractor_id)); }
  if (project_type) { filters.push(`${alias}.project_id IN (SELECT id FROM projects WHERE type = ?)`); params.push(project_type); }
  if (observer_id && ['o', 't'].includes(alias)) { filters.push(`${alias}.observer_id = ?`); params.push(Number(observer_id)); }
  return { where: filters.length ? filters.join(' AND ') : '1=1', params };
}

// ===== لوحة المعلومات التنفيذية =====
router.get('/dashboard', (req, res) => {
  const obs = buildFilters(req, 'o', 'created_at');
  const tours = buildFilters(req, 't', 'planned_date');
  const inc = buildFilters(req, 'i', 'occurred_at');
  const act = buildFilters(req, 'a', 'created_at');

  const { severity, category, status: statusF, otype } = req.query;
  let obsExtra = '', obsParams = [...obs.params];
  if (severity) { obsExtra += ' AND o.severity = ?'; obsParams.push(severity); }
  if (category) { obsExtra += ' AND o.category = ?'; obsParams.push(category); }
  if (statusF) { obsExtra += ' AND o.status = ?'; obsParams.push(statusF); }
  if (otype) { obsExtra += ' AND o.otype = ?'; obsParams.push(otype); }
  const OBS = `FROM observations o WHERE ${obs.where}${obsExtra} AND o.archived = 0`;

  const d = {};
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  const projWhere = ids ? (ids.length ? `id IN (${ids.join(',')})` : '1=0') : '1=1';
  d.projects = {
    total: get(`SELECT COUNT(*) AS c FROM projects WHERE ${projWhere} AND archived = 0`).c,
    active: get(`SELECT COUNT(*) AS c FROM projects WHERE ${projWhere} AND status = 'active' AND archived = 0`).c,
  };
  d.tours = {
    planned: get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where}`, ...tours.params).c,
    completed: get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'completed'`, ...tours.params).c,
    missed: get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'missed'`, ...tours.params).c,
    in_progress: get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'in_progress'`, ...tours.params).c,
    upcoming: get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'planned'`, ...tours.params).c,
  };
  d.tours.execution_rate = d.tours.planned ? Math.round((d.tours.completed / Math.max(1, d.tours.completed + d.tours.missed)) * 100) : 0;

  d.observations = {
    total: get(`SELECT COUNT(*) AS c ${OBS}`, ...obsParams).c,
    open: get(`SELECT COUNT(*) AS c ${OBS} AND o.status NOT IN ('closed','rejected')`, ...obsParams).c,
    closed: get(`SELECT COUNT(*) AS c ${OBS} AND o.status = 'closed'`, ...obsParams).c,
    critical_open: get(`SELECT COUNT(*) AS c ${OBS} AND o.severity = 'critical' AND o.status NOT IN ('closed','rejected')`, ...obsParams).c,
    overdue: get(`SELECT COUNT(*) AS c ${OBS} AND o.status NOT IN ('closed','rejected') AND o.due_date IS NOT NULL AND date(o.due_date) < date('now')`, ...obsParams).c,
    escalated: get(`SELECT COUNT(*) AS c ${OBS} AND o.escalated = 1 AND o.status NOT IN ('closed','rejected')`, ...obsParams).c,
    violations: get(`SELECT COUNT(*) AS c ${OBS} AND o.otype = 'violation'`, ...obsParams).c,
  };
  d.by_severity = all(`SELECT o.severity, COUNT(*) AS c ${OBS} GROUP BY o.severity`, ...obsParams);
  d.by_category = all(`SELECT o.category, COUNT(*) AS c ${OBS} GROUP BY o.category ORDER BY c DESC LIMIT 10`, ...obsParams);
  d.by_status = all(`SELECT o.status, COUNT(*) AS c ${OBS} GROUP BY o.status`, ...obsParams);

  // نسبة الإغلاق ضمن المدة ومتوسط زمن المعالجة
  const closedRows = all(`SELECT o.due_date, o.closed_at, o.created_at ${OBS} AND o.status = 'closed' AND o.closed_at IS NOT NULL`, ...obsParams);
  const onTime = closedRows.filter(r => !r.due_date || new Date(r.closed_at) <= new Date(r.due_date + 'T23:59:59')).length;
  d.observations.on_time_closure_rate = closedRows.length ? Math.round((onTime / closedRows.length) * 100) : 0;
  const avgDays = closedRows.length
    ? closedRows.reduce((s, r) => s + (new Date(r.closed_at) - new Date(r.created_at)) / 864e5, 0) / closedRows.length
    : 0;
  d.observations.avg_closure_days = Math.round(avgDays * 10) / 10;

  // نسبة الالتزام من نتائج التفتيش
  const trTotal = get(`SELECT COUNT(*) AS c FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE ${tours.where} AND tr.result IN ('pass','fail')`, ...tours.params).c;
  const trPass = get(`SELECT COUNT(*) AS c FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE ${tours.where} AND tr.result = 'pass'`, ...tours.params).c;
  d.compliance_rate = trTotal ? Math.round((trPass / trTotal) * 100) : 0;

  d.incidents = {
    total: get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.archived = 0`, ...inc.params).c,
    injuries: get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.itype IN ('injury','fatality') AND i.archived = 0`, ...inc.params).c,
    near_miss: get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.itype = 'near_miss' AND i.archived = 0`, ...inc.params).c,
    open: get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.status != 'closed' AND i.archived = 0`, ...inc.params).c,
    by_type: all(`SELECT i.itype, COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.archived = 0 GROUP BY i.itype`, ...inc.params),
  };
  d.actions = {
    total: get(`SELECT COUNT(*) AS c FROM actions a WHERE ${act.where} AND a.archived = 0`, ...act.params).c,
    open: get(`SELECT COUNT(*) AS c FROM actions a WHERE ${act.where} AND a.status NOT IN ('closed','rejected') AND a.archived = 0`, ...act.params).c,
    overdue: get(`SELECT COUNT(*) AS c FROM actions a WHERE ${act.where} AND a.status NOT IN ('closed','rejected') AND a.due_date IS NOT NULL AND date(a.due_date) < date('now') AND a.archived = 0`, ...act.params).c,
    closed: get(`SELECT COUNT(*) AS c FROM actions a WHERE ${act.where} AND a.status = 'closed' AND a.archived = 0`, ...act.params).c,
  };
  const closedActs = all(`SELECT a.due_date, a.closed_at FROM actions a WHERE ${act.where} AND a.status = 'closed' AND a.closed_at IS NOT NULL`, ...act.params);
  const actOnTime = closedActs.filter(r => !r.due_date || new Date(r.closed_at) <= new Date(r.due_date + 'T23:59:59')).length;
  d.actions.on_time_rate = closedActs.length ? Math.round((actOnTime / closedActs.length) * 100) : 0;

  d.risks = {
    by_level: all(`SELECT CASE WHEN score >= 17 THEN 'critical' WHEN score >= 10 THEN 'high' WHEN score >= 5 THEN 'medium' ELSE 'low' END AS level,
                   COUNT(*) AS c FROM risks r WHERE r.archived = 0 ${ids ? (ids.length ? `AND r.project_id IN (${ids.join(',')})` : 'AND 1=0') : ''} AND r.status != 'closed' GROUP BY level`),
  };

  // اتجاه أسبوعي (آخر 12 أسبوعاً): ملاحظات مسجلة/مغلقة
  d.weekly_trend = all(
    `SELECT strftime('%Y-%W', o.created_at) AS wk, COUNT(*) AS created,
            SUM(CASE WHEN o.status = 'closed' THEN 1 ELSE 0 END) AS closed
     ${OBS} AND o.created_at >= datetime('now', '-84 days')
     GROUP BY wk ORDER BY wk`, ...obsParams);

  // أداء المشاريع: الأعلى والأقل التزاماً + مؤشر السلامة العام
  const projPerf = all(
    `SELECT p.id, p.name, p.risk_level,
       (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.archived = 0) AS obs_total,
       (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.status NOT IN ('closed','rejected') AND o.archived = 0) AS obs_open,
       (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.severity = 'critical' AND o.status NOT IN ('closed','rejected') AND o.archived = 0) AS critical_open,
       (SELECT COUNT(*) FROM incidents i WHERE i.project_id = p.id AND i.archived = 0) AS incidents,
       (SELECT COUNT(*) FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE t.project_id = p.id AND tr.result = 'pass') AS tr_pass,
       (SELECT COUNT(*) FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE t.project_id = p.id AND tr.result IN ('pass','fail')) AS tr_total
     FROM projects p WHERE ${projWhere} AND p.archived = 0 AND p.status = 'active'`);
  d.project_performance = projPerf.map(p => {
    const compliance = p.tr_total ? (p.tr_pass / p.tr_total) * 100 : 100;
    const closure = p.obs_total ? ((p.obs_total - p.obs_open) / p.obs_total) * 100 : 100;
    // مؤشر السلامة: التزام 50% + إغلاق 30% - خصم للحوادث والحرجة
    const safety = Math.max(0, Math.min(100, Math.round(compliance * 0.5 + closure * 0.3 + 20 - p.incidents * 3 - p.critical_open * 5)));
    return { ...p, compliance: Math.round(compliance), closure: Math.round(closure), safety_index: safety };
  }).sort((a, b) => b.safety_index - a.safety_index);

  // أداء المقاولين
  d.contractor_performance = all(
    `SELECT pa.id, pa.name, ROUND(AVG(e.total)) AS avg_score
     FROM evaluations e JOIN parties pa ON pa.id = e.party_id
     GROUP BY pa.id ORDER BY avg_score DESC`);

  // المؤشرات الاستباقية واللاحقة
  d.leading = {
    tours_completed: d.tours.completed,
    near_miss_reported: d.incidents.near_miss,
    compliance_rate: d.compliance_rate,
    active_permits: get(`SELECT COUNT(*) AS c FROM permits pr WHERE pr.status = 'active' ${ids ? (ids.length ? `AND pr.project_id IN (${ids.join(',')})` : 'AND 1=0') : ''}`).c,
  };
  const totalHours = get(`SELECT COALESCE(SUM(work_hours),0) AS h FROM projects WHERE ${projWhere} AND archived = 0`).h || 1;
  const recordable = d.incidents.injuries;
  const lost = get(`SELECT COALESCE(SUM(lost_hours),0) AS h FROM incidents i WHERE ${inc.where} AND i.archived = 0`, ...inc.params).h;
  d.lagging = {
    incidents_total: d.incidents.total,
    injuries: d.incidents.injuries,
    lost_hours: lost,
    trir: Math.round(((recordable * 200000) / totalHours) * 100) / 100,
    ltifr: Math.round(((recordable * 1000000) / totalHours) * 100) / 100,
  };

  // حظر العمل تحت أشعة الشمس (15 يونيو – 15 سبتمبر، 12:00–15:00) وفق قرار وزارة الموارد البشرية
  const now = new Date();
  const m = now.getMonth() + 1, day = now.getDate();
  const inSeason = (m === 6 && day >= 15) || m === 7 || m === 8 || (m === 9 && day <= 15);
  d.midday_ban = { in_season: inSeason, hours: '12:00 – 15:00', period: '15 يونيو – 15 سبتمبر' };

  // اجتماعات التوعية آخر 30 يوماً
  d.toolbox = {
    last30: get(`SELECT COUNT(*) AS c FROM toolbox_talks t WHERE ${tours.where.replace(/t\.planned_date/g, 't.talk_date')} AND t.talk_date >= date('now','-30 days')`, ...tours.params).c,
  };

  res.json(d);
});

// ===== بطاقات المؤشرات =====
router.get('/kpis', requirePerm('view_reports'), (req, res) => {
  const obs = buildFilters(req, 'o', 'created_at');
  const tours = buildFilters(req, 't', 'planned_date');
  const inc = buildFilters(req, 'i', 'occurred_at');
  const act = buildFilters(req, 'a', 'created_at');
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  const projWhere = ids ? (ids.length ? `id IN (${ids.join(',')})` : '1=0') : '1=1';

  const toursDone = get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'completed'`, ...tours.params).c;
  const toursMissed = get(`SELECT COUNT(*) AS c FROM tours t WHERE ${tours.where} AND t.status = 'missed'`, ...tours.params).c;
  const trTotal = get(`SELECT COUNT(*) AS c FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE ${tours.where} AND tr.result IN ('pass','fail')`, ...tours.params).c;
  const trPass = get(`SELECT COUNT(*) AS c FROM tour_results tr JOIN tours t ON t.id = tr.tour_id WHERE ${tours.where} AND tr.result = 'pass'`, ...tours.params).c;
  const obsTotal = get(`SELECT COUNT(*) AS c FROM observations o WHERE ${obs.where} AND o.archived = 0`, ...obs.params).c;
  const obsCriticalTotal = get(`SELECT COUNT(*) AS c FROM observations o WHERE ${obs.where} AND o.severity = 'critical' AND o.archived = 0`, ...obs.params).c;
  const closedRows = all(`SELECT o.due_date, o.closed_at, o.created_at FROM observations o WHERE ${obs.where} AND o.status = 'closed' AND o.closed_at IS NOT NULL AND o.archived = 0`, ...obs.params);
  const onTime = closedRows.filter(r => !r.due_date || new Date(r.closed_at) <= new Date(r.due_date + 'T23:59:59')).length;
  const closedActs = all(`SELECT a.closed_at, a.created_at FROM actions a WHERE ${act.where} AND a.status = 'closed' AND a.closed_at IS NOT NULL`, ...act.params);
  const avgActDays = closedActs.length ? Math.round(closedActs.reduce((s, r) => s + (new Date(r.closed_at) - new Date(r.created_at)) / 864e5, 0) / closedActs.length * 10) / 10 : 0;
  const injuries = get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.itype IN ('injury','fatality') AND i.archived = 0`, ...inc.params).c;
  const nearMiss = get(`SELECT COUNT(*) AS c FROM incidents i WHERE ${inc.where} AND i.itype = 'near_miss' AND i.archived = 0`, ...inc.params).c;
  const totalHours = get(`SELECT COALESCE(SUM(work_hours),0) AS h FROM projects WHERE ${projWhere} AND archived = 0`).h || 1;
  const highRisks = get(`SELECT COUNT(*) AS c FROM risks r WHERE r.archived = 0 AND r.score >= 10 ${ids ? (ids.length ? `AND r.project_id IN (${ids.join(',')})` : 'AND 1=0') : ''}`).c;
  const highRisksTreated = get(`SELECT COUNT(*) AS c FROM risks r WHERE r.archived = 0 AND r.score >= 10 AND r.status IN ('monitoring','closed') ${ids ? (ids.length ? `AND r.project_id IN (${ids.join(',')})` : 'AND 1=0') : ''}`).c;
  const lastInjury = get(`SELECT MAX(occurred_at) AS d FROM incidents i WHERE ${inc.where} AND i.itype IN ('injury','fatality') AND i.archived = 0`, ...inc.params).d;
  const activeProjects = get(`SELECT COUNT(*) AS c FROM projects WHERE ${projWhere} AND status = 'active' AND archived = 0`).c;

  // بطاقة تعريف لكل مؤشر
  const kpis = [
    { key: 'tour_execution', name: 'نسبة تنفيذ الجولات', unit: '%', formula: 'الجولات المنفذة ÷ (المنفذة + الفائتة) × 100', source: 'وحدة الجولات', frequency: 'أسبوعي', target: 90,
      value: (toursDone + toursMissed) ? Math.round(toursDone / (toursDone + toursMissed) * 100) : 0, direction: 'higher' },
    { key: 'compliance', name: 'نسبة الالتزام بقوائم التفتيش', unit: '%', formula: 'البنود المطابقة ÷ إجمالي البنود المقيمة × 100', source: 'نتائج التفتيش', frequency: 'أسبوعي', target: 85,
      value: trTotal ? Math.round(trPass / trTotal * 100) : 0, direction: 'higher' },
    { key: 'on_time_closure', name: 'نسبة إغلاق الملاحظات ضمن المدة', unit: '%', formula: 'المغلقة ضمن الاستحقاق ÷ إجمالي المغلقة × 100', source: 'وحدة الملاحظات', frequency: 'شهري', target: 80,
      value: closedRows.length ? Math.round(onTime / closedRows.length * 100) : 0, direction: 'higher' },
    { key: 'obs_per_project', name: 'متوسط الملاحظات لكل مشروع', unit: '', formula: 'إجمالي الملاحظات ÷ عدد المشاريع النشطة', source: 'وحدة الملاحظات', frequency: 'شهري', target: 20,
      value: activeProjects ? Math.round(obsTotal / activeProjects * 10) / 10 : 0, direction: 'lower' },
    { key: 'critical_obs', name: 'عدد الملاحظات الحرجة', unit: '', formula: 'عدد الملاحظات بدرجة حرجة خلال الفترة', source: 'وحدة الملاحظات', frequency: 'شهري', target: 5,
      value: obsCriticalTotal, direction: 'lower' },
    { key: 'trir', name: 'معدل الحوادث القابلة للتسجيل TRIR', unit: '', formula: '(الإصابات المسجلة × 200,000) ÷ ساعات العمل', source: 'وحدة الحوادث', frequency: 'ربع سنوي', target: 1.0,
      value: Math.round(injuries * 200000 / totalHours * 100) / 100, direction: 'lower' },
    { key: 'ltifr', name: 'معدل الإصابات المضيعة للوقت LTIFR', unit: '', formula: '(الإصابات المضيعة للوقت × 1,000,000) ÷ ساعات العمل', source: 'وحدة الحوادث', frequency: 'ربع سنوي', target: 2.0,
      value: Math.round(injuries * 1000000 / totalHours * 100) / 100, direction: 'lower' },
    { key: 'near_miss', name: 'عدد الحالات شبه الحادثة المبلغة', unit: '', formula: 'عدد بلاغات Near Miss خلال الفترة', source: 'وحدة الحوادث', frequency: 'شهري', target: 10,
      value: nearMiss, direction: 'higher' },
    { key: 'capa_avg_days', name: 'متوسط زمن إغلاق الإجراء التصحيحي', unit: 'يوم', formula: 'مجموع (تاريخ الإغلاق - تاريخ الإنشاء) ÷ عدد المغلقة', source: 'وحدة CAPA', frequency: 'شهري', target: 7,
      value: avgActDays, direction: 'lower' },
    { key: 'high_risk_treated', name: 'نسبة المخاطر المرتفعة المعالجة', unit: '%', formula: 'المخاطر المرتفعة تحت المراقبة/المغلقة ÷ إجمالي المرتفعة × 100', source: 'سجل المخاطر', frequency: 'شهري', target: 70,
      value: highRisks ? Math.round(highRisksTreated / highRisks * 100) : 100, direction: 'higher' },
    { key: 'hours_no_injury', name: 'أيام العمل دون إصابة', unit: 'يوم', formula: 'الأيام منذ آخر إصابة مسجلة', source: 'وحدة الحوادث', frequency: 'مستمر', target: 90,
      value: lastInjury ? Math.floor((Date.now() - new Date(lastInjury)) / 864e5) : 365, direction: 'higher' },
    { key: 'emergency_plans', name: 'نسبة المشاريع بخطة سلامة معتمدة', unit: '%', formula: 'المشاريع بخطة معتمدة ÷ إجمالي المشاريع النشطة × 100', source: 'سجل المشاريع', frequency: 'ربع سنوي', target: 100,
      value: activeProjects ? Math.round(get(`SELECT COUNT(*) AS c FROM projects WHERE ${projWhere} AND status = 'active' AND safety_plan_approved = 1 AND archived = 0`).c / activeProjects * 100) : 0, direction: 'higher' },
    { key: 'toolbox_coverage', name: 'نسبة تنفيذ اجتماعات التوعية Toolbox', unit: '%', formula: 'أيام العمل الموثقة باجتماع توعية ÷ (المشاريع النشطة × 30 يوماً) × 100', source: 'سجل التوعية والتدريب', frequency: 'شهري', target: 70,
      value: activeProjects ? Math.min(100, Math.round(
        get(`SELECT COUNT(DISTINCT project_id || ':' || talk_date) AS c FROM toolbox_talks
             WHERE talk_date >= date('now','-30 days') ${ids ? (ids.length ? `AND project_id IN (${ids.join(',')})` : 'AND 1=0') : ''}`).c
        / (activeProjects * 30) * 100)) : 0, direction: 'higher' },
    { key: 'gosi_compliance', name: 'الالتزام بمهلة إبلاغ التأمينات (3 أيام)', unit: '%', formula: 'الإصابات المبلغة ضمن المهلة ÷ إجمالي الإصابات × 100', source: 'وحدة الحوادث', frequency: 'شهري', target: 100,
      value: (() => {
        const injs = all(`SELECT occurred_at, gosi_reported, gosi_reported_at FROM incidents i WHERE ${inc.where} AND i.itype IN ('injury','fatality') AND i.archived = 0`, ...inc.params);
        if (!injs.length) return 100;
        const ok = injs.filter(x => x.gosi_reported && x.gosi_reported_at &&
          (new Date(x.gosi_reported_at) - new Date(x.occurred_at)) / 864e5 <= 3).length;
        return Math.round(ok / injs.length * 100);
      })(), direction: 'higher' },
  ];
  for (const k of kpis) {
    k.status = k.direction === 'higher'
      ? (k.value >= k.target ? 'good' : k.value >= k.target * 0.75 ? 'warning' : 'critical')
      : (k.value <= k.target ? 'good' : k.value <= k.target * 1.5 ? 'warning' : 'critical');
  }
  res.json(kpis);
});

// ===== الخريطة =====
router.get('/map', (req, res) => {
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  const projWhere = ids ? (ids.length ? `p.id IN (${ids.join(',')})` : '1=0') : '1=1';
  const obs = buildFilters(req, 'o', 'created_at');
  const inc = buildFilters(req, 'i', 'occurred_at');
  res.json({
    projects: all(`SELECT p.id, p.name, p.code, p.lat, p.lng, p.status, p.risk_level, p.geofence_radius FROM projects p WHERE ${projWhere} AND p.archived = 0 AND p.lat IS NOT NULL`),
    observations: all(`SELECT o.id, o.ref, o.lat, o.lng, o.severity, o.status, o.category, o.description, o.project_id
                       FROM observations o WHERE ${obs.where} AND o.archived = 0 AND o.lat IS NOT NULL LIMIT 1000`, ...obs.params),
    incidents: all(`SELECT i.id, i.ref, i.lat, i.lng, i.itype, i.description, i.project_id
                    FROM incidents i WHERE ${inc.where} AND i.archived = 0 AND i.lat IS NOT NULL LIMIT 500`, ...inc.params),
  });
});

// ===== التقارير =====
router.get('/reports/:type', requirePerm('view_reports'), (req, res) => {
  const type = req.params.type;
  const obs = buildFilters(req, 'o', 'created_at');
  const tours = buildFilters(req, 't', 'planned_date');
  const inc = buildFilters(req, 'i', 'occurred_at');
  const act = buildFilters(req, 'a', 'created_at');
  const org = get(`SELECT value FROM settings WHERE key = 'org_name'`)?.value || '';
  const meta = { org, generated_at: new Date().toISOString(), generated_by: req.user.full_name, filters: req.query };

  if (type === 'observations') {
    return res.json({ meta, rows: all(
      `SELECT o.*, p.name AS project_name, u.full_name AS observer_name
       FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id
       WHERE ${obs.where} AND o.archived = 0 ORDER BY o.created_at DESC LIMIT 2000`, ...obs.params) });
  }
  if (type === 'overdue') {
    return res.json({ meta, rows: all(
      `SELECT o.*, p.name AS project_name, u.full_name AS observer_name,
              CAST(julianday('now') - julianday(o.due_date) AS INTEGER) AS days_overdue
       FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id
       WHERE ${obs.where} AND o.archived = 0 AND o.status NOT IN ('closed','rejected')
         AND o.due_date IS NOT NULL AND date(o.due_date) < date('now')
       ORDER BY days_overdue DESC LIMIT 2000`, ...obs.params) });
  }
  if (type === 'incidents') {
    return res.json({ meta, rows: all(
      `SELECT i.*, p.name AS project_name FROM incidents i JOIN projects p ON p.id = i.project_id
       WHERE ${inc.where} AND i.archived = 0 ORDER BY i.occurred_at DESC LIMIT 2000`, ...inc.params) });
  }
  if (type === 'tours') {
    return res.json({ meta, rows: all(
      `SELECT t.*, p.name AS project_name, u.full_name AS observer_name,
        (SELECT COUNT(*) FROM observations o WHERE o.tour_id = t.id) AS obs_count
       FROM tours t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id
       WHERE ${tours.where} ORDER BY t.planned_date DESC LIMIT 2000`, ...tours.params) });
  }
  if (type === 'actions') {
    return res.json({ meta, rows: all(
      `SELECT a.*, p.name AS project_name FROM actions a JOIN projects p ON p.id = a.project_id
       WHERE ${act.where} AND a.archived = 0 ORDER BY a.created_at DESC LIMIT 2000`, ...act.params) });
  }
  if (type === 'risks') {
    const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
    const w = ids ? (ids.length ? `r.project_id IN (${ids.join(',')})` : '1=0') : '1=1';
    return res.json({ meta, rows: all(
      `SELECT r.*, p.name AS project_name FROM risks r JOIN projects p ON p.id = r.project_id
       WHERE ${w} AND r.archived = 0 ORDER BY r.score DESC LIMIT 2000`) });
  }
  if (type === 'tour_detail') {
    const id = Number(req.query.tour_id);
    const t = get(`SELECT t.*, p.name AS project_name, p.code AS project_code, u.full_name AS observer_name, ct.name AS template_name
                   FROM tours t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id
                   LEFT JOIN checklist_templates ct ON ct.id = t.template_id WHERE t.id = ?`, id);
    if (!t) return res.status(404).json({ error: 'الجولة غير موجودة' });
    t.results = all(`SELECT ci.text, tr.result, tr.note FROM tour_results tr JOIN checklist_items ci ON ci.id = tr.item_id WHERE tr.tour_id = ? ORDER BY ci.sort_order`, id);
    t.observations = all(`SELECT o.*, (SELECT COUNT(*) FROM attachments at WHERE at.entity_type='observation' AND at.entity_id=o.id) AS attachment_count FROM observations o WHERE o.tour_id = ?`, id);
    return res.json({ meta, tour: t });
  }
  res.status(404).json({ error: 'نوع التقرير غير معروف' });
});

// ===== التصدير CSV (متوافق مع Excel عبر BOM) =====
const EXPORT_QUERIES = {
  observations: `SELECT o.ref AS "الرقم المرجعي", p.name AS "المشروع", o.site AS "الموقع", o.category AS "التصنيف",
      o.otype AS "النوع", o.description AS "الوصف", o.severity AS "الخطورة", o.risk_score AS "درجة المخاطر",
      o.status AS "الحالة", o.due_date AS "الاستحقاق", u.full_name AS "الراصد", o.created_at AS "تاريخ التسجيل"
    FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id WHERE o.archived = 0 ORDER BY o.id DESC`,
  incidents: `SELECT i.ref AS "الرقم المرجعي", p.name AS "المشروع", i.itype AS "النوع", i.occurred_at AS "التاريخ",
      i.description AS "الوصف", i.lost_hours AS "الساعات المفقودة", i.status AS "الحالة"
    FROM incidents i JOIN projects p ON p.id = i.project_id WHERE i.archived = 0 ORDER BY i.occurred_at DESC`,
  actions: `SELECT a.ref AS "الرقم المرجعي", p.name AS "المشروع", a.description AS "الوصف", a.assignee AS "المسؤول",
      a.priority AS "الأولوية", a.due_date AS "الاستحقاق", a.progress AS "نسبة الإنجاز", a.status AS "الحالة"
    FROM actions a JOIN projects p ON p.id = a.project_id WHERE a.archived = 0 ORDER BY a.id DESC`,
  tours: `SELECT t.ref AS "الرقم المرجعي", p.name AS "المشروع", u.full_name AS "الراصد", t.planned_date AS "الموعد",
      t.status AS "الحالة", t.started_at AS "البداية", t.ended_at AS "النهاية"
    FROM tours t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id ORDER BY t.planned_date DESC`,
  projects: `SELECT p.code AS "الرمز", p.name AS "الاسم", p.type AS "النوع", p.location_text AS "الموقع",
      c.name AS "المقاول", s.name AS "الاستشاري", p.value AS "القيمة", p.progress_pct AS "نسبة الإنجاز",
      p.workers_count AS "عدد العاملين", p.status AS "الحالة", p.risk_level AS "مستوى المخاطر"
    FROM projects p LEFT JOIN parties c ON c.id = p.contractor_id LEFT JOIN parties s ON s.id = p.consultant_id WHERE p.archived = 0`,
  risks: `SELECT r.ref AS "الرقم المرجعي", p.name AS "المشروع", r.description AS "الوصف", r.likelihood AS "الاحتمالية",
      r.impact AS "الأثر", r.score AS "الدرجة", r.status AS "الحالة", r.owner AS "المالك"
    FROM risks r JOIN projects p ON p.id = r.project_id WHERE r.archived = 0 ORDER BY r.score DESC`,
  audit: `SELECT created_at AS "التاريخ", username AS "المستخدم", action AS "العملية", entity_type AS "الكيان", details AS "التفاصيل" FROM audit_log ORDER BY id DESC LIMIT 5000`,
};

function toCsv(rows) {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
}

router.get('/export/:entity', requirePerm('view_reports'), (req, res) => {
  const q = EXPORT_QUERIES[req.params.entity];
  if (!q) return res.status(404).json({ error: 'كيان غير معروف' });
  if (req.params.entity === 'audit' && req.user.role !== 'admin') return res.status(403).json({ error: 'صلاحية غير كافية' });
  // نطاق الراصد
  let rows = all(q);
  if (req.user.role !== 'admin') {
    const ids = new Set(allowedProjectIds(req.user));
    const names = new Set(all(`SELECT name FROM projects WHERE id IN (${[...ids].join(',') || 0})`).map(r => r.name));
    rows = rows.filter(r => !('المشروع' in r) || names.has(r['المشروع']));
  }
  logAudit(req, 'export', req.params.entity, null, `${rows.length} سجل`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.entity}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows));
});

// ===== الاستيراد من CSV (مشاريع/أطراف) =====
router.post('/import/:entity', requireAdmin, (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'لا توجد صفوف للاستيراد' });
  let imported = 0, errors = [];
  if (req.params.entity === 'parties') {
    for (const r of rows) {
      if (!r.name || !['contractor', 'consultant'].includes(r.kind)) { errors.push(r); continue; }
      run(`INSERT INTO parties (name, kind, contact_name, phone, email) VALUES (?,?,?,?,?)`,
        r.name, r.kind, r.contact_name || '', r.phone || '', r.email || '');
      imported++;
    }
  } else if (req.params.entity === 'projects') {
    for (const r of rows) {
      if (!r.code || !r.name || !r.type) { errors.push(r); continue; }
      if (get(`SELECT id FROM projects WHERE code = ?`, r.code)) { errors.push({ ...r, reason: 'رمز مكرر' }); continue; }
      run(`INSERT INTO projects (code, name, type, location_text, lat, lng, owner_entity, value, start_date, end_date, workers_count)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        r.code, r.name, r.type, r.location_text || '', r.lat || null, r.lng || null,
        r.owner_entity || '', Number(r.value) || 0, r.start_date || null, r.end_date || null, Number(r.workers_count) || 0);
      imported++;
    }
  } else return res.status(404).json({ error: 'كيان غير مدعوم للاستيراد' });
  logAudit(req, 'import', req.params.entity, null, `${imported} سجل`);
  res.json({ imported, failed: errors.length });
});

// ===== التقارير المجدولة وأرشيفها =====
const { runScheduledReports, REPORT_TITLES } = require('../reportgen');

router.get('/report-schedules', requireAdmin, (req, res) => {
  res.json(all(`SELECT s.*, p.name AS project_name FROM report_schedules s
    LEFT JOIN projects p ON p.id = s.project_id ORDER BY s.id DESC`));
});

router.post('/report-schedules', requireAdmin, (req, res) => {
  const { report_type, frequency, project_id = null } = req.body || {};
  if (!REPORT_TITLES[report_type] || !['weekly', 'monthly'].includes(frequency))
    return res.status(400).json({ error: 'اختر نوع التقرير والدورية' });
  run(`INSERT INTO report_schedules (report_type, frequency, project_id, created_by) VALUES (?,?,?,?)`,
    report_type, frequency, project_id ? Number(project_id) : null, req.user.id);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'report_schedule', id, `${report_type} ${frequency}`);
  res.status(201).json({ id });
});

router.put('/report-schedules/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const s = get(`SELECT * FROM report_schedules WHERE id = ?`, id);
  if (!s) return res.status(404).json({ error: 'غير موجود' });
  if (req.body?.active !== undefined)
    run(`UPDATE report_schedules SET active = ? WHERE id = ?`, req.body.active ? 1 : 0, id);
  res.json({ ok: true });
});

router.delete('/report-schedules/:id', requireAdmin, (req, res) => {
  run(`DELETE FROM report_schedules WHERE id = ?`, Number(req.params.id));
  logAudit(req, 'delete', 'report_schedule', Number(req.params.id));
  res.json({ ok: true });
});

// تشغيل فوري (يولّد كل الجداول النشطة الآن)
router.post('/report-schedules/run', requireAdmin, (req, res) => {
  const r = runScheduledReports(true);
  logAudit(req, 'run', 'report_schedule', null, `${r.generated} تقرير`);
  res.json(r);
});

router.get('/report-archive', requirePerm('view_reports'), (req, res) => {
  res.json(all(`SELECT a.id, a.report_type, a.title, a.period_from, a.period_to, a.created_at, p.name AS project_name
    FROM report_archive a LEFT JOIN projects p ON p.id = a.project_id
    ORDER BY a.id DESC LIMIT ?`, Number(req.query.limit) || 100));
});

router.get('/report-archive/:id', requirePerm('view_reports'), (req, res) => {
  const a = get(`SELECT * FROM report_archive WHERE id = ?`, Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'التقرير غير موجود' });
  res.json({ ...a, payload: JSON.parse(a.payload) });
});

// ===== الأرشيف والاسترجاع =====
const ARCHIVE_ENTITIES = {
  observations: { table: 'observations', label: 'ref', desc: 'description' },
  incidents: { table: 'incidents', label: 'ref', desc: 'description' },
  actions: { table: 'actions', label: 'ref', desc: 'description' },
  risks: { table: 'risks', label: 'ref', desc: 'description' },
  permits: { table: 'permits', label: 'ref', desc: 'description' },
  projects: { table: 'projects', label: 'code', desc: 'name' },
};

router.get('/archive', requireAdmin, (req, res) => {
  const def = ARCHIVE_ENTITIES[req.query.entity];
  if (!def) return res.status(400).json({ error: 'كيان غير معروف' });
  const hasProject = def.table !== 'projects';
  const rows = all(
    `SELECT t.id, t.${def.label} AS label, t.${def.desc} AS description
       ${hasProject ? ', p.name AS project_name' : ''}
     FROM ${def.table} t ${hasProject ? 'JOIN projects p ON p.id = t.project_id' : ''}
     WHERE t.archived = 1 ORDER BY t.id DESC LIMIT 300`);
  const entityType = def.table === 'projects' ? 'project'
    : def.table.slice(0, -1); // observation/incident/action/risk/permit
  for (const r of rows) {
    const a = get(`SELECT username, created_at FROM audit_log
      WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1`, entityType, r.id);
    r.last_by = a?.username || '—';
    r.last_at = a?.created_at || null;
  }
  res.json(rows);
});

router.post('/archive/restore', requireAdmin, (req, res) => {
  const { entity, id } = req.body || {};
  const def = ARCHIVE_ENTITIES[entity];
  if (!def || !id) return res.status(400).json({ error: 'حدد الكيان والسجل' });
  run(`UPDATE ${def.table} SET archived = 0 WHERE id = ?`, Number(id));
  logAudit(req, 'restore', def.table === 'projects' ? 'project' : def.table.slice(0, -1), Number(id), 'استرجاع من الأرشيف');
  res.json({ ok: true });
});

// فحص التصعيدات يدوياً
router.post('/escalations/check', requireAdmin, (req, res) => {
  const result = checkEscalations();
  logAudit(req, 'escalation_check', 'system', null, JSON.stringify(result));
  res.json(result);
});

// حالة التصعيد الشاملة — لصفحة «التصعيد والمهل»
router.get('/escalations/status', requireAdmin, (req, res) => {
  const rules = escalationRules();
  const slaRow = get(`SELECT value FROM settings WHERE key = 'sla_days'`);
  const sla = slaRow ? JSON.parse(slaRow.value) : { low: 14, medium: 7, high: 3, critical: 1 };

  const escalatedObs = all(
    `SELECT o.id, o.ref, o.severity, o.status, o.due_date, p.name AS project_name, u.full_name AS observer_name,
       CAST(julianday('now') - julianday(o.due_date) AS INTEGER) AS days_overdue
     FROM observations o JOIN projects p ON p.id = o.project_id JOIN users u ON u.id = o.observer_id
     WHERE o.escalated = 1 AND o.status NOT IN ('closed','rejected') AND o.archived = 0
     ORDER BY days_overdue DESC LIMIT 200`);
  const escalatedActions = all(
    `SELECT a.id, a.ref, a.priority, a.status, a.due_date, a.assignee, p.name AS project_name,
       CAST(julianday('now') - julianday(a.due_date) AS INTEGER) AS days_overdue
     FROM actions a JOIN projects p ON p.id = a.project_id
     WHERE a.escalated = 1 AND a.status NOT IN ('closed','rejected') AND a.archived = 0
     ORDER BY days_overdue DESC LIMIT 200`);
  const missedTours = all(
    `SELECT t.id, t.ref, t.planned_date, p.name AS project_name, u.full_name AS observer_name
     FROM tours t JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id
     WHERE t.status = 'missed' ORDER BY t.planned_date DESC LIMIT 100`);
  const upcoming = all(
    `SELECT o.id, o.ref, o.severity, o.due_date, p.name AS project_name
     FROM observations o JOIN projects p ON p.id = o.project_id
     WHERE o.status NOT IN ('closed','rejected','draft') AND o.archived = 0
       AND o.due_date IS NOT NULL AND date(o.due_date) >= date('now')
       AND date(o.due_date) <= date('now', '+' || ? || ' days')
     ORDER BY o.due_date LIMIT 200`, Number(rules.remind_before_days) || 0);

  res.json({ rules, sla, escalatedObs, escalatedActions, missedTours, upcoming });
});

// ===== التحليل الذكي (قواعد استدلالية قابلة للتطوير بنماذج ذكاء اصطناعي) =====
const CAT_KEYWORDS = {
  ppe: ['خوذ', 'سترة', 'سترات', 'حذاء', 'أحذية', 'قفاز', 'نظارة', 'واقي', 'كمامة'],
  height: ['ارتفاع', 'مرتفعات', 'سقوط', 'حزام أمان', 'حافة'],
  excavation: ['حفر', 'حفرية', 'خندق', 'تدعيم', 'انهيار جوانب'],
  lifting: ['رافعة', 'رفع', 'ونش', 'أحمال', 'حبال'],
  equipment: ['معدة', 'معدات', 'آلية', 'شيول', 'بلدوزر', 'حفارة'],
  traffic: ['مرور', 'تحويلة', 'طريق', 'مركبات', 'سيارة', 'حواجز'],
  electrical: ['كهرباء', 'كهربائية', 'توصيلات', 'جهد', 'صعق', 'قاطع'],
  hotwork: ['لحام', 'قطع', 'ساخنة', 'شرر', 'أوكسجين'],
  scaffold: ['سقالة', 'سقالات', 'سلم', 'سلالم', 'درابزين'],
  fire: ['حريق', 'طفاية', 'إطفاء', 'اشتعال', 'وقود'],
  housekeeping: ['نظافة', 'مخلفات', 'ترتيب', 'نفايات', 'مبعثرة'],
  health: ['حرارة', 'إجهاد', 'شمس', 'ظهيرة', 'مياه شرب'],
  environment: ['بيئة', 'انسكاب', 'تلوث', 'صرف', 'غبار'],
};

router.post('/ai/classify', (req, res) => {
  const desc = String(req.body?.description || '');
  if (!desc) return res.status(400).json({ error: 'أدخل وصف الملاحظة' });
  const scores = {};
  for (const [cat, words] of Object.entries(CAT_KEYWORDS))
    scores[cat] = words.reduce((s, w) => s + (desc.includes(w) ? 1 : 0), 0);
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const category = best[1] > 0 ? best[0] : null;
  // اقتراح الخطورة من كلمات دلالية
  const criticalWords = ['وفاة', 'انهيار', 'صعق', 'سقوط من', 'حريق', 'اختناق', 'غاز'];
  const highWords = ['بدون حزام', 'دون تدعيم', 'مكشوفة', 'خطر', 'عميق'];
  let severity = 'medium';
  if (criticalWords.some(w => desc.includes(w))) severity = 'critical';
  else if (highWords.some(w => desc.includes(w))) severity = 'high';
  res.json({ category, severity, confidence: best[1] > 1 ? 'high' : best[1] === 1 ? 'medium' : 'low' });
});

// ===== المساعد الذكي: اسأل المنصة (محرك قواعد عربي داخلي) =====
router.post('/ai/ask', (req, res) => {
  const q = String(req.body?.question || '').trim();
  if (!q) return res.status(400).json({ error: 'اكتب سؤالك' });
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  const scope = col => ids ? (ids.length ? `AND ${col} IN (${ids.join(',')})` : 'AND 1=0') : '';

  // استخراج المشروع من نص السؤال
  const projs = all(`SELECT id, name, code FROM projects WHERE archived = 0 ${ids ? (ids.length ? `AND id IN (${ids.join(',')})` : 'AND 1=0') : ''}`);
  const norm = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ');
  const nq = norm(q);
  const proj = projs.find(p => {
    const words = norm(p.name).split(' ').filter(w => w.length > 3 && !['مشروع', 'تطوير', 'طريق', 'الملك', 'الامير'].includes(w));
    return nq.includes(norm(p.code).toLowerCase()) || words.some(w => nq.includes(w));
  });
  const pFilter = proj ? `AND project_id = ${proj.id}` : '';
  const pLabel = proj ? ` في «${proj.name}»` : '';
  const pQ = proj ? `&project_id=${proj.id}` : '';

  // استخراج الفترة
  let from = null, label = '';
  const today = new Date().toISOString().slice(0, 10);
  if (/اليوم/.test(q)) { from = today; label = ' اليوم'; }
  else if (/الاسبوع|الأسبوع/.test(q)) { const d = new Date(); d.setDate(d.getDate() - d.getDay()); from = d.toISOString().slice(0, 10); label = ' هذا الأسبوع'; }
  else if (/الشهر/.test(q)) { from = today.slice(0, 8) + '01'; label = ' هذا الشهر'; }
  const dFilter = c => from ? `AND date(${c}) >= date('${from}')` : '';
  const dQ = from ? `&from=${from}` : '';

  const has = (...words) => words.some(w => nq.includes(norm(w)));
  const reply = (answer, links = []) => res.json({ answer, links });

  // أعلى مشروع
  if (has('اي مشروع', 'أي مشروع', 'الاكثر', 'الأكثر', 'الاعلى', 'الأعلى', 'اسوأ', 'أسوأ')) {
    const metric = has('حادث', 'اصاب') ? 'incidents' : 'observations';
    const sevF = has('حرج') ? "AND severity = 'critical'" : '';
    const rows = all(metric === 'incidents'
      ? `SELECT p.name, COUNT(*) c FROM incidents i JOIN projects p ON p.id = i.project_id WHERE i.archived = 0 ${scope('i.project_id')} ${dFilter('i.occurred_at')} GROUP BY p.id ORDER BY c DESC LIMIT 3`
      : `SELECT p.name, COUNT(*) c FROM observations o JOIN projects p ON p.id = o.project_id WHERE o.archived = 0 AND o.status NOT IN ('closed','rejected') ${sevF} ${scope('o.project_id')} ${dFilter('o.created_at')} GROUP BY p.id ORDER BY c DESC LIMIT 3`);
    if (!rows.length) return reply('لا توجد بيانات مطابقة.');
    return reply(
      `الأعلى${label}:\n` + rows.map((r, i) => `${i + 1}. ${r.name} — ${r.c}`).join('\n'),
      [{ label: 'فتح القائمة', hash: metric === 'incidents' ? '#/incidents' : `#/observations?open_only=1${has('حرج') ? '&severity=critical' : ''}` }]);
  }
  // نسبة الالتزام
  if (has('التزام')) {
    const r = get(`SELECT SUM(tr.result='pass') p, SUM(tr.result IN ('pass','fail')) t
      FROM tour_results tr JOIN tours tt ON tt.id = tr.tour_id WHERE 1=1 ${proj ? `AND tt.project_id = ${proj.id}` : scope('tt.project_id')} ${dFilter('tt.planned_date')}`);
    return reply(`نسبة الالتزام بقوائم التفتيش${pLabel}${label}: ${r.t ? Math.round(r.p / r.t * 100) : 0}% (من ${r.t || 0} بنداً مقيماً)`,
      [{ label: 'مؤشرات الأداء', hash: '#/kpis' }]);
  }
  // نسبة تنفيذ الجولات / جولات
  if (has('جول')) {
    if (has('نسبه', 'نسبة', 'تنفيذ')) {
      const r = get(`SELECT SUM(status='completed') c, SUM(status='missed') m FROM tours WHERE 1=1 ${pFilter} ${scope('project_id')} ${dFilter('planned_date')}`);
      return reply(`نسبة تنفيذ الجولات${pLabel}${label}: ${(r.c + r.m) ? Math.round(r.c / (r.c + r.m) * 100) : 0}% (${r.c || 0} منفذة / ${r.m || 0} فائتة)`,
        [{ label: 'الجولات', hash: `#/tours?${pQ}${dQ}` }]);
    }
    const c = get(`SELECT COUNT(*) c FROM tours WHERE 1=1 ${pFilter} ${scope('project_id')} ${from ? dFilter('planned_date') : `AND planned_date = '${today}'`}`).c;
    return reply(`${c} جولة${pLabel}${label || ' اليوم'}`, [{ label: 'الجولات', hash: `#/tours?${pQ}` }]);
  }
  // الحوادث والإصابات
  if (has('حادث', 'حوادث', 'اصاب', 'إصاب')) {
    const injOnly = has('اصاب', 'إصاب');
    const c = get(`SELECT COUNT(*) c FROM incidents WHERE archived = 0 ${injOnly ? "AND itype IN ('injury','fatality')" : ''} ${pFilter} ${scope('project_id')} ${dFilter('occurred_at')}`).c;
    return reply(`${c} ${injOnly ? 'إصابة' : 'حادثاً'}${pLabel}${label}`, [{ label: 'الحوادث', hash: `#/incidents?${pQ}${dQ}` }]);
  }
  // الإجراءات التصحيحية
  if (has('اجراء', 'إجراء')) {
    const overdue = has('متاخر', 'متأخر');
    const c = get(`SELECT COUNT(*) c FROM actions WHERE archived = 0 AND status NOT IN ('closed','rejected')
      ${overdue ? "AND due_date IS NOT NULL AND date(due_date) < date('now')" : ''} ${pFilter} ${scope('project_id')}`).c;
    return reply(`${c} إجراء تصحيحي ${overdue ? 'متأخر' : 'مفتوح'}${pLabel}`,
      [{ label: 'الإجراءات', hash: `#/actions?${overdue ? 'overdue=1' : ''}${pQ}` }]);
  }
  // التصاريح
  if (has('تصريح', 'تصاريح')) {
    const c = get(`SELECT COUNT(*) c FROM permits WHERE archived = 0 AND status = 'active' ${pFilter} ${scope('project_id')}`).c;
    return reply(`${c} تصريح عمل ساري${pLabel}`, [{ label: 'التصاريح', hash: `#/permits?status=active${pQ}` }]);
  }
  // المخاطر
  if (has('مخاطر', 'خطر')) {
    const c = get(`SELECT COUNT(*) c FROM risks WHERE archived = 0 AND status != 'closed' AND score >= 10 ${pFilter} ${scope('project_id')}`).c;
    return reply(`${c} خطراً مرتفعاً/حرجاً نشطاً${pLabel}`, [{ label: 'سجل المخاطر', hash: `#/risks?${pQ}` }]);
  }
  // الملاحظات (الافتراضي الأوسع)
  if (has('ملاحظ', 'مخالف', 'كم')) {
    const crit = has('حرج');
    const overdue = has('متاخر', 'متأخر');
    const violations = has('مخالف');
    const closed = has('مغلق');
    const open = has('مفتوح') || (!closed && !overdue);
    let where = 'archived = 0', qs = [];
    if (crit) { where += " AND severity = 'critical'"; qs.push('severity=critical'); }
    if (violations) { where += " AND otype = 'violation'"; qs.push('otype=violation'); }
    if (closed) { where += " AND status = 'closed'"; qs.push('status=closed'); }
    else if (overdue) { where += " AND status NOT IN ('closed','rejected') AND due_date IS NOT NULL AND date(due_date) < date('now')"; qs.push('escalated=1'); }
    else if (open && has('مفتوح')) { where += " AND status NOT IN ('closed','rejected')"; qs.push('open_only=1'); }
    const c = get(`SELECT COUNT(*) c FROM observations WHERE ${where} ${pFilter} ${scope('project_id')} ${dFilter('created_at')}`).c;
    const desc = [crit && 'حرجة', violations && 'مخالفة', overdue && 'متأخرة', closed && 'مغلقة', (open && has('مفتوح')) && 'مفتوحة'].filter(Boolean).join(' ');
    return reply(`${c} ملاحظة ${desc}${pLabel}${label}`,
      [{ label: 'فتح القائمة المفلترة', hash: `#/observations?${qs.join('&')}${pQ}${dQ}` }]);
  }
  // إرشاد
  reply('لم أفهم السؤال تماماً. جرب مثلاً:\n• كم ملاحظة حرجة مفتوحة في مشروع النسيم؟\n• كم حادثاً هذا الشهر؟\n• أي مشروع الأكثر ملاحظات؟\n• ما نسبة الالتزام؟\n• كم إجراءً متأخراً؟');
});

router.get('/ai/insights', (req, res) => {
  const ids = req.user.role === 'admin' ? null : allowedProjectIds(req.user);
  const w = ids ? (ids.length ? `o.project_id IN (${ids.join(',')})` : '1=0') : '1=1';
  const insights = [];
  // الملاحظات المتكررة
  const repeated = all(
    `SELECT o.project_id, p.name, o.category, COUNT(*) AS c FROM observations o JOIN projects p ON p.id = o.project_id
     WHERE ${w} AND o.archived = 0 AND o.created_at >= datetime('now','-30 days')
     GROUP BY o.project_id, o.category HAVING c >= 3 ORDER BY c DESC LIMIT 5`);
  for (const r of repeated)
    insights.push({ kind: 'repeat', title: 'تكرار ملاحظات من نفس التصنيف',
      body: `تكررت ملاحظات «${r.category}» في «${r.name}» ${r.c} مرات خلال 30 يوماً — يوصى بمراجعة السبب الجذري وخطة تدريب مستهدفة.` });
  // مشاريع الأعلى عرضة للحوادث (ملاحظات حرجة مفتوحة + حوادث سابقة)
  const risky = all(
    `SELECT p.id, p.name,
       (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.severity IN ('high','critical') AND o.status NOT IN ('closed','rejected') AND o.archived = 0) AS open_high,
       (SELECT COUNT(*) FROM incidents i WHERE i.project_id = p.id AND i.archived = 0 AND i.occurred_at >= datetime('now','-60 days')) AS recent_inc
     FROM projects p WHERE ${ids ? (ids.length ? `p.id IN (${ids.join(',')})` : '1=0') : '1=1'} AND p.archived = 0 AND p.status = 'active'
     ORDER BY (open_high * 2 + recent_inc * 3) DESC LIMIT 3`);
  for (const r of risky.filter(x => x.open_high + x.recent_inc > 2))
    insights.push({ kind: 'predict', title: 'مشروع مرشح لارتفاع احتمالية الحوادث',
      body: `«${r.name}» لديه ${r.open_high} ملاحظة عالية/حرجة مفتوحة و${r.recent_inc} حادثاً خلال 60 يوماً — يوصى بتكثيف الجولات والتدقيق على الأنشطة عالية الخطورة.` });
  // أنماط غير طبيعية في أداء المقاولين
  const anomaly = all(
    `SELECT pa.name, AVG(e.total) AS avg_total, MIN(e.total) AS min_total FROM evaluations e JOIN parties pa ON pa.id = e.party_id
     GROUP BY pa.id HAVING avg_total - min_total > 15 LIMIT 3`);
  for (const a of anomaly)
    insights.push({ kind: 'anomaly', title: 'تذبذب في أداء مقاول',
      body: `«${a.name}» سجل تراجعاً ملحوظاً في أحد التقييمات (${Math.round(a.min_total)} مقابل متوسط ${Math.round(a.avg_total)}) — يوصى بمراجعة أسباب التراجع.` });
  // ملخص تنفيذي آلي
  const openCritical = get(`SELECT COUNT(*) AS c FROM observations o WHERE ${w} AND o.severity = 'critical' AND o.status NOT IN ('closed','rejected') AND o.archived = 0`).c;
  const overdue = get(`SELECT COUNT(*) AS c FROM observations o WHERE ${w} AND o.status NOT IN ('closed','rejected') AND o.due_date IS NOT NULL AND date(o.due_date) < date('now') AND o.archived = 0`).c;
  insights.push({ kind: 'summary', title: 'الملخص التنفيذي الآلي',
    body: `يوجد حالياً ${openCritical} ملاحظة حرجة مفتوحة و${overdue} ملاحظة متجاوزة للاستحقاق. ${openCritical > 0 ? 'الأولوية القصوى: إغلاق الملاحظات الحرجة ومتابعة توصيات إيقاف العمل.' : 'الوضع العام تحت السيطرة — يوصى بالاستمرار في وتيرة الجولات الحالية.'}` });
  res.json(insights);
});

module.exports = router;
