// المشاريع + المقاولون والاستشاريون والتقييم
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, optsFromDict, fmtNum, fmtMoney, fmtDate, toast } = UI;

  // ===== نموذج مشروع (إنشاء/تعديل) =====
  async function projectForm(existing) {
    const parties = await api('/api/parties');
    const contractors = parties.filter(p => p.kind === 'contractor');
    const consultants = parties.filter(p => p.kind === 'consultant');
    const p = existing || {};
    const body = `<form id="prj-form" class="form-grid">
      ${fld('رمز المشروع', `<input name="code" value="${esc(p.code || '')}" required>`, { required: true })}
      ${fld('اسم المشروع', `<input name="name" value="${esc(p.name || '')}" required>`, { required: true })}
      ${fld('نوع المشروع', select('type', optsFromDict('project_type'), p.type || 'roads', { allowEmpty: false }), { required: true })}
      ${fld('حالة المشروع', select('status', optsFromDict('project_status'), p.status || 'active', { allowEmpty: false }))}
      ${fld('الوصف', `<textarea name="description">${esc(p.description || '')}</textarea>`, { full: true })}
      ${fld('الموقع', `<input name="location_text" value="${esc(p.location_text || '')}">`)}
      ${fld('الجهة المالكة', `<input name="owner_entity" value="${esc(p.owner_entity || '')}">`)}
      ${fld('خط العرض', `<input name="lat" type="number" step="any" value="${p.lat ?? ''}">`)}
      ${fld('خط الطول', `<input name="lng" type="number" step="any" value="${p.lng ?? ''}">`)}
      ${fld('نطاق التحقق الجغرافي (متر)', `<input name="geofence_radius" type="number" value="${p.geofence_radius ?? 500}">`)}
      ${fld('مستوى المخاطر العام', select('risk_level', optsFromDict('severity'), p.risk_level || 'medium', { allowEmpty: false }))}
      ${fld('المقاول', select('contractor_id', contractors.map(c => ({ value: c.id, label: c.name })), p.contractor_id, { emptyLabel: '—' }))}
      ${fld('الاستشاري', select('consultant_id', consultants.map(c => ({ value: c.id, label: c.name })), p.consultant_id, { emptyLabel: '—' }))}
      ${fld('مدير المشروع', `<input name="project_manager" value="${esc(p.project_manager || '')}">`)}
      ${fld('مسؤول السلامة', `<input name="safety_officer" value="${esc(p.safety_officer || '')}">`)}
      ${fld('قيمة المشروع (ريال)', `<input name="value" type="number" step="any" value="${p.value ?? ''}">`)}
      ${fld('نسبة الإنجاز %', `<input name="progress_pct" type="number" min="0" max="100" value="${p.progress_pct ?? 0}">`)}
      ${fld('تاريخ البداية', `<input name="start_date" type="date" value="${esc(p.start_date || '')}">`)}
      ${fld('تاريخ النهاية', `<input name="end_date" type="date" value="${esc(p.end_date || '')}">`)}
      ${fld('عدد العاملين', `<input name="workers_count" type="number" value="${p.workers_count ?? 0}">`)}
      ${fld('ساعات العمل التراكمية', `<input name="work_hours" type="number" value="${p.work_hours ?? 0}">`)}
      <label class="fld"><span>خطة السلامة معتمدة</span>
        <input type="checkbox" name="safety_plan_approved" style="width:auto" ${p.safety_plan_approved ? 'checked' : ''}></label>
    </form>`;
    return new Promise(resolve => {
      const m = UI.modal({
        title: existing ? `تعديل المشروع ${p.code}` : 'إضافة مشروع جديد',
        body, wide: true,
        footer: `<button class="btn" id="prj-save">حفظ</button><button class="btn secondary" id="prj-cancel">إلغاء</button>`,
        onClose: () => resolve(false),
      });
      m.el.querySelector('#prj-cancel').onclick = () => { m.close(); };
      m.el.querySelector('#prj-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#prj-form'));
        d.safety_plan_approved = d.safety_plan_approved ? 1 : 0;
        ['lat','lng','value','progress_pct','workers_count','work_hours','geofence_radius','contractor_id','consultant_id']
          .forEach(k => { if (d[k] === '') d[k] = null; else if (d[k] != null) d[k] = Number(d[k]); });
        try {
          if (existing) await api(`/api/projects/${existing.id}`, { method: 'PUT', body: d });
          else await api('/api/projects', { method: 'POST', body: d });
          toast('تم حفظ المشروع بنجاح');
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  }

  // ===== قائمة المشاريع =====
  async function render(el, { params, user }) {
    const projects = await api('/api/projects');
    const isAdmin = user.role === 'admin';
    const q = (params.q || '').trim();
    const filtered = q ? projects.filter(p => p.name.includes(q) || p.code.includes(q) || (p.contractor_name || '').includes(q)) : projects;
    el.innerHTML = `
      <div class="filters">
        <label class="fld" style="flex:1;min-width:220px"><span>بحث</span>
          <input id="prj-q" placeholder="اسم المشروع أو الرمز أو المقاول…" value="${esc(q)}"></label>
        ${isAdmin ? `<button class="btn" id="prj-add">+ مشروع جديد</button>
        <a class="btn secondary sm" href="/api/export/projects" download>⬇ تصدير Excel/CSV</a>` : ''}
      </div>
      <div class="grid cols-3" id="prj-cards">
        ${filtered.map(p => `
        <div class="card" style="cursor:pointer" data-id="${p.id}">
          <div style="display:flex;justify-content:space-between;gap:.5rem;align-items:flex-start">
            <h3 style="font-size:.92rem;margin:0">${esc(p.name)}</h3>
            ${badge('project_status', p.status)}
          </div>
          <div style="font-size:.74rem;color:var(--ink-3);margin:.3rem 0 .6rem">${esc(p.code)} — ${label('project_type', p.type)}</div>
          <dl class="kv" style="font-size:.78rem">
            <dt>المقاول</dt><dd>${esc(p.contractor_name || '—')}</dd>
            <dt>الموقع</dt><dd>${esc(p.location_text || '—')}</dd>
            <dt>المخاطر</dt><dd>${badge('severity', p.risk_level)}</dd>
          </dl>
          <div style="display:flex;align-items:center;gap:.6rem;margin-top:.7rem;font-size:.75rem;color:var(--ink-2)">
            <div class="progressbar" style="flex:1"><div style="width:${p.progress_pct}%"></div></div>
            <span>${Math.round(p.progress_pct)}%</span>
          </div>
          <div style="display:flex;gap:.9rem;margin-top:.6rem;font-size:.75rem;color:var(--ink-2)">
            <span>⚠ ${fmtNum(p.open_obs)} ملاحظة مفتوحة</span>
            <span>◆ ${fmtNum(p.incidents)} حادث</span>
          </div>
        </div>`).join('') || '<div class="empty-state">لا توجد مشاريع</div>'}
      </div>`;
    el.querySelector('#prj-q').addEventListener('change', e => {
      location.hash = '#/projects' + (e.target.value ? `?q=${encodeURIComponent(e.target.value)}` : '');
    });
    el.querySelectorAll('#prj-cards .card').forEach(c =>
      c.addEventListener('click', () => { location.hash = `#/projects/${c.dataset.id}`; }));
    if (isAdmin) el.querySelector('#prj-add').onclick = async () => { if (await projectForm(null)) App.refreshRoute(); };
  }

  // ===== تفاصيل المشروع =====
  async function renderDetail(el, { args, user }) {
    const id = Number(args[0]);
    const p = await api(`/api/projects/${id}`);
    const isAdmin = user.role === 'admin';
    document.getElementById('page-title').textContent = p.name;
    const openObs = p.observations.filter(o => !['closed', 'rejected'].includes(o.status)).length;
    el.innerHTML = `
      <div class="btn-row no-print" style="margin-bottom:1rem">
        <a class="btn secondary sm" href="#/projects">→ جميع المشاريع</a>
        ${isAdmin ? `<button class="btn sm" id="prj-edit">تعديل البيانات</button>
        <button class="btn sm secondary" id="prj-archive">${p.archived ? 'إلغاء الأرشفة' : 'أرشفة'}</button>
        <button class="btn sm danger" id="prj-delete">🗑 حذف المشروع</button>` : ''}
        <button class="btn sm secondary" onclick="window.print()">🖨 طباعة</button>
      </div>
      <div class="print-header"><div class="o">بطاقة مشروع — ${esc(p.name)}</div><div class="m">${UI.dualDate()}</div></div>
      <div class="grid cols-4">
        <div class="stat"><div class="accent"></div><div class="lbl">الملاحظات المفتوحة</div><div class="val">${fmtNum(openObs)}</div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">الحوادث</div><div class="val">${fmtNum(p.incidents.length)}</div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">الجولات (آخر 50)</div><div class="val">${fmtNum(p.tours.length)}</div></div>
        <div class="stat"><div class="accent"></div><div class="lbl">المخاطر النشطة</div><div class="val">${fmtNum(p.risks.filter(r => r.status !== 'closed').length)}</div></div>
      </div>
      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>بيانات المشروع</h3>
          <dl class="kv">
            <dt>الرمز</dt><dd>${esc(p.code)}</dd>
            <dt>النوع</dt><dd>${label('project_type', p.type)}</dd>
            <dt>الحالة</dt><dd>${badge('project_status', p.status)}</dd>
            <dt>مستوى المخاطر</dt><dd>${badge('severity', p.risk_level)}</dd>
            <dt>الموقع</dt><dd>${esc(p.location_text || '—')}</dd>
            <dt>الجهة المالكة</dt><dd>${esc(p.owner_entity || '—')}</dd>
            <dt>المقاول</dt><dd>${esc(p.contractor_name || '—')}</dd>
            <dt>الاستشاري</dt><dd>${esc(p.consultant_name || '—')}</dd>
            <dt>مدير المشروع</dt><dd>${esc(p.project_manager || '—')}</dd>
            <dt>مسؤول السلامة</dt><dd>${esc(p.safety_officer || '—')}</dd>
            <dt>القيمة</dt><dd>${fmtMoney(p.value)}</dd>
            <dt>المدة</dt><dd>${fmtDate(p.start_date)} ← ${fmtDate(p.end_date)}</dd>
            <dt>الإنجاز</dt><dd>${Math.round(p.progress_pct)}%</dd>
            <dt>عدد العاملين</dt><dd>${fmtNum(p.workers_count)}</dd>
            <dt>ساعات العمل</dt><dd>${fmtNum(p.work_hours)}</dd>
            <dt>خطة السلامة</dt><dd>${p.safety_plan_approved ? badge('', 'closed', 'b-good').replace('مغلقة', 'معتمدة') : '<span class="badge b-critical">غير معتمدة</span>'}</dd>
            <dt>الراصدون المكلفون</dt><dd>${p.observers.map(o => esc(o.full_name)).join('، ') || '—'}</dd>
          </dl>
          <h3 style="margin-top:1rem">وثائق المشروع</h3>
          ${UI.attachmentGrid(p.attachments)}
          ${isAdmin ? `<div class="btn-row no-print" style="margin-top:.6rem">
            <label class="btn secondary sm">⬆ رفع وثيقة<input type="file" id="prj-upload" multiple hidden></label></div>` : ''}
        </div>
        <div>
          <div class="card">
            <h3>سجل المخاطر</h3>
            ${UI.dataTable({
              columns: [
                { title: 'الوصف', key: 'description', render: r => esc(r.description).slice(0, 60) },
                { title: 'الدرجة', render: r => `<b>${r.score}</b>` },
                { title: 'المستوى', render: r => badge('severity', r.score >= 17 ? 'critical' : r.score >= 10 ? 'high' : r.score >= 5 ? 'medium' : 'low') },
                { title: 'الحالة', render: r => badge('risk_status', r.status) },
              ], rows: p.risks.slice(0, 6),
            })}
          </div>
          <div class="card" style="margin-top:1rem">
            <h3>آخر الحوادث</h3>
            ${UI.dataTable({
              columns: [
                { title: 'المرجع', key: 'ref' },
                { title: 'النوع', render: r => badge('itype', r.itype) },
                { title: 'التاريخ', render: r => fmtDate(r.occurred_at) },
                { title: 'الحالة', render: r => badge('incident_status', r.status) },
              ], rows: p.incidents.slice(0, 6),
            })}
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>آخر الملاحظات</h3>
        <div id="prj-obs"></div>
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>آخر الجولات</h3>
        <div id="prj-tours"></div>
      </div>`;

    const obsEl = el.querySelector('#prj-obs');
    obsEl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'النوع', render: r => badge('otype', r.otype, r.otype === 'violation' ? 'b-high' : 'b-neutral') },
        { title: 'الوصف', render: r => esc(r.description).slice(0, 70) },
        { title: 'الخطورة', render: r => badge('severity', r.severity) },
        { title: 'الحالة', render: r => badge('obs_status', r.status) },
        { title: 'التاريخ', render: r => fmtDate(r.created_at) },
      ],
      rows: p.observations.slice(0, 12),
      onRow: r => { location.hash = `#/observations/${r.id}`; },
    });
    UI.bindRows(obsEl, p.observations.slice(0, 12), r => { location.hash = `#/observations/${r.id}`; });

    const toursEl = el.querySelector('#prj-tours');
    toursEl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'الراصد', key: 'observer_name' },
        { title: 'الموعد', render: r => fmtDate(r.planned_date) },
        { title: 'الحالة', render: r => badge('tour_status', r.status) },
      ],
      rows: p.tours.slice(0, 12),
    });
    UI.bindRows(toursEl, p.tours.slice(0, 12), r => { location.hash = `#/tours/${r.id}`; });

    if (isAdmin) {
      el.querySelector('#prj-edit').onclick = async () => { if (await projectForm(p)) App.refreshRoute(); };
      el.querySelector('#prj-archive').onclick = async () => {
        if (!await UI.confirmDialog(p.archived ? 'إلغاء أرشفة المشروع؟' : 'السجلات المعتمدة لا تُحذف — سيتم أرشفة المشروع فقط. متابعة؟')) return;
        await api(`/api/projects/${id}`, { method: 'PUT', body: { archived: p.archived ? 0 : 1 } });
        toast('تم تحديث حالة الأرشفة');
        location.hash = '#/projects';
      };
      el.querySelector('#prj-delete').onclick = async () => {
        if (!await UI.confirmDialog(`حذف المشروع «${p.name}» نهائياً؟ الحذف متاح فقط للمشاريع التي لا تحتوي سجلات مرتبطة (جولات/ملاحظات/حوادث…) — وإلا فسيُقترح الأرشفة.`, { danger: true, okText: 'حذف نهائي' })) return;
        try {
          await api(`/api/projects/${id}`, { method: 'DELETE' });
          toast('تم حذف المشروع نهائياً');
          location.hash = '#/projects';
        } catch (e) {
          if (e.data?.can_archive) {
            if (await UI.confirmDialog(e.message + ' — هل تريد أرشفته الآن؟', { okText: 'أرشفة' })) {
              await api(`/api/projects/${id}`, { method: 'PUT', body: { archived: 1 } });
              toast('تمت أرشفة المشروع');
              location.hash = '#/projects';
            }
          } else toast(e.message, 'error');
        }
      };
      const up = el.querySelector('#prj-upload');
      if (up) up.addEventListener('change', async () => {
        if (!up.files.length) return;
        await UI.uploadAttachments('project', id, up.files, 'doc');
        toast('تم رفع الوثائق');
        App.refreshRoute();
      });
    }
  }

  // ===== المقاولون والاستشاريون + التقييم =====
  async function renderContractors(el, { user }) {
    const [parties, evals, projects] = await Promise.all([
      api('/api/parties'), api('/api/evaluations'), api('/api/projects'),
    ]);
    const isAdmin = user.role === 'admin';
    const byParty = {};
    for (const e of evals) (byParty[e.party_id] = byParty[e.party_id] || []).push(e);

    const CRITERIA = {
      safety_plan: 'الالتزام بخطة السلامة', internal_tours: 'الجولات الداخلية', violation_speed: 'سرعة معالجة المخالفات',
      repeat_rate: 'عدم تكرار الملاحظات', incidents: 'سجل الحوادث', evidence_quality: 'جودة أدلة الإغلاق',
      training: 'تدريب العاملين', ppe: 'الالتزام بمعدات الوقاية', permits: 'الالتزام بالتصاريح', cooperation: 'التعاون مع الراصدين',
    };

    function partyCard(p) {
      const list = (byParty[p.id] || []).sort((a, b) => b.period.localeCompare(a.period));
      const latest = list[0];
      const avg = list.length ? Math.round(list.reduce((s, e) => s + e.total, 0) / list.length) : null;
      const projCount = projects.filter(x => x.contractor_id === p.id || x.consultant_id === p.id).length;
      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
          <h3 style="font-size:.9rem;margin:0">${esc(p.name)}</h3>
          <span>
            <span class="badge ${p.kind === 'contractor' ? 'b-brand' : 'b-info'}">${p.kind === 'contractor' ? 'مقاول' : 'استشاري'}</span>
            ${p.active ? '' : '<span class="badge b-critical">معطل</span>'}
          </span>
        </div>
        <div style="font-size:.74rem;color:var(--ink-3);margin:.3rem 0 .6rem">${fmtNum(projCount)} مشروع مرتبط</div>
        ${avg != null ? `
        <div style="display:flex;align-items:center;gap:.6rem">
          <div class="progressbar" style="flex:1"><div style="width:${avg}%;background:${avg >= 85 ? 'var(--good)' : avg >= 70 ? 'var(--warn)' : 'var(--critical)'}"></div></div>
          <b style="font-size:1.1rem">${avg}</b>
        </div>
        <div style="font-size:.72rem;color:var(--ink-3);margin-top:.3rem">آخر تقييم: ${esc(latest.period)} (${latest.total})</div>
        ${latest.notes ? `<div style="font-size:.76rem;color:var(--ink-2);margin-top:.4rem">${esc(latest.notes)}</div>` : ''}`
        : '<div style="font-size:.8rem;color:var(--ink-3)">لا توجد تقييمات بعد</div>'}
        <div class="btn-row" style="margin-top:.7rem">
          <button class="btn sm secondary" data-history="${p.id}">سجل التقييمات</button>
          ${isAdmin ? `<button class="btn sm" data-eval="${p.id}">تقييم جديد</button>
          <button class="btn sm secondary" data-toggle="${p.id}">${p.active ? 'تعطيل' : 'تفعيل'}</button>
          <button class="btn sm danger" data-del="${p.id}">حذف</button>` : ''}
        </div>
      </div>`;
    }

    // الترتيب حسب متوسط التقييم
    const ranked = [...parties].sort((a, b) => {
      const av = x => { const l = byParty[x.id] || []; return l.length ? l.reduce((s, e) => s + e.total, 0) / l.length : -1; };
      return av(b) - av(a);
    });

    el.innerHTML = `
      <div class="filters">
        ${isAdmin ? '<button class="btn" id="party-add">+ إضافة مقاول/استشاري</button>' : ''}
      </div>
      <div class="card">
        <h3>ترتيب الأداء</h3>
        <div class="sub">حسب متوسط تقييمات الفترات — الأعلى أداءً أولاً</div>
        <div class="chart-box"><canvas id="ch-rank"></canvas></div>
      </div>
      <div class="grid cols-3" style="margin-top:1rem">${ranked.map(partyCard).join('')}</div>`;

    const rankData = ranked.map(p => {
      const l = byParty[p.id] || [];
      return { name: p.name, avg: l.length ? Math.round(l.reduce((s, e) => s + e.total, 0) / l.length) : 0 };
    }).filter(x => x.avg > 0);
    Charts.hbar('ch-rank', rankData.map(x => x.name), rankData.map(x => x.avg));

    el.querySelectorAll('[data-history]').forEach(b => b.onclick = () => {
      const pid = Number(b.dataset.history);
      const list = (byParty[pid] || []).sort((a, b2) => b2.period.localeCompare(a.period));
      const p = parties.find(x => x.id === pid);
      UI.modal({
        title: `سجل تقييمات — ${p.name}`,
        wide: true,
        body: list.length ? list.map(e => {
          const scores = JSON.parse(e.scores || '{}');
          return `<div style="border-bottom:1px solid var(--grid);padding:.7rem 0">
            <div style="display:flex;justify-content:space-between"><b>${esc(e.period)}</b><span class="badge ${e.total >= 85 ? 'b-good' : e.total >= 70 ? 'b-medium' : 'b-critical'}">${e.total}/100</span></div>
            <div class="grid cols-2" style="gap:.2rem .8rem;font-size:.78rem;margin-top:.4rem">
              ${Object.entries(scores).map(([k, v]) => `<div style="display:flex;justify-content:space-between"><span style="color:var(--ink-2)">${esc(CRITERIA[k] || k)}</span><b>${v}</b></div>`).join('')}
            </div>
            ${e.notes ? `<div style="font-size:.78rem;color:var(--ink-2);margin-top:.4rem">📝 ${esc(e.notes)}</div>` : ''}
          </div>`;
        }).join('') : '<div class="empty-state">لا توجد تقييمات</div>',
        footer: null,
      });
    });

    if (isAdmin) {
      el.querySelectorAll('[data-eval]').forEach(b => b.onclick = () => {
        const pid = Number(b.dataset.eval);
        const p = parties.find(x => x.id === pid);
        const month = new Date().toISOString().slice(0, 7);
        const m = UI.modal({
          title: `تقييم جديد — ${p.name}`,
          wide: true,
          body: `<form id="eval-form">
            ${fld('الفترة (شهر)', `<input name="period" type="month" value="${month}" required>`, { required: true })}
            <div class="form-grid">
              ${Object.entries(CRITERIA).map(([k, v]) =>
                fld(v, `<input name="s_${k}" type="number" min="0" max="100" value="80">`)).join('')}
            </div>
            ${fld('ملاحظات وتوصيات', `<textarea name="notes"></textarea>`, { full: true })}
          </form>`,
          footer: `<button class="btn" id="eval-save">حفظ التقييم</button>`,
        });
        m.el.querySelector('#eval-save').onclick = async () => {
          const d = UI.formData(m.el.querySelector('#eval-form'));
          const scores = {};
          Object.keys(CRITERIA).forEach(k => { scores[k] = Number(d['s_' + k]) || 0; });
          try {
            const r = await api('/api/evaluations', { method: 'POST', body: { party_id: pid, period: d.period, scores, notes: d.notes } });
            toast(`تم حفظ التقييم — النتيجة الإجمالية ${r.total}/100`);
            m.close(); App.refreshRoute();
          } catch (e) { toast(e.message, 'error'); }
        };
      });
      // تعطيل / تفعيل
      el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
        const pid = Number(b.dataset.toggle);
        const p = parties.find(x => x.id === pid);
        if (!await UI.confirmDialog(p.active
          ? `تعطيل «${p.name}»؟ سيختفي من قوائم الاختيار مع بقاء سجلاته التاريخية.`
          : `إعادة تفعيل «${p.name}»؟`)) return;
        await api(`/api/parties/${pid}`, { method: 'PUT', body: { active: p.active ? 0 : 1 } });
        toast(p.active ? 'تم التعطيل' : 'تم التفعيل');
        App.refreshRoute();
      });
      // حذف نهائي (مع اقتراح التعطيل عند وجود ارتباطات)
      el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        const pid = Number(b.dataset.del);
        const p = parties.find(x => x.id === pid);
        if (!await UI.confirmDialog(`حذف «${p.name}» نهائياً؟`, { danger: true, okText: 'حذف نهائي' })) return;
        try {
          await api(`/api/parties/${pid}`, { method: 'DELETE' });
          toast('تم الحذف نهائياً');
          App.refreshRoute();
        } catch (e) {
          if (e.data?.can_disable) {
            if (await UI.confirmDialog(e.message, { okText: 'تعطيل بدلاً من الحذف' })) {
              await api(`/api/parties/${pid}`, { method: 'PUT', body: { active: 0 } });
              toast('تم التعطيل');
              App.refreshRoute();
            }
          } else toast(e.message, 'error');
        }
      });
      const addBtn = el.querySelector('#party-add');
      if (addBtn) addBtn.onclick = () => {
        const m = UI.modal({
          title: 'إضافة مقاول / استشاري',
          body: `<form id="party-form">
            ${fld('الاسم', '<input name="name" required>', { required: true })}
            ${fld('النوع', select('kind', [{ value: 'contractor', label: 'مقاول' }, { value: 'consultant', label: 'استشاري' }], 'contractor', { allowEmpty: false }))}
            ${fld('جهة الاتصال', '<input name="contact_name">')}
            ${fld('الهاتف', '<input name="phone">')}
            ${fld('البريد', '<input name="email" type="email">')}
          </form>`,
          footer: `<button class="btn" id="party-save">حفظ</button>`,
        });
        m.el.querySelector('#party-save').onclick = async () => {
          try {
            await api('/api/parties', { method: 'POST', body: UI.formData(m.el.querySelector('#party-form')) });
            toast('تمت الإضافة'); m.close(); App.refreshRoute();
          } catch (e) { toast(e.message, 'error'); }
        };
      };
    }
  }

  window.Pages.projects = {
    title: 'إدارة المشاريع',
    render: (el, ctx) => ctx.args.length ? renderDetail(el, ctx) : render(el, ctx),
  };
  window.Pages.contractors = { title: 'المقاولون والاستشاريون وتقييم الأداء', render: renderContractors };
})();
