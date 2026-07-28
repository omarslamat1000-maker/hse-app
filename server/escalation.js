// التصعيد التلقائي للملاحظات والإجراءات المتأخرة + التذكير قبل الاستحقاق
// المهل قابلة للتخصيص من صفحة «التصعيد والمهل» في حساب مدير النظام
const { all, run, get } = require('./db');
const { pushToUser } = require('./realtime');

const DEFAULT_RULES = {
  remind_before_days: 2,      // تنبيه قبل تاريخ الاستحقاق بـ N يوم
  obs_after_due_days: 0,      // تصعيد الملاحظة بعد تجاوز الاستحقاق بـ N يوم
  action_after_due_days: 0,   // تصعيد الإجراء التصحيحي بعد تجاوز الاستحقاق بـ N يوم
  tour_missed_after_days: 0,  // اعتبار الجولة فائتة بعد موعدها بـ N يوم
};

function escalationRules() {
  try {
    const row = get(`SELECT value FROM settings WHERE key = 'escalation_rules'`);
    return { ...DEFAULT_RULES, ...(row ? JSON.parse(row.value) : {}) };
  } catch { return { ...DEFAULT_RULES }; }
}

function notifyAdmins(title, body, kind, entityType, entityId) {
  const admins = all(`SELECT id FROM users WHERE role = 'admin' AND active = 1`);
  for (const a of admins) {
    run(`INSERT INTO notifications (user_id, title, body, kind, entity_type, entity_id)
         VALUES (?,?,?,?,?,?)`, a.id, title, body, kind, entityType, entityId);
    pushToUser(a.id, { title, body, kind, entity_type: entityType, entity_id: entityId });
  }
}

function notifyUser(userId, title, body, kind, entityType, entityId) {
  run(`INSERT INTO notifications (user_id, title, body, kind, entity_type, entity_id)
       VALUES (?,?,?,?,?,?)`, userId, title, body, kind, entityType, entityId);
  pushToUser(userId, { title, body, kind, entity_type: entityType, entity_id: entityId });
}

// تنبيه مرة واحدة فقط لكل كيان (تفادي التكرار في كل دورة فحص)
function alreadyNotified(kind, entityType, entityId) {
  return !!get(`SELECT 1 AS x FROM notifications WHERE kind = ? AND entity_type = ? AND entity_id = ? LIMIT 1`,
    kind, entityType, entityId);
}

function checkEscalations() {
  const rules = escalationRules();

  // ملاحظات تجاوزت الاستحقاق (+ مهلة التصعيد) ولم تُغلق ولم تُصعّد بعد
  const overdueObs = all(
    `SELECT o.id, o.ref, o.severity, o.observer_id, p.name AS project_name
     FROM observations o JOIN projects p ON p.id = o.project_id
     WHERE o.status NOT IN ('closed','rejected','draft') AND o.escalated = 0
       AND o.due_date IS NOT NULL AND date(o.due_date, '+' || ? || ' days') < date('now') AND o.archived = 0`,
    Number(rules.obs_after_due_days) || 0);
  for (const o of overdueObs) {
    run(`UPDATE observations SET escalated = 1, updated_at = datetime('now') WHERE id = ?`, o.id);
    run(`INSERT INTO observation_history (observation_id, from_status, to_status, by_user, note)
         VALUES (?,?,?,?,?)`, o.id, null, null, null, 'تصعيد تلقائي — تجاوز تاريخ الاستحقاق');
    notifyAdmins('تصعيد ملاحظة متأخرة',
      `الملاحظة ${o.ref} في «${o.project_name}» تجاوزت تاريخ الاستحقاق وتم تصعيدها تلقائياً.`,
      'escalation', 'observation', o.id);
    notifyUser(o.observer_id, 'ملاحظة متأخرة',
      `الملاحظة ${o.ref} التي رصدتها تجاوزت تاريخ الاستحقاق دون إغلاق.`,
      'warning', 'observation', o.id);
  }

  // إجراءات تصحيحية متأخرة
  const overdueActions = all(
    `SELECT a.id, a.ref, p.name AS project_name
     FROM actions a JOIN projects p ON p.id = a.project_id
     WHERE a.status NOT IN ('closed','rejected') AND a.escalated = 0
       AND a.due_date IS NOT NULL AND date(a.due_date, '+' || ? || ' days') < date('now') AND a.archived = 0`,
    Number(rules.action_after_due_days) || 0);
  for (const a of overdueActions) {
    run(`UPDATE actions SET escalated = 1 WHERE id = ?`, a.id);
    notifyAdmins('تصعيد إجراء تصحيحي متأخر',
      `الإجراء ${a.ref} في «${a.project_name}» تجاوز تاريخ الاستحقاق وتم تصعيده تلقائياً.`,
      'escalation', 'action', a.id);
  }

  // جولات فات موعدها ولم تنفذ
  const missed = all(
    `SELECT t.id, t.ref, t.observer_id, p.name AS project_name
     FROM tours t JOIN projects p ON p.id = t.project_id
     WHERE t.status = 'planned' AND date(t.planned_date, '+' || ? || ' days') < date('now')`,
    Number(rules.tour_missed_after_days) || 0);
  for (const t of missed) {
    run(`UPDATE tours SET status = 'missed' WHERE id = ?`, t.id);
    notifyAdmins('جولة لم تنفذ', `الجولة ${t.ref} على «${t.project_name}» لم تنفذ في موعدها.`, 'warning', 'tour', t.id);
  }

  // تذكير قبل الاستحقاق: ملاحظات مفتوحة يحين استحقاقها خلال النافذة
  let reminders = 0;
  const remindDays = Number(rules.remind_before_days) || 0;
  if (remindDays > 0) {
    const upcoming = all(
      `SELECT o.id, o.ref, o.due_date, o.observer_id, p.name AS project_name
       FROM observations o JOIN projects p ON p.id = o.project_id
       WHERE o.status NOT IN ('closed','rejected','draft') AND o.archived = 0
         AND o.due_date IS NOT NULL
         AND date(o.due_date) >= date('now')
         AND date(o.due_date) <= date('now', '+' || ? || ' days')`, remindDays);
    for (const o of upcoming) {
      if (alreadyNotified('reminder', 'observation', o.id)) continue;
      notifyAdmins('تنبيه قبل الاستحقاق',
        `الملاحظة ${o.ref} في «${o.project_name}» يحين استحقاقها في ${o.due_date} — يرجى متابعة المعالجة.`,
        'reminder', 'observation', o.id);
      notifyUser(o.observer_id, 'تنبيه قبل الاستحقاق',
        `الملاحظة ${o.ref} يحين استحقاقها في ${o.due_date}.`, 'reminder', 'observation', o.id);
      reminders++;
    }
    const upcomingActs = all(
      `SELECT a.id, a.ref, a.due_date, p.name AS project_name
       FROM actions a JOIN projects p ON p.id = a.project_id
       WHERE a.status NOT IN ('closed','rejected') AND a.archived = 0
         AND a.due_date IS NOT NULL
         AND date(a.due_date) >= date('now')
         AND date(a.due_date) <= date('now', '+' || ? || ' days')`, remindDays);
    for (const a of upcomingActs) {
      if (alreadyNotified('reminder', 'action', a.id)) continue;
      notifyAdmins('تنبيه قبل استحقاق إجراء',
        `الإجراء ${a.ref} في «${a.project_name}» يحين استحقاقه في ${a.due_date}.`, 'reminder', 'action', a.id);
      reminders++;
    }
  }

  // مهلة الإبلاغ عن إصابات العمل للتأمينات الاجتماعية GOSI (3 أيام من وقوع الإصابة)
  let gosiAlerts = 0;
  const unreported = all(
    `SELECT i.id, i.ref, i.occurred_at, p.name AS project_name,
       CAST(julianday('now') - julianday(i.occurred_at) AS INTEGER) AS days_since
     FROM incidents i JOIN projects p ON p.id = i.project_id
     WHERE i.itype IN ('injury','fatality') AND i.gosi_reported = 0 AND i.archived = 0
       AND julianday('now') - julianday(i.occurred_at) >= 2`);
  for (const inc of unreported) {
    if (alreadyNotified('gosi', 'incident', inc.id)) continue;
    notifyAdmins('⚠ مهلة الإبلاغ للتأمينات الاجتماعية',
      `الإصابة ${inc.ref} في «${inc.project_name}» مضى عليها ${inc.days_since} يوم دون تعليمها كمُبلّغة للتأمينات — المهلة النظامية 3 أيام من وقوع الإصابة.`,
      'gosi', 'incident', inc.id);
    gosiAlerts++;
  }

  return { observations: overdueObs.length, actions: overdueActions.length, missedTours: missed.length, reminders, gosiAlerts };
}

module.exports = { checkEscalations, notifyAdmins, notifyUser, escalationRules, DEFAULT_RULES };
