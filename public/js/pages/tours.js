// الجولات الميدانية + واجهة الراصد الميداني
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, optsFromDict, fmtDate, fmtDateTime, fmtNum, toast } = UI;

  // ===== تخطيط جولة (مدير النظام) =====
  async function tourForm(presetDate) {
    const [users, projects, checklists] = await Promise.all([
      api('/api/users'), api('/api/projects'), api('/api/checklists'),
    ]);
    const observers = users.filter(u => u.role === 'observer' && u.active);
    const m = UI.modal({
      title: 'تخطيط جولة ميدانية',
      body: `<form id="tour-form" class="form-grid">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), '', { allowEmpty: false }), { required: true })}
        ${fld('الراصد', `<select name="observer_id"></select>`, { required: true })}
        ${fld('نموذج التفتيش', select('template_id', checklists.filter(c => c.active).map(c => ({ value: c.id, label: c.name })), '', { emptyLabel: 'بدون نموذج' }))}
        ${fld('الموقع داخل المشروع', '<input name="site" placeholder="مثال: المنطقة الشمالية">')}
        ${fld('تاريخ الجولة', `<input name="planned_date" type="date" value="${presetDate || new Date().toISOString().slice(0, 10)}" required>`, { required: true })}
        ${fld('الفترة', select('planned_period', optsFromDict('period'), 'morning', { allowEmpty: false }))}
        ${fld('ملاحظات التكليف', '<textarea name="notes"></textarea>', { full: true })}
      </form>`,
      footer: `<button class="btn" id="tour-save">حفظ وإشعار الراصد</button>`,
    });
    // الراصدون المكلفون بالمشروع المختار فقط
    const projSel = m.el.querySelector('[name="project_id"]');
    const obsSel = m.el.querySelector('[name="observer_id"]');
    function fillObservers() {
      const pid = Number(projSel.value);
      const eligible = observers.filter(o => (o.project_ids || []).includes(pid));
      obsSel.innerHTML = eligible.length
        ? eligible.map(o => `<option value="${o.id}">${esc(o.full_name)}</option>`).join('')
        : '<option value="">لا يوجد راصد مكلف بهذا المشروع</option>';
    }
    projSel.addEventListener('change', fillObservers);
    fillObservers();
    return new Promise(resolve => {
      m.el.addEventListener('click', () => {}, { once: true });
      m.el.querySelector('#tour-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#tour-form'));
        if (!d.observer_id) return toast('اختر راصداً مكلفاً بالمشروع', 'warn');
        ['project_id','observer_id','template_id'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
        try {
          const r = await api('/api/tours', { method: 'POST', body: d });
          toast(`تم إنشاء الجولة ${r.ref} وإشعار الراصد`);
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  // ===== تعديل جولة (مدير النظام) =====
  async function tourEditModal(t) {
    const [users, checklists] = await Promise.all([api('/api/users'), api('/api/checklists')]);
    const observers = users.filter(u => u.role === 'observer' && u.active && (u.project_ids || []).includes(t.project_id));
    // الحالات المتاحة يدوياً حسب الحالة الحالية
    const TOUR_NEXT = {
      planned: ['cancelled'],
      in_progress: ['cancelled'],
      missed: ['planned'],
      cancelled: ['planned'],
      completed: [],
    };
    const nextStates = TOUR_NEXT[t.status] || [];
    const m = UI.modal({
      title: `تعديل الجولة ${t.ref}`,
      body: `<form id="te-form" class="form-grid">
        ${fld('الراصد', select('observer_id', observers.map(o => ({ value: o.id, label: o.full_name })), t.observer_id, { allowEmpty: false }))}
        ${fld('نموذج التفتيش', select('template_id', checklists.filter(c => c.active).map(c => ({ value: c.id, label: c.name })), t.template_id, { emptyLabel: 'بدون نموذج' }))}
        ${fld('الموقع', `<input name="site" value="${esc(t.site || '')}">`)}
        ${fld('تاريخ الجولة', `<input name="planned_date" type="date" value="${esc(t.planned_date)}">`)}
        ${fld('الفترة', select('planned_period', optsFromDict('period'), t.planned_period, { allowEmpty: false }))}
        ${fld('تغيير الحالة — الحالية: ' + label('tour_status', t.status),
          nextStates.length
            ? select('status', nextStates.map(s => ({ value: s, label: label('tour_status', s) })), '', { emptyLabel: 'بلا تغيير' })
            : `<input value="لا تتوفر انتقالات يدوية (تدار عبر بدء/إنهاء الجولة)" disabled>`)}
        ${fld('ملاحظات', `<textarea name="notes">${esc(t.notes || '')}</textarea>`, { full: true })}
      </form>`,
      footer: `<button class="btn" id="te-save">حفظ</button>`,
    });
    m.el.querySelector('#te-save').onclick = async () => {
      const d = UI.formData(m.el.querySelector('#te-form'));
      const body = {
        observer_id: Number(d.observer_id), template_id: d.template_id ? Number(d.template_id) : null,
        site: d.site, planned_date: d.planned_date, planned_period: d.planned_period, notes: d.notes,
      };
      if (d.status) body.status = d.status;
      try {
        await api(`/api/tours/${t.id}`, { method: 'PUT', body });
        toast('تم حفظ تعديلات الجولة');
        m.close(); App.refreshRoute();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ===== قائمة الجولات =====
  async function render(el, { params, user }) {
    const isAdmin = user.role === 'admin' || !!user.perms?.assign_tours;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [tours, projects] = await Promise.all([
      api('/api/tours' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
    ]);
    const counts = {
      planned: tours.filter(t => t.status === 'planned').length,
      in_progress: tours.filter(t => t.status === 'in_progress').length,
      completed: tours.filter(t => t.status === 'completed').length,
      missed: tours.filter(t => t.status === 'missed').length,
    };
    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat info"><div class="accent"></div><div class="lbl">مخططة</div><div class="val">${counts.planned}</div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">قيد التنفيذ</div><div class="val">${counts.in_progress}</div></div>
        <div class="stat good"><div class="accent"></div><div class="lbl">منفذة</div><div class="val">${counts.completed}</div></div>
        <div class="stat critical"><div class="accent"></div><div class="lbl">فائتة</div><div class="val">${counts.missed}</div></div>
      </div>
      <form class="filters" id="tour-filters" style="margin-top:1rem">
        ${fld('الحالة', select('status', optsFromDict('tour_status'), params.status))}
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn sm secondary" type="button" id="tours-view-toggle"></button>
        ${isAdmin ? `<button class="btn" type="button" id="tour-add">+ تخطيط جولة</button>
        <a class="btn secondary sm" href="/api/export/tours" download>⬇ تصدير</a>` : ''}
      </form>
      <div id="tours-table"></div>`;

    const tbl = el.querySelector('#tours-table');

    // ===== عرض التقويم الشهري =====
    let calMonth = sessionStorage.getItem('hse_cal_month') || new Date().toISOString().slice(0, 7);
    async function renderCalendar() {
      const [y, mo] = calMonth.split('-').map(Number);
      const first = new Date(y, mo - 1, 1);
      const last = new Date(y, mo, 0);
      const fq = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && ['project_id', 'status'].includes(k)));
      fq.set('from', `${calMonth}-01`);
      fq.set('to', `${calMonth}-${String(last.getDate()).padStart(2, '0')}`);
      const monthTours = await api('/api/tours?' + fq.toString());
      const byDay = {};
      for (const t of monthTours) (byDay[t.planned_date] = byDay[t.planned_date] || []).push(t);

      const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const todayStr = new Date().toISOString().slice(0, 10);
      const startPad = first.getDay(); // الأحد = 0
      const cells = [];
      for (let i = 0; i < startPad; i++) cells.push(null);
      for (let d = 1; d <= last.getDate(); d++) cells.push(`${calMonth}-${String(d).padStart(2, '0')}`);
      while (cells.length % 7) cells.push(null);

      const monthTitle = first.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: 'long' });
      tbl.innerHTML = `
        <div class="btn-row" style="justify-content:center;margin-bottom:.7rem;align-items:center">
          <button class="btn sm secondary" id="cal-prev">‹ السابق</button>
          <b style="min-width:140px;text-align:center">${monthTitle}</b>
          <button class="btn sm secondary" id="cal-next">التالي ›</button>
          <button class="btn sm ghost" id="cal-today">اليوم</button>
        </div>
        <div class="cal">${WD.map(w => `<div class="cal-wd">${w}</div>`).join('')}
          ${cells.map(dateStr => {
            if (!dateStr) return '<div class="cal-day other"></div>';
            const list = byDay[dateStr] || [];
            return `<div class="cal-day ${dateStr === todayStr ? 'today' : ''}" data-date="${dateStr}">
              <div class="dn"><span>${Number(dateStr.slice(8))}</span>${list.length ? `<span style="color:var(--ink-3)">${list.length}</span>` : ''}</div>
              ${list.map(t => `<span class="cal-tour st-${t.status}" data-tour="${t.id}"
                ${isAdmin && t.status === 'planned' ? 'draggable="true"' : ''}
                title="${esc(t.ref)} — ${esc(t.project_name)} — ${esc(t.observer_name)} (${label('tour_status', t.status)})">
                ${esc(t.project_name).slice(0, 16)} · ${esc(t.observer_name.split(' ')[0])}</span>`).join('')}
              ${isAdmin ? `<div class="add-hint" data-add="${dateStr}">+ جولة</div>` : ''}
            </div>`;
          }).join('')}
        </div>
        <div class="legend-row" style="margin-top:.6rem">
          <span class="li"><span class="sw" style="background:var(--info)"></span> مخططة</span>
          <span class="li"><span class="sw" style="background:var(--brand)"></span> قيد التنفيذ</span>
          <span class="li"><span class="sw" style="background:var(--good)"></span> منفذة</span>
          <span class="li"><span class="sw" style="background:var(--critical)"></span> فائتة</span>
          ${isAdmin ? '<span class="li" style="color:var(--ink-3)">اسحب جولة مخططة ليوم آخر لإعادة جدولتها — وانقر يوماً فارغاً للتخطيط</span>' : ''}
        </div>`;

      tbl.querySelector('#cal-prev').onclick = () => { calMonth = shiftMonth(calMonth, -1); sessionStorage.setItem('hse_cal_month', calMonth); renderCalendar(); };
      tbl.querySelector('#cal-next').onclick = () => { calMonth = shiftMonth(calMonth, 1); sessionStorage.setItem('hse_cal_month', calMonth); renderCalendar(); };
      tbl.querySelector('#cal-today').onclick = () => { calMonth = new Date().toISOString().slice(0, 7); sessionStorage.setItem('hse_cal_month', calMonth); renderCalendar(); };

      tbl.querySelectorAll('.cal-tour').forEach(chip => {
        chip.addEventListener('click', () => { location.hash = `#/tours/${chip.dataset.tour}`; });
        chip.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', chip.dataset.tour);
          e.dataTransfer.effectAllowed = 'move';
        });
      });
      if (isAdmin) {
        tbl.querySelectorAll('[data-add]').forEach(h => h.addEventListener('click', async () => {
          if (await tourForm(h.dataset.add)) renderCalendar();
        }));
        tbl.querySelectorAll('.cal-day[data-date]').forEach(day => {
          day.addEventListener('dragover', e => { e.preventDefault(); day.classList.add('dragover'); });
          day.addEventListener('dragleave', () => day.classList.remove('dragover'));
          day.addEventListener('drop', async e => {
            e.preventDefault();
            day.classList.remove('dragover');
            const tourId = e.dataTransfer.getData('text/plain');
            if (!tourId) return;
            const t = monthTours.find(x => x.id === Number(tourId));
            if (!t || t.planned_date === day.dataset.date) return;
            try {
              await api(`/api/tours/${tourId}`, { method: 'PUT', body: { planned_date: day.dataset.date } });
              toast(`أُعيدت جدولة ${t.ref} إلى ${fmtDate(day.dataset.date)} وأُشعر الراصد`);
              renderCalendar();
            } catch (err) { toast(err.message, 'error'); }
          });
        });
      }
    }
    function shiftMonth(ym, delta) {
      const [y, m] = ym.split('-').map(Number);
      const d = new Date(y, m - 1 + delta, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function renderToursTable() {
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الموقع', key: 'site' },
        { title: 'الراصد', key: 'observer_name' },
        { title: 'الموعد', render: r => `${fmtDate(r.planned_date)} — ${label('period', r.planned_period)}` },
        { title: 'النموذج', render: r => esc(r.template_name || '—') },
        { title: 'الملاحظات', key: 'obs_count' },
        { title: 'الحالة', render: r => badge('tour_status', r.status) },
        ...(isAdmin ? [{ title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` }] : []),
      ],
      rows: tours,
    });
    UI.bindRows(tbl, tours, r => { location.hash = `#/tours/${r.id}`; });
    if (isAdmin) tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      tourEditModal(tours.find(x => x.id === Number(b.dataset.edit)));
    }));
    }

    function applyToursView() {
      const view = localStorage.getItem('hse_tours_view') || 'table';
      el.querySelector('#tours-view-toggle').textContent = view === 'table' ? '📅 عرض تقويم' : '📋 عرض جدول';
      view === 'calendar' ? renderCalendar() : renderToursTable();
    }
    el.querySelector('#tours-view-toggle').onclick = () => {
      const cur = localStorage.getItem('hse_tours_view') || 'table';
      localStorage.setItem('hse_tours_view', cur === 'table' ? 'calendar' : 'table');
      applyToursView();
    };
    applyToursView();

    el.querySelector('#tour-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/tours' + (q ? `?${q}` : '');
    });
    if (isAdmin) el.querySelector('#tour-add').onclick = async () => { if (await tourForm()) App.refreshRoute(); };
  }

  // ===== تنفيذ الجولة / تفاصيلها =====
  async function renderDetail(el, { args, user }) {
    const id = Number(args[0]);
    const t = await api(`/api/tours/${id}`);
    const isMine = user.role === 'observer' && t.observer_id === user.id;
    const canRun = (isMine || user.role === 'admin');
    document.getElementById('page-title').textContent = `جولة ${t.ref}`;

    const RESULT_BTNS = [
      ['pass', 'مطابق', 'b-good'], ['fail', 'غير مطابق', 'b-critical'],
      ['na', 'غير منطبق', 'b-neutral'], ['followup', 'متابعة', 'b-medium'],
    ];

    el.innerHTML = `
      <div class="btn-row no-print" style="margin-bottom:1rem">
        <a class="btn secondary sm" href="#/tours">→ جميع الجولات</a>
        ${t.status === 'planned' && canRun ? `<button class="btn" id="tour-start">▶ بدء الجولة (تسجيل الحضور GPS)</button>` : ''}
        ${t.status === 'in_progress' && canRun ? `<button class="btn" id="tour-finish">✔ إنهاء الجولة</button>
          <button class="btn secondary" id="tour-obs">+ تسجيل ملاحظة</button>` : ''}
        ${t.status === 'completed' ? `<a class="btn secondary sm" href="#/reports?type=tour_detail&tour_id=${t.id}">📄 تقرير الجولة</a>` : ''}
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h3>بيانات الجولة ${badge('tour_status', t.status)}</h3>
          <dl class="kv">
            <dt>المشروع</dt><dd><a href="#/projects/${t.project_id}">${esc(t.project_name)}</a></dd>
            <dt>الموقع</dt><dd>${esc(t.site || '—')}</dd>
            <dt>الراصد</dt><dd>${esc(t.observer_name)}</dd>
            <dt>الموعد</dt><dd>${fmtDate(t.planned_date)} — ${label('period', t.planned_period)}</dd>
            <dt>نموذج التفتيش</dt><dd>${esc(t.template_name || 'بدون')}</dd>
            <dt>البداية</dt><dd>${fmtDateTime(t.started_at)}</dd>
            <dt>النهاية</dt><dd>${fmtDateTime(t.ended_at)}</dd>
            <dt>التحقق الجغرافي</dt><dd>${t.geofence_ok == null ? '—' : t.geofence_ok ? '<span class="badge b-good">داخل النطاق</span>' : `<span class="badge b-critical">خارج النطاق</span> ${esc(t.geofence_note || '')}`}</dd>
            <dt>ملاحظات</dt><dd>${esc(t.notes || '—')}</dd>
          </dl>
        </div>
        <div class="card">
          <h3>ملاحظات الجولة (${t.observations.length})</h3>
          <div id="tour-obs-list"></div>
        </div>
      </div>
      ${t.items.length ? `
      <div class="card" style="margin-top:1rem">
        <h3>قائمة التفتيش — ${esc(t.template_name)}</h3>
        <div class="sub">${t.status === 'in_progress' && canRun ? 'اختر نتيجة كل بند — يُحفظ تلقائياً' : 'نتائج التفتيش'}</div>
        <div id="check-items">
          ${t.items.map(it => `
          <div style="padding:.7rem 0;border-bottom:1px solid var(--grid)" data-item="${it.id}">
            <div style="display:flex;justify-content:space-between;gap:.6rem;flex-wrap:wrap;align-items:center">
              <div style="font-size:.88rem;flex:1;min-width:200px">${esc(it.text)}</div>
              <div class="btn-row">
                ${RESULT_BTNS.map(([v, lbl2, cls]) => `
                  <button type="button" class="btn sm ${it.result === v ? '' : 'secondary'} r-btn" data-val="${v}"
                    ${t.status === 'in_progress' && canRun ? '' : 'disabled'}
                    style="${it.result === v ? '' : 'opacity:.75'}">${lbl2}</button>`).join('')}
              </div>
            </div>
            ${it.result_note ? `<div style="font-size:.76rem;color:var(--ink-2);margin-top:.3rem">📝 ${esc(it.result_note)}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>` : ''}`;

    // ملاحظات الجولة
    const obsList = el.querySelector('#tour-obs-list');
    obsList.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'الوصف', render: r => esc(r.description).slice(0, 50) },
        { title: 'الخطورة', render: r => badge('severity', r.severity) },
        { title: 'الحالة', render: r => badge('obs_status', r.status) },
      ],
      rows: t.observations,
      empty: 'لم تسجل ملاحظات في هذه الجولة',
    });
    UI.bindRows(obsList, t.observations, r => { location.hash = `#/observations/${r.id}`; });

    // بدء الجولة
    const startBtn = el.querySelector('#tour-start');
    if (startBtn) startBtn.onclick = async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'جارٍ تحديد الموقع…';
      const loc = await UI.getLocation();
      try {
        await api(`/api/tours/${id}/start`, { method: 'POST', body: { lat: loc?.lat, lng: loc?.lng } });
        toast('تم تسجيل الحضور وبدء الجولة');
        App.refreshRoute();
      } catch (e) {
        if (e.data?.requires_note) {
          const note = await UI.promptDialog('أنت خارج النطاق الجغرافي للمشروع — أدخل توضيحاً لتسجيل الاستثناء', e.message);
          if (note) {
            await api(`/api/tours/${id}/start`, { method: 'POST', body: { lat: loc?.lat, lng: loc?.lng, geofence_note: note } });
            toast('تم بدء الجولة مع تسجيل الاستثناء', 'warn');
            App.refreshRoute();
          } else { startBtn.disabled = false; startBtn.textContent = '▶ بدء الجولة (تسجيل الحضور GPS)'; }
        } else { toast(e.message, 'error'); startBtn.disabled = false; startBtn.textContent = '▶ بدء الجولة'; }
      }
    };

    // إنهاء الجولة
    const finishBtn = el.querySelector('#tour-finish');
    if (finishBtn) finishBtn.onclick = async () => {
      const unanswered = t.items.filter(i => !i.result).length;
      if (unanswered && !await UI.confirmDialog(`يوجد ${unanswered} بند لم يُقيّم بعد. إنهاء الجولة على أي حال؟`)) return;
      const loc = await UI.getLocation();
      await api(`/api/tours/${id}/finish`, { method: 'POST', body: { lat: loc?.lat, lng: loc?.lng } });
      toast('تم إنهاء الجولة بنجاح');
      App.refreshRoute();
    };

    // تسجيل ملاحظة من داخل الجولة
    const obsBtn = el.querySelector('#tour-obs');
    if (obsBtn) obsBtn.onclick = () => {
      window.ObservationForm({ project_id: t.project_id, tour_id: t.id, site: t.site }).then(saved => { if (saved) App.refreshRoute(); });
    };

    // نتائج البنود
    el.querySelectorAll('#check-items [data-item]').forEach(row => {
      row.querySelectorAll('.r-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const val = btn.dataset.val;
          const itemId = Number(row.dataset.item);
          let note = '', severity = '';
          if (val === 'fail') {
            note = await UI.promptDialog('وصف عدم المطابقة (سيُنشأ إجراء تصحيحي)', 'مثال: عدم توفر حواجز حماية على الحافة') || '';
            if (!note) return;
          }
          await api(`/api/tours/${id}/results`, {
            method: 'POST', queueable: true,
            body: { results: [{ item_id: itemId, result: val, note, severity }] },
          });
          row.querySelectorAll('.r-btn').forEach(b => { b.classList.add('secondary'); b.style.opacity = '.75'; });
          btn.classList.remove('secondary'); btn.style.opacity = '1';
          if (val === 'fail') {
            // إنشاء ملاحظة مرتبطة بالبند تلقائياً
            const itemText = row.querySelector('div').textContent.trim();
            const saved = await window.ObservationForm({
              project_id: t.project_id, tour_id: t.id, site: t.site,
              checklist_item_id: itemId,
              description: `${itemText} — ${note}`,
              prefill: true,
            });
            if (saved) toast('تم إنشاء ملاحظة مرتبطة بالبند');
          }
        });
      });
    });
  }

  // ===== الواجهة الميدانية للراصد =====
  async function renderField(el, { user }) {
    const [me, tours, obs] = await Promise.all([
      api('/api/auth/me'),
      api('/api/tours'),
      api('/api/observations?open_only=1'),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const todayTours = tours.filter(t => t.planned_date === today && ['planned', 'in_progress'].includes(t.status));
    const upcoming = tours.filter(t => t.planned_date > today && t.status === 'planned').slice(0, 5);
    const myObs = obs.filter(o => o.observer_id === user.id).slice(0, 8);
    const pendingSync = OfflineSync.queueLength();

    const dash = await api('/api/dashboard').catch(() => null);
    el.innerHTML = `
      ${dash?.midday_ban?.in_season ? `<div class="card" style="border-color:var(--warn);background:var(--warn-soft);margin-bottom:1rem;font-size:.85rem">
        ☀️ <b>تذكير: حظر العمل وقت الظهيرة ساري</b> — راقب التزام الموقع من ${dash.midday_ban.hours} وسجل أي مخالفة ضمن «الصحة المهنية».</div>` : ''}
      ${pendingSync ? `<div class="card" style="border-color:var(--warn);margin-bottom:1rem">
        ⚠ لديك <b>${pendingSync}</b> سجل بانتظار المزامنة — ستُرفع تلقائياً عند توفر الاتصال.
        <button class="btn sm" id="fld-sync" style="margin-inline-start:.6rem">مزامنة الآن</button></div>` : ''}
      <div class="grid cols-2">
        <button class="btn" id="fld-new-obs" style="padding:1.1rem;font-size:1rem">⚠ تسجيل ملاحظة / مخالفة</button>
        <button class="btn secondary" id="fld-new-inc" style="padding:1.1rem;font-size:1rem">◆ الإبلاغ عن حادث</button>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>جولات اليوم (${todayTours.length})</h3>
        ${todayTours.length ? todayTours.map(t => `
          <div style="display:flex;align-items:center;gap:.8rem;padding:.7rem 0;border-bottom:1px solid var(--grid)">
            <div style="flex:1">
              <div style="font-weight:700;font-size:.9rem">${esc(t.project_name)}</div>
              <div style="font-size:.75rem;color:var(--ink-3)">${esc(t.ref)} — ${esc(t.site || '')} — ${label('period', t.planned_period)} ${t.template_name ? '— ' + esc(t.template_name) : ''}</div>
            </div>
            ${badge('tour_status', t.status)}
            <a class="btn sm" href="#/tours/${t.id}">${t.status === 'in_progress' ? 'متابعة' : 'بدء'}</a>
          </div>`).join('') : '<div class="empty-state">لا توجد جولات مجدولة اليوم</div>'}
      </div>
      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>الجولات القادمة</h3>
          ${upcoming.length ? upcoming.map(t => `
            <div style="display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--grid);font-size:.84rem">
              <span>${esc(t.project_name)}</span>
              <span style="color:var(--ink-3)">${fmtDate(t.planned_date)}</span>
            </div>`).join('') : '<div class="empty-state">لا توجد جولات قادمة</div>'}
        </div>
        <div class="card">
          <h3>ملاحظاتي المفتوحة</h3>
          ${myObs.length ? myObs.map(o => `
            <a href="#/observations/${o.id}" style="display:flex;justify-content:space-between;gap:.5rem;padding:.5rem 0;border-bottom:1px solid var(--grid);font-size:.82rem;color:var(--ink)">
              <span>${esc(o.description).slice(0, 42)}…</span>
              ${badge('severity', o.severity)}
            </a>`).join('') : '<div class="empty-state">لا توجد ملاحظات مفتوحة</div>'}
        </div>
      </div>`;
    el.querySelector('#fld-new-obs').onclick = () => window.ObservationForm({}).then(s => s && App.refreshRoute());
    el.querySelector('#fld-new-inc').onclick = () => window.IncidentForm && window.IncidentForm({}).then(s => s && App.refreshRoute());
    const syncBtn = el.querySelector('#fld-sync');
    if (syncBtn) syncBtn.onclick = async () => {
      const r = await OfflineSync.syncQueue();
      toast(r.synced ? `تمت مزامنة ${r.synced} سجل` : 'تعذرت المزامنة — تحقق من الاتصال', r.synced ? 'ok' : 'warn');
      App.refreshRoute();
    };
  }

  // ===== التوعية والتدريب Toolbox Talks =====
  async function renderTraining(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [talks, projects] = await Promise.all([
      api('/api/talks' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
    ]);
    const last30 = talks.filter(t => new Date(t.talk_date) >= new Date(Date.now() - 30 * 864e5));
    const attendees30 = last30.reduce((s, t) => s + t.attendees_count, 0);
    const activeProjects = projects.length || 1;
    const coverage = Math.min(100, Math.round(new Set(last30.map(t => t.project_id + ':' + t.talk_date)).size / (activeProjects * 30) * 100));

    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="accent"></div><div class="lbl">اجتماعات آخر 30 يوماً</div><div class="val">${last30.length}</div></div>
        <div class="stat info"><div class="accent"></div><div class="lbl">إجمالي الحضور (30 يوماً)</div><div class="val">${fmtNum(attendees30)}</div></div>
        <div class="stat ${coverage >= 70 ? 'good' : coverage >= 50 ? 'warn' : 'critical'}"><div class="accent"></div><div class="lbl">نسبة التغطية اليومية</div><div class="val">${coverage}<small> %</small></div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">إجمالي السجل</div><div class="val">${talks.length}</div></div>
      </div>
      <form class="filters" id="talk-filters" style="margin-top:1rem">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn" type="button" id="talk-add">+ توثيق اجتماع توعية</button>
      </form>
      <div id="talks-table"></div>`;

    const tbl = el.querySelector('#talks-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'التاريخ', render: r => fmtDate(r.talk_date) },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الموضوع', key: 'topic' },
        { title: 'المقدم', key: 'presenter' },
        { title: 'الحضور', key: 'attendees_count' },
        { title: 'المدة (د)', key: 'duration_min' },
        { title: 'وثّقه', key: 'created_by_name' },
        ...(user.role === 'admin' ? [{ title: 'إجراءات', render: r => `<button class="btn sm danger" data-del="${r.id}">حذف</button>` }] : []),
      ],
      rows: talks,
      empty: 'لا توجد اجتماعات توعية موثقة',
    });
    if (user.role === 'admin') tbl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await UI.confirmDialog('حذف سجل اجتماع التوعية؟', { danger: true })) return;
      await api(`/api/talks/${b.dataset.del}`, { method: 'DELETE' });
      toast('تم الحذف'); App.refreshRoute();
    });
    el.querySelector('#talk-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/training' + (q ? `?${q}` : '');
    });
    el.querySelector('#talk-add').onclick = () => {
      const m = UI.modal({
        title: 'توثيق اجتماع توعية Toolbox Talk',
        body: `<form id="talk-form" class="form-grid">
          ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), '', { allowEmpty: false }), { required: true })}
          ${fld('التاريخ', `<input name="talk_date" type="date" value="${new Date().toISOString().slice(0, 10)}" required>`, { required: true })}
          ${fld('الموضوع', `<input name="topic" required placeholder="مثال: مخاطر العمل على المرتفعات">`, { required: true, full: true })}
          ${fld('مقدم الاجتماع', `<input name="presenter">`)}
          ${fld('عدد الحضور', `<input name="attendees_count" type="number" min="0" value="10">`)}
          ${fld('المدة (دقائق)', `<input name="duration_min" type="number" min="5" value="15">`)}
          ${fld('ملاحظات', `<textarea name="notes"></textarea>`, { full: true })}
        </form>`,
        footer: `<button class="btn" id="talk-save">حفظ</button>`,
      });
      m.el.querySelector('#talk-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#talk-form'));
        if (!d.project_id || !d.topic.trim()) return toast('أكمل المشروع والموضوع', 'warn');
        d.project_id = Number(d.project_id);
        try {
          await api('/api/talks', { method: 'POST', body: d, queueable: true });
          toast('تم توثيق اجتماع التوعية');
          m.close(); App.refreshRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
    };
  }

  window.Pages.training = { title: 'التوعية والتدريب — Toolbox Talks', render: renderTraining };
  window.Pages.tours = {
    title: 'الجولات الميدانية',
    render: (el, ctx) => ctx.args.length ? renderDetail(el, ctx) : render(el, ctx),
  };
  window.Pages.field = { title: 'الواجهة الميدانية', render: renderField, roles: ['observer', 'admin'] };
})();
