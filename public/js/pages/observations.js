// الملاحظات والمخالفات — القائمة، التفاصيل، سير العمل، نموذج التسجيل الميداني
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, optsFromDict, fmtDate, fmtDateTime, toast } = UI;

  // ===== نموذج تسجيل ملاحظة (مشترك: يُستدعى من أي مكان) =====
  window.ObservationForm = async function (preset = {}) {
    const me = await api('/api/auth/me');
    const projects = me.projects;
    let regRefs = [];
    try { regRefs = JSON.parse((await api('/api/settings')).reg_references || '[]'); } catch {}
    const m = UI.modal({
      title: preset.description ? 'تسجيل ملاحظة من بند التفتيش' : 'تسجيل ملاحظة / مخالفة',
      wide: true,
      body: `<form id="obs-form" class="form-grid">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), preset.project_id || '', { allowEmpty: false }), { required: true })}
        ${fld('النوع', select('otype', optsFromDict('otype'), preset.otype || 'observation', { allowEmpty: false }))}
        ${fld('الموقع داخل المشروع', `<input name="site" value="${esc(preset.site || '')}">`)}
        ${fld('التصنيف', select('category', optsFromDict('category'), preset.category || '', { emptyLabel: 'اختر…' }), { required: true })}
        ${fld('وصف الملاحظة', `<textarea name="description" required>${esc(preset.description || '')}</textarea>
          <div style="font-size:.72rem;color:var(--ink-3);margin-top:.2rem" id="ai-hint"></div>`, { required: true, full: true })}
        ${fld('الطرف المسؤول', select('responsible_party', optsFromDict('party'), 'contractor', { allowEmpty: false }))}
        ${fld('المرجع النظامي / بند التفتيش', `<input name="reference_clause" list="reg-refs" placeholder="اختر من المراجع السعودية أو اكتب…">
          <datalist id="reg-refs">${regRefs.map(r => `<option value="${esc(r)}">`).join('')}</datalist>`)}
        ${fld('الاحتمالية (1-5)', `<input name="likelihood" type="number" min="1" max="5" value="3">`)}
        ${fld('شدة الأثر (1-5)', `<input name="impact" type="number" min="1" max="5" value="3">`)}
        ${fld('درجة المخاطر', `<input id="obs-score" disabled value="9 — متوسط">`)}
        ${fld('مستوى الخطورة', select('severity', optsFromDict('severity'), '', { emptyLabel: 'تلقائي من الدرجة' }))}
        ${fld('الإجراء الفوري المتخذ', `<textarea name="immediate_action"></textarea>`, { full: true })}
        ${fld('الإجراء التصحيحي المطلوب', `<textarea name="corrective_action"></textarea>`, { full: true })}
        ${fld('تاريخ الاستحقاق', `<input name="due_date" type="date"> <small style="color:var(--ink-3)">يُحدد تلقائياً حسب الخطورة إن تُرك فارغاً</small>`)}
        <label class="fld"><span>🛑 حرجة وتستوجب التوصية بإيقاف العمل</span><input type="checkbox" name="work_stop" style="width:auto"></label>
        <div class="full">
          <div class="btn-row">
            <button type="button" class="btn secondary sm" id="obs-gps">📍 تحديد الموقع الجغرافي</button>
            <span id="obs-gps-status" style="font-size:.76rem;color:var(--ink-3)"></span>
          </div>
          <div class="btn-row" style="margin-top:.6rem">
            <label class="btn secondary sm">📷 التقاط / إرفاق صور<input type="file" id="obs-files" accept="image/*,video/*,.pdf" capture="environment" multiple hidden></label>
            <span id="obs-files-status" style="font-size:.76rem;color:var(--ink-3)"></span>
          </div>
        </div>
      </form>`,
      footer: `<button class="btn" id="obs-save">حفظ الملاحظة</button>
               <button class="btn secondary" id="obs-draft">حفظ كمسودة</button>`,
    });

    const form = m.el.querySelector('#obs-form');
    let gps = null, files = [];

    // درجة المخاطر التفاعلية
    const likeEl = form.querySelector('[name="likelihood"]'), impEl = form.querySelector('[name="impact"]');
    function updScore() {
      const s = (Number(likeEl.value) || 3) * (Number(impEl.value) || 3);
      const lvl = s >= 17 ? 'critical' : s >= 10 ? 'high' : s >= 5 ? 'medium' : 'low';
      form.querySelector('#obs-score').value = `${s} — ${label('severity', lvl)}`;
    }
    likeEl.addEventListener('input', updScore); impEl.addEventListener('input', updScore);

    // تصنيف ذكي من الوصف
    const descEl = form.querySelector('[name="description"]');
    let aiTimer;
    descEl.addEventListener('input', () => {
      clearTimeout(aiTimer);
      aiTimer = setTimeout(async () => {
        if (descEl.value.trim().length < 8) return;
        try {
          const r = await api('/api/ai/classify', { method: 'POST', body: { description: descEl.value } });
          const hint = m.el.querySelector('#ai-hint');
          if (r.category) {
            hint.innerHTML = `💡 اقتراح آلي: التصنيف <b>${label('category', r.category)}</b> — الخطورة <b>${label('severity', r.severity)}</b>
              <button type="button" class="btn ghost sm" id="ai-apply">تطبيق</button>`;
            hint.querySelector('#ai-apply').onclick = () => {
              form.querySelector('[name="category"]').value = r.category;
              form.querySelector('[name="severity"]').value = r.severity;
            };
          }
        } catch {}
      }, 600);
    });
    if (preset.description) descEl.dispatchEvent(new Event('input'));

    m.el.querySelector('#obs-gps').onclick = async e => {
      e.target.textContent = 'جارٍ التحديد…';
      gps = await UI.getLocation();
      m.el.querySelector('#obs-gps-status').textContent = gps
        ? `تم التحديد (دقة ${Math.round(gps.accuracy)} م)` : 'تعذر تحديد الموقع — تأكد من تفعيل GPS';
      e.target.textContent = '📍 تحديد الموقع الجغرافي';
    };
    m.el.querySelector('#obs-files').addEventListener('change', e => {
      files = [...e.target.files];
      m.el.querySelector('#obs-files-status').textContent = files.length ? `${files.length} ملف جاهز للرفع` : '';
    });

    return new Promise(resolve => {
      m.el.addEventListener('transitionend', () => {}, { once: true });
      const origClose = m.close;
      async function save(asDraft) {
        const d = UI.formData(form);
        if (!d.project_id || !d.category || !d.description.trim()) return toast('أكمل الحقول الإلزامية: المشروع والتصنيف والوصف', 'warn');
        const body = {
          ...d,
          project_id: Number(d.project_id),
          likelihood: Number(d.likelihood) || 3,
          impact: Number(d.impact) || 3,
          work_stop: d.work_stop ? 1 : 0,
          lat: gps?.lat, lng: gps?.lng,
          tour_id: preset.tour_id, checklist_item_id: preset.checklist_item_id,
          status: asDraft ? 'draft' : undefined,
        };
        if (!body.severity) delete body.severity;
        try {
          let r;
          try {
            r = await api('/api/observations', { method: 'POST', body, queueable: true });
          } catch (e) {
            if (e.status === 409 && e.data?.requires_confirm) {
              if (!await UI.confirmDialog(e.message, { okText: 'تسجيل على أي حال' })) return;
              r = await api('/api/observations', { method: 'POST', body: { ...body, force: true }, queueable: true });
            } else throw e;
          }
          if (r.__queued) {
            toast('لا يوجد اتصال — حُفظت الملاحظة محلياً وستُزامن تلقائياً', 'warn');
            resolve(true); m.close(); return;
          }
          if (files.length) {
            try { await UI.uploadAttachments('observation', r.id, files, 'before'); }
            catch { toast('حُفظت الملاحظة لكن تعذر رفع المرفقات', 'warn'); }
          }
          toast(`تم تسجيل الملاحظة ${r.ref} — الاستحقاق ${r.due_date}`);
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      }
      m.el.querySelector('#obs-save').onclick = () => save(false);
      m.el.querySelector('#obs-draft').onclick = () => save(true);
    });
  };

  // ===== نافذة تعديل الملاحظة (بيانات + حالة مخصصة + تغيير الحالة) =====
  async function observationEditModal(row, user) {
    const [o, tags] = await Promise.all([
      api(`/api/observations/${row.id}`),
      UI.customStatuses(),
    ]);
    const canEditFields = user.role === 'admin' ||
      (o.observer_id === user.id && ['draft', 'submitted', 'rejected'].includes(o.status));
    const transitions = (NEXT_ACTIONS[o.status] || []).filter(a => hasPerm(user, a));
    return new Promise(resolve => {
      const m = UI.modal({
        title: `تعديل ${o.ref}`,
        wide: true,
        body: `<form id="oe-form" class="form-grid">
          ${fld('الموقع', `<input name="site" value="${esc(o.site || '')}" ${canEditFields ? '' : 'disabled'}>`)}
          ${fld('التصنيف', canEditFields ? select('category', optsFromDict('category'), o.category, { allowEmpty: false }) : `<input value="${esc(label('category', o.category))}" disabled>`)}
          ${fld('الوصف', `<textarea name="description" ${canEditFields ? '' : 'disabled'}>${esc(o.description)}</textarea>`, { full: true })}
          ${fld('الطرف المسؤول', canEditFields ? select('responsible_party', optsFromDict('party'), o.responsible_party, { allowEmpty: false }) : `<input value="${esc(label('party', o.responsible_party))}" disabled>`)}
          ${fld('مستوى الخطورة', canEditFields ? select('severity', optsFromDict('severity'), o.severity, { allowEmpty: false }) : `<input value="${esc(label('severity', o.severity))}" disabled>`)}
          ${fld('تاريخ الاستحقاق', `<input name="due_date" type="date" value="${esc(o.due_date || '')}" ${user.role === 'admin' ? '' : 'disabled'}>`)}
          ${fld('الحالة المخصصة (وسم)', UI.tagSelect('status_tag', tags, o.status_tag || ''))}
          <div class="full" style="border-top:1px solid var(--hairline);padding-top:.8rem;margin-top:.3rem">
            <span style="font-size:.8rem;font-weight:700;color:var(--ink-2)">تغيير الحالة — الحالة الحالية: ${badge('obs_status', o.status)}</span>
            ${transitions.length ? `
            <div class="btn-row" style="margin-top:.5rem;align-items:flex-end">
              <label class="fld" style="min-width:220px;margin:0"><span>الحالات المتاحة</span>
                <select id="oe-transition">
                  <option value="">— اختر الحالة الجديدة —</option>
                  ${transitions.map((t, i) => `<option value="${i}">${esc(t.label)} (${label('obs_status', t.to)})</option>`).join('')}
                </select></label>
              <button type="button" class="btn sm" id="oe-apply-tr">تطبيق الحالة</button>
            </div>` : '<div style="font-size:.78rem;color:var(--ink-3);margin-top:.4rem">لا تتوفر انتقالات لهذه الحالة ضمن صلاحيتك</div>'}
          </div>
        </form>`,
        footer: `<button class="btn" id="oe-save">حفظ التعديلات</button>
                 <a class="btn secondary" href="#/observations/${o.id}">فتح الصفحة الكاملة</a>`,
        onClose: () => resolve(false),
      });
      m.el.querySelector('#oe-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#oe-form'));
        const body = { status_tag: d.status_tag ?? '' };
        if (canEditFields) Object.assign(body, {
          site: d.site, category: d.category, description: d.description,
          responsible_party: d.responsible_party, severity: d.severity,
        });
        if (user.role === 'admin' && d.due_date !== undefined) body.due_date = d.due_date || null;
        try {
          await api(`/api/observations/${o.id}`, { method: 'PUT', body });
          toast('تم حفظ التعديلات');
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
      const applyBtn = m.el.querySelector('#oe-apply-tr');
      if (applyBtn) applyBtn.onclick = async () => {
        const idx = m.el.querySelector('#oe-transition').value;
        if (idx === '') return toast('اختر الحالة الجديدة أولاً', 'warn');
        const t = transitions[Number(idx)];
        let note = '';
        if (t.needNote) {
          note = await UI.promptDialog(t.needNote);
          if (!note) return;
        } else if (!await UI.confirmDialog(`تأكيد: ${t.label}؟`)) return;
        try {
          await api(`/api/observations/${o.id}/transition`, { method: 'POST', body: { to: t.to, note } });
          toast('تم تحديث حالة الملاحظة');
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  // ===== قائمة الملاحظات =====
  async function render(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [rows, projects, tags] = await Promise.all([
      api('/api/observations' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
      UI.customStatuses(),
    ]);
    el.innerHTML = `
      <form class="filters" id="obs-filters">
        <label class="fld" style="min-width:200px;flex:1"><span>بحث</span>
          <input name="q" placeholder="الوصف أو الرقم المرجعي…" value="${esc(params.q || '')}"></label>
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('النوع', select('otype', optsFromDict('otype'), params.otype))}
        ${fld('الخطورة', select('severity', optsFromDict('severity'), params.severity))}
        ${fld('الحالة', select('status', optsFromDict('obs_status'), params.status))}
        ${tags.length ? fld('الحالة المخصصة', select('status_tag', tags.map(t => ({ value: t, label: t })), params.status_tag)) : ''}
        ${fld('التصنيف', select('category', optsFromDict('category'), params.category))}
        ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
        <button class="btn sm" type="submit">تصفية</button>
        ${(user.role === 'admin' || user.perms?.record_observations) ? '<button class="btn" type="button" id="obs-new">+ ملاحظة جديدة</button>' : ''}
        <a class="btn secondary sm" href="/api/export/observations" download>⬇ تصدير</a>
      </form>
      <div id="obs-table"></div>`;
    const tbl = el.querySelector('#obs-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', render: r => `${esc(r.ref)}${r.escalated ? ' <span class="badge b-critical">مصعدة</span>' : ''}${r.work_stop ? ' 🛑' : ''}` },
        { title: 'النوع', render: r => badge('otype', r.otype, r.otype === 'violation' ? 'b-high' : 'b-neutral') },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الوصف', render: r => esc(r.description).slice(0, 55) },
        { title: 'التصنيف', render: r => label('category', r.category) },
        { title: 'الخطورة', render: r => badge('severity', r.severity) },
        { title: 'الحالة', render: r => badge('obs_status', r.status) + UI.tagBadge(r.status_tag) + (r.overdue ? ' <span class="badge b-critical">متأخرة</span>' : '') },
        { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
        { title: 'الراصد', key: 'observer_name' },
        { title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` },
      ],
      rows,
    });
    UI.bindRows(tbl, rows, r => { location.hash = `#/observations/${r.id}`; });
    tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const row = rows.find(x => x.id === Number(b.dataset.edit));
      if (await observationEditModal(row, user)) App.refreshRoute();
    }));
    el.querySelector('#obs-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/observations' + (q ? `?${q}` : '');
    });
    const newBtn = el.querySelector('#obs-new');
    if (newBtn) newBtn.onclick = () => window.ObservationForm({}).then(s => s && App.refreshRoute());
  }

  // ===== تفاصيل الملاحظة وسير العمل =====
  const NEXT_ACTIONS = {
    // status -> [{to, label, perm, kind}] — perm: الصلاحية المطلوبة من المصفوفة (null = تسجيل أو إغلاق)
    draft: [{ to: 'submitted', label: 'تقديم الملاحظة', perm: 'record_observations' }],
    submitted: [
      { to: 'under_review', label: 'بدء المراجعة', perm: 'approve_observations' },
      { to: 'approved', label: 'اعتماد', perm: 'approve_observations' },
      { to: 'rejected', label: 'رفض', perm: 'approve_observations', needNote: 'سبب الرفض', kind: 'danger' },
    ],
    under_review: [
      { to: 'approved', label: 'اعتماد', perm: 'approve_observations' },
      { to: 'rejected', label: 'رفض', perm: 'approve_observations', needNote: 'سبب الرفض', kind: 'danger' },
    ],
    approved: [{ to: 'assigned', label: 'إحالة للمعالجة', perm: 'approve_observations' }],
    assigned: [{ to: 'in_progress', label: 'بدء التنفيذ', perm: 'approve_observations' }],
    in_progress: [{ to: 'pending_verification', label: 'جاهزة للتحقق', perm: 'approve_observations' }],
    pending_verification: [
      { to: 'closed', label: 'اعتماد الإغلاق ✔', perm: 'close_observations' },
      { to: 'reopened', label: 'إعادة فتح — الدليل غير كافٍ', perm: null, needNote: 'سبب إعادة الفتح', kind: 'danger' },
    ],
    rejected: [{ to: 'submitted', label: 'إعادة التقديم', perm: 'record_observations' }],
    reopened: [{ to: 'in_progress', label: 'إعادة التنفيذ', perm: 'approve_observations' }],
    closed: [{ to: 'reopened', label: 'إعادة فتح', perm: null, needNote: 'سبب إعادة الفتح', kind: 'danger' }],
  };
  // هل يملك المستخدم صلاحية هذا الانتقال؟
  function hasPerm(user, action) {
    if (user.role === 'admin') return true;
    // ممثل المقاول: بدء التنفيذ وطلب التحقق فقط
    if (user.role === 'contractor') return ['in_progress', 'pending_verification'].includes(action.to);
    if (action.perm === null) return !!(user.perms?.record_observations || user.perms?.close_observations);
    return !!user.perms?.[action.perm];
  }

  async function renderDetail(el, { args, user }) {
    const id = Number(args[0]);
    const o = await api(`/api/observations/${id}`);
    document.getElementById('page-title').textContent = `${label('otype', o.otype)} ${o.ref}`;
    const isAdmin = user.role === 'admin';
    const actions = (NEXT_ACTIONS[o.status] || []).filter(a => hasPerm(user, a));
    const before = o.attachments.filter(a => a.kind === 'before' || a.kind === 'photo');
    const after = o.attachments.filter(a => a.kind === 'after' || a.kind === 'evidence');

    el.innerHTML = `
      <div class="btn-row no-print" style="margin-bottom:1rem">
        <a class="btn secondary sm" href="#/observations">→ جميع الملاحظات</a>
        ${actions.map((a, i) => `<button class="btn sm ${a.kind === 'danger' ? 'danger' : ''}" data-tr="${i}">${a.label}</button>`).join('')}
        <button class="btn sm secondary" onclick="window.print()">🖨 طباعة</button>
        ${isAdmin && o.status === 'closed' ? `<button class="btn sm secondary" id="obs-archive">أرشفة</button>` : ''}
      </div>
      ${o.work_stop ? `<div class="card" style="border-color:var(--critical);background:var(--critical-soft);margin-bottom:1rem">
        🛑 <b>ملاحظة حرجة تستوجب التوصية بإيقاف العمل</b> — تم إشعار مدير النظام فوراً.</div>` : ''}
      <div class="print-header"><div class="o">${label('otype', o.otype)} ${esc(o.ref)}</div><div class="m">${UI.dualDate()}</div></div>
      <div class="grid cols-2">
        <div class="card">
          <h3>البيانات الأساسية ${badge('obs_status', o.status)}${UI.tagBadge(o.status_tag)} ${o.escalated ? badge('', 'escalated', 'b-critical').replace('escalated', 'مصعدة') : ''}</h3>
          <dl class="kv">
            <dt>المشروع</dt><dd><a href="#/projects/${o.project_id}">${esc(o.project_name)}</a></dd>
            <dt>الموقع</dt><dd>${esc(o.site || '—')}</dd>
            <dt>الراصد</dt><dd>${esc(o.observer_name)}</dd>
            <dt>تاريخ الرصد</dt><dd>${fmtDateTime(o.created_at)}</dd>
            <dt>التصنيف</dt><dd>${label('category', o.category)}</dd>
            <dt>النوع</dt><dd>${badge('otype', o.otype, o.otype === 'violation' ? 'b-high' : 'b-neutral')}</dd>
            <dt>الطرف المسؤول</dt><dd>${label('party', o.responsible_party)}</dd>
            <dt>الخطورة</dt><dd>${badge('severity', o.severity)}</dd>
            <dt>الاحتمالية × الأثر</dt><dd>${o.likelihood} × ${o.impact} = <b>${o.risk_score}</b></dd>
            <dt>المرجع النظامي</dt><dd>${esc(o.reference_clause || '—')}</dd>
            <dt>تاريخ الاستحقاق</dt><dd>${fmtDate(o.due_date)}</dd>
            ${o.closed_at ? `<dt>تاريخ الإغلاق</dt><dd>${fmtDateTime(o.closed_at)}</dd>` : ''}
            ${o.reject_reason ? `<dt>سبب الرفض</dt><dd>${esc(o.reject_reason)}</dd>` : ''}
            ${o.reopen_reason ? `<dt>سبب إعادة الفتح</dt><dd>${esc(o.reopen_reason)}</dd>` : ''}
            ${o.lat ? `<dt>الإحداثيات</dt><dd dir="ltr">${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}</dd>` : ''}
          </dl>
          <h3 style="margin-top:1rem">الوصف</h3>
          <p style="font-size:.9rem;margin:.2rem 0">${esc(o.description)}</p>
          ${o.immediate_action ? `<h3 style="margin-top:.8rem">الإجراء الفوري</h3><p style="font-size:.86rem;margin:.2rem 0">${esc(o.immediate_action)}</p>` : ''}
          ${o.corrective_action ? `<h3 style="margin-top:.8rem">الإجراء التصحيحي المطلوب</h3><p style="font-size:.86rem;margin:.2rem 0">${esc(o.corrective_action)}</p>` : ''}
          ${o.actions.length ? `<h3 style="margin-top:.8rem">إجراءات CAPA مرتبطة</h3>
            ${o.actions.map(a => `<a href="#/actions?project_id=${o.project_id}" style="font-size:.84rem">${esc(a.ref)} — ${badge('action_status', a.status)}</a><br>`).join('')}` : ''}
        </div>
        <div>
          <div class="card">
            <h3>📷 صور قبل المعالجة</h3>
            ${UI.attachmentGrid(before)}
            <div class="btn-row no-print" style="margin-top:.6rem">
              <label class="btn secondary sm">⬆ إرفاق صور الرصد<input type="file" data-kind="before" class="obs-up" accept="image/*,video/*,.pdf" capture="environment" multiple hidden></label>
            </div>
            <h3 style="margin-top:1.1rem">✅ أدلة المعالجة (بعد)</h3>
            ${UI.attachmentGrid(after)}
            <div class="btn-row no-print" style="margin-top:.6rem">
              <label class="btn secondary sm">⬆ إرفاق دليل معالجة<input type="file" data-kind="after" class="obs-up" accept="image/*,video/*,.pdf" capture="environment" multiple hidden></label>
            </div>
            ${['pending_verification'].includes(o.status) && !after.length ? '<div style="font-size:.76rem;color:var(--critical);margin-top:.4rem">⚠ لا يمكن اعتماد الإغلاق قبل إرفاق دليل المعالجة</div>' : ''}
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>🛠 الإجراءات المتخذة</h3>
            <div class="sub">وثّق ما تم تنفيذه أثناء المعالجة — إلزامي قبل طلب التحقق</div>
            <div id="obs-updates">${UI.spinner()}</div>
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>سجل الحالة</h3>
            <ul class="timeline">
              ${o.history.map(h => `<li>
                <div class="t">${h.to_status ? label('obs_status', h.to_status) : 'تحديث'} ${h.from_status ? `<small style="color:var(--ink-3)">(من ${label('obs_status', h.from_status)})</small>` : ''}</div>
                <div class="d">${esc(h.full_name || 'النظام')} — ${fmtDateTime(h.created_at)}${h.note ? ' — ' + esc(h.note) : ''}</div>
              </li>`).join('')}
            </ul>
          </div>
        </div>
      </div>`;

    // سجل الإجراءات المتخذة
    UI.renderUpdates(el.querySelector('#obs-updates'), 'observation', id, {
      locked: ['closed', 'rejected'].includes(o.status),
    });

    // انتقالات الحالة
    actions.forEach((a, i) => {
      el.querySelector(`[data-tr="${i}"]`).onclick = async () => {
        let note = '';
        if (a.needNote) {
          note = await UI.promptDialog(a.needNote);
          if (!note) return;
        } else if (!await UI.confirmDialog(`تأكيد: ${a.label}؟`)) return;
        try {
          await api(`/api/observations/${id}/transition`, { method: 'POST', body: { to: a.to, note } });
          toast('تم تحديث حالة الملاحظة');
          App.refreshRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
    });

    // رفع مرفقات
    el.querySelectorAll('.obs-up').forEach(inp => inp.addEventListener('change', async () => {
      if (!inp.files.length) return;
      await UI.uploadAttachments('observation', id, inp.files, inp.dataset.kind);
      toast('تم رفع المرفقات');
      App.refreshRoute();
    }));

    const archBtn = el.querySelector('#obs-archive');
    if (archBtn) archBtn.onclick = async () => {
      if (!await UI.confirmDialog('السجلات المعتمدة لا تُحذف — سيتم نقل الملاحظة إلى الأرشيف. متابعة؟')) return;
      await api(`/api/observations/${id}`, { method: 'PUT', body: { archived: 1 } });
      toast('تمت الأرشفة');
      location.hash = '#/observations';
    };
  }

  window.Pages.observations = {
    title: 'الملاحظات والمخالفات',
    render: (el, ctx) => ctx.args.length ? renderDetail(el, ctx) : render(el, ctx),
  };
})();
