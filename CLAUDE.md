# CLAUDE.md — منصة السلامة HSE

## نظرة سريعة
منصة عربية RTL لإدارة الأمن والسلامة والصحة المهنية في مشاريع البنية التحتية.
Node.js (Express + `node:sqlite` المدمجة — لا native deps) + SPA بجافاسكربت صرف. التفاصيل في README.md.

## أوامر التشغيل
```bash
npm start        # الخادم على :3000 (PORT قابل للتغيير)
npm run seed     # إعادة تهيئة البيانات التجريبية (مدمّر!)
npm test         # 87 اختبار API — يتطلب خادماً يعمل
node tests/formulas.audit.js   # تدقيق المعادلات (18 فحصاً) — يتطلب خادماً
```
حسابات: `admin/Admin@123` و`rased1..4/Rased@123`. معاينة عبر `.claude/launch.json` باسم `hse-platform`.

## أعراف المشروع
- **البنية**: `server/` (db.js مخططُ SQL قياسي، auth.js جلسات+RBAC، escalation.js مهمة دورية، routes/ أربعة ملفات)، `public/` (SPA: ui.js مكونات+قاموس عربي، charts.js، pages/*).
- **القواعد تُفرض في الخادم لا الواجهة**: انتقالات الحالات خرائط صريحة (OBS_TRANSITIONS…)، بوابات الإغلاق (دليل معالجة + إجراء متخذ)، نطاق الراصد عبر `canAccessProject`.
- **كل نص للمستخدم بالعربية** — الأكواد الداخلية إنجليزية وتُترجم عبر قاموس `UI.L` في ui.js.
- **لا حذف للسجلات المعتمدة** — أرشفة (`archived=1`)، والحذف النهائي فقط لسجل بلا ارتباطات (409 + اقتراح بديل).
- كل تعديل يسجَّل في `audit_log` عبر `logAudit`.
- الترحيلات: `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` داخل try/catch في db.js — تُنفذ عند الإقلاع.
- الخط: TheSansArabic (`public/fonts/`)، الألوان عبر متغيرات CSS (وضعان)، الرسوم بلوحة مدققة CVD في charts.js.
- لقطات شاشة جزء المعاينة غير موثوقة بعد التمرير/تغيير المقاس — تحقق عبر JS/read_page.

## دليل التحديث الآمن (إضافة ميزة)
1. حدّث المخطط في db.js (إضافة غير مدمِّرة فقط) + بيانات seed.js إن لزم.
2. أضف المسار في routes/ المناسب مع `requireAuth`/`requireAdmin` و`canAccessProject` و`logAudit`.
3. الواجهة: صفحة في pages/ تسجل نفسها في `window.Pages` + عنصر قائمة في app.js + أضِف الملف إلى sw.js (وارفع إصدار CACHE).
4. أضف اختبارات في tests/api.test.js، وشغّل `npm test` + `node tests/formulas.audit.js` إن لمست الحسابات.
5. أعد تشغيل الخادم (يطبق الترحيلات) وتحقق في المتصفح، ثم حدّث CHANGELOG.md.

## صيانة دورية
- شهرياً: `npm audit` و`npm outdated` (اعتماديتان فقط: express وmulter).
- نسخ احتياطي دوري لـ `data/hse.db` و`server/uploads/` (زر التنزيل في سجل العمليات، أو نسخ الملف).
- الاستعادة: إيقاف الخادم ← استبدال hse.db ← تشغيل.
- راقب سجل العمليات وصفحة «التصعيد والمهل» بعد الإطلاق.
