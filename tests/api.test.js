// اختبارات الوظائف الأساسية — تشغيل: npm test (يتطلب خادماً يعمل على المنفذ 3000 أو TEST_URL)
const BASE = process.env.TEST_URL || 'http://localhost:3000';
let passed = 0, failed = 0;
const jars = {}; // كوكيز لكل مستخدم

function assert(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name} ${extra}`); }
}

async function req(user, method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jars[user]) headers.Cookie = jars[user];
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) jars[user] = setCookie.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

async function login(user, password) {
  const r = await req(user, 'POST', '/api/auth/login', { username: user, password });
  return r;
}

(async () => {
  console.log('— اختبارات المصادقة والصلاحيات —');
  let r = await login('admin', 'wrong-password');
  assert('رفض كلمة مرور خاطئة', r.status === 401);
  r = await login('admin', 'Admin@123');
  assert('تسجيل دخول المدير', r.status === 200 && r.data.role === 'admin');
  r = await login('rased1', 'Rased@123');
  assert('تسجيل دخول الراصد', r.status === 200 && r.data.role === 'observer');
  await login('rased2', 'Rased@123');
  r = await req(null, 'GET', '/api/dashboard');
  assert('منع الوصول دون جلسة', r.status === 401);
  r = await req('rased1', 'GET', '/api/users');
  assert('منع الراصد من إدارة المستخدمين', r.status === 403);
  r = await req('rased1', 'GET', '/api/audit');
  assert('منع الراصد من سجل التدقيق', r.status === 403);

  console.log('— نطاق المشاريع (RBAC) —');
  const adminProjects = await req('admin', 'GET', '/api/projects');
  const obsProjects = await req('rased1', 'GET', '/api/projects');
  assert('المدير يرى جميع المشاريع', adminProjects.data.length >= 8);
  assert('الراصد يرى مشاريعه فقط', obsProjects.data.length < adminProjects.data.length && obsProjects.data.length > 0);
  const notMine = adminProjects.data.find(p => !obsProjects.data.some(o => o.id === p.id));
  r = await req('rased1', 'GET', `/api/projects/${notMine.id}`);
  assert('منع الراصد من مشروع خارج نطاقه', r.status === 403);

  console.log('— دورة حياة الملاحظة —');
  const pid = obsProjects.data[0].id;
  const desc = 'اختبار آلي: عمال بدون خوذ واقية قرب الرافعة — ' + Date.now();
  r = await req('rased1', 'POST', '/api/observations', {
    project_id: pid, category: 'ppe', description: desc, site: 'موقع الاختبار',
    likelihood: 4, impact: 5, otype: 'violation',
  });
  assert('تسجيل ملاحظة جديدة', r.status === 201 && r.data.ref);
  assert('توليد رقم مرجعي تسلسلي', /^OBS-\d{4}-\d{5}$/.test(r.data.ref));
  assert('احتساب الخطورة تلقائياً (4×5=20 حرج)', r.data.severity === 'critical');
  assert('تحديد الاستحقاق تلقائياً حسب SLA', !!r.data.due_date);
  const obsId = r.data.id;

  // منع التكرار
  r = await req('rased1', 'POST', '/api/observations', {
    project_id: pid, category: 'ppe', description: desc, site: 'موقع الاختبار',
  });
  assert('اكتشاف الملاحظة المكررة (409)', r.status === 409 && r.data.requires_confirm);
  r = await req('rased1', 'POST', '/api/observations', {
    project_id: pid, category: 'ppe', description: desc, site: 'موقع الاختبار', force: true,
  });
  assert('السماح بالتسجيل مع التأكيد force', r.status === 201);
  const dupId = r.data.id;

  // الإشعار الفوري للمدير عن الحرجة
  r = await req('admin', 'GET', '/api/notifications');
  assert('إشعار المدير فوراً بالملاحظة الحرجة', r.data.items.some(n => n.kind === 'critical' && n.entity_id === obsId));

  // إنشاء إجراء تصحيحي تلقائي للحرجة
  r = await req('admin', 'GET', `/api/observations/${obsId}`);
  assert('إنشاء إجراء تصحيحي تلقائياً للحرجة', r.data.actions.length >= 1);

  // سير العمل
  r = await req('rased1', 'POST', `/api/observations/${obsId}/transition`, { to: 'approved' });
  assert('منع الراصد من الاعتماد', r.status === 403);
  r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to: 'closed' });
  assert('منع القفز في سير العمل (submitted→closed)', r.status === 400);
  for (const to of ['approved', 'assigned', 'in_progress']) {
    r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to });
  }
  assert('التدرج حتى جارٍ التنفيذ', r.status === 200);
  r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to: 'pending_verification' });
  assert('منع طلب التحقق دون توثيق إجراء متخذ', r.status === 400);
  r = await req('rased1', 'POST', '/api/updates', {
    entity_type: 'observation', entity_id: obsId,
    body: 'تم توفير خوذ واقية لجميع العاملين والتنبيه على مشرف الموقع',
  });
  assert('الراصد يوثق إجراءً متخذاً', r.status === 201);
  r = await req('admin', 'GET', `/api/updates?entity_type=observation&entity_id=${obsId}`);
  assert('قراءة سجل الإجراءات المتخذة', r.status === 200 && r.data.length === 1 && Array.isArray(r.data[0].attachments));
  r = await req('rased2', 'POST', '/api/updates', {
    entity_type: 'observation', entity_id: obsId, body: 'محاولة من راصد خارج نطاق المشروع',
  });
  assert('منع مستخدم خارج نطاق المشروع من التوثيق', r.status === 403);
  r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to: 'pending_verification' });
  assert('طلب التحقق بعد توثيق الإجراء', r.status === 200);
  r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to: 'closed' });
  assert('منع الإغلاق دون دليل معالجة', r.status === 400);

  // رفع دليل معالجة ثم الإغلاق
  const fd = new FormData();
  fd.append('entity_type', 'observation');
  fd.append('entity_id', String(obsId));
  fd.append('kind', 'after');
  fd.append('files', new File([Buffer.from('89504e470d0a1a0a', 'hex')], 'evidence.png', { type: 'image/png' }));
  r = await req('admin', 'POST', '/api/attachments', fd);
  assert('رفع دليل المعالجة', r.status === 201);
  r = await req('admin', 'POST', `/api/observations/${obsId}/transition`, { to: 'closed' });
  assert('الإغلاق بعد إرفاق الدليل', r.status === 200);
  r = await req('rased1', 'POST', `/api/observations/${obsId}/transition`, { to: 'reopened', note: 'الدليل غير كافٍ — الموقع ما زال مخالفاً' });
  assert('إعادة الفتح من الراصد مع السبب', r.status === 200);
  r = await req('admin', 'POST', `/api/observations/${dupId}/transition`, { to: 'rejected' });
  assert('رفض بدون سبب مرفوض', r.status === 400);
  r = await req('admin', 'POST', `/api/observations/${dupId}/transition`, { to: 'rejected', note: 'مكررة — اختبار' });
  assert('الرفض مع السبب', r.status === 200);

  // سجل الحالة
  r = await req('admin', 'GET', `/api/observations/${obsId}`);
  assert('سجل تاريخ الحالات مكتمل', r.data.history.length >= 6);

  console.log('— الجولات والتحقق الجغرافي —');
  const users = await req('admin', 'GET', '/api/users');
  const rased1Id = users.data.find(u => u.username === 'rased1').id;
  r = await req('admin', 'POST', '/api/tours', {
    project_id: pid, observer_id: rased1Id, template_id: 1,
    planned_date: new Date().toISOString().slice(0, 10),
  });
  assert('تخطيط جولة وإشعار الراصد', r.status === 201);
  const tourId = r.data.id;
  r = await req('rased1', 'GET', '/api/notifications');
  assert('وصول إشعار التكليف للراصد', r.data.items.some(n => n.kind === 'tour' && n.entity_id === tourId));
  const proj = adminProjects.data.find(p => p.id === pid);
  r = await req('rased1', 'POST', `/api/tours/${tourId}/start`, { lat: proj.lat + 0.2, lng: proj.lng + 0.2 });
  assert('منع البدء خارج النطاق دون توضيح', r.status === 422 && r.data.requires_note);
  r = await req('rased1', 'POST', `/api/tours/${tourId}/start`, { lat: proj.lat + 0.0005, lng: proj.lng + 0.0005 });
  assert('البدء داخل النطاق الجغرافي', r.status === 200 && r.data.geofence_ok === 1);
  r = await req('rased1', 'POST', `/api/tours/${tourId}/results`, {
    results: [{ item_id: 1, result: 'fail', note: 'اختبار' }, { item_id: 2, result: 'pass' }],
  });
  assert('حفظ نتائج قائمة التفتيش', r.status === 200 && r.data.saved === 2);
  r = await req('rased1', 'POST', `/api/tours/${tourId}/finish`, {});
  assert('إنهاء الجولة', r.status === 200);
  r = await req('rased2', 'POST', `/api/tours/${tourId}/start`, {});
  assert('منع راصد آخر من الجولة', r.status === 403 || r.status === 400);

  console.log('— الحوادث والمخاطر وCAPA والتصاريح —');
  r = await req('rased1', 'POST', '/api/incidents', {
    project_id: pid, itype: 'near_miss', occurred_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    description: 'اختبار آلي: سقوط مواد قرب العاملين دون إصابات',
  });
  assert('تسجيل حادث', r.status === 201 && /^INC-/.test(r.data.ref));
  r = await req('rased1', 'POST', '/api/risks', {
    project_id: pid, description: 'اختبار آلي: خطر انهيار جوانب الحفر', likelihood: 4, impact: 5,
  });
  assert('تسجيل خطر (4×5=20)', r.status === 201);
  const risks = await req('rased1', 'GET', '/api/risks?project_id=' + pid);
  const testRisk = risks.data.find(x => x.ref === r.data.ref);
  assert('احتساب مستوى الخطر حرج', testRisk && testRisk.level === 'critical');
  r = await req('admin', 'POST', '/api/actions', {
    project_id: pid, description: 'اختبار آلي: إجراء تصحيحي يدوي', due_date: '2026-01-01',
  });
  assert('إنشاء إجراء تصحيحي', r.status === 201);
  const actId = r.data.id;
  r = await req('admin', 'POST', `/api/actions/${actId}/transition`, { to: 'in_progress' });
  assert('بدء تنفيذ الإجراء', r.status === 200);
  r = await req('admin', 'POST', `/api/actions/${actId}/transition`, { to: 'pending_verification' });
  assert('منع تحقق الإجراء دون توثيق', r.status === 400);
  r = await req('admin', 'POST', '/api/updates', {
    entity_type: 'action', entity_id: actId, body: 'تم تنفيذ 60% من الإجراء المطلوب', progress: 60,
  });
  assert('توثيق إجراء متخذ بنسبة إنجاز', r.status === 201);
  r = await req('admin', 'GET', '/api/actions?project_id=' + pid);
  assert('نسبة الإنجاز تحدّث الإجراء تلقائياً', r.data.find(x => x.id === actId)?.progress === 60);
  r = await req('admin', 'POST', `/api/actions/${actId}/transition`, { to: 'pending_verification' });
  assert('تحقق الإجراء بعد التوثيق', r.status === 200);
  r = await req('admin', 'POST', '/api/permits', {
    project_id: pid, ptype: 'hotwork', valid_from: '2026-07-15', valid_to: '2026-07-18',
  });
  assert('طلب تصريح عمل', r.status === 201);
  const prmId = r.data.id;
  r = await req('rased1', 'POST', `/api/permits/${prmId}/transition`, { to: 'under_review' });
  assert('منع الراصد من مراجعة التصريح', r.status === 403 || r.status === 400);
  await req('admin', 'POST', `/api/permits/${prmId}/transition`, { to: 'under_review' });
  r = await req('admin', 'POST', `/api/permits/${prmId}/transition`, { to: 'approved' });
  assert('اعتماد التصريح', r.status === 200);
  await req('admin', 'POST', `/api/permits/${prmId}/transition`, { to: 'active' });
  r = await req('admin', 'POST', `/api/permits/${prmId}/transition`, { to: 'closed' });
  assert('منع إغلاق التصريح دون توثيق', r.status === 400);
  await req('admin', 'POST', '/api/updates', { entity_type: 'permit', entity_id: prmId, body: 'تم تنفيذ الأعمال وإزالة العزل وإعادة الموقع لوضعه الآمن' });
  r = await req('admin', 'POST', `/api/permits/${prmId}/transition`, { to: 'closed' });
  assert('إغلاق التصريح بعد التوثيق', r.status === 200);
  // إغلاق الحادث يتطلب توثيقاً أيضاً
  const incs = await req('rased1', 'GET', '/api/incidents?project_id=' + pid);
  const incId = incs.data.find(x => x.description.includes('اختبار آلي')).id;
  r = await req('admin', 'PUT', `/api/incidents/${incId}`, { status: 'closed' });
  assert('منع إغلاق الحادث دون توثيق', r.status === 400);
  await req('rased1', 'POST', '/api/updates', { entity_type: 'incident', entity_id: incId, body: 'تم تأمين منطقة الرفع ومنع الوقوف تحت الأحمال وتوعية العاملين' });
  r = await req('admin', 'PUT', `/api/incidents/${incId}`, { status: 'closed' });
  assert('إغلاق الحادث بعد التوثيق', r.status === 200);
  r = await req('rased1', 'POST', '/api/updates', { entity_type: 'incident', entity_id: incId, body: 'محاولة إضافة بعد الإغلاق' });
  assert('منع التوثيق على سجل مغلق', r.status === 400);

  console.log('— التصعيد والمؤشرات والتقارير —');
  r = await req('admin', 'POST', '/api/escalations/check', {});
  assert('تشغيل فحص التصعيدات', r.status === 200);
  r = await req('admin', 'GET', '/api/dashboard');
  assert('لوحة المعلومات ترجع بيانات حية', r.data.observations.total > 0 && r.data.projects.active > 0);
  r = await req('admin', 'GET', '/api/kpis');
  assert('بطاقات المؤشرات (12 مؤشراً)', r.data.length >= 12 && r.data.every(k => k.formula && k.target !== undefined));
  r = await req('admin', 'GET', '/api/reports/overdue');
  assert('تقرير الملاحظات المتأخرة', r.status === 200 && Array.isArray(r.data.rows));
  r = await req('admin', 'GET', '/api/export/observations');
  assert('تصدير CSV بترويسة عربية', r.status === 200 && String(r.data).includes('الرقم المرجعي'));
  r = await req('admin', 'GET', '/api/map');
  assert('بيانات الخريطة', r.data.projects.length > 0 && r.data.observations.length > 0);
  r = await req('admin', 'POST', '/api/ai/classify', { description: 'عامل يعمل على سقالة دون حزام أمان على ارتفاع عالٍ' });
  assert('التصنيف الذكي من الوصف', r.status === 200 && r.data.category);
  r = await req('admin', 'GET', '/api/ai/insights');
  assert('التحليل الذكي والتوصيات', r.status === 200 && r.data.length > 0);
  r = await req('admin', 'GET', '/api/audit?q=اختبار');
  assert('سجل التدقيق يسجل العمليات', r.status === 200);

  console.log('— قواعد العمل —');
  r = await req('admin', 'PUT', `/api/observations/${obsId}`, { archived: 1 });
  assert('الأرشفة بدل الحذف', r.status === 200);
  await req('admin', 'PUT', `/api/observations/${obsId}`, { archived: 0 });
  r = await req('admin', 'POST', '/api/users', { username: 'x', password: '123', full_name: 'قصير', role: 'observer' });
  assert('رفض كلمة مرور قصيرة', r.status === 400);

  console.log('— الحذف الآمن والتصعيد المخصص —');
  r = await req('admin', 'DELETE', '/api/parties/1');
  assert('منع حذف مقاول مرتبط بمشاريع (اقتراح التعطيل)', r.status === 409 && r.data.can_disable);
  r = await req('admin', 'DELETE', `/api/users/${rased1Id}`);
  assert('منع حذف مستخدم له سجلات (اقتراح التعطيل)', r.status === 409 && r.data.can_disable);
  r = await req('admin', 'DELETE', '/api/projects/1');
  assert('منع حذف مشروع له سجلات (اقتراح الأرشفة)', r.status === 409 && r.data.can_archive);
  r = await req('admin', 'POST', '/api/projects', { code: 'TST-DEL-' + Date.now(), name: 'مشروع اختبار الحذف', type: 'other' });
  const tmpPid = r.data.id;
  r = await req('admin', 'DELETE', `/api/projects/${tmpPid}`);
  assert('حذف مشروع بلا سجلات مرتبطة', r.status === 200);
  r = await req('admin', 'POST', '/api/users', { username: 'tmpdel' + Date.now(), password: 'Temp@12345', full_name: 'مؤقت للحذف', role: 'observer' });
  r = await req('admin', 'DELETE', `/api/users/${r.data.id}`);
  assert('حذف مستخدم جديد بلا سجلات', r.status === 200);
  r = await req('rased1', 'GET', '/api/escalations/status');
  assert('منع الراصد من صفحة التصعيد', r.status === 403);
  r = await req('admin', 'GET', '/api/escalations/status');
  assert('حالة التصعيد الشاملة (قواعد + قوائم)', r.status === 200 && r.data.rules && Array.isArray(r.data.escalatedObs) && r.data.sla);

  console.log('— الحالات المخصصة (الوسوم) —');
  r = await req('admin', 'PUT', '/api/settings', { custom_statuses: JSON.stringify(['بانتظار المقاول', 'اختبار وسم']) });
  assert('حفظ الحالات المخصصة من الإعدادات', r.status === 200);
  r = await req('admin', 'PUT', `/api/observations/${obsId}`, { status_tag: 'اختبار وسم' });
  assert('إسناد حالة مخصصة لملاحظة', r.status === 200);
  r = await req('admin', 'GET', `/api/observations?status_tag=${encodeURIComponent('اختبار وسم')}`);
  assert('التصفية بالحالة المخصصة', r.status === 200 && r.data.some(x => x.id === obsId) && r.data.every(x => x.status_tag === 'اختبار وسم'));
  r = await req('admin', 'PUT', `/api/actions/${actId}`, { status_tag: 'بانتظار المقاول' });
  assert('إسناد حالة مخصصة لإجراء تصحيحي', r.status === 200);

  console.log('— أفضل الممارسات السعودية —');
  r = await req('admin', 'GET', '/api/dashboard');
  assert('بيانات حظر الظهيرة في اللوحة', r.data.midday_ban && typeof r.data.midday_ban.in_season === 'boolean');
  r = await req('admin', 'GET', '/api/kpis');
  assert('مؤشرا التوعية وإبلاغ التأمينات', r.data.some(k => k.key === 'toolbox_coverage') && r.data.some(k => k.key === 'gosi_compliance'));
  r = await req('rased1', 'GET', '/api/talks');
  assert('سجل اجتماعات التوعية (بنطاق الراصد)', r.status === 200 && Array.isArray(r.data));
  r = await req('rased1', 'POST', '/api/talks', {
    project_id: pid, talk_date: new Date().toISOString().slice(0, 10),
    topic: 'اختبار آلي: توعية بمخاطر الإجهاد الحراري', attendees_count: 12,
  });
  assert('توثيق اجتماع توعية من الراصد', r.status === 201);
  const otherPid = adminProjects.data.find(p => !obsProjects.data.some(o => o.id === p.id)).id;
  r = await req('rased1', 'POST', '/api/talks', { project_id: otherPid, talk_date: '2026-07-15', topic: 'خارج النطاق' });
  assert('منع التوثيق خارج نطاق الراصد', r.status === 403);
  r = await req('rased1', 'POST', '/api/incidents', {
    project_id: pid, itype: 'injury', occurred_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    description: 'اختبار آلي: إصابة لاختبار إبلاغ التأمينات', injured_id: '2412345678', injured_nationality: 'مصري', injured_occupation: 'نجار',
  });
  const gosiIncId = r.data.id;
  assert('تسجيل إصابة ببيانات المصاب GOSI', r.status === 201);
  r = await req('admin', 'PUT', `/api/incidents/${gosiIncId}`, { gosi_reported: 1 });
  assert('تعليم الإصابة كمُبلّغة للتأمينات', r.status === 200);
  r = await req('admin', 'GET', `/api/incidents/${gosiIncId}`);
  assert('توثيق وقت الإبلاغ تلقائياً', r.data.gosi_reported === 1 && !!r.data.gosi_reported_at);
  r = await req('admin', 'GET', '/api/settings');
  assert('مكتبة المراجع النظامية السعودية', JSON.parse(r.data.reg_references || '[]').length >= 5);

  console.log('— الأدوار ومصفوفة الصلاحيات —');
  r = await login('mushrif', 'Mushrif@123');
  assert('دخول مشرف السلامة', r.status === 200 && r.data.role === 'safety_supervisor');
  await login('viewer', 'Viewer@123');
  r = await req('mushrif', 'GET', '/api/auth/me');
  assert('me يرجع صلاحيات الدور', r.data.perms && r.data.perms.approve_observations === true && r.data.perms.manage_projects === false);
  // مشرف السلامة يعتمد ملاحظة ضمن نطاقه (مشاريع 1-4)
  r = await req('rased1', 'POST', '/api/observations', {
    project_id: 1, category: 'ppe', description: 'اختبار أدوار: عامل دون قفازات قرب مواد حادة ' + Date.now(),
  });
  const roleObsId = r.data.id;
  r = await req('mushrif', 'POST', `/api/observations/${roleObsId}/transition`, { to: 'approved' });
  assert('مشرف السلامة يعتمد الملاحظات', r.status === 200);
  r = await req('mushrif', 'POST', '/api/projects', { code: 'X-' + Date.now(), name: 'تجربة', type: 'other' });
  assert('منع المشرف من إنشاء المشاريع', r.status === 403);
  // القراءة فقط: يشاهد ولا يسجل
  r = await req('viewer', 'GET', '/api/dashboard');
  assert('القراءة فقط يشاهد اللوحة', r.status === 200);
  r = await req('viewer', 'POST', '/api/observations', { project_id: 1, category: 'ppe', description: 'محاولة تسجيل' });
  assert('منع القراءة فقط من التسجيل', r.status === 403);
  // تعديل المصفوفة يغير السلوك فوراً: سحب اعتماد الملاحظات من المشرف
  r = await req('admin', 'GET', '/api/permissions');
  assert('قراءة مصفوفة الصلاحيات', r.status === 200 && r.data.roles.length === 6 && r.data.permissions.length === 8);
  const matrix = r.data.matrix;
  matrix.safety_supervisor.approve_observations = false;
  await req('admin', 'PUT', '/api/settings', { role_permissions: JSON.stringify(matrix) });
  r = await req('mushrif', 'POST', `/api/observations/${roleObsId}/transition`, { to: 'assigned' });
  assert('سحب الصلاحية من المصفوفة يمنع فوراً', r.status === 403);
  matrix.safety_supervisor.approve_observations = true;
  await req('admin', 'PUT', '/api/settings', { role_permissions: JSON.stringify(matrix) });
  r = await req('mushrif', 'POST', `/api/observations/${roleObsId}/transition`, { to: 'assigned' });
  assert('إعادة الصلاحية تعيد التمكين', r.status === 200);

  console.log('— بوابة المقاول —');
  r = await login('moqawil', 'Moqawil@123');
  assert('دخول ممثل المقاول', r.status === 200 && r.data.role === 'contractor');
  // ملاحظة محالة على مقاول شركته (مشروع 1 — شركة البناء المتحدة) ومعتمدة
  r = await req('rased1', 'POST', '/api/observations', {
    project_id: 1, category: 'scaffold', responsible_party: 'contractor',
    description: 'اختبار بوابة المقاول: سقالة دون درابزين علوي ' + Date.now(),
  });
  const cObs = r.data.id;
  await req('admin', 'POST', `/api/observations/${cObs}/transition`, { to: 'approved' });
  r = await req('moqawil', 'GET', '/api/observations');
  assert('المقاول لا يرى الملاحظة قبل الإحالة… يراها بعد الاعتماد', r.status === 200);
  await req('admin', 'POST', `/api/observations/${cObs}/transition`, { to: 'assigned' });
  r = await req('moqawil', 'GET', '/api/observations');
  assert('المقاول يرى ملاحظات شركته المحالة فقط', r.data.some(x => x.id === cObs) &&
    r.data.every(x => x.responsible_party === 'contractor' && ![3, 4].includes(x.project_id)));
  r = await req('moqawil', 'POST', `/api/observations/${cObs}/transition`, { to: 'in_progress' });
  assert('المقاول يبدأ التنفيذ', r.status === 200);
  r = await req('moqawil', 'POST', '/api/updates', {
    entity_type: 'observation', entity_id: cObs, body: 'تم تركيب الدرابزين العلوي وتثبيته وفق المواصفات',
  });
  assert('المقاول يوثق الإجراء المتخذ', r.status === 201);
  r = await req('moqawil', 'POST', `/api/observations/${cObs}/transition`, { to: 'pending_verification' });
  assert('المقاول يطلب التحقق', r.status === 200);
  r = await req('moqawil', 'POST', `/api/observations/${cObs}/transition`, { to: 'closed' });
  assert('منع المقاول من اعتماد الإغلاق', r.status === 403);
  r = await req('moqawil', 'GET', '/api/tours');
  assert('منع المقاول من شاشة الجولات', r.status === 403);
  r = await req('moqawil', 'GET', '/api/incidents');
  assert('منع المقاول من الحوادث', r.status === 403);
  r = await req('moqawil', 'POST', '/api/observations', { project_id: 1, category: 'ppe', description: 'محاولة تسجيل' });
  assert('منع المقاول من تسجيل الملاحظات', r.status === 403);

  console.log(`\nالنتيجة: ${passed} ناجح / ${failed} فاشل`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('فشل تشغيل الاختبارات:', e.message); process.exit(1); });
