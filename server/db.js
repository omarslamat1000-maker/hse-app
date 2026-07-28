// قاعدة البيانات — SQLite عبر وحدة node:sqlite المدمجة.
// المخطط مكتوب بصيغة SQL قياسية قابلة للنقل إلى PostgreSQL/MySQL
// (استبدل INTEGER PRIMARY KEY AUTOINCREMENT بـ SERIAL/AUTO_INCREMENT).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.HSE_DB || path.join(DATA_DIR, 'hse.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','safety_supervisor','project_manager','observer','viewer','contractor')),
  party_id INTEGER REFERENCES parties(id),
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- المقاولون والاستشاريون
CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('contractor','consultant')),
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL,
  location_text TEXT DEFAULT '',
  lat REAL, lng REAL,
  geofence_radius INTEGER NOT NULL DEFAULT 500,
  owner_entity TEXT DEFAULT '',
  contractor_id INTEGER REFERENCES parties(id),
  consultant_id INTEGER REFERENCES parties(id),
  project_manager TEXT DEFAULT '',
  safety_officer TEXT DEFAULT '',
  value REAL DEFAULT 0,
  start_date TEXT, end_date TEXT,
  progress_pct REAL DEFAULT 0,
  workers_count INTEGER DEFAULT 0,
  work_hours REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','completed','cancelled')),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  safety_plan_approved INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- تكليف الراصدين بالمشاريع
CREATE TABLE IF NOT EXISTS project_assignments (
  user_id INTEGER NOT NULL REFERENCES users(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  PRIMARY KEY (user_id, project_id)
);

-- المرفقات لأي كيان
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'photo',
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- نماذج التفتيش
CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  project_type TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- الجولات الميدانية
CREATE TABLE IF NOT EXISTS tours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  observer_id INTEGER NOT NULL REFERENCES users(id),
  template_id INTEGER REFERENCES checklist_templates(id),
  site TEXT DEFAULT '',
  planned_date TEXT NOT NULL,
  planned_period TEXT NOT NULL DEFAULT 'morning',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','missed','cancelled')),
  started_at TEXT, ended_at TEXT,
  start_lat REAL, start_lng REAL, end_lat REAL, end_lng REAL,
  geofence_ok INTEGER,
  geofence_note TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tour_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES checklist_items(id),
  result TEXT NOT NULL CHECK (result IN ('pass','fail','na','followup')),
  note TEXT DEFAULT '',
  severity TEXT DEFAULT '',
  UNIQUE (tour_id, item_id)
);

-- الملاحظات والمخالفات
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  otype TEXT NOT NULL DEFAULT 'observation' CHECK (otype IN ('observation','violation')),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  tour_id INTEGER REFERENCES tours(id),
  checklist_item_id INTEGER REFERENCES checklist_items(id),
  site TEXT DEFAULT '',
  observer_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  lat REAL, lng REAL,
  responsible_party TEXT DEFAULT 'contractor',
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  likelihood INTEGER NOT NULL DEFAULT 3 CHECK (likelihood BETWEEN 1 AND 5),
  impact INTEGER NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  risk_score INTEGER NOT NULL DEFAULT 9,
  reference_clause TEXT DEFAULT '',
  immediate_action TEXT DEFAULT '',
  corrective_action TEXT DEFAULT '',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN
    ('draft','submitted','under_review','approved','assigned','in_progress',
     'pending_verification','closed','rejected','reopened')),
  work_stop INTEGER NOT NULL DEFAULT 0,
  escalated INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT DEFAULT '',
  reopen_reason TEXT DEFAULT '',
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  verified_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT,
  by_user INTEGER REFERENCES users(id),
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- سجل المخاطر
CREATE TABLE IF NOT EXISTS risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL,
  causes TEXT DEFAULT '',
  effects TEXT DEFAULT '',
  current_controls TEXT DEFAULT '',
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
  score INTEGER NOT NULL,
  actions TEXT DEFAULT '',
  owner TEXT DEFAULT '',
  due_date TEXT,
  residual_likelihood INTEGER, residual_impact INTEGER, residual_score INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigating','monitoring','closed')),
  monitoring_plan TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الحوادث
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  itype TEXT NOT NULL CHECK (itype IN
    ('accident','injury','fatality','property','fire','spill','near_miss','unsafe_condition','unsafe_act')),
  occurred_at TEXT NOT NULL,
  location TEXT DEFAULT '',
  lat REAL, lng REAL,
  people_affected TEXT DEFAULT '',
  description TEXT NOT NULL,
  injury_type TEXT DEFAULT '',
  injury_severity TEXT DEFAULT '',
  lost_hours REAL DEFAULT 0,
  immediate_action TEXT DEFAULT '',
  investigation_team TEXT DEFAULT '',
  rca_method TEXT DEFAULT '',
  root_cause TEXT DEFAULT '',
  direct_causes TEXT DEFAULT '',
  indirect_causes TEXT DEFAULT '',
  lessons TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','actions','closed')),
  closed_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الإجراءات التصحيحية والوقائية CAPA
CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('observation','incident','risk','checklist','manual')),
  source_id INTEGER,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  description TEXT NOT NULL,
  required_action TEXT DEFAULT '',
  assignee TEXT DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  start_date TEXT, due_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN
    ('open','in_progress','pending_verification','closed','rejected','reopened')),
  escalated INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  verified_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- تصاريح العمل
CREATE TABLE IF NOT EXISTS permits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  ptype TEXT NOT NULL,
  description TEXT DEFAULT '',
  requester TEXT DEFAULT '',
  responsible TEXT DEFAULT '',
  safety_requirements TEXT DEFAULT '',
  valid_from TEXT, valid_to TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN
    ('requested','under_review','approved','active','suspended','cancelled','closed')),
  field_verified INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الإشعارات
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info',
  entity_type TEXT DEFAULT '',
  entity_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- تقييم المقاولين والاستشاريين
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  project_id INTEGER REFERENCES projects(id),
  period TEXT NOT NULL,
  scores TEXT NOT NULL DEFAULT '{}',
  total REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- اجتماعات التوعية Toolbox Talks وسجل التدريب
CREATE TABLE IF NOT EXISTS toolbox_talks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  talk_date TEXT NOT NULL,
  topic TEXT NOT NULL,
  presenter TEXT DEFAULT '',
  attendees_count INTEGER NOT NULL DEFAULT 0,
  duration_min INTEGER NOT NULL DEFAULT 15,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_talks_project ON toolbox_talks(project_id, talk_date);

-- سجل الإجراءات المتخذة أثناء المعالجة (ملاحظات، إجراءات تصحيحية، حوادث، تصاريح)
CREATE TABLE IF NOT EXISTS progress_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('observation','action','incident','permit')),
  entity_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  progress INTEGER CHECK (progress BETWEEN 0 AND 100),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_updates_entity ON progress_updates(entity_type, entity_id);

-- سجل التدقيق
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT DEFAULT '',
  entity_id INTEGER,
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project_id);
CREATE INDEX IF NOT EXISTS idx_obs_status ON observations(status);
CREATE INDEX IF NOT EXISTS idx_obs_created ON observations(created_at);
CREATE INDEX IF NOT EXISTS idx_tours_project ON tours(project_id);
CREATE INDEX IF NOT EXISTS idx_tours_observer ON tours(observer_id);
CREATE INDEX IF NOT EXISTS idx_actions_project ON actions(project_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;

db.exec(SCHEMA);

// ترحيلات خفيفة: عمود «الحالة المخصصة» (وسم إضافي بجانب حالة سير العمل)
for (const t of ['observations', 'actions', 'incidents', 'permits', 'risks']) {
  try { db.exec(`ALTER TABLE ${t} ADD COLUMN status_tag TEXT NOT NULL DEFAULT ''`); } catch { /* موجود مسبقاً */ }
}
// ترحيل: توسيع أدوار المستخدمين + ربط ممثل المقاول بشركته — إعادة بناء الجدول عند الحاجة
{
  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get();
  if (ddl && !ddl.sql.includes("'contractor'")) {
    db.exec(`PRAGMA foreign_keys = OFF`);
    db.exec('BEGIN');
    db.exec(`CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','safety_supervisor','project_manager','observer','viewer','contractor')),
      party_id INTEGER REFERENCES parties(id),
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`INSERT INTO users_new (id, username, password_hash, full_name, role, phone, email, active, created_at)
             SELECT id, username, password_hash, full_name, role, phone, email, active, created_at FROM users`);
    db.exec(`DROP TABLE users`);
    db.exec(`ALTER TABLE users_new RENAME TO users`);
    db.exec('COMMIT');
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}

// حقول الإبلاغ عن إصابات العمل للتأمينات الاجتماعية GOSI
for (const col of [
  `injured_id TEXT NOT NULL DEFAULT ''`,          // رقم الهوية / الإقامة
  `injured_nationality TEXT NOT NULL DEFAULT ''`,
  `injured_occupation TEXT NOT NULL DEFAULT ''`,
  `gosi_reported INTEGER NOT NULL DEFAULT 0`,
  `gosi_reported_at TEXT`,
]) {
  try { db.exec(`ALTER TABLE incidents ADD COLUMN ${col}`); } catch { /* موجود مسبقاً */ }
}

// ===== أدوات مساعدة =====
function all(sql, ...params) { return db.prepare(sql).all(...params); }
function get(sql, ...params) { return db.prepare(sql).get(...params); }
function run(sql, ...params) { return db.prepare(sql).run(...params); }

// توليد رقم مرجعي تسلسلي حسب النوع والسنة: OBS-2026-00051
function nextRef(prefix, table) {
  const year = new Date().getFullYear();
  const like = `${prefix}-${year}-%`;
  const row = get(`SELECT ref FROM ${table} WHERE ref LIKE ? ORDER BY id DESC LIMIT 1`, like);
  let n = 1;
  if (row) n = parseInt(row.ref.split('-')[2], 10) + 1;
  return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
}

// مدد المعالجة الافتراضية بالأيام حسب الخطورة (قابلة للتعديل من الإعدادات)
const DEFAULT_SLA = { low: 14, medium: 7, high: 3, critical: 1 };
function slaDays(severity) {
  const row = get(`SELECT value FROM settings WHERE key = 'sla_days'`);
  const sla = row ? JSON.parse(row.value) : DEFAULT_SLA;
  return sla[severity] ?? 7;
}

function riskLevel(score) {
  if (score >= 17) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
}

module.exports = { db, all, get, run, nextRef, slaDays, riskLevel, DB_PATH };
