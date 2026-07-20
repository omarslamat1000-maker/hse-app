// المسارات الأساسية: المصادقة، المستخدمون، الأطراف، الإعدادات، التدقيق، الإشعارات، المرفقات
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { all, get, run, DB_PATH } = require('../db');
const {
  hashPassword, verifyPassword, createSession, destroySession,
  requireAuth, requireAdmin,
} = require('../auth');

const authRouter = express.Router();
const coreRouter = express.Router();

function logAudit(req, action, entityType, entityId, details = '') {
  run(`INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip)
       VALUES (?,?,?,?,?,?,?)`,
    req.user?.id ?? null, req.user?.username ?? '', action, entityType, entityId ?? null,
    typeof details === 'string' ? details : JSON.stringify(details), req.ip || '');
}

// ===== المصادقة =====
authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'أدخل اسم المستخدم وكلمة المرور' });
  const user = get(`SELECT * FROM users WHERE username = ?`, String(username).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  if (!user.active) return res.status(403).json({ error: 'الحساب معطل — راجع مدير النظام' });
  const token = createSession(user.id);
  res.setHeader('Set-Cookie', `hse_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${12 * 3600}`);
  run(`INSERT INTO audit_log (user_id, username, action, entity_type, details, ip) VALUES (?,?,?,?,?,?)`,
    user.id, user.username, 'login', 'session', 'تسجيل دخول', req.ip || '');
  res.json({ id: user.id, username: user.username, full_name: user.full_name, role: user.role });
});

authRouter.post('/logout', requireAuth, (req, res) => {
  destroySession(req.sessionToken);
  logAudit(req, 'logout', 'session', null, 'تسجيل خروج');
  res.setHeader('Set-Cookie', 'hse_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const u = get(`SELECT id, username, full_name, role, phone, email FROM users WHERE id = ?`, req.user.id);
  const projects = req.user.role === 'admin'
    ? all(`SELECT id, name FROM projects WHERE archived = 0`)
    : all(`SELECT p.id, p.name FROM projects p JOIN project_assignments a ON a.project_id = p.id
           WHERE a.user_id = ? AND p.archived = 0`, req.user.id);
  res.json({ ...u, projects });
});

authRouter.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 8)
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' });
  const user = get(`SELECT * FROM users WHERE id = ?`, req.user.id);
  if (!verifyPassword(current || '', user.password_hash))
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  run(`UPDATE users SET password_hash = ? WHERE id = ?`, hashPassword(next), req.user.id);
  logAudit(req, 'change_password', 'user', req.user.id);
  res.json({ ok: true });
});

// جميع المسارات التالية تتطلب تسجيل الدخول
coreRouter.use(requireAuth);

// ===== المستخدمون (مدير النظام) =====
coreRouter.get('/users', requireAdmin, (req, res) => {
  const users = all(`SELECT id, username, full_name, role, phone, email, active, created_at FROM users ORDER BY id`);
  const assignments = all(`SELECT user_id, project_id FROM project_assignments`);
  for (const u of users) u.project_ids = assignments.filter(a => a.user_id === u.id).map(a => a.project_id);
  res.json(users);
});

coreRouter.post('/users', requireAdmin, (req, res) => {
  const { username, password, full_name, role, phone = '', email = '', project_ids = [] } = req.body || {};
  if (!username || !password || !full_name || !['admin', 'observer'].includes(role))
    return res.status(400).json({ error: 'بيانات المستخدم غير مكتملة' });
  if (String(password).length < 8) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });
  if (get(`SELECT id FROM users WHERE username = ?`, String(username).trim().toLowerCase()))
    return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقاً' });
  run(`INSERT INTO users (username, password_hash, full_name, role, phone, email) VALUES (?,?,?,?,?,?)`,
    String(username).trim().toLowerCase(), hashPassword(password), full_name, role, phone, email);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  for (const pid of project_ids) run(`INSERT OR IGNORE INTO project_assignments (user_id, project_id) VALUES (?,?)`, id, pid);
  logAudit(req, 'create', 'user', id, `إنشاء مستخدم ${username}`);
  res.status(201).json({ id });
});

coreRouter.put('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = get(`SELECT * FROM users WHERE id = ?`, id);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const { full_name, role, phone, email, active, password, project_ids } = req.body || {};
  run(`UPDATE users SET full_name = ?, role = ?, phone = ?, email = ?, active = ? WHERE id = ?`,
    full_name ?? user.full_name, ['admin', 'observer'].includes(role) ? role : user.role,
    phone ?? user.phone, email ?? user.email, active === undefined ? user.active : (active ? 1 : 0), id);
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 8 أحرف' });
    run(`UPDATE users SET password_hash = ? WHERE id = ?`, hashPassword(password), id);
  }
  if (Array.isArray(project_ids)) {
    run(`DELETE FROM project_assignments WHERE user_id = ?`, id);
    for (const pid of project_ids) run(`INSERT OR IGNORE INTO project_assignments (user_id, project_id) VALUES (?,?)`, id, pid);
  }
  logAudit(req, 'update', 'user', id, `تعديل مستخدم ${user.username}`);
  res.json({ ok: true });
});

// ===== المقاولون والاستشاريون =====
coreRouter.get('/parties', (req, res) => {
  res.json(all(`SELECT * FROM parties ORDER BY kind, name`));
});

coreRouter.post('/parties', requireAdmin, (req, res) => {
  const { name, kind, contact_name = '', phone = '', email = '' } = req.body || {};
  if (!name || !['contractor', 'consultant'].includes(kind))
    return res.status(400).json({ error: 'بيانات غير مكتملة' });
  run(`INSERT INTO parties (name, kind, contact_name, phone, email) VALUES (?,?,?,?,?)`, name, kind, contact_name, phone, email);
  const id = get(`SELECT last_insert_rowid() AS id`).id;
  logAudit(req, 'create', 'party', id, name);
  res.status(201).json({ id });
});

coreRouter.put('/parties/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM parties WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  const { name, contact_name, phone, email, active } = req.body || {};
  run(`UPDATE parties SET name = ?, contact_name = ?, phone = ?, email = ?, active = ? WHERE id = ?`,
    name ?? p.name, contact_name ?? p.contact_name, phone ?? p.phone, email ?? p.email,
    active === undefined ? p.active : (active ? 1 : 0), id);
  logAudit(req, 'update', 'party', id, name ?? p.name);
  res.json({ ok: true });
});

// حذف مقاول/استشاري — يُسمح فقط إذا لم يكن مرتبطاً بمشاريع أو تقييمات، وإلا فالتعطيل
coreRouter.delete('/parties/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const p = get(`SELECT * FROM parties WHERE id = ?`, id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  const projects = get(`SELECT COUNT(*) AS c FROM projects WHERE contractor_id = ? OR consultant_id = ?`, id, id).c;
  const evals = get(`SELECT COUNT(*) AS c FROM evaluations WHERE party_id = ?`, id).c;
  if (projects || evals) {
    return res.status(409).json({
      error: `لا يمكن الحذف — ${p.kind === 'contractor' ? 'المقاول' : 'الاستشاري'} مرتبط بـ${projects} مشروع و${evals} تقييم. يمكنك تعطيله بدلاً من ذلك فيختفي من القوائم مع بقاء السجلات التاريخية.`,
      can_disable: true,
    });
  }
  run(`DELETE FROM parties WHERE id = ?`, id);
  logAudit(req, 'delete', 'party', id, `حذف نهائي: ${p.name}`);
  res.json({ ok: true });
});

// حذف مستخدم — يُسمح فقط إذا لم تكن له سجلات، وإلا فالتعطيل
coreRouter.delete('/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = get(`SELECT * FROM users WHERE id = ?`, id);
  if (!u) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
  const related =
    get(`SELECT COUNT(*) AS c FROM tours WHERE observer_id = ? OR created_by = ?`, id, id).c +
    get(`SELECT COUNT(*) AS c FROM observations WHERE observer_id = ?`, id).c +
    get(`SELECT COUNT(*) AS c FROM incidents WHERE created_by = ?`, id).c +
    get(`SELECT COUNT(*) AS c FROM actions WHERE created_by = ?`, id).c +
    get(`SELECT COUNT(*) AS c FROM audit_log WHERE user_id = ?`, id).c;
  if (related) {
    return res.status(409).json({
      error: `لا يمكن حذف المستخدم لوجود ${related} سجل مرتبط به (جولات/ملاحظات/عمليات). قواعد العمل تمنع الحذف حفاظاً على سجل التدقيق — عطّل الحساب بدلاً من ذلك.`,
      can_disable: true,
    });
  }
  run(`DELETE FROM sessions WHERE user_id = ?`, id);
  run(`DELETE FROM notifications WHERE user_id = ?`, id);
  run(`DELETE FROM project_assignments WHERE user_id = ?`, id);
  run(`DELETE FROM users WHERE id = ?`, id);
  logAudit(req, 'delete', 'user', id, `حذف نهائي: ${u.username}`);
  res.json({ ok: true });
});

// ===== الإشعارات =====
coreRouter.get('/notifications', (req, res) => {
  const rows = all(`SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100`, req.user.id);
  const unread = get(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0`, req.user.id).c;
  res.json({ items: rows, unread });
});

coreRouter.put('/notifications/read', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
  if (ids && ids.length)
    ids.forEach(id => run(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`, id, req.user.id));
  else run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, req.user.id);
  res.json({ ok: true });
});

// ===== الإعدادات =====
coreRouter.get('/settings', (req, res) => {
  const rows = all(`SELECT key, value FROM settings`);
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});

coreRouter.put('/settings', requireAdmin, (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    run(`INSERT INTO settings (key, value) VALUES (?,?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, String(v));
  }
  logAudit(req, 'update', 'settings', null, JSON.stringify(req.body));
  res.json({ ok: true });
});

// ===== سجل التدقيق =====
coreRouter.get('/audit', requireAdmin, (req, res) => {
  const { q = '', limit = 200 } = req.query;
  const rows = q
    ? all(`SELECT * FROM audit_log WHERE username LIKE ? OR action LIKE ? OR entity_type LIKE ? OR details LIKE ?
           ORDER BY id DESC LIMIT ?`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, Number(limit))
    : all(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, Number(limit));
  res.json(rows);
});

// ===== المرفقات =====
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.pdf', '.doc', '.docx', '.xls', '.xlsx']);
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('نوع الملف غير مسموح'));
    cb(null, true);
  },
});

coreRouter.post('/attachments', upload.array('files', 10), (req, res) => {
  const { entity_type, entity_id, kind = 'photo' } = req.body || {};
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'حدد الكيان المرتبط بالمرفق' });
  const out = [];
  for (const f of req.files || []) {
    let original = f.originalname || '';
    try { original = Buffer.from(original, 'latin1').toString('utf8'); } catch {}
    run(`INSERT INTO attachments (entity_type, entity_id, filename, original_name, mime, size, kind, uploaded_by)
         VALUES (?,?,?,?,?,?,?,?)`,
      entity_type, Number(entity_id), f.filename, original, f.mimetype, f.size, kind, req.user.id);
    out.push({ id: get(`SELECT last_insert_rowid() AS id`).id, filename: f.filename, original_name: original, kind });
  }
  logAudit(req, 'upload', entity_type, Number(entity_id), `${out.length} مرفق`);
  res.status(201).json(out);
});

coreRouter.get('/attachments', (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'حدد الكيان' });
  res.json(all(`SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY id`,
    entity_type, Number(entity_id)));
});

// ===== نسخة احتياطية =====
coreRouter.get('/backup', requireAdmin, (req, res) => {
  logAudit(req, 'backup', 'system', null, 'تنزيل نسخة احتياطية');
  res.setHeader('Content-Disposition', `attachment; filename="hse-backup-${new Date().toISOString().slice(0, 10)}.db"`);
  res.sendFile(DB_PATH);
});

module.exports = { authRouter, coreRouter, logAudit };
