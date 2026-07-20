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
    `SELECT u.id, u.username, u.full_name, u.role, u.active, s.expires_at
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

// نطاق المشاريع المسموح للراصد
function allowedProjectIds(user) {
  if (user.role === 'admin') return null; // الكل
  const { all } = require('./db');
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
};
