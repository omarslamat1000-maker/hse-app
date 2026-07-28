// منصة إدارة الأمن والسلامة والصحة المهنية — الخادم الرئيسي
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { run } = require('./db');
const { requireAuth } = require('./auth');
const { checkEscalations } = require('./escalation');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.disable('x-powered-by');

// رؤوس أمنية أساسية
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// الهوية البصرية — عامة (تلزم شاشة الدخول قبل المصادقة)
const { get: dbGet } = require('./db');
app.get('/api/brand', (req, res) => {
  const g = k => dbGet(`SELECT value FROM settings WHERE key = ?`, k)?.value || '';
  const ext = g('brand_logo_ext');
  res.json({
    platform_name: g('platform_name') || 'منصة السلامة',
    org_name: g('org_name') || '',
    primary_color: g('primary_color') || '',
    logo: ext && fs.existsSync(path.join(__dirname, '..', 'data', 'brand-logo' + ext)) ? '/api/brand/logo?v=' + encodeURIComponent(ext) : null,
  });
});
app.get('/api/brand/logo', (req, res) => {
  const ext = dbGet(`SELECT value FROM settings WHERE key = 'brand_logo_ext'`)?.value;
  const f = ext && path.join(__dirname, '..', 'data', 'brand-logo' + ext);
  if (!f || !fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});

// المسارات
app.use('/api/auth', require('./routes/core').authRouter);
app.use('/api', require('./routes/core').coreRouter);
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/analytics'));

// الملفات المرفوعة (بعد التحقق من الجلسة)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { fallthrough: false, dotfiles: 'deny' }));

// الواجهة الأمامية
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api|uploads).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// معالج أخطاء موحد
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'خطأ غير متوقع في الخادم' });
});

// فحص التصعيدات دورياً (كل 15 دقيقة) وعند الإقلاع
checkEscalations();
setInterval(checkEscalations, 15 * 60 * 1000);

// التقارير المجدولة — فحص الاستحقاق كل 30 دقيقة وعند الإقلاع
const { runScheduledReports } = require('./reportgen');
setTimeout(() => { try { runScheduledReports(); } catch (e) { console.error(e); } }, 5000);
setInterval(() => { try { runScheduledReports(); } catch (e) { console.error(e); } }, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`منصة السلامة تعمل على http://localhost:${PORT}`);
});
