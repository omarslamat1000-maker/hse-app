// مولد التقارير المجدولة + المجدوِل الدوري
const { all, get, run } = require('./db');
const { notifyAdmins } = require('./escalation');

const REPORT_TITLES = {
  executive: 'تقرير السلامة التنفيذي',
  observations: 'تقرير الملاحظات والمخالفات',
  overdue: 'تقرير الملاحظات المتأخرة',
  incidents: 'تقرير الحوادث',
  actions: 'تقرير الإجراءات التصحيحية',
  tours: 'تقرير الجولات',
  risks: 'تقرير المخاطر',
};

// توليد حمولة تقرير عامة البنية: { title, stats: [{label,value}], sections: [{title, columns, rows}] }
function generateReport(reportType, projectId, from, to) {
  const pf = projectId ? 'AND project_id = ?' : '';
  const pp = projectId ? [projectId] : [];
  const range = `AND date(created_at) >= date(?) AND date(created_at) <= date(?)`;
  const rp = [from, to];
  const projName = projectId ? (get(`SELECT name FROM projects WHERE id = ?`, projectId)?.name || '') : 'جميع المشاريع';
  const title = `${REPORT_TITLES[reportType] || reportType} — ${projName}`;
  const out = { title, period_from: from, period_to: to, stats: [], sections: [] };

  const sevAr = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' };
  const stAr = {
    draft: 'مسودة', submitted: 'مسجلة', under_review: 'تحت المراجعة', approved: 'معتمدة',
    assigned: 'محالة', in_progress: 'جارٍ التنفيذ', pending_verification: 'بانتظار التحقق',
    closed: 'مغلقة', rejected: 'مرفوضة', reopened: 'معاد فتحها',
    open: 'مفتوح', investigating: 'قيد التحقيق', actions: 'إجراءات جارية',
    planned: 'مخططة', completed: 'منفذة', missed: 'فائتة', cancelled: 'ملغاة',
    mitigating: 'قيد المعالجة', monitoring: 'تحت المراقبة',
  };

  if (reportType === 'executive' || reportType === 'observations' || reportType === 'overdue') {
    const obs = all(`SELECT o.*, p.name AS pname FROM observations o JOIN projects p ON p.id = o.project_id
      WHERE o.archived = 0 ${pf ? 'AND o.project_id = ?' : ''} ${range.replace(/created_at/g, 'o.created_at')}
      ORDER BY o.id DESC LIMIT 500`, ...pp, ...rp);
    if (reportType !== 'overdue') {
      out.stats.push(
        { label: 'ملاحظات الفترة', value: obs.length },
        { label: 'حرجة', value: obs.filter(o => o.severity === 'critical').length },
        { label: 'مخالفات', value: obs.filter(o => o.otype === 'violation').length },
        { label: 'أُغلقت', value: obs.filter(o => o.status === 'closed').length },
      );
    }
    if (reportType === 'observations') {
      out.sections.push({
        title: 'سجل الملاحظات',
        columns: ['المرجع', 'المشروع', 'الوصف', 'الخطورة', 'الحالة', 'الاستحقاق'],
        rows: obs.map(o => [o.ref, o.pname, o.description.slice(0, 60), sevAr[o.severity], stAr[o.status], o.due_date || '—']),
      });
    }
    if (reportType === 'overdue') {
      const od = all(`SELECT o.*, p.name AS pname, CAST(julianday('now') - julianday(o.due_date) AS INTEGER) AS days_overdue
        FROM observations o JOIN projects p ON p.id = o.project_id
        WHERE o.archived = 0 AND o.status NOT IN ('closed','rejected')
          AND o.due_date IS NOT NULL AND date(o.due_date) < date('now') ${pf ? 'AND o.project_id = ?' : ''}
        ORDER BY days_overdue DESC LIMIT 500`, ...pp);
      out.stats.push({ label: 'متأخرة حالياً', value: od.length },
        { label: 'أقصى تأخير (يوم)', value: od[0]?.days_overdue || 0 });
      out.sections.push({
        title: 'الملاحظات المتجاوزة للاستحقاق',
        columns: ['المرجع', 'المشروع', 'الوصف', 'الخطورة', 'الاستحقاق', 'أيام التأخير'],
        rows: od.map(o => [o.ref, o.pname, o.description.slice(0, 60), sevAr[o.severity], o.due_date, o.days_overdue]),
      });
    }
    if (reportType === 'executive') {
      const tours = all(`SELECT status, COUNT(*) c FROM tours WHERE date(planned_date) >= date(?) AND date(planned_date) <= date(?) ${pf} GROUP BY status`, from, to, ...pp);
      const tget = s => tours.find(x => x.status === s)?.c || 0;
      const incs = all(`SELECT i.*, p.name AS pname FROM incidents i JOIN projects p ON p.id = i.project_id
        WHERE i.archived = 0 ${pf ? 'AND i.project_id = ?' : ''} AND date(i.occurred_at) >= date(?) AND date(i.occurred_at) <= date(?)`, ...pp, from, to);
      const acts = get(`SELECT SUM(status NOT IN ('closed','rejected')) open,
        SUM(status NOT IN ('closed','rejected') AND due_date IS NOT NULL AND date(due_date) < date('now')) overdue
        FROM actions WHERE archived = 0 ${pf}`, ...pp);
      const tr = get(`SELECT SUM(tr.result='pass') p, SUM(tr.result IN ('pass','fail')) t
        FROM tour_results tr JOIN tours tt ON tt.id = tr.tour_id
        WHERE date(tt.planned_date) >= date(?) AND date(tt.planned_date) <= date(?) ${pf ? 'AND tt.project_id = ?' : ''}`, from, to, ...pp);
      out.stats.push(
        { label: 'جولات منفذة', value: tget('completed') },
        { label: 'جولات فائتة', value: tget('missed') },
        { label: 'نسبة الالتزام %', value: tr.t ? Math.round(tr.p / tr.t * 100) : 0 },
        { label: 'حوادث الفترة', value: incs.length },
        { label: 'إصابات', value: incs.filter(i => ['injury', 'fatality'].includes(i.itype)).length },
        { label: 'إجراءات مفتوحة', value: acts.open || 0 },
        { label: 'إجراءات متأخرة', value: acts.overdue || 0 },
      );
      const perf = all(`SELECT p.name,
          (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.status NOT IN ('closed','rejected') AND o.archived = 0) open_obs,
          (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id AND o.severity = 'critical' AND o.status NOT IN ('closed','rejected') AND o.archived = 0) crit
        FROM projects p WHERE p.archived = 0 AND p.status = 'active' ${projectId ? 'AND p.id = ?' : ''}
        ORDER BY open_obs DESC LIMIT 10`, ...pp);
      out.sections.push({
        title: 'المشاريع حسب الملاحظات المفتوحة',
        columns: ['المشروع', 'ملاحظات مفتوحة', 'حرجة مفتوحة'],
        rows: perf.map(x => [x.name, x.open_obs, x.crit]),
      });
      out.sections.push({
        title: 'الملاحظات الحرجة خلال الفترة',
        columns: ['المرجع', 'المشروع', 'الوصف', 'الحالة'],
        rows: obs.filter(o => o.severity === 'critical').map(o => [o.ref, o.pname, o.description.slice(0, 70), stAr[o.status]]),
      });
    }
  } else if (reportType === 'incidents') {
    const incs = all(`SELECT i.*, p.name AS pname FROM incidents i JOIN projects p ON p.id = i.project_id
      WHERE i.archived = 0 ${pf ? 'AND i.project_id = ?' : ''} AND date(i.occurred_at) >= date(?) AND date(i.occurred_at) <= date(?)
      ORDER BY i.occurred_at DESC LIMIT 500`, ...pp, from, to);
    const iAr = { accident: 'حادث', injury: 'إصابة', fatality: 'وفاة', property: 'أضرار', fire: 'حريق', spill: 'انسكاب', near_miss: 'شبه حادثة', unsafe_condition: 'حالة غير آمنة', unsafe_act: 'سلوك غير آمن' };
    out.stats.push({ label: 'أحداث الفترة', value: incs.length },
      { label: 'إصابات ووفيات', value: incs.filter(i => ['injury', 'fatality'].includes(i.itype)).length },
      { label: 'شبه حادثة', value: incs.filter(i => i.itype === 'near_miss').length });
    out.sections.push({
      title: 'سجل الأحداث',
      columns: ['المرجع', 'المشروع', 'النوع', 'التاريخ', 'الوصف', 'الحالة'],
      rows: incs.map(i => [i.ref, i.pname, iAr[i.itype], i.occurred_at.slice(0, 10), i.description.slice(0, 55), stAr[i.status]]),
    });
  } else if (reportType === 'actions') {
    const acts = all(`SELECT a.*, p.name AS pname FROM actions a JOIN projects p ON p.id = a.project_id
      WHERE a.archived = 0 ${pf ? 'AND a.project_id = ?' : ''} ${range.replace(/created_at/g, 'a.created_at')}
      ORDER BY a.id DESC LIMIT 500`, ...pp, ...rp);
    out.stats.push({ label: 'إجراءات الفترة', value: acts.length },
      { label: 'أُغلقت', value: acts.filter(a => a.status === 'closed').length });
    out.sections.push({
      title: 'سجل الإجراءات',
      columns: ['المرجع', 'المشروع', 'الوصف', 'المسؤول', 'الاستحقاق', 'الإنجاز %', 'الحالة'],
      rows: acts.map(a => [a.ref, a.pname, a.description.slice(0, 50), a.assignee, a.due_date || '—', a.progress, stAr[a.status]]),
    });
  } else if (reportType === 'tours') {
    const tours = all(`SELECT t.*, p.name AS pname, u.full_name AS uname FROM tours t
      JOIN projects p ON p.id = t.project_id JOIN users u ON u.id = t.observer_id
      WHERE date(t.planned_date) >= date(?) AND date(t.planned_date) <= date(?) ${pf}
      ORDER BY t.planned_date DESC LIMIT 500`, from, to, ...pp);
    out.stats.push({ label: 'جولات الفترة', value: tours.length },
      { label: 'منفذة', value: tours.filter(t => t.status === 'completed').length },
      { label: 'فائتة', value: tours.filter(t => t.status === 'missed').length });
    out.sections.push({
      title: 'سجل الجولات',
      columns: ['المرجع', 'المشروع', 'الراصد', 'الموعد', 'الحالة'],
      rows: tours.map(t => [t.ref, t.pname, t.uname, t.planned_date, stAr[t.status]]),
    });
  } else if (reportType === 'risks') {
    const risks = all(`SELECT r.*, p.name AS pname FROM risks r JOIN projects p ON p.id = r.project_id
      WHERE r.archived = 0 ${pf ? 'AND r.project_id = ?' : ''} ORDER BY r.score DESC LIMIT 500`, ...pp);
    out.stats.push({ label: 'مخاطر مسجلة', value: risks.length },
      { label: 'مرتفعة/حرجة نشطة', value: risks.filter(r => r.score >= 10 && r.status !== 'closed').length });
    out.sections.push({
      title: 'سجل المخاطر',
      columns: ['المرجع', 'المشروع', 'الخطر', 'الدرجة', 'المتبقية', 'الحالة'],
      rows: risks.map(r => [r.ref, r.pname, r.description.slice(0, 55), r.score, r.residual_score ?? '—', stAr[r.status]]),
    });
  }
  return out;
}

// حفظ تقرير في الأرشيف + إشعار
function archiveReport(scheduleId, reportType, projectId, from, to, freqLabel) {
  const payload = generateReport(reportType, projectId, from, to);
  run(`INSERT INTO report_archive (schedule_id, report_type, title, period_from, period_to, project_id, payload)
       VALUES (?,?,?,?,?,?,?)`,
    scheduleId, reportType, `${payload.title} (${freqLabel})`, from, to, projectId, JSON.stringify(payload));
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  notifyAdmins('صدر تقرير مجدول', `${payload.title} — الفترة ${from} إلى ${to}`, 'report', 'report', id);
  return id;
}

function dateOnly(d) { return d.toISOString().slice(0, 10); }

// فحص الاستحقاق وتشغيل التقارير المجدولة
function runScheduledReports(force = false) {
  const schedules = all(`SELECT * FROM report_schedules WHERE active = 1`);
  const now = new Date();
  let generated = 0;
  for (const s of schedules) {
    let due = false, from, to, freqLabel;
    if (s.frequency === 'weekly') {
      // أسبوع سعودي يبدأ الأحد — يستحق إن لم يصدر خلال الأسبوع الحالي
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); // الأحد
      due = !s.last_run || new Date(s.last_run) < new Date(dateOnly(weekStart));
      const prevEnd = new Date(weekStart); prevEnd.setDate(weekStart.getDate() - 1);
      const prevStart = new Date(weekStart); prevStart.setDate(weekStart.getDate() - 7);
      from = dateOnly(prevStart); to = dateOnly(prevEnd); freqLabel = 'أسبوعي';
    } else {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      due = !s.last_run || new Date(s.last_run) < monthStart;
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      from = dateOnly(prevStart); to = dateOnly(prevEnd); freqLabel = 'شهري';
    }
    if (due || force) {
      archiveReport(s.id, s.report_type, s.project_id, from, to, freqLabel);
      run(`UPDATE report_schedules SET last_run = datetime('now') WHERE id = ?`, s.id);
      generated++;
    }
  }
  return { generated };
}

module.exports = { generateReport, archiveReport, runScheduledReports, REPORT_TITLES };
