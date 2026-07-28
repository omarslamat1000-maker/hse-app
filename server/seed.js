// البيانات التجريبية — تشغيل: npm run seed
const { db, all, get, run, riskLevel } = require('./db');
const { hashPassword } = require('./auth');

const FORCE = process.argv.includes('--force');
const existing = get(`SELECT COUNT(*) AS c FROM users`);
if (existing.c > 0 && !FORCE) {
  console.log('قاعدة البيانات تحتوي بيانات بالفعل — استخدم --force لإعادة التهيئة.');
  process.exit(0);
}

// مولد أرقام شبه عشوائي حتمي (لثبات البيانات التجريبية)
let _seed = 42;
function rnd() { _seed = (_seed * 1103515245 + 12345) % 2147483648; return _seed / 2147483648; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function ri(min, max) { return min + Math.floor(rnd() * (max - min + 1)); }
function daysAgo(n) { const d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 19).replace('T', ' '); }
function dateOnly(n) { const d = new Date(Date.now() - n * 864e5); return d.toISOString().slice(0, 10); }

db.exec('BEGIN');

// تنظيف
['audit_log','notifications','progress_updates','toolbox_talks','evaluations','permits','actions','incidents','risks',
 'observation_history','observations','tour_results','tours','checklist_items','checklist_templates',
 'attachments','project_assignments','projects','sessions','users','parties','settings']
  .forEach(t => db.exec(`DELETE FROM ${t}`));
db.exec(`DELETE FROM sqlite_sequence`);

// ===== الإعدادات =====
run(`INSERT INTO settings (key, value) VALUES ('sla_days', ?)`, JSON.stringify({ low: 14, medium: 7, high: 3, critical: 1 }));
run(`INSERT INTO settings (key, value) VALUES ('org_name', ?)`, 'وكالة البنية التحتية — إدارة الأمن والسلامة والصحة المهنية');
run(`INSERT INTO settings (key, value) VALUES ('duplicate_window_days', '7')`);
run(`INSERT INTO settings (key, value) VALUES ('reg_references', ?)`, JSON.stringify([
  'نظام العمل السعودي — المادة 121 (التزامات صاحب العمل للوقاية)',
  'نظام العمل السعودي — المادة 122 (حماية العمال من الأخطار)',
  'اللائحة التنفيذية لنظام العمل — اشتراطات السلامة والصحة المهنية',
  'قرار حظر العمل تحت أشعة الشمس (12:00–15:00، 15 يونيو–15 سبتمبر)',
  'الكود السعودي للبناء SBC 201 — الاشتراطات العامة',
  'الكود السعودي للبناء SBC 801 — الحماية من الحريق',
  'اشتراطات الدفاع المدني — السلامة في مواقع الإنشاءات',
  'دليل أجهزة التحكم المروري السعودي — التحويلات المرورية بمناطق العمل',
  'نظام التأمينات الاجتماعية — فرع الأخطار المهنية (الإبلاغ خلال 3 أيام)',
  'المواصفات السعودية SASO — معدات الوقاية الشخصية',
]));
run(`INSERT INTO settings (key, value) VALUES ('custom_statuses', ?)`,
  JSON.stringify(['بانتظار المقاول', 'بانتظار توريد مواد', 'قيد التنسيق مع جهة أخرى', 'معلقة لأسباب مالية']));
run(`INSERT INTO settings (key, value) VALUES ('escalation_rules', ?)`,
  JSON.stringify({ remind_before_days: 2, obs_after_due_days: 0, action_after_due_days: 0, tour_missed_after_days: 0 }));

// ===== المستخدمون =====
const users = [
  ['admin',  'Admin@123',  'م. عبدالله الحربي', 'admin',    '0501000001', 'admin@hse.gov.sa'],
  ['rased1', 'Rased@123',  'أحمد العتيبي',      'observer', '0501000002', 'rased1@hse.gov.sa'],
  ['rased2', 'Rased@123',  'خالد الشهري',       'observer', '0501000003', 'rased2@hse.gov.sa'],
  ['rased3', 'Rased@123',  'سعود القحطاني',     'observer', '0501000004', 'rased3@hse.gov.sa'],
  ['rased4', 'Rased@123',  'فهد الدوسري',       'observer', '0501000005', 'rased4@hse.gov.sa'],
  ['mushrif', 'Mushrif@123', 'م. ناصر الغامدي', 'safety_supervisor', '0501000006', 'mushrif@hse.gov.sa'],
  ['mudir',   'Mudir@1234',  'م. سلمان العمري',  'project_manager',   '0501000007', 'mudir@hse.gov.sa'],
  ['viewer',  'Viewer@123',  'د. هند القحطاني',  'viewer',            '0501000008', 'viewer@hse.gov.sa'],
  ['moqawil', 'Moqawil@123', 'م. خالد رمضان',    'contractor',        '0501000009', 'moqawil@contractor.sa'],
];
for (const [u, p, name, role, phone, email] of users)
  run(`INSERT INTO users (username, password_hash, full_name, role, phone, email) VALUES (?,?,?,?,?,?)`,
    u, hashPassword(p), name, role, phone, email);

// ===== المقاولون والاستشاريون =====
const contractors = [
  'شركة البناء المتحدة للمقاولات', 'مجموعة الإنشاءات الحديثة', 'شركة الطرق العربية',
  'مؤسسة التعمير الشامل', 'شركة أعمال البنية التحتية المحدودة',
];
const consultants = [
  'دار الاستشارات الهندسية', 'المكتب العربي للاستشارات', 'بيت الخبرة الهندسي',
];
for (const n of contractors) run(`INSERT INTO parties (name, kind, contact_name, phone) VALUES (?,?,?,?)`, n, 'contractor', 'مدير المشروع', '011' + ri(4000000, 4999999));
for (const n of consultants) run(`INSERT INTO parties (name, kind, contact_name, phone) VALUES (?,?,?,?)`, n, 'consultant', 'المهندس المقيم', '011' + ri(4000000, 4999999));

// ===== المشاريع (إحداثيات في نطاق الرياض) =====
const projects = [
  ['INF-001', 'مشروع تطوير طريق الملك عبدالعزيز', 'roads',    'طريق الملك عبدالعزيز — وسط المدينة', 24.7136, 46.6753, 85000000, 62, 'active',   'high',   340],
  ['INF-002', 'مشروع تصريف مياه الأمطار — حي النسيم', 'drainage', 'حي النسيم الشرقي', 24.7743, 46.7982, 46000000, 38, 'active',   'critical', 210],
  ['INF-003', 'مشروع جسر تقاطع طريق الأمير محمد', 'bridges',  'تقاطع طريق الأمير محمد بن سلمان', 24.8226, 46.6791, 120000000, 45, 'active',  'high',   420],
  ['INF-004', 'مشروع أنفاق الخدمات — المنطقة الصناعية', 'tunnels', 'المنطقة الصناعية الثانية', 24.6120, 46.7482, 64000000, 71, 'active',  'critical', 180],
  ['INF-005', 'مشروع سفلتة وتحسين شوارع حي الروضة', 'roads',   'حي الروضة', 24.7290, 46.7723, 18000000, 88, 'active',   'medium', 120],
  ['INF-006', 'مشروع إنارة الطرق الذكية — المرحلة الأولى', 'electrical', 'عدة أحياء — شمال المدينة', 24.8145, 46.6280, 22000000, 54, 'active', 'medium', 95],
  ['INF-007', 'مشروع محطة معالجة مياه الصرف', 'water',        'جنوب المدينة', 24.5731, 46.7150, 95000000, 30, 'active',   'high',   260],
  ['INF-008', 'مشروع تطوير ميدان الثقافة', 'landscape',       'ميدان الثقافة — وسط المدينة', 24.6980, 46.6850, 15000000, 100, 'completed', 'low', 0],
];
projects.forEach((p, i) => {
  const [code, name, type, loc, lat, lng, value, progress, status, risk, workers] = p;
  run(`INSERT INTO projects (code, name, description, type, location_text, lat, lng, owner_entity,
        contractor_id, consultant_id, project_manager, safety_officer, value, start_date, end_date,
        progress_pct, workers_count, work_hours, status, risk_level, safety_plan_approved)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, name, `أعمال ${name} وفق المواصفات المعتمدة ومتطلبات السلامة.`, type, loc, lat, lng,
    'وكالة البنية التحتية', (i % 5) + 1, 6 + (i % 3), 'م. ' + pick(['ماجد','تركي','بدر','نايف']) + ' ' + pick(['السبيعي','العنزي','المطيري']),
    'م. ' + pick(['سلطان','مشعل','عمر']) + ' ' + pick(['الغامدي','الزهراني']),
    value, dateOnly(400 - i * 30), dateOnly(-(200 + i * 30)), progress, workers, workers * 8 * 300, status, risk, 1);
});

// تكليف الراصدين: كل راصد على مشروعين
const assignments = [[2,1],[2,2],[3,3],[3,4],[4,5],[4,6],[5,7],[5,1],[2,5],[3,6]];
for (const [u, p] of assignments) run(`INSERT INTO project_assignments (user_id, project_id) VALUES (?,?)`, u, p);
// نطاقات الأدوار الجديدة: المشرف على 1-4، مدير المشروع على 1-2، القراءة على الكل
for (const p of [1,2,3,4]) run(`INSERT INTO project_assignments (user_id, project_id) VALUES (6,?)`, p);
for (const p of [1,2]) run(`INSERT INTO project_assignments (user_id, project_id) VALUES (7,?)`, p);
for (const p of [1,2,3,4,5,6,7,8]) run(`INSERT INTO project_assignments (user_id, project_id) VALUES (8,?)`, p);
// ممثل المقاول مرتبط بشركة البناء المتحدة للمقاولات (مشاريعها: 1 و6)
run(`UPDATE users SET party_id = 1 WHERE username = 'moqawil'`);

// ===== نماذج التفتيش (24 فئة) =====
const TEMPLATES = [
  ['معدات الوقاية الشخصية PPE', 'ppe', [
    'ارتداء الخوذ الواقية لجميع العاملين', 'ارتداء الأحذية الواقية المناسبة', 'ارتداء السترات العاكسة',
    'توفر النظارات الواقية عند الأعمال الخطرة', 'توفر القفازات المناسبة لطبيعة العمل', 'توفر واقيات السمع في مناطق الضوضاء']],
  ['العمل على المرتفعات', 'height', [
    'استخدام أحزمة الأمان وربطها بنقاط تثبيت معتمدة', 'تركيب حواجز حماية على الحواف المفتوحة',
    'فحص السقالات واعتمادها قبل الاستخدام', 'تأمين فتحات الأسقف والأرضيات', 'وجود تصريح عمل على ارتفاع ساري']],
  ['الحفريات والخنادق', 'excavation', [
    'وجود تصريح حفر ساري', 'تدعيم جوانب الحفر بعمق يتجاوز 1.2م', 'وجود سلالم خروج آمنة كل 7.5م',
    'إبعاد نواتج الحفر عن حافة الحفرية', 'حماية الحفرية بحواجز وإشارات تحذيرية', 'فحص الغازات قبل النزول للحفريات العميقة']],
  ['الرافعات ومعدات الرفع', 'lifting', [
    'شهادات فحص الرافعات سارية', 'شهادة مشغل الرافعة سارية', 'خطة رفع معتمدة للأحمال الحرجة',
    'فحص حبال وسلاسل الرفع', 'تحديد منطقة الرفع ومنع الوقوف تحت الأحمال']],
  ['المعدات والآليات الثقيلة', 'equipment', [
    'فحص المعدات دورياً وتوثيقه', 'وجود إنذار الرجوع للخلف', 'سلامة الأنوار والمرايا',
    'مرافق إرشاد الحركة Banksman', 'رخص المشغلين سارية']],
  ['التحويلات المرورية وسلامة الطرق', 'traffic', [
    'مخطط تحويلات مرورية معتمد', 'اللوحات والعلامات التحذيرية مطابقة للدليل', 'الحواجز الخرسانية والبلاستيكية سليمة',
    'الإنارة الليلية للتحويلات تعمل', 'وجود أعلام ومرشدي حركة عند المداخل']],
  ['الأعمال الكهربائية', 'electrical', [
    'عزل مصادر الطاقة وتطبيق Lockout/Tagout', 'سلامة التمديدات والتوصيلات المؤقتة', 'وجود قواطع تسرب أرضي',
    'ابتعاد الأعمال عن خطوط الجهد العالي', 'كفاءة تأريض المعدات']],
  ['الأماكن المغلقة', 'confined', [
    'تصريح دخول أماكن مغلقة ساري', 'قياس الغازات قبل وأثناء الدخول', 'وجود مراقب خارجي دائم',
    'توفر معدات الإنقاذ والطوارئ', 'تهوية مناسبة للمكان المغلق']],
  ['الأعمال الساخنة واللحام', 'hotwork', [
    'تصريح أعمال ساخنة ساري', 'إزالة المواد القابلة للاشتعال من محيط العمل', 'توفر طفاية حريق صالحة بموقع العمل',
    'وجود مراقب حريق أثناء وبعد العمل', 'حالة معدات اللحام والأسطوانات سليمة']],
  ['السقالات والسلالم', 'scaffold', [
    'بطاقة فحص السقالة (Scafftag) محدثة', 'قواعد السقالة سليمة ومستوية', 'ممرات وأرضيات السقالة مكتملة',
    'الدرابزين ولوح القدم مركبة', 'السلالم بحالة جيدة ومؤمنة']],
  ['إدارة المواد الخطرة', 'hazmat', [
    'توفر نشرات السلامة MSDS', 'تخزين المواد الكيميائية في مناطق مخصصة', 'وضع ملصقات التعريف على العبوات',
    'توفر معدات مكافحة الانسكاب', 'تدريب العاملين على التعامل مع المواد الخطرة']],
  ['التخزين والمستودعات', 'storage', [
    'ترتيب المواد وتكديسها بشكل آمن', 'ممرات الحركة خالية من العوائق', 'فصل المواد غير المتوافقة',
    'توفر وسائل إطفاء بالمستودع', 'التهوية والإضاءة مناسبة']],
  ['النظافة والترتيب بالموقع', 'housekeeping', [
    'الموقع خالٍ من المخلفات المتراكمة', 'تصريف مياه آمن دون تجمعات', 'تخزين المواد بشكل منظم',
    'ممرات المشاة واضحة وآمنة', 'حاويات النفايات كافية وتفرغ دورياً']],
  ['الإسعافات الأولية', 'firstaid', [
    'توفر حقيبة إسعافات أولية مكتملة', 'وجود مسعف مؤهل بالموقع', 'لوحة أرقام الطوارئ ظاهرة',
    'سهولة الوصول لنقطة الإسعاف', 'سجل الإصابات والإسعافات محدث']],
  ['خطط الطوارئ والإخلاء', 'emergency', [
    'خطة طوارئ معتمدة ومحدثة', 'نقاط التجمع محددة ومعلمة', 'مسارات الإخلاء واضحة وخالية',
    'تنفيذ تجارب إخلاء دورية', 'وسائل الإنذار تعمل']],
  ['مكافحة الحريق', 'fire', [
    'طفايات الحريق موزعة وصالحة', 'صيانة معدات الإطفاء موثقة', 'خلو مصادر الاشتعال من المواد القابلة للاحتراق',
    'تدريب العاملين على استخدام الطفايات', 'ممرات الوصول لمعدات الإطفاء خالية']],
  ['سلامة العمال والمرافق المؤقتة', 'welfare', [
    'توفر مياه شرب باردة ونظيفة', 'مظلات وأماكن استراحة مناسبة', 'دورات مياه نظيفة وكافية',
    'سكن العمال مطابق للاشتراطات', 'توفر وسائل تبريد في مواقع العمل الحارة']],
  ['اللوحات والتحذيرات والحواجز', 'signage', [
    'لوحات تحذيرية واضحة بالعربية ولغات العمالة', 'حواجز فصل مناطق الخطر', 'لوحة معلومات المشروع مركبة',
    'إشارات الاتجاهات والمخارج واضحة', 'تحديث اللوحات حسب مراحل العمل']],
  ['التدريب والتوعية Toolbox Talk', 'training', [
    'عقد اجتماعات توعية يومية موثقة', 'تدريب العاملين الجدد قبل مباشرة العمل', 'سجلات التدريب محدثة',
    'التوعية بمخاطر المهام الخاصة قبل تنفيذها', 'برنامج تدريب شهري معتمد']],
  ['تصاريح العمل', 'permits', [
    'جميع الأعمال الخطرة بتصاريح سارية', 'التصاريح معلقة في مواقع العمل', 'إغلاق التصاريح المنتهية',
    'توقيعات المصرح والمنفذ مكتملة', 'الالتزام باشتراطات التصريح ميدانياً']],
  ['حماية الجمهور والمشاة', 'public', [
    'سياج محيط بالموقع سليم ومكتمل', 'ممرات مشاة آمنة ومظللة حول الموقع', 'بوابات الدخول مراقبة',
    'إنارة محيط الموقع ليلاً', 'حماية المجاورين من الغبار والضوضاء']],
  ['السلامة البيئية وإدارة النفايات', 'environment', [
    'فرز النفايات والتخلص الآمن منها', 'منع صرف الملوثات لشبكات التصريف', 'تغطية مواد البناء المسببة للغبار',
    'عدم حرق المخلفات بالموقع', 'سجل نقل النفايات لمواقع معتمدة']],
  ['الضوضاء والغبار والانبعاثات', 'emissions', [
    'رش المياه للحد من الغبار', 'الالتزام بساعات العمل المسموحة للأعمال المزعجة', 'صيانة المعدات للحد من الانبعاثات',
    'قياسات دورية للضوضاء', 'تغطية شاحنات نقل المواد']],
  ['الصحة المهنية والإجهاد الحراري', 'health', [
    'تطبيق جدول العمل الصيفي وحظر الظهيرة', 'توفر أملاح ومشروبات تعويضية', 'مراقبة مؤشر الإجهاد الحراري',
    'فحوصات طبية دورية للعاملين', 'توعية بأعراض الإجهاد الحراري']],
  ['الرفع اليدوي وبيئة العمل', 'ergonomics', [
    'تدريب على الرفع اليدوي السليم', 'استخدام وسائل مساعدة للأحمال الثقيلة', 'تناوب العاملين في المهام المجهدة',
    'وضعيات عمل سليمة للمهام المتكررة']],
];
for (const [name, cat, items] of TEMPLATES) {
  run(`INSERT INTO checklist_templates (name, category, project_type) VALUES (?,?,?)`, name, cat, '');
  const tid = get(`SELECT last_insert_rowid() AS id`).id;
  items.forEach((t, i) => run(`INSERT INTO checklist_items (template_id, text, sort_order) VALUES (?,?,?)`, tid, t, i));
}

// ===== الجولات =====
const OBS_CATEGORIES = ['ppe','height','excavation','lifting','equipment','traffic','electrical','hotwork','scaffold','housekeeping','fire','signage','public','environment','health'];
const CAT_DESC = {
  ppe: ['عمال بدون خوذ واقية في منطقة الأعمال', 'عدم ارتداء السترات العاكسة قرب حركة المعدات', 'عامل لحام بدون قناع واقٍ للوجه'],
  height: ['عمل على ارتفاع دون أحزمة أمان', 'حواف مفتوحة دون حواجز حماية', 'سقالة غير مكتملة الدرابزين'],
  excavation: ['حفرية بعمق 2م دون تدعيم للجوانب', 'عدم وجود سلالم خروج من الخندق', 'نواتج حفر قريبة من حافة الحفرية'],
  lifting: ['رفع أحمال فوق العاملين', 'شهادة فحص الرافعة منتهية', 'حبال رفع متآكلة قيد الاستخدام'],
  equipment: ['معدة تعمل دون إنذار رجوع', 'مشغل معدة دون رخصة سارية', 'تسرب زيوت من معدة بموقع العمل'],
  traffic: ['تحويلة مرورية دون لوحات إرشادية كافية', 'حواجز متضررة على الطريق المفتوح للحركة', 'غياب الإنارة الليلية للتحويلة'],
  electrical: ['توصيلات كهربائية مكشوفة قرب تجمع مياه', 'لوحة كهرباء مؤقتة دون قاطع تسرب', 'أعمال قرب خط جهد عالٍ دون عزل'],
  hotwork: ['أعمال لحام دون تصريح أعمال ساخنة', 'لحام قرب مواد قابلة للاشتعال', 'عدم وجود مراقب حريق أثناء القطع'],
  scaffold: ['سقالة دون بطاقة فحص محدثة', 'أرضيات سقالة غير مكتملة', 'قواعد سقالة على أرض غير مستوية'],
  housekeeping: ['مخلفات بناء متراكمة تعيق الممرات', 'تجمعات مياه راكدة بالموقع', 'مواد مبعثرة في مسار المشاة'],
  fire: ['طفاية حريق منتهية الصلاحية', 'انسداد الوصول لمعدات الإطفاء', 'تخزين وقود قرب مصدر اشتعال'],
  signage: ['غياب اللوحات التحذيرية عند منطقة الحفر', 'سياج الموقع متضرر ومفتوح', 'لوحات بلغة واحدة فقط دون لغات العمالة'],
  public: ['ممر مشاة غير آمن حول الموقع', 'بوابة موقع مفتوحة دون مراقبة', 'مواد بناء على الرصيف العام'],
  environment: ['صرف مياه عكرة لشبكة التصريف', 'حرق مخلفات داخل الموقع', 'نفايات غير مفروزة ومتراكمة'],
  health: ['عمل وقت الظهيرة مخالفة لحظر العمل تحت الشمس', 'عدم توفر مياه شرب باردة للعمال', 'غياب مظلات الاستراحة'],
};
const SITES = ['المنطقة الشمالية', 'المنطقة الجنوبية', 'محور الأعمال الرئيسي', 'موقع المعدات', 'المستودع', 'مدخل المشروع'];

let tourCount = 0, obsCount = 0;
const tourStatuses = ['completed','completed','completed','completed','missed','planned','in_progress'];
for (let d = 60; d >= -7; d--) {
  // جولة أو جولتان يومياً
  const n = d > 0 ? ri(1, 3) : 1;
  for (let k = 0; k < n; k++) {
    const [uid, pid] = pick(assignments);
    const proj = get(`SELECT * FROM projects WHERE id = ?`, pid);
    let status;
    if (d < 0) status = 'planned';
    else if (d === 0) status = pick(['in_progress','completed','planned']);
    else status = pick(tourStatuses);
    tourCount++;
    const ref = `TUR-2026-${String(tourCount).padStart(5, '0')}`;
    const tmpl = ri(1, TEMPLATES.length);
    run(`INSERT INTO tours (ref, project_id, observer_id, template_id, site, planned_date, planned_period,
          status, started_at, ended_at, start_lat, start_lng, geofence_ok, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ref, pid, uid, tmpl, pick(SITES), dateOnly(d), pick(['morning','evening']),
      status,
      status === 'completed' || status === 'in_progress' ? daysAgo(d) : null,
      status === 'completed' ? daysAgo(d) : null,
      proj.lat + (rnd() - 0.5) * 0.002, proj.lng + (rnd() - 0.5) * 0.002,
      status === 'completed' || status === 'in_progress' ? 1 : null,
      1, daysAgo(d + 1));
    const tourId = get(`SELECT last_insert_rowid() AS id`).id;

    if (status === 'completed') {
      // نتائج قائمة التفتيش
      const items = all(`SELECT id FROM checklist_items WHERE template_id = ?`, tmpl);
      for (const it of items) {
        const r = rnd();
        const result = r < 0.72 ? 'pass' : r < 0.88 ? 'fail' : r < 0.95 ? 'na' : 'followup';
        run(`INSERT INTO tour_results (tour_id, item_id, result, note) VALUES (?,?,?,?)`,
          tourId, it.id, result, result === 'fail' ? 'مخالفة مرصودة ميدانياً' : '');
      }
      // ملاحظات مرتبطة بالجولة
      const numObs = ri(0, 3);
      for (let j = 0; j < numObs; j++) {
        obsCount++;
        const cat = pick(OBS_CATEGORIES);
        const likelihood = ri(1, 5), impact = ri(1, 5);
        const score = likelihood * impact;
        const sev = riskLevel(score);
        const ageDays = d;
        const slaMap = { low: 14, medium: 7, high: 3, critical: 1 };
        const due = dateOnly(ageDays - slaMap[sev]);
        // توزيع الحالات حسب العمر
        let st;
        if (ageDays > 30) st = pick(['closed','closed','closed','closed','in_progress','pending_verification','reopened']);
        else if (ageDays > 10) st = pick(['closed','closed','in_progress','assigned','pending_verification','approved']);
        else st = pick(['submitted','under_review','approved','assigned','in_progress','closed']);
        const isCritical = sev === 'critical';
        run(`INSERT INTO observations (ref, otype, project_id, tour_id, site, observer_id, category, description,
              lat, lng, responsible_party, severity, likelihood, impact, risk_score, immediate_action,
              corrective_action, due_date, status, work_stop, escalated, closed_at, closed_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          `OBS-2026-${String(obsCount).padStart(5, '0')}`,
          rnd() < 0.35 ? 'violation' : 'observation',
          pid, tourId, pick(SITES), uid, cat, pick(CAT_DESC[cat]),
          proj.lat + (rnd() - 0.5) * 0.004, proj.lng + (rnd() - 0.5) * 0.004,
          pick(['contractor','contractor','consultant','other']),
          sev, likelihood, impact, score,
          'تم التنبيه على المسؤول ميدانياً وإيقاف النشاط المخالف مؤقتاً.',
          'معالجة المخالفة وتقديم دليل المعالجة خلال المدة المحددة.',
          due, st, isCritical && rnd() < 0.3 ? 1 : 0,
          st !== 'closed' && new Date(due) < new Date() ? 1 : 0,
          st === 'closed' ? daysAgo(Math.max(0, ageDays - slaMap[sev] + ri(-2, 3))) : null,
          st === 'closed' ? 1 : null,
          daysAgo(ageDays), daysAgo(Math.max(0, ageDays - 2)));
        const oid = get(`SELECT last_insert_rowid() AS id`).id;
        run(`INSERT INTO observation_history (observation_id, from_status, to_status, by_user, note, created_at)
             VALUES (?,?,?,?,?,?)`, oid, null, 'submitted', uid, 'تسجيل الملاحظة ميدانياً', daysAgo(ageDays));
        // إجراء تصحيحي للملاحظات غير المغلقة عالية الخطورة
        if (st !== 'closed' && (sev === 'high' || sev === 'critical')) {
          const aref = `CAP-2026-${String(oid).padStart(5, '0')}`;
          run(`INSERT INTO actions (ref, source_type, source_id, project_id, description, required_action,
                assignee, priority, start_date, due_date, progress, status, escalated, created_by, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            aref, 'observation', oid, pid, pick(CAT_DESC[cat]),
            'تنفيذ الإجراء التصحيحي وإرفاق أدلة المعالجة.',
            'مسؤول السلامة — المقاول', sev, dateOnly(ageDays), due,
            ri(0, 80), pick(['open','in_progress','in_progress','pending_verification']),
            new Date(due) < new Date() ? 1 : 0, 1, daysAgo(ageDays));
        }
      }
    }
  }
}

// ===== المخاطر =====
const RISKS = [
  ['انهيار جوانب الحفريات العميقة', 'تربة رملية غير متماسكة، غياب التدعيم', 'إصابات بليغة أو وفيات، توقف الأعمال', 'تدعيم جزئي، تصاريح حفر', 4, 5],
  ['سقوط من ارتفاع أثناء أعمال الجسور', 'حواف مفتوحة، عدم استخدام أحزمة', 'إصابات مميتة', 'حواجز مؤقتة، تدريب', 3, 5],
  ['حوادث مرورية في مناطق التحويلات', 'ضعف الإنارة والعلامات، سرعة المركبات', 'إصابات للعاملين والجمهور', 'حواجز خرسانية، لوحات', 4, 4],
  ['الإجهاد الحراري في أشهر الصيف', 'درجات حرارة مرتفعة، عمل مكشوف', 'إعياء حراري، ضربات شمس', 'جدول صيفي، مظلات ومياه', 4, 3],
  ['صعق كهربائي من التمديدات المؤقتة', 'توصيلات غير آمنة، مياه قرب الكهرباء', 'إصابات خطيرة أو وفاة', 'قواطع تسرب، فحص دوري', 3, 5],
  ['انبعاث غازات في الأماكن المغلقة', 'تحلل مواد عضوية بغرف التفتيش', 'اختناق، فقدان وعي', 'قياس غازات، تهوية', 2, 5],
  ['حريق في مناطق التخزين', 'مواد قابلة للاشتعال، أعمال ساخنة قريبة', 'خسائر مادية وإصابات', 'طفايات، فصل التخزين', 3, 4],
  ['اصطدام معدات ثقيلة بالعاملين', 'نقاط عمياء، غياب مرشدي الحركة', 'إصابات دهس خطيرة', 'إنذارات رجوع، سترات عاكسة', 3, 4],
];
RISKS.forEach((r, i) => {
  const [desc, causes, effects, controls, L, I] = r;
  const score = L * I;
  const rl = ri(1, Math.max(1, L - 1)), rimp = ri(1, Math.max(1, I - 1));
  run(`INSERT INTO risks (ref, project_id, description, causes, effects, current_controls, likelihood, impact, score,
        actions, owner, due_date, residual_likelihood, residual_impact, residual_score, status, monitoring_plan, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `RSK-2026-${String(i + 1).padStart(5, '0')}`, (i % 7) + 1, desc, causes, effects, controls, L, I, score,
    'تعزيز الضوابط الوقائية والتدريب والمتابعة الميدانية.',
    'مسؤول السلامة بالمشروع', dateOnly(-ri(10, 60)), rl, rimp, rl * rimp,
    pick(['open','mitigating','mitigating','monitoring']),
    'مراجعة أسبوعية ضمن الجولات الميدانية.', 1, daysAgo(ri(20, 55)));
});

// ===== الحوادث =====
const INCIDENTS = [
  [2, 'near_miss', 'سقوط مواد من رافعة قرب مجموعة عمال دون إصابات', '', '', 0, 12],
  [1, 'injury', 'إصابة عامل بجرح في اليد أثناء تركيب حديد التسليح', 'جرح قطعي', 'minor', 8, 25],
  [4, 'unsafe_condition', 'تراكم غازات بنسبة منخفضة داخل نفق الخدمات', '', '', 0, 18],
  [3, 'property', 'اصطدام شاحنة بحاجز خرساني أثناء المناورة', '', '', 0, 30],
  [2, 'injury', 'التواء كاحل لعامل بسبب سطح غير مستوٍ', 'التواء', 'minor', 16, 40],
  [7, 'spill', 'انسكاب وقود محدود من خزان معدة', '', '', 0, 22],
  [1, 'near_miss', 'انزلاق معدة قرب حافة حفرية دون أضرار', '', '', 0, 48],
  [6, 'unsafe_act', 'عامل يصعد سقالة دون حزام أمان', '', '', 0, 15],
  [4, 'fire', 'حريق محدود في مواد عزل تمت السيطرة عليه', '', '', 0, 35],
  [5, 'near_miss', 'سيارة تجاوزت التحويلة المرورية ليلاً دون إصابات', '', '', 0, 10],
  [3, 'injury', 'إصابة عامل بكدمة في القدم أثناء مناولة مواد', 'كدمة', 'minor', 4, 1],
];
INCIDENTS.forEach((x, i) => {
  const [pid, itype, desc, injType, injSev, lost, age] = x;
  const closed = age > 20;
  run(`INSERT INTO incidents (ref, project_id, itype, occurred_at, location, lat, lng, description,
        injury_type, injury_severity, lost_hours, immediate_action, investigation_team, rca_method,
        root_cause, direct_causes, indirect_causes, lessons, status, closed_at, approved_by, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `INC-2026-${String(i + 1).padStart(5, '0')}`, pid, itype, daysAgo(age), pick(SITES),
    get(`SELECT lat FROM projects WHERE id=?`, pid).lat + (rnd() - 0.5) * 0.003,
    get(`SELECT lng FROM projects WHERE id=?`, pid).lng + (rnd() - 0.5) * 0.003,
    desc, injType, injSev, lost,
    'تأمين الموقع وإسعاف المصاب وإبلاغ إدارة السلامة.',
    closed ? 'م. عبدالله الحربي، مسؤول السلامة بالمشروع، ممثل المقاول' : '',
    closed ? pick(['5whys','fishbone','rca']) : '',
    closed ? 'ضعف الالتزام بإجراءات السلامة والإشراف الميداني' : '',
    closed ? 'عدم اتباع تعليمات العمل الآمن' : '',
    closed ? 'قصور في التدريب والمتابعة' : '',
    closed ? 'تعزيز التدريب والتفتيش اليومي على النشاط المماثل' : '',
    closed ? 'closed' : pick(['open','investigating','actions']),
    closed ? daysAgo(age - 10) : null, closed ? 1 : null, 1, daysAgo(age));
});

// بيانات المصابين لمتطلبات التأمينات GOSI — القديمة مُبلغة والحديثة بانتظار الإبلاغ
run(`UPDATE incidents SET injured_id = '24' || (ABS(RANDOM()) % 80000000 + 10000000),
      injured_nationality = 'باكستاني', injured_occupation = 'عامل إنشاءات',
      gosi_reported = CASE WHEN julianday('now') - julianday(occurred_at) > 3 THEN 1 ELSE 0 END,
      gosi_reported_at = CASE WHEN julianday('now') - julianday(occurred_at) > 3 THEN datetime(occurred_at, '+1 day') ELSE NULL END
     WHERE itype IN ('injury','fatality')`);

// ===== اجتماعات التوعية Toolbox Talks =====
const TOPICS = [
  'مخاطر العمل على المرتفعات وأحزمة الأمان', 'الإجهاد الحراري وحظر العمل وقت الظهيرة',
  'معدات الوقاية الشخصية وأهمية الالتزام بها', 'السلامة في أعمال الحفر والخنادق',
  'إجراءات الطوارئ ونقاط التجمع', 'التعامل الآمن مع المعدات الثقيلة',
  'مخاطر الكهرباء في المواقع الإنشائية', 'النظافة والترتيب ودورهما في منع الحوادث',
  'تصاريح العمل ومتى تكون إلزامية', 'الإسعافات الأولية الأساسية',
];
let talkCount = 0;
for (let d = 30; d >= 0; d--) {
  for (const pid of [1, 2, 3, 4, 5, 6, 7]) {
    if (rnd() < 0.55) { // ~55% التزام يومي
      talkCount++;
      run(`INSERT INTO toolbox_talks (project_id, talk_date, topic, presenter, attendees_count, duration_min, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        pid, dateOnly(d), pick(TOPICS), 'مسؤول السلامة — المقاول', ri(8, 45), pick([10, 15, 20]), 1, daysAgo(d));
    }
  }
}

// ===== تصاريح العمل =====
const PERMIT_TYPES = ['hotwork','excavation','height','lifting','electrical','confined','road_closure','other'];
for (let i = 0; i < 14; i++) {
  const pid = ri(1, 7);
  const age = ri(-5, 30);
  const status = age > 15 ? 'closed' : age > 5 ? pick(['active','approved','closed','suspended']) : pick(['requested','under_review','approved','active']);
  run(`INSERT INTO permits (ref, project_id, ptype, description, requester, responsible, safety_requirements,
        valid_from, valid_to, status, field_verified, created_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    `PRM-2026-${String(i + 1).padStart(5, '0')}`, pid, pick(PERMIT_TYPES),
    'تنفيذ أعمال ضمن نطاق المشروع وفق اشتراطات السلامة.',
    'مهندس الموقع — المقاول', 'مسؤول السلامة',
    'عزل المنطقة، معدات وقاية كاملة، مراقب سلامة، طفاية حريق.',
    dateOnly(Math.max(0, age)), dateOnly(Math.max(0, age) - 3),
    status, status === 'active' || status === 'closed' ? 1 : 0, 1, daysAgo(Math.max(0, age) + 1));
}

// ===== تقييم المقاولين =====
const months = ['2026-04', '2026-05', '2026-06'];
for (const pid of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const m of months) {
    const scores = {
      safety_plan: ri(60, 100), internal_tours: ri(50, 100), violation_speed: ri(50, 100),
      repeat_rate: ri(50, 100), incidents: ri(60, 100), evidence_quality: ri(55, 100),
      training: ri(60, 100), ppe: ri(60, 100), permits: ri(60, 100), cooperation: ri(70, 100),
    };
    const total = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / 10);
    run(`INSERT INTO evaluations (party_id, project_id, period, scores, total, notes, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      pid, null, m, JSON.stringify(scores), total,
      total >= 85 ? 'أداء جيد — الاستمرار بنفس المستوى' : total >= 70 ? 'أداء مقبول — يتطلب تحسيناً في بعض الجوانب' : 'أداء ضعيف — يتطلب خطة تحسين عاجلة',
      1, `${m}-28 10:00:00`);
  }
}

// ===== إشعارات تجريبية =====
const notifSeed = [
  [1, 'ملاحظة حرجة جديدة', 'تم تسجيل ملاحظة حرجة في مشروع تصريف مياه الأمطار — حي النسيم تتطلب مراجعة عاجلة.', 'critical', 'observation'],
  [1, 'إجراء تصحيحي متأخر', 'إجراء تصحيحي تجاوز تاريخ الاستحقاق في مشروع أنفاق الخدمات وتم تصعيده.', 'escalation', 'action'],
  [2, 'جولة جديدة مكلف بها', 'تم تكليفك بجولة تفتيش على مشروع تطوير طريق الملك عبدالعزيز غداً صباحاً.', 'tour', 'tour'],
  [3, 'اعتماد إغلاق ملاحظة', 'تم اعتماد إغلاق الملاحظة OBS-2026-00012 بعد التحقق من أدلة المعالجة.', 'info', 'observation'],
  [2, 'إعادة فتح ملاحظة', 'تمت إعادة فتح ملاحظة لعدم كفاية الإجراء التصحيحي — يرجى المتابعة.', 'warning', 'observation'],
];
notifSeed.forEach(([uid, t, b, k, et]) => run(
  `INSERT INTO notifications (user_id, title, body, kind, entity_type, entity_id) VALUES (?,?,?,?,?,1)`, uid, t, b, k, et));

run(`INSERT INTO audit_log (user_id, username, action, entity_type, details) VALUES (1, 'admin', 'seed', 'system', 'تهيئة البيانات التجريبية')`);

db.exec('COMMIT');

const counts = {};
for (const t of ['users','parties','projects','checklist_templates','checklist_items','tours','tour_results','observations','risks','incidents','actions','permits','evaluations','notifications'])
  counts[t] = get(`SELECT COUNT(*) AS c FROM ${t}`).c;
console.log('تمت تهيئة البيانات التجريبية:');
console.table(counts);
console.log('حساب المدير: admin / Admin@123');
console.log('حسابات الراصدين: rased1..rased4 / Rased@123');
