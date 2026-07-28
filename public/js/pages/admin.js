// إدارة النظام: المستخدمون، نماذج التفتيش، سجل العمليات، الإعدادات
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, optsFromDict, fmtDateTime, toast } = UI;

  // ===== المستخدمون =====
  async function renderUsers(el) {
    const [users, projects] = await Promise.all([api('/api/users'), api('/api/projects')]);
    el.innerHTML = `
      <div class="filters">
        <button class="btn" id="usr-add">+ مستخدم جديد</button>
      </div>
      <div id="usr-table"></div>`;
    const tbl = el.querySelector('#usr-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'اسم المستخدم', render: r => `<code>${esc(r.username)}</code>` },
        { title: 'الاسم الكامل', key: 'full_name' },
        { title: 'الدور', render: r => `<span class="badge ${r.role === 'admin' ? 'b-brand' : r.role === 'viewer' ? 'b-neutral' : 'b-info'}">${label('role', r.role)}</span>` },
        { title: 'الهاتف', key: 'phone' },
        { title: 'المشاريع المكلف بها', render: r => r.role === 'admin' ? 'الكل' :
          (r.project_ids || []).map(id => esc(projects.find(p => p.id === id)?.code || id)).join('، ') || '—' },
        { title: 'الحالة', render: r => r.active ? '<span class="badge b-good">نشط</span>' : '<span class="badge b-critical">معطل</span>' },
        { title: 'إجراءات', render: r => `
          <div class="btn-row" style="flex-wrap:nowrap">
            <button class="btn sm secondary" data-uedit="${r.id}">تعديل</button>
            <button class="btn sm secondary" data-utoggle="${r.id}">${r.active ? 'تعطيل' : 'تفعيل'}</button>
            <button class="btn sm danger" data-udel="${r.id}">حذف</button>
          </div>` },
      ],
      rows: users,
    });
    el.querySelector('#usr-add').onclick = () => userForm(null);

    tbl.querySelectorAll('[data-uedit]').forEach(b => b.onclick = () =>
      userForm(users.find(u => u.id === Number(b.dataset.uedit))));

    tbl.querySelectorAll('[data-utoggle]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === Number(b.dataset.utoggle));
      if (u.username === 'admin' && u.active) return toast('لا يمكن تعطيل حساب مدير النظام الرئيسي', 'warn');
      if (!await UI.confirmDialog(u.active
        ? `تعطيل حساب «${u.full_name}»؟ لن يتمكن من تسجيل الدخول حتى إعادة تفعيله.`
        : `إعادة تفعيل حساب «${u.full_name}»؟`)) return;
      await api(`/api/users/${u.id}`, { method: 'PUT', body: { active: u.active ? 0 : 1 } });
      toast(u.active ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
      App.refreshRoute();
    });

    tbl.querySelectorAll('[data-udel]').forEach(b => b.onclick = async () => {
      const u = users.find(x => x.id === Number(b.dataset.udel));
      if (!await UI.confirmDialog(`حذف المستخدم «${u.full_name}» نهائياً؟ الحذف متاح فقط لحساب بلا سجلات — وإلا فسيُقترح التعطيل.`, { danger: true, okText: 'حذف نهائي' })) return;
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        toast('تم حذف المستخدم نهائياً');
        App.refreshRoute();
      } catch (e) {
        if (e.data?.can_disable) {
          if (await UI.confirmDialog(e.message, { okText: 'تعطيل الحساب' })) {
            await api(`/api/users/${u.id}`, { method: 'PUT', body: { active: 0 } });
            toast('تم تعطيل الحساب');
            App.refreshRoute();
          }
        } else toast(e.message, 'error');
      }
    });

    function userForm(u) {
      const isNew = !u;
      const m = UI.modal({
        title: isNew ? 'إضافة مستخدم' : `تعديل ${u.full_name}`,
        wide: true,
        body: `<form id="usr-form" class="form-grid">
          ${fld('اسم المستخدم', `<input name="username" value="${esc(u?.username || '')}" ${isNew ? 'required' : 'disabled'}>`, { required: isNew })}
          ${fld('الاسم الكامل', `<input name="full_name" value="${esc(u?.full_name || '')}" required>`, { required: true })}
          ${fld('الدور', select('role', optsFromDict('role'), u?.role || 'observer', { allowEmpty: false }))}
          ${fld(isNew ? 'كلمة المرور' : 'كلمة مرور جديدة (اختياري)', `<input name="password" type="password" autocomplete="new-password" ${isNew ? 'required' : ''} minlength="8">`, { required: isNew })}
          ${fld('الهاتف', `<input name="phone" value="${esc(u?.phone || '')}">`)}
          ${fld('البريد الإلكتروني', `<input name="email" type="email" value="${esc(u?.email || '')}">`)}
          ${!isNew ? `<label class="fld"><span>الحساب نشط</span><input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}></label>` : ''}
          <div class="full">
            <span style="font-size:.78rem;font-weight:700;color:var(--ink-2)">نطاق المشاريع (لغير مدير النظام)</span>
            <div class="grid cols-2" style="gap:.3rem;margin-top:.4rem">
              ${projects.map(p => `<label style="display:flex;gap:.4rem;align-items:center;font-size:.82rem">
                <input type="checkbox" class="prj-cb" value="${p.id}" style="width:auto" ${(u?.project_ids || []).includes(p.id) ? 'checked' : ''}>
                ${esc(p.name)}</label>`).join('')}
            </div>
          </div>
        </form>`,
        footer: `<button class="btn" id="usr-save">حفظ</button>`,
      });
      m.el.querySelector('#usr-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#usr-form'));
        d.project_ids = [...m.el.querySelectorAll('.prj-cb:checked')].map(cb => Number(cb.value));
        if (!isNew) d.active = m.el.querySelector('[name="active"]')?.checked;
        if (!d.password) delete d.password;
        try {
          if (isNew) await api('/api/users', { method: 'POST', body: d });
          else await api(`/api/users/${u.id}`, { method: 'PUT', body: d });
          toast('تم حفظ المستخدم');
          m.close(); App.refreshRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  }

  // ===== نماذج التفتيش =====
  async function renderChecklists(el) {
    const templates = await api('/api/checklists');
    el.innerHTML = `
      <div class="filters">
        <button class="btn" id="chk-add">+ نموذج جديد</button>
        <span style="font-size:.8rem;color:var(--ink-3)">${templates.length} نموذجاً — ${templates.reduce((s, t) => s + t.items.length, 0)} بنداً</span>
      </div>
      <div class="grid cols-3">
        ${templates.map(t => `
        <div class="card" style="cursor:pointer" data-id="${t.id}">
          <div style="display:flex;justify-content:space-between;gap:.4rem">
            <h3 style="font-size:.88rem;margin:0">${esc(t.name)}</h3>
            ${t.active ? '<span class="badge b-good">نشط</span>' : '<span class="badge b-neutral">معطل</span>'}
          </div>
          <div style="font-size:.74rem;color:var(--ink-3);margin-top:.4rem">${t.items.length} بند تفتيش</div>
        </div>`).join('')}
      </div>`;
    el.querySelectorAll('[data-id]').forEach(c => c.addEventListener('click', () => {
      const t = templates.find(x => x.id === Number(c.dataset.id));
      tmplForm(t);
    }));
    el.querySelector('#chk-add').onclick = () => tmplForm(null);

    function tmplForm(t) {
      const isNew = !t;
      const m = UI.modal({
        title: isNew ? 'نموذج تفتيش جديد' : `تعديل — ${t.name}`,
        wide: true,
        body: `<form id="chk-form">
          <div class="form-grid">
            ${fld('اسم النموذج', `<input name="name" value="${esc(t?.name || '')}" required>`, { required: true })}
            ${fld('الفئة', select('category', optsFromDict('category'), t?.category || '', { emptyLabel: 'اختر…' }), { required: true })}
          </div>
          ${!isNew ? `<label class="fld"><span>النموذج نشط</span><input type="checkbox" name="active" style="width:auto" ${t.active ? 'checked' : ''}></label>` : ''}
          <span style="font-size:.78rem;font-weight:700;color:var(--ink-2)">بنود التفتيش (بند في كل سطر)</span>
          <textarea name="items" style="min-height:220px;margin-top:.4rem">${(t?.items || []).map(i => esc(i.text)).join('\n')}</textarea>
        </form>`,
        footer: `<button class="btn" id="chk-save">حفظ النموذج</button>`,
      });
      m.el.querySelector('#chk-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#chk-form'));
        const items = d.items.split('\n').map(s => s.trim()).filter(Boolean);
        const body = { name: d.name, category: d.category, items };
        if (!isNew) body.active = m.el.querySelector('[name="active"]').checked;
        try {
          if (isNew) await api('/api/checklists', { method: 'POST', body });
          else await api(`/api/checklists/${t.id}`, { method: 'PUT', body });
          toast('تم حفظ النموذج');
          m.close(); App.refreshRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
    }
  }

  // ===== سجل العمليات =====
  async function renderAudit(el, { params }) {
    const rows = await api('/api/audit' + (params.q ? `?q=${encodeURIComponent(params.q)}` : ''));
    const ACTION_AR = {
      login: 'تسجيل دخول', logout: 'تسجيل خروج', create: 'إنشاء', update: 'تعديل', upload: 'رفع مرفق',
      export: 'تصدير', import: 'استيراد', backup: 'نسخة احتياطية', seed: 'تهيئة', tour_start: 'بدء جولة',
      tour_finish: 'إنهاء جولة', tour_results: 'نتائج تفتيش', escalation_check: 'فحص تصعيدات', change_password: 'تغيير كلمة مرور',
    };
    el.innerHTML = `
      <form class="filters" id="aud-filters">
        <label class="fld" style="flex:1;min-width:220px"><span>بحث</span>
          <input name="q" value="${esc(params.q || '')}" placeholder="مستخدم أو عملية أو تفاصيل…"></label>
        <button class="btn sm" type="submit">بحث</button>
        <a class="btn secondary sm" href="/api/export/audit" download>⬇ تصدير السجل</a>
        <a class="btn secondary sm" href="/api/backup" download>💾 نسخة احتياطية من قاعدة البيانات</a>
      </form>
      <div id="aud-table"></div>`;
    el.querySelector('#aud-table').innerHTML = UI.dataTable({
      columns: [
        { title: 'التاريخ والوقت', render: r => fmtDateTime(r.created_at) },
        { title: 'المستخدم', render: r => `<code>${esc(r.username || 'النظام')}</code>` },
        { title: 'العملية', render: r => {
          const base = r.action.split(':')[0];
          return `<span class="badge b-neutral">${esc(ACTION_AR[base] || r.action)}</span>${r.action.includes(':') ? ` <small dir="ltr">${esc(r.action.split(':')[1])}</small>` : ''}`;
        } },
        { title: 'الكيان', render: r => `${esc(r.entity_type)}${r.entity_id ? ' #' + r.entity_id : ''}` },
        { title: 'التفاصيل', render: r => esc((r.details || '').slice(0, 80)) },
      ],
      rows,
    });
    el.querySelector('#aud-filters').addEventListener('submit', e => {
      e.preventDefault();
      const q = e.target.q.value.trim();
      location.hash = '#/audit' + (q ? `?q=${encodeURIComponent(q)}` : '');
    });
  }

  // ===== التصعيد والمهل =====
  async function renderEscalation(el) {
    const s = await api('/api/escalations/status');
    const { rules, sla } = s;
    const { fmtDate } = UI;

    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat critical"><div class="accent"></div><div class="lbl">ملاحظات مصعدة مفتوحة</div><div class="val">${s.escalatedObs.length}</div></div>
        <div class="stat critical"><div class="accent"></div><div class="lbl">إجراءات مصعدة مفتوحة</div><div class="val">${s.escalatedActions.length}</div></div>
        <div class="stat warn"><div class="accent"></div><div class="lbl">تستحق خلال ${rules.remind_before_days} يوم</div><div class="val">${s.upcoming.length}</div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">جولات فائتة</div><div class="val">${s.missedTours.length}</div></div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>⏱ مدد المعالجة القصوى حسب الخطورة (SLA)</h3>
          <div class="sub">تُحدد تاريخ استحقاق الملاحظة تلقائياً عند تسجيلها — بالأيام</div>
          <form id="sla-form">
            <div class="form-grid">
              ${fld('منخفض (يوم)', `<input name="sla_low" type="number" min="1" value="${sla.low}">`)}
              ${fld('متوسط (يوم)', `<input name="sla_medium" type="number" min="1" value="${sla.medium}">`)}
              ${fld('مرتفع (يوم)', `<input name="sla_high" type="number" min="1" value="${sla.high}">`)}
              ${fld('حرج (يوم)', `<input name="sla_critical" type="number" min="1" value="${sla.critical}">`)}
            </div>
            <button class="btn" type="submit">حفظ مدد المعالجة</button>
          </form>
        </div>
        <div class="card">
          <h3>📣 قواعد التصعيد والتنبيه</h3>
          <div class="sub">يعمل الفحص تلقائياً كل 15 دقيقة ويطبق هذه القواعد على جميع الإجراءات</div>
          <form id="rules-form">
            <div class="form-grid">
              ${fld('تنبيه قبل الاستحقاق بـ (يوم)', `<input name="remind_before_days" type="number" min="0" value="${rules.remind_before_days}">`)}
              ${fld('تصعيد الملاحظة بعد الاستحقاق بـ (يوم)', `<input name="obs_after_due_days" type="number" min="0" value="${rules.obs_after_due_days}">`)}
              ${fld('تصعيد الإجراء التصحيحي بعد الاستحقاق بـ (يوم)', `<input name="action_after_due_days" type="number" min="0" value="${rules.action_after_due_days}">`)}
              ${fld('اعتبار الجولة فائتة بعد موعدها بـ (يوم)', `<input name="tour_missed_after_days" type="number" min="0" value="${rules.tour_missed_after_days}">`)}
            </div>
            <div class="btn-row">
              <button class="btn" type="submit">حفظ قواعد التصعيد</button>
              <button class="btn secondary" type="button" id="esc-run">تشغيل الفحص الآن</button>
            </div>
          </form>
          <p style="font-size:.74rem;color:var(--ink-3);margin-top:.7rem">
            القيمة 0 تعني التصعيد فور تجاوز تاريخ الاستحقاق. التنبيهات لا تتكرر لنفس السجل.
          </p>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <h3>🛑 الملاحظات المصعدة (${s.escalatedObs.length})</h3>
        <div id="esc-obs"></div>
      </div>
      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>الإجراءات التصحيحية المصعدة (${s.escalatedActions.length})</h3>
          <div id="esc-acts"></div>
        </div>
        <div class="card">
          <h3>تستحق قريباً — خلال ${rules.remind_before_days} يوم (${s.upcoming.length})</h3>
          <div id="esc-upcoming"></div>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>الجولات الفائتة (${s.missedTours.length})</h3>
        <div id="esc-tours"></div>
      </div>`;

    const escObs = el.querySelector('#esc-obs');
    escObs.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الخطورة', render: r => badge('severity', r.severity) },
        { title: 'الحالة', render: r => badge('obs_status', r.status) },
        { title: 'الراصد', key: 'observer_name' },
        { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
        { title: 'أيام التأخير', render: r => `<b style="color:var(--critical)">${r.days_overdue}</b>` },
      ],
      rows: s.escalatedObs,
      empty: 'لا توجد ملاحظات مصعدة — ممتاز',
    });
    UI.bindRows(escObs, s.escalatedObs, r => { location.hash = `#/observations/${r.id}`; });

    el.querySelector('#esc-acts').innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'المسؤول', key: 'assignee' },
        { title: 'الأولوية', render: r => badge('priority', r.priority, UI.SEV_CLASS[r.priority]) },
        { title: 'أيام التأخير', render: r => `<b style="color:var(--critical)">${r.days_overdue}</b>` },
      ],
      rows: s.escalatedActions,
      empty: 'لا توجد إجراءات مصعدة',
    });

    const upEl = el.querySelector('#esc-upcoming');
    upEl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الخطورة', render: r => badge('severity', r.severity) },
        { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
      ],
      rows: s.upcoming,
      empty: 'لا توجد ملاحظات تستحق خلال النافذة',
    });
    UI.bindRows(upEl, s.upcoming, r => { location.hash = `#/observations/${r.id}`; });

    el.querySelector('#esc-tours').innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الراصد', key: 'observer_name' },
        { title: 'الموعد الفائت', render: r => fmtDate(r.planned_date) },
      ],
      rows: s.missedTours,
      empty: 'لا توجد جولات فائتة',
    });

    el.querySelector('#sla-form').addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      await api('/api/settings', { method: 'PUT', body: {
        sla_days: JSON.stringify({ low: +d.sla_low, medium: +d.sla_medium, high: +d.sla_high, critical: +d.sla_critical }),
      } });
      toast('تم حفظ مدد المعالجة — ستُطبق على الملاحظات الجديدة');
    });
    el.querySelector('#rules-form').addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      await api('/api/settings', { method: 'PUT', body: {
        escalation_rules: JSON.stringify({
          remind_before_days: +d.remind_before_days, obs_after_due_days: +d.obs_after_due_days,
          action_after_due_days: +d.action_after_due_days, tour_missed_after_days: +d.tour_missed_after_days,
        }),
      } });
      toast('تم حفظ قواعد التصعيد');
      App.refreshRoute();
    });
    el.querySelector('#esc-run').onclick = async () => {
      const r = await api('/api/escalations/check', { method: 'POST', body: {} });
      toast(`تم الفحص: ${r.observations} ملاحظة و${r.actions} إجراء صُعدت، ${r.missedTours} جولة فائتة، ${r.reminders} تنبيه استحقاق`);
      App.refreshRoute();
    };
  }

  // ===== الإعدادات =====
  async function renderSettings(el) {
    const s = await api('/api/settings');
    let customStatuses = [];
    try { customStatuses = JSON.parse(s.custom_statuses || '[]'); } catch {}
    let regRefs = [];
    try { regRefs = JSON.parse(s.reg_references || '[]'); } catch {}
    const sla = JSON.parse(s.sla_days || '{"low":14,"medium":7,"high":3,"critical":1}');
    el.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>الإعدادات العامة</h3>
          <form id="set-form">
            ${fld('اسم الجهة (يظهر في التقارير)', `<input name="org_name" value="${esc(s.org_name || '')}">`)}
            ${fld('نافذة منع التكرار (أيام)', `<input name="duplicate_window_days" type="number" min="1" value="${esc(s.duplicate_window_days || 7)}">
              <small style="color:var(--ink-3)">منع تسجيل ملاحظة مكررة لنفس المشروع والموقع والوصف خلال هذه المدة</small>`)}
            <button class="btn" type="submit">حفظ الإعدادات</button>
            <p style="font-size:.78rem;color:var(--ink-3);margin-top:.8rem">
              مدد المعالجة (SLA) وقواعد التصعيد انتقلت إلى صفحة <a href="#/escalation">التصعيد والمهل</a>.
            </p>
          </form>
        </div>
        <div>
          <div class="card">
            <h3>الصيانة والتشغيل</h3>
            <div class="btn-row" style="margin-top:.6rem">
              <button class="btn secondary" id="run-escalation">تشغيل فحص التصعيدات الآن</button>
              <a class="btn secondary" href="/api/backup" download>💾 تنزيل نسخة احتياطية</a>
            </div>
            <p style="font-size:.78rem;color:var(--ink-3);margin-top:.8rem">
              يعمل فحص التصعيدات تلقائياً كل 15 دقيقة: يصعّد الملاحظات والإجراءات المتجاوزة للاستحقاق،
              ويعلّم الجولات الفائتة، ويرسل الإشعارات لمدير النظام.
            </p>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>استيراد بيانات (Excel/CSV)</h3>
            <p style="font-size:.78rem;color:var(--ink-2)">استيراد مشاريع: أعمدة إلزامية <code dir="ltr">code,name,type</code> —
            استيراد مقاولين: <code dir="ltr">name,kind</code> (kind = contractor أو consultant)</p>
            ${fld('الكيان', select('imp_entity', [{ value: 'projects', label: 'مشاريع' }, { value: 'parties', label: 'مقاولون/استشاريون' }], 'projects', { allowEmpty: false }))}
            <label class="btn secondary">📂 اختيار ملف CSV<input type="file" id="imp-file" accept=".csv" hidden></label>
            <div id="imp-status" style="font-size:.78rem;color:var(--ink-3);margin-top:.5rem"></div>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>🔐 مصفوفة الصلاحيات</h3>
            <p style="font-size:.78rem;color:var(--ink-2)">
              حدد ما يستطيع كل دور فعله — تُطبق فوراً على الجميع. صلاحيات مدير النظام كاملة دائماً ولا تُعطل.
            </p>
            <div id="perm-matrix">${UI.spinner()}</div>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>🏷 الحالات المخصصة (الوسوم)</h3>
            <p style="font-size:.78rem;color:var(--ink-2)">
              حالات إضافية تُسند للسجلات (ملاحظات، إجراءات، حوادث، تصاريح، مخاطر) بجانب حالة سير العمل الأساسية —
              تظهر كشارة في الجداول ويمكن التصفية بها، دون التأثير على التصعيد والمؤشرات. حالة في كل سطر:
            </p>
            <form id="tags-form">
              <textarea name="tags" style="min-height:120px">${esc(customStatuses.join('\n'))}</textarea>
              <button class="btn" type="submit" style="margin-top:.6rem">حفظ الحالات المخصصة</button>
            </form>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>📚 المراجع النظامية السعودية</h3>
            <p style="font-size:.78rem;color:var(--ink-2)">
              تظهر كقائمة اقتراحات في حقل «المرجع النظامي» عند تسجيل الملاحظات — لربط كل مخالفة بسندها النظامي (نظام العمل، الكود السعودي للبناء، اشتراطات الدفاع المدني…). مرجع في كل سطر:
            </p>
            <form id="refs-form">
              <textarea name="refs" style="min-height:150px">${esc(regRefs.join('\n'))}</textarea>
              <button class="btn" type="submit" style="margin-top:.6rem">حفظ المراجع النظامية</button>
            </form>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>تغيير كلمة المرور</h3>
            <form id="pwd-form">
              ${fld('كلمة المرور الحالية', '<input name="current" type="password" autocomplete="current-password" required>')}
              ${fld('كلمة المرور الجديدة', '<input name="next" type="password" autocomplete="new-password" minlength="8" required>')}
              <button class="btn secondary" type="submit">تغيير</button>
            </form>
          </div>
        </div>
      </div>`;

    el.querySelector('#set-form').addEventListener('submit', async e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const body = {
        org_name: d.org_name,
        duplicate_window_days: d.duplicate_window_days,
      };
      await api('/api/settings', { method: 'PUT', body });
      toast('تم حفظ الإعدادات');
    });
    // مصفوفة الصلاحيات
    (async () => {
      const pm = await api('/api/permissions');
      const box = el.querySelector('#perm-matrix');
      box.innerHTML = `
        <div class="table-wrap"><table class="data" style="min-width:0">
          <thead><tr><th>الصلاحية</th>${pm.roles.map(r => `<th style="text-align:center">${label('role', r)}</th>`).join('')}</tr></thead>
          <tbody>${pm.permissions.map(p => `
            <tr><td style="font-size:.8rem">${label('perm', p)}</td>
              ${pm.roles.map(r => `<td style="text-align:center">
                <input type="checkbox" data-role="${r}" data-perm="${p}" style="width:auto"
                  ${pm.matrix[r]?.[p] ? 'checked' : ''} ${r === 'admin' ? 'disabled' : ''}></td>`).join('')}
            </tr>`).join('')}
          </tbody></table></div>
        <button class="btn" id="perm-save" style="margin-top:.7rem">حفظ مصفوفة الصلاحيات</button>`;
      box.querySelector('#perm-save').onclick = async () => {
        const matrix = {};
        box.querySelectorAll('input[data-role]').forEach(cb => {
          (matrix[cb.dataset.role] = matrix[cb.dataset.role] || {})[cb.dataset.perm] = cb.checked;
        });
        await api('/api/settings', { method: 'PUT', body: { role_permissions: JSON.stringify(matrix) } });
        toast('تم حفظ مصفوفة الصلاحيات — تُطبق فوراً');
      };
    })();

    el.querySelector('#tags-form').addEventListener('submit', async e => {
      e.preventDefault();
      const tags = e.target.tags.value.split('\n').map(x => x.trim()).filter(Boolean);
      await api('/api/settings', { method: 'PUT', body: { custom_statuses: JSON.stringify(tags) } });
      UI.invalidateCustomStatuses();
      toast(`تم حفظ ${tags.length} حالة مخصصة`);
    });
    el.querySelector('#refs-form').addEventListener('submit', async e => {
      e.preventDefault();
      const refs = e.target.refs.value.split('\n').map(x => x.trim()).filter(Boolean);
      await api('/api/settings', { method: 'PUT', body: { reg_references: JSON.stringify(refs) } });
      toast(`تم حفظ ${refs.length} مرجعاً نظامياً`);
    });
    el.querySelector('#run-escalation').onclick = async () => {
      const r = await api('/api/escalations/check', { method: 'POST', body: {} });
      toast(`تم الفحص: ${r.observations} ملاحظة و${r.actions} إجراء صُعدت، ${r.missedTours} جولة فائتة`);
    };
    el.querySelector('#pwd-form').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api('/api/auth/change-password', { method: 'POST', body: UI.formData(e.target) });
        toast('تم تغيير كلمة المرور');
        e.target.reset();
      } catch (err) { toast(err.message, 'error'); }
    });
    // استيراد CSV
    el.querySelector('#imp-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const entity = el.querySelector('[name="imp_entity"]').value;
      const text = await file.text();
      const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return toast('الملف فارغ أو بلا صفوف', 'warn');
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1).map(l => {
        const vals = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map(v => v.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || l.split(',');
        return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || '').trim()]));
      });
      try {
        const r = await api(`/api/import/${entity}`, { method: 'POST', body: { rows } });
        el.querySelector('#imp-status').textContent = `تم استيراد ${r.imported} سجل — فشل ${r.failed}`;
        toast(`تم استيراد ${r.imported} سجل`);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  window.Pages.users = { title: 'إدارة المستخدمين والراصدين', render: renderUsers, roles: ['admin'] };
  window.Pages.escalation = { title: 'التصعيد والمهل', render: renderEscalation, roles: ['admin'] };
  window.Pages.checklists = { title: 'نماذج وقوائم التفتيش', render: renderChecklists, roles: ['admin'] };
  window.Pages.audit = { title: 'سجل العمليات والتدقيق', render: renderAudit, roles: ['admin'] };
  window.Pages.settings = { title: 'إعدادات النظام', render: renderSettings, roles: ['admin'] };
})();
