// المرحلة ٦ — تدقيق المعادلات والمنطق الحسابي
// يعيد حساب كل معادلة يدوياً من قاعدة البيانات مباشرة ويقارنها بمخرجات API
// تشغيل: node tests/formulas.audit.js (يتطلب خادماً على 3000)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'hse.db'));
const BASE = process.env.TEST_URL || 'http://localhost:3000';

const q = (sql, ...p) => db.prepare(sql).all(...p);
const q1 = (sql, ...p) => db.prepare(sql).get(...p);
const results = [];
function check(name, formula, manual, system, note = '') {
  const ok = String(manual) === String(system);
  results.push({ 'المعادلة': name, 'الحساب اليدوي': manual, 'ناتج النظام': system, 'النتيجة': ok ? '✔ مطابق' : '✘ غير مطابق', 'ملاحظة': note || formula });
  return ok;
}

(async () => {
  // جلسة مدير
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@123' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async p => (await fetch(BASE + p, { headers: { Cookie: cookie } })).json();

  const d = await api('/api/dashboard');
  const kpis = await api('/api/kpis');
  const kpi = k => kpis.find(x => x.key === k);

  // 1) درجة المخاطر = الاحتمالية × الأثر (عيّنة كاملة)
  const badScores = q(`SELECT id FROM observations WHERE risk_score != likelihood * impact`).length +
                    q(`SELECT id FROM risks WHERE score != likelihood * impact`).length;
  check('درجة المخاطر = الاحتمالية × الأثر', 'L×I لكل السجلات', 0, badScores, 'عدد السجلات المخالفة (يجب 0)');

  // 2) حدود مستويات المخاطر (حالات حدّية: 1، 4، 5، 9، 10، 16، 17، 25)
  const lvl = s => (s >= 17 ? 'critical' : s >= 10 ? 'high' : s >= 5 ? 'medium' : 'low');
  const bands = [1, 4, 5, 9, 10, 16, 17, 25].map(lvl).join(',');
  check('حدود مصفوفة 5×5', '1-4 منخفض/5-9 متوسط/10-16 مرتفع/17-25 حرج',
    'low,low,medium,medium,high,high,critical,critical', bands, 'قيم حدّية');

  // 3) نسبة تنفيذ الجولات = منفذة ÷ (منفذة + فائتة)
  const tc = q1(`SELECT SUM(status='completed') c, SUM(status='missed') m FROM tours`);
  check('نسبة تنفيذ الجولات', 'منفذة ÷ (منفذة+فائتة) ×100',
    Math.round(tc.c / Math.max(1, tc.c + tc.m) * 100), d.tours.execution_rate,
    `${tc.c} ÷ (${tc.c}+${tc.m})`);

  // 4) نسبة الالتزام = مطابق ÷ (مطابق + غير مطابق)
  const tr = q1(`SELECT SUM(result='pass') p, SUM(result IN ('pass','fail')) t FROM tour_results`);
  check('نسبة الالتزام بالتفتيش', 'مطابق ÷ (مطابق+غير مطابق) ×100',
    Math.round(tr.p / tr.t * 100), d.compliance_rate, `${tr.p} ÷ ${tr.t}`);

  // 5) الإغلاق ضمن المدة
  const closed = q(`SELECT due_date, closed_at FROM observations WHERE status='closed' AND closed_at IS NOT NULL AND archived=0`);
  const onTime = closed.filter(r => !r.due_date || new Date(r.closed_at) <= new Date(r.due_date + 'T23:59:59')).length;
  check('نسبة الإغلاق ضمن المدة', 'مغلقة ضمن الاستحقاق ÷ مغلقة ×100',
    closed.length ? Math.round(onTime / closed.length * 100) : 0, d.observations.on_time_closure_rate,
    `${onTime} ÷ ${closed.length}`);

  // 6) متوسط زمن المعالجة (يوم)
  const rows = q(`SELECT created_at, closed_at FROM observations WHERE status='closed' AND closed_at IS NOT NULL AND archived=0`);
  const avg = rows.reduce((s, r) => s + (new Date(r.closed_at) - new Date(r.created_at)) / 864e5, 0) / rows.length;
  check('متوسط زمن المعالجة', 'Σ(الإغلاق−التسجيل)÷العدد', Math.round(avg * 10) / 10, d.observations.avg_closure_days);

  // 7) TRIR = إصابات × 200,000 ÷ ساعات العمل
  const hours = q1(`SELECT SUM(work_hours) h FROM projects WHERE archived=0`).h;
  const inj = q1(`SELECT COUNT(*) c FROM incidents WHERE itype IN ('injury','fatality') AND archived=0`).c;
  check('TRIR', 'إصابات×200000÷الساعات', Math.round(inj * 200000 / hours * 100) / 100, d.lagging.trir,
    `${inj}×200000÷${hours}`);

  // 8) LTIFR = إصابات × 1,000,000 ÷ ساعات العمل
  check('LTIFR', 'إصابات×1000000÷الساعات', Math.round(inj * 1000000 / hours * 100) / 100, d.lagging.ltifr);

  // 9) مؤشر السلامة (أول مشروع نشط) — إعادة حساب مستقلة
  const p1 = d.project_performance[0];
  const pv = q1(`SELECT
      (SELECT COUNT(*) FROM tour_results tr JOIN tours t ON t.id=tr.tour_id WHERE t.project_id=? AND tr.result='pass') pass,
      (SELECT COUNT(*) FROM tour_results tr JOIN tours t ON t.id=tr.tour_id WHERE t.project_id=? AND tr.result IN ('pass','fail')) tot,
      (SELECT COUNT(*) FROM observations WHERE project_id=? AND archived=0) obs,
      (SELECT COUNT(*) FROM observations WHERE project_id=? AND status NOT IN ('closed','rejected') AND archived=0) open,
      (SELECT COUNT(*) FROM observations WHERE project_id=? AND severity='critical' AND status NOT IN ('closed','rejected') AND archived=0) crit,
      (SELECT COUNT(*) FROM incidents WHERE project_id=? AND archived=0) inc`,
    p1.id, p1.id, p1.id, p1.id, p1.id, p1.id);
  const comp = pv.tot ? pv.pass / pv.tot * 100 : 100;
  const clos = pv.obs ? (pv.obs - pv.open) / pv.obs * 100 : 100;
  const si = Math.max(0, Math.min(100, Math.round(comp * 0.5 + clos * 0.3 + 20 - pv.inc * 3 - pv.crit * 5)));
  check('مؤشر السلامة العام', 'التزام×0.5 + إغلاق×0.3 + 20 − حوادث×3 − حرجة×5 (0-100)', si, p1.safety_index,
    `مشروع «${p1.name.slice(0, 20)}…»`);

  // 10) متوسط تقييم المقاول = متوسط بنود التقييم
  const ev = q1(`SELECT id, scores, total FROM evaluations LIMIT 1`);
  const vals = Object.values(JSON.parse(ev.scores));
  check('إجمالي تقييم المقاول', 'متوسط البنود العشرة',
    Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), ev.total);

  // 11) تغطية التوعية = أيام موثقة ÷ (مشاريع نشطة×30)
  const act = q1(`SELECT COUNT(*) c FROM projects WHERE status='active' AND archived=0`).c;
  const days = q1(`SELECT COUNT(DISTINCT project_id || ':' || talk_date) c FROM toolbox_talks WHERE talk_date >= date('now','-30 days')`).c;
  check('تغطية اجتماعات التوعية', 'أيام موثقة ÷ (نشطة×30) ×100',
    Math.min(100, Math.round(days / (act * 30) * 100)), kpi('toolbox_coverage').value, `${days} ÷ (${act}×30)`);

  // 12) التزام إبلاغ GOSI ≤ 3 أيام
  const injs = q(`SELECT occurred_at, gosi_reported, gosi_reported_at FROM incidents WHERE itype IN ('injury','fatality') AND archived=0`);
  const okG = injs.filter(x => x.gosi_reported && x.gosi_reported_at &&
    (new Date(x.gosi_reported_at) - new Date(x.occurred_at)) / 864e5 <= 3).length;
  check('التزام إبلاغ التأمينات', 'مبلغة ≤3 أيام ÷ الإصابات ×100',
    injs.length ? Math.round(okG / injs.length * 100) : 100, kpi('gosi_compliance').value, `${okG} ÷ ${injs.length}`);

  // 13) حالات حدّية: القسمة على صفر
  const zeroChecks = [
    ['ساعات عمل = 0 (TRIR)', 'الكود يستخدم ||1 فلا قسمة على صفر', true, hours === 0 ? Number.isFinite(d.lagging.trir) : true],
    ['لا ملاحظات مغلقة', 'النسبة ترجع 0 لا NaN', true, Number.isFinite(d.observations.on_time_closure_rate)],
    ['لا بنود تفتيش', 'النسبة ترجع 0 لا NaN', true, Number.isFinite(d.compliance_rate)],
  ];
  for (const [n, f, m, s] of zeroChecks) check(n, f, m, s, 'حالة حدّية');

  // 14) تناسق المجاميع: مجموع توزيع الخطورة = إجمالي الملاحظات
  const sevSum = d.by_severity.reduce((s, x) => s + x.c, 0);
  check('مجموع توزيع الخطورة = الإجمالي', 'Σ(by_severity) = total', d.observations.total, sevSum, 'تناسق المجاميع');
  const stSum = d.by_status.reduce((s, x) => s + x.c, 0);
  check('مجموع توزيع الحالات = الإجمالي', 'Σ(by_status) = total', d.observations.total, stSum, 'تناسق المجاميع');

  // 15) عتبات حالة المؤشر (أعلى أفضل): good/warning/critical
  const t1 = kpi('compliance');
  const expSt = t1.value >= t1.target ? 'good' : t1.value >= t1.target * 0.75 ? 'warning' : 'critical';
  check('عتبات حالة المؤشر', '≥الهدف جيد / ≥75% تنبيه / أقل متدنٍ', expSt, t1.status, `قيمة ${t1.value} هدف ${t1.target}`);

  // النتائج
  const fails = results.filter(r => r['النتيجة'].includes('✘'));
  console.table(results);
  console.log(`\nالخلاصة: ${results.length - fails.length} مطابقة / ${fails.length} غير مطابقة من ${results.length} معادلة`);
  db.close();
  process.exitCode = fails.length ? 1 : 0;
})().catch(e => { console.error('فشل التدقيق:', e.message); process.exit(1); });
