// المصادقة والجلسات والصلاحيات
const crypto = require('node:crypto');
const { get, run } = require('./db');

const SESSION_HOURS = 12;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`, token, userId, expires);
  return token;
}

function destroySession(token) {
  run(`DELETE FROM sessions WHERE token = ?`, token);
}

function getSessionUser(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.id, u.username, u.full_name, u.role, u.party_id, u.active, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date() || !row.active) {
    destroySession(token);
    return null;
  }
  return row;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// وسيط: يتطلب تسجيل الدخول
function requireAuth(req, res, next) {
  const token = parseCookies(req).hse_session;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  req.user = user;
  req.sessionToken = token;
  next();
}

// وسيط: يتطلب دور مدير النظام
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'صلاحية غير كافية' });
  next();
}

// ===== مصفوفة الصلاحيات (قابلة للتحرير من الإعدادات — مفتاح role_permissions) =====
const ROLES = ['admin', 'safety_supervisor', 'project_manager', 'observer', 'viewer', 'contractor'];
const PERMISSIONS = [
  'record_observations',   // تسجيل ملاحظات وحوادث وإجراءات متخذة
  'approve_observations',  // اعتماد/رفض/إحالة الملاحظات وسير عملها
  'close_observations',    // اعتماد الإغلاق وإعادة الفتح (ملاحظات وإجراءات وحوادث)
  'assign_tours',          // تخطيط الجولات وتوزيعها وتعديلها
  'approve_permits',       // مراجعة واعتماد وتعليق تصاريح العمل
  'manage_projects',       // إنشاء وتعديل وأرشفة المشاريع والأطراف والتقييمات
  'edit_checklists',       // إدارة نماذج التفتيش
  'view_reports',          // التقارير والمؤشرات والتصدير
];
const DEFAULT_MATRIX = {
  admin:             Object.fromEntries(PERMISSIONS.map(p => [p, true])),
  safety_supervisor: { record_observations: true, approve_observations: true, close_observations: true, assign_tours: true, approve_permits: true, manage_projects: false, edit_checklists: true, view_reports: true },
  project_manager:   { record_observations: false, approve_observations: false, close_observations: false, assign_tours: false, approve_permits: false, manage_projects: false, edit_checklists: false, view_reports: true },
  observer:          { record_observations: true, approve_observations: false, close_observations: false, assign_tours: false, approve_permits: false, manage_projects: false, edit_checklists: false, view_reports: true },
  viewer:            { record_observations: false, approve_observations: false, close_observations: false, assign_tours: false, approve_permits: false, manage_projects: false, edit_checklists: false, view_reports: true },
  // ممثل المقاول: قدراته محددة ببوابته (توثيق المعالجة ورفع الأدلة وطلب التحقق) وتُفرض برمجياً
  contractor:        { record_observations: false, approve_observations: false, close_observations: false, assign_tours: false, approve_permits: false, manage_projects: false, edit_checklists: false, view_reports: false },
};

// وسيط: مسار غير متاح لحساب المقاول
function noContractor(req, res, next) {
  if (req.user?.role === 'contractor') return res.status(403).json({ error: 'هذه الشاشة غير متاحة لحساب المقاول' });
  next();
}

function roleMatrix() {
  try {
    const row = get(`SELECT value FROM settings WHERE key = 'role_permissions'`);
    const saved = row ? JSON.parse(row.value) : {};
    const out = {};
    for (const r of ROLES) out[r] = { ...DEFAULT_MATRIX[r], ...(saved[r] || {}) };
    out.admin = { ...DEFAULT_MATRIX.admin }; // صلاحيات المدير كاملة دائماً — غير قابلة للتعطيل
    return out;
  } catch { return DEFAULT_MATRIX; }
}

function userPerms(user) {
  return roleMatrix()[user?.role] || DEFAULT_MATRIX.viewer;
}

function can(user, perm) {
  if (user?.role === 'admin') return true;
  return !!userPerms(user)[perm];
}

// وسيط: يتطلب صلاحية محددة من المصفوفة
function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.user, perm)) return res.status(403).json({ error: 'صلاحية غير كافية لهذه العملية' });
    next();
  };
}

// نطاق المشاريع المسموح للمستخدم
function allowedProjectIds(user) {
  if (user.role === 'admin') return null; // الكل
  const { all } = require('./db');
  // ممثل المقاول: مشاريع شركته فقط
  if (user.role === 'contractor') {
    if (!user.party_id) return [];
    return all(`SELECT id AS project_id FROM projects WHERE contractor_id = ? AND archived = 0`, user.party_id)
      .map(r => r.project_id);
  }
  return all(`SELECT project_id FROM project_assignments WHERE user_id = ?`, user.id).map(r => r.project_id);
}

function canAccessProject(user, projectId) {
  if (user.role === 'admin') return true;
  const ids = allowedProjectIds(user);
  return ids.includes(Number(projectId));
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  getSessionUser, requireAuth, requireAdmin, allowedProjectIds, canAccessProject, parseCookies,
  ROLES, PERMISSIONS, DEFAULT_MATRIX, roleMatrix, userPerms, can, requirePerm, noContractor,
};
