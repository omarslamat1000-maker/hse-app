// المخاطر، الحوادث، الإجراءات التصحيحية CAPA، تصاريح العمل
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, optsFromDict, fmtDate, fmtDateTime, fmtNum, toast } = UI;

  function riskLevelOf(score) {
    return score >= 17 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low';
  }
  const MATRIX_COLORS = { low: '#7fd08a', medium: '#f2cf66', high: '#eda468', critical: '#e57373' };

  // مصفوفة 5×5
  function matrixHtml(marks = []) {
    const likeLbl = ['نادر', 'غير محتمل', 'ممكن', 'محتمل', 'شبه مؤكد'];
    const impLbl = ['طفيف', 'بسيط', 'متوسط', 'جسيم', 'كارثي'];
    let rows = '';
    for (let i = 5; i >= 1; i--) {
      rows += `<tr><th style="font-size:.66rem">${impLbl[i - 1]}<br>(${i})</th>`;
      for (let l = 1; l <= 5; l++) {
        const s = l * i;
        const lvl = riskLevelOf(s);
        const count = marks.filter(m => m.likelihood === l && m.impact === i).length;
        rows += `<td style="background:${MATRIX_COLORS[lvl]}">${s}${count ? `<div style="font-size:.62rem;background:rgba(0,0,0,.25);color:#fff;border-radius:99px;margin-top:2px">${count} خطر</div>` : ''}</td>`;
      }
      rows += '</tr>';
    }
    return `<div class="table-wrap" style="border:none"><table class="matrix">
      <tr><th></th><th colspan="5" style="font-size:.7rem;color:var(--ink-3)">الاحتمالية ←</th></tr>
      ${rows}
      <tr><th style="font-size:.66rem">الأثر ↑</th>${likeLbl.map((l, i2) => `<th style="font-size:.66rem">${l}<br>(${i2 + 1})</th>`).join('')}</tr>
    </table></div>`;
  }

  // ===== سجل المخاطر =====
  async function renderRisks(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [risks, projects] = await Promise.all([
      api('/api/risks' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
    ]);
    const openRisks = risks.filter(r => r.status !== 'closed');
    el.innerHTML = `
      <div class="grid cols-2">
        <div class="card">
          <h3>مصفوفة المخاطر 5×5</h3>
          <div class="sub">درجة المخاطر = الاحتمالية × شدة الأثر — الأرقام داخل الخلايا تمثل المخاطر النشطة</div>
          ${matrixHtml(openRisks)}
          <div class="legend-row">
            ${['low','medium','high','critical'].map(l => `<span class="li"><span class="sw" style="background:${MATRIX_COLORS[l]}"></span>${label('severity', l)} ${l === 'low' ? '(1-4)' : l === 'medium' ? '(5-9)' : l === 'high' ? '(10-16)' : '(17-25)'}</span>`).join('')}
          </div>
        </div>
        <div class="card">
          <h3>توزيع المخاطر النشطة</h3>
          <div class="chart-box"><canvas id="ch-risk"></canvas></div>
        </div>
      </div>
      <form class="filters" id="risk-filters" style="margin-top:1rem">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('المستوى', select('level', optsFromDict('severity'), params.level))}
        ${fld('الحالة', select('status', optsFromDict('risk_status'), params.status))}
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn" type="button" id="risk-add">+ تسجيل خطر</button>
        <a class="btn secondary sm" href="/api/export/risks" download>⬇ تصدير</a>
      </form>
      <div id="risk-table"></div>`;

    const sevColors = Charts.SEV_COLOR();
    const order = ['low', 'medium', 'high', 'critical'];
    Charts.doughnut('ch-risk', order.map(l => label('severity', l)),
      order.map(l => openRisks.filter(r => r.level === l).length),
      order.map(l => sevColors[l]));

    const tbl = el.querySelector('#risk-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الخطر', render: r => esc(r.description).slice(0, 60) },
        { title: 'ق. المخاطر', render: r => `<b>${r.score}</b> ${badge('severity', r.level)}` },
        { title: 'المتبقية', render: r => r.residual_score ? `${r.residual_score} ${badge('severity', r.residual_level)}` : '—' },
        { title: 'المالك', key: 'owner' },
        { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
        { title: 'الحالة', render: r => badge('risk_status', r.status) + UI.tagBadge(r.status_tag) },
        { title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` },
      ],
      rows: risks,
    });
    UI.bindRows(tbl, risks, r => riskDetail(r));
    tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      riskForm(risks.find(x => x.id === Number(b.dataset.edit)), projects).then(s => s && App.refreshRoute());
    }));

    el.querySelector('#risk-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/risks' + (q ? `?${q}` : '');
    });
    el.querySelector('#risk-add').onclick = () => riskForm(null, projects).then(s => s && App.refreshRoute());

    function riskDetail(r) {
      const m = UI.modal({
        title: `${r.ref} — سجل الخطر`,
        wide: true,
        body: `
          <dl class="kv">
            <dt>المشروع</dt><dd>${esc(r.project_name)}</dd>
            <dt>الوصف</dt><dd>${esc(r.description)}</dd>
            <dt>المسببات</dt><dd>${esc(r.causes || '—')}</dd>
            <dt>الآثار المحتملة</dt><dd>${esc(r.effects || '—')}</dd>
            <dt>الضوابط الحالية</dt><dd>${esc(r.current_controls || '—')}</dd>
            <dt>قبل المعالجة</dt><dd>${r.likelihood} × ${r.impact} = <b>${r.score}</b> ${badge('severity', r.level)}</dd>
            <dt>الإجراءات</dt><dd>${esc(r.actions || '—')}</dd>
            <dt>بعد المعالجة (المتبقية)</dt><dd>${r.residual_score ? `${r.residual_likelihood} × ${r.residual_impact} = <b>${r.residual_score}</b> ${badge('severity', r.residual_level)}` : '—'}</dd>
            <dt>مالك الخطر</dt><dd>${esc(r.owner || '—')}</dd>
            <dt>الاستحقاق</dt><dd>${fmtDate(r.due_date)}</dd>
            <dt>خطة المراقبة</dt><dd>${esc(r.monitoring_plan || '—')}</dd>
            <dt>الحالة</dt><dd>${badge('risk_status', r.status)}</dd>
          </dl>`,
        footer: `<button class="btn" id="risk-edit">تعديل</button>`,
      });
      m.el.querySelector('#risk-edit').onclick = () => { m.close(); riskForm(r, projects).then(s => s && App.refreshRoute()); };
    }

    async function riskForm(existing, projs) {
      const r = existing || {};
      const tags = await UI.customStatuses();
      return new Promise(resolve => {
        const m = UI.modal({
          title: existing ? `تعديل ${r.ref}` : 'تسجيل خطر جديد',
          wide: true,
          body: `<form id="risk-form" class="form-grid">
            ${fld('المشروع', select('project_id', projs.map(p => ({ value: p.id, label: p.name })), r.project_id, { allowEmpty: false }), { required: true })}
            ${fld('حالة الخطر', select('status', optsFromDict('risk_status'), r.status || 'open', { allowEmpty: false }))}
            ${fld('الحالة المخصصة (وسم)', UI.tagSelect('status_tag', tags, r.status_tag || ''))}
            ${fld('وصف الخطر', `<textarea name="description" required>${esc(r.description || '')}</textarea>`, { required: true, full: true })}
            ${fld('المسببات', `<textarea name="causes">${esc(r.causes || '')}</textarea>`)}
            ${fld('الآثار المحتملة', `<textarea name="effects">${esc(r.effects || '')}</textarea>`)}
            ${fld('الضوابط الحالية', `<textarea name="current_controls">${esc(r.current_controls || '')}</textarea>`, { full: true })}
            ${fld('الاحتمالية (1-5)', `<input name="likelihood" type="number" min="1" max="5" value="${r.likelihood || 3}" required>`, { required: true })}
            ${fld('شدة الأثر (1-5)', `<input name="impact" type="number" min="1" max="5" value="${r.impact || 3}" required>`, { required: true })}
            ${fld('الإجراءات الوقائية والتصحيحية', `<textarea name="actions">${esc(r.actions || '')}</textarea>`, { full: true })}
            ${fld('مالك الخطر', `<input name="owner" value="${esc(r.owner || '')}">`)}
            ${fld('تاريخ الاستحقاق', `<input name="due_date" type="date" value="${esc(r.due_date || '')}">`)}
            ${fld('الاحتمالية المتبقية', `<input name="residual_likelihood" type="number" min="1" max="5" value="${r.residual_likelihood || ''}">`)}
            ${fld('الأثر المتبقي', `<input name="residual_impact" type="number" min="1" max="5" value="${r.residual_impact || ''}">`)}
            ${fld('خطة المراقبة والمراجعة', `<textarea name="monitoring_plan">${esc(r.monitoring_plan || '')}</textarea>`, { full: true })}
          </form>`,
          footer: `<button class="btn" id="risk-save">حفظ</button>`,
          onClose: () => resolve(false),
        });
        m.el.querySelector('#risk-save').onclick = async () => {
          const d = UI.formData(m.el.querySelector('#risk-form'));
          ['project_id','likelihood','impact','residual_likelihood','residual_impact'].forEach(k => { d[k] = d[k] ? Number(d[k]) : null; });
          try {
            if (existing) await api(`/api/risks/${existing.id}`, { method: 'PUT', body: d });
            else await api('/api/risks', { method: 'POST', body: d });
            toast('تم حفظ سجل الخطر');
            resolve(true); m.close();
          } catch (e) { toast(e.message, 'error'); }
        };
      });
    }
  }

  // ===== الحوادث =====
  window.IncidentForm = async function (preset = {}) {
    const projects = (await api('/api/auth/me')).projects;
    return new Promise(resolve => {
      const m = UI.modal({
        title: 'الإبلاغ عن حادث / حالة',
        wide: true,
        body: `<form id="inc-form" class="form-grid">
          ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), preset.project_id, { allowEmpty: false }), { required: true })}
          ${fld('نوع الحدث', select('itype', optsFromDict('itype'), 'near_miss', { allowEmpty: false }), { required: true })}
          ${fld('تاريخ ووقت الحادث', `<input name="occurred_at" type="datetime-local" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}" required>`, { required: true })}
          ${fld('الموقع', `<input name="location">`)}
          ${fld('وصف الحدث', `<textarea name="description" required></textarea>`, { required: true, full: true })}
          ${fld('الأشخاص المتضررون', `<input name="people_affected" placeholder="الأسماء أو العدد">`)}
          ${fld('نوع الإصابة', `<input name="injury_type">`)}
          ${fld('شدة الإصابة', select('injury_severity', [
            { value: 'minor', label: 'بسيطة' }, { value: 'moderate', label: 'متوسطة' },
            { value: 'serious', label: 'بليغة' }, { value: 'fatal', label: 'قاتلة' }], '', { emptyLabel: '—' }))}
          ${fld('ساعات العمل المفقودة', `<input name="lost_hours" type="number" min="0" value="0">`)}
          <div class="full" style="background:var(--surface-2);border-radius:8px;padding:.7rem .9rem">
            <b style="font-size:.8rem">بيانات المصاب — لمتطلبات الإبلاغ للتأمينات الاجتماعية GOSI (للإصابات والوفيات)</b>
            <div class="form-grid" style="margin-top:.5rem">
              ${fld('رقم الهوية / الإقامة', `<input name="injured_id" dir="ltr">`)}
              ${fld('الجنسية', `<input name="injured_nationality">`)}
              ${fld('المهنة', `<input name="injured_occupation">`)}
            </div>
          </div>
          ${fld('الإجراء الفوري', `<textarea name="immediate_action"></textarea>`, { full: true })}
          <div class="full btn-row">
            <button type="button" class="btn secondary sm" id="inc-gps">📍 تحديد الموقع</button>
            <label class="btn secondary sm">📷 صور ومرفقات<input type="file" id="inc-files" accept="image/*,video/*,.pdf" capture="environment" multiple hidden></label>
            <span id="inc-status" style="font-size:.76rem;color:var(--ink-3)"></span>
          </div>
        </form>`,
        footer: `<button class="btn" id="inc-save">تسجيل الحادث</button>`,
        onClose: () => resolve(false),
      });
      let gps = null, files = [];
      m.el.querySelector('#inc-gps').onclick = async () => {
        gps = await UI.getLocation();
        m.el.querySelector('#inc-status').textContent = gps ? 'تم تحديد الموقع' : 'تعذر تحديد الموقع';
      };
      m.el.querySelector('#inc-files').addEventListener('change', e => {
        files = [...e.target.files];
        m.el.querySelector('#inc-status').textContent = `${files.length} ملف`;
      });
      m.el.querySelector('#inc-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#inc-form'));
        if (!d.description.trim()) return toast('أدخل وصف الحدث', 'warn');
        d.project_id = Number(d.project_id);
        d.lost_hours = Number(d.lost_hours) || 0;
        d.occurred_at = d.occurred_at.replace('T', ' ');
        if (gps) { d.lat = gps.lat; d.lng = gps.lng; }
        try {
          const r = await api('/api/incidents', { method: 'POST', body: d, queueable: true });
          if (r.__queued) { toast('حُفظ البلاغ محلياً وستتم المزامنة عند الاتصال', 'warn'); resolve(true); m.close(); return; }
          if (files.length) await UI.uploadAttachments('incident', r.id, files, 'photo');
          toast(`تم تسجيل الحادث ${r.ref}`);
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };

  async function renderIncidents(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [rows, projects] = await Promise.all([
      api('/api/incidents' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
    ]);
    const injuries = rows.filter(r => ['injury', 'fatality'].includes(r.itype)).length;
    const nearMiss = rows.filter(r => r.itype === 'near_miss').length;
    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="accent"></div><div class="lbl">إجمالي الأحداث</div><div class="val">${rows.length}</div></div>
        <div class="stat critical"><div class="accent"></div><div class="lbl">إصابات ووفيات</div><div class="val">${injuries}</div></div>
        <div class="stat info"><div class="accent"></div><div class="lbl">شبه حادثة</div><div class="val">${nearMiss}</div></div>
        <div class="stat warn"><div class="accent"></div><div class="lbl">قيد التحقيق</div><div class="val">${rows.filter(r => r.status === 'investigating').length}</div></div>
      </div>
      <form class="filters" id="inc-filters" style="margin-top:1rem">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('النوع', select('itype', optsFromDict('itype'), params.itype))}
        ${fld('الحالة', select('status', optsFromDict('incident_status'), params.status))}
        ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn" type="button" id="inc-add">+ تسجيل حادث</button>
        <a class="btn secondary sm" href="/api/export/incidents" download>⬇ تصدير</a>
      </form>
      <div id="inc-table"></div>`;
    const tbl = el.querySelector('#inc-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'النوع', render: r => badge('itype', r.itype, ['injury', 'fatality', 'fire'].includes(r.itype) ? 'b-critical' : 'b-neutral') },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الوصف', render: r => esc(r.description).slice(0, 55) },
        { title: 'التاريخ', render: r => fmtDateTime(r.occurred_at) },
        { title: 'ساعات مفقودة', key: 'lost_hours' },
        { title: 'الحالة', render: r => badge('incident_status', r.status) + UI.tagBadge(r.status_tag) },
        { title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` },
      ],
      rows,
    });
    UI.bindRows(tbl, rows, r => { location.hash = `#/incidents/${r.id}`; });
    tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      location.hash = `#/incidents/${b.dataset.edit}`;
    }));
    el.querySelector('#inc-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/incidents' + (q ? `?${q}` : '');
    });
    el.querySelector('#inc-add').onclick = () => window.IncidentForm({}).then(s => s && App.refreshRoute());
  }

  async function renderIncidentDetail(el, { args, user }) {
    const id = Number(args[0]);
    const i = await api(`/api/incidents/${id}`);
    const isAdmin = user.role === 'admin';
    document.getElementById('page-title').textContent = `حادث ${i.ref}`;
    el.innerHTML = `
      <div class="btn-row no-print" style="margin-bottom:1rem">
        <a class="btn secondary sm" href="#/incidents">→ جميع الحوادث</a>
        ${isAdmin && i.status !== 'closed' ? `<button class="btn sm" id="inc-invest">تحديث التحقيق والأسباب</button>
          <button class="btn sm secondary" id="inc-capa">+ إجراء تصحيحي</button>
          <button class="btn sm danger" id="inc-close">إغلاق الحادث</button>` : ''}
        <button class="btn sm secondary" onclick="window.print()">🖨 طباعة</button>
      </div>
      <div class="print-header"><div class="o">تقرير حادث ${esc(i.ref)}</div><div class="m">${new Date().toLocaleDateString('ar-SA-u-nu-latn')}</div></div>
      <div class="grid cols-2">
        <div class="card">
          <h3>بيانات الحادث ${badge('incident_status', i.status)}${UI.tagBadge(i.status_tag)}</h3>
          <dl class="kv">
            <dt>المشروع</dt><dd><a href="#/projects/${i.project_id}">${esc(i.project_name)}</a></dd>
            <dt>النوع</dt><dd>${badge('itype', i.itype)}</dd>
            <dt>التاريخ والوقت</dt><dd>${fmtDateTime(i.occurred_at)}</dd>
            <dt>الموقع</dt><dd>${esc(i.location || '—')}</dd>
            <dt>المتضررون</dt><dd>${esc(i.people_affected || '—')}</dd>
            <dt>نوع الإصابة</dt><dd>${esc(i.injury_type || '—')} ${i.injury_severity ? `(${esc(i.injury_severity)})` : ''}</dd>
            <dt>ساعات مفقودة</dt><dd>${fmtNum(i.lost_hours)}</dd>
            ${['injury', 'fatality'].includes(i.itype) ? `
            <dt>هوية المصاب</dt><dd dir="ltr">${esc(i.injured_id || '—')}</dd>
            <dt>الجنسية / المهنة</dt><dd>${esc(i.injured_nationality || '—')} / ${esc(i.injured_occupation || '—')}</dd>
            <dt>إبلاغ التأمينات GOSI</dt><dd>${i.gosi_reported
              ? `<span class="badge b-good">تم الإبلاغ</span> <small style="color:var(--ink-3)">${fmtDateTime(i.gosi_reported_at)}</small>`
              : `<span class="badge b-critical">لم يُبلغ — المهلة 3 أيام</span>
                 ${isAdmin ? '<button class="btn sm no-print" id="gosi-mark" style="margin-inline-start:.4rem">✔ تعليم كمُبلّغ</button>' : ''}`}</dd>` : ''}
            ${i.closed_at ? `<dt>تاريخ الإغلاق</dt><dd>${fmtDateTime(i.closed_at)}</dd>` : ''}
          </dl>
          <h3 style="margin-top:1rem">وصف الحدث</h3>
          <p style="font-size:.9rem">${esc(i.description)}</p>
          ${i.immediate_action ? `<h3>الإجراء الفوري</h3><p style="font-size:.86rem">${esc(i.immediate_action)}</p>` : ''}
          <h3 style="margin-top:1rem">الصور والمرفقات</h3>
          ${UI.attachmentGrid(i.attachments)}
          <div class="btn-row no-print" style="margin-top:.6rem">
            <label class="btn secondary sm">⬆ إرفاق<input type="file" id="inc-up" multiple hidden></label>
          </div>
          <h3 style="margin-top:1.1rem">🛠 الإجراءات المتخذة</h3>
          <div class="sub">وثّق إجراءات المعالجة والتحقيق — إلزامي قبل إغلاق الحادث</div>
          <div id="inc-updates">${UI.spinner()}</div>
        </div>
        <div class="card">
          <h3>التحقيق وتحليل الأسباب الجذرية</h3>
          <dl class="kv">
            <dt>فريق التحقيق</dt><dd>${esc(i.investigation_team || '—')}</dd>
            <dt>منهجية التحليل</dt><dd>${i.rca_method ? label('rca', i.rca_method) : '—'}</dd>
            <dt>السبب الجذري</dt><dd>${esc(i.root_cause || '—')}</dd>
            <dt>الأسباب المباشرة</dt><dd>${esc(i.direct_causes || '—')}</dd>
            <dt>الأسباب غير المباشرة</dt><dd>${esc(i.indirect_causes || '—')}</dd>
            <dt>الدروس المستفادة</dt><dd>${esc(i.lessons || '—')}</dd>
          </dl>
          ${i.actions.length ? `<h3 style="margin-top:1rem">الإجراءات التصحيحية المرتبطة</h3>
            ${UI.dataTable({
              columns: [
                { title: 'المرجع', key: 'ref' },
                { title: 'الوصف', render: r => esc(r.description).slice(0, 40) },
                { title: 'الحالة', render: r => badge('action_status', r.status) },
              ], rows: i.actions,
            })}` : ''}
        </div>
      </div>`;

    UI.renderUpdates(el.querySelector('#inc-updates'), 'incident', id, { locked: i.status === 'closed' });

    const gosiBtn = el.querySelector('#gosi-mark');
    if (gosiBtn) gosiBtn.onclick = async () => {
      if (!await UI.confirmDialog('تأكيد: تم إبلاغ التأمينات الاجتماعية عن هذه الإصابة عبر القنوات الرسمية؟')) return;
      await api(`/api/incidents/${id}`, { method: 'PUT', body: { gosi_reported: 1 } });
      toast('تم تعليم الإصابة كمُبلّغة للتأمينات');
      App.refreshRoute();
    };

    const upEl = el.querySelector('#inc-up');
    if (upEl) upEl.addEventListener('change', async () => {
      if (!upEl.files.length) return;
      await UI.uploadAttachments('incident', id, upEl.files, 'photo');
      toast('تم الرفع'); App.refreshRoute();
    });

    if (isAdmin && i.status !== 'closed') {
      el.querySelector('#inc-invest').onclick = async () => {
        const tags = await UI.customStatuses();
        const m = UI.modal({
          title: 'تحديث التحقيق وتحليل الأسباب',
          wide: true,
          body: `<form id="inv-form" class="form-grid">
            ${fld('حالة الحادث', select('status', optsFromDict('incident_status'), i.status, { allowEmpty: false }))}
            ${fld('الحالة المخصصة (وسم)', UI.tagSelect('status_tag', tags, i.status_tag || ''))}
            ${fld('منهجية التحليل', select('rca_method', optsFromDict('rca'), i.rca_method, { emptyLabel: '—' }))}
            ${fld('فريق التحقيق', `<input name="investigation_team" value="${esc(i.investigation_team || '')}">`, { full: true })}
            ${['injury', 'fatality'].includes(i.itype) ? `
            ${fld('رقم هوية/إقامة المصاب', `<input name="injured_id" dir="ltr" value="${esc(i.injured_id || '')}">`)}
            ${fld('جنسية المصاب', `<input name="injured_nationality" value="${esc(i.injured_nationality || '')}">`)}
            ${fld('مهنة المصاب', `<input name="injured_occupation" value="${esc(i.injured_occupation || '')}">`)}` : ''}
            ${fld('السبب الجذري', `<textarea name="root_cause">${esc(i.root_cause || '')}</textarea>`, { full: true })}
            ${fld('الأسباب المباشرة', `<textarea name="direct_causes">${esc(i.direct_causes || '')}</textarea>`)}
            ${fld('الأسباب غير المباشرة', `<textarea name="indirect_causes">${esc(i.indirect_causes || '')}</textarea>`)}
            ${fld('الدروس المستفادة', `<textarea name="lessons">${esc(i.lessons || '')}</textarea>`, { full: true })}
          </form>`,
          footer: `<button class="btn" id="inv-save">حفظ</button>`,
        });
        m.el.querySelector('#inv-save').onclick = async () => {
          await api(`/api/incidents/${id}`, { method: 'PUT', body: UI.formData(m.el.querySelector('#inv-form')) });
          toast('تم تحديث التحقيق');
          m.close(); App.refreshRoute();
        };
      };
      el.querySelector('#inc-capa').onclick = () => {
        window.ActionForm({ source_type: 'incident', source_id: id, project_id: i.project_id, description: `إجراء تصحيحي للحادث ${i.ref}` })
          .then(s => s && App.refreshRoute());
      };
      el.querySelector('#inc-close').onclick = async () => {
        if (!i.root_cause && !await UI.confirmDialog('لم يُسجل سبب جذري بعد — إغلاق الحادث دون استكمال التحقيق؟', { danger: true })) return;
        await api(`/api/incidents/${id}`, { method: 'PUT', body: { status: 'closed' } });
        toast('تم إغلاق الحادث واعتماده');
        App.refreshRoute();
      };
    }
  }

  // ===== الإجراءات التصحيحية CAPA =====
  window.ActionForm = async function (preset = {}) {
    const projects = (await api('/api/auth/me')).projects;
    return new Promise(resolve => {
      const m = UI.modal({
        title: 'إجراء تصحيحي / وقائي جديد',
        body: `<form id="act-form" class="form-grid">
          ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), preset.project_id, { allowEmpty: false }), { required: true })}
          ${fld('الأولوية', select('priority', optsFromDict('priority'), 'medium', { allowEmpty: false }))}
          ${fld('وصف المشكلة', `<textarea name="description" required>${esc(preset.description || '')}</textarea>`, { required: true, full: true })}
          ${fld('الإجراء المطلوب', `<textarea name="required_action"></textarea>`, { full: true })}
          ${fld('المسؤول عن التنفيذ', `<input name="assignee">`)}
          ${fld('تاريخ الاستحقاق', `<input name="due_date" type="date" required>`, { required: true })}
        </form>`,
        footer: `<button class="btn" id="act-save">حفظ</button>`,
        onClose: () => resolve(false),
      });
      m.el.querySelector('#act-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#act-form'));
        d.project_id = Number(d.project_id);
        if (preset.source_type) { d.source_type = preset.source_type; d.source_id = preset.source_id; }
        try {
          const r = await api('/api/actions', { method: 'POST', body: d });
          toast(`تم إنشاء الإجراء ${r.ref}`);
          resolve(true); m.close();
        } catch (e) { toast(e.message, 'error'); }
      };
    });
  };

  const ACT_NEXT = {
    open: [{ to: 'in_progress', label: 'بدء التنفيذ' }],
    in_progress: [{ to: 'pending_verification', label: 'جاهز للتحقق' }],
    pending_verification: [
      { to: 'closed', label: 'اعتماد الإغلاق ✔', admin: true },
      { to: 'rejected', label: 'رفض', admin: true, danger: true },
      { to: 'reopened', label: 'إعادة فتح', admin: true, danger: true },
    ],
    rejected: [{ to: 'in_progress', label: 'إعادة التنفيذ' }],
    reopened: [{ to: 'in_progress', label: 'إعادة التنفيذ' }],
    closed: [{ to: 'reopened', label: 'إعادة فتح', admin: true, danger: true }],
  };

  async function renderActions(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [rows, projects, tags] = await Promise.all([
      api('/api/actions' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
      UI.customStatuses(),
    ]);
    const overdue = rows.filter(r => r.overdue).length;
    const isAdmin = user.role === 'admin';
    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="accent"></div><div class="lbl">الإجمالي</div><div class="val">${rows.length}</div></div>
        <div class="stat info"><div class="accent"></div><div class="lbl">قيد التنفيذ</div><div class="val">${rows.filter(r => r.status === 'in_progress').length}</div></div>
        <div class="stat critical"><div class="accent"></div><div class="lbl">متأخرة</div><div class="val">${overdue}</div></div>
        <div class="stat good"><div class="accent"></div><div class="lbl">مغلقة</div><div class="val">${rows.filter(r => r.status === 'closed').length}</div></div>
      </div>
      <form class="filters" id="act-filters" style="margin-top:1rem">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('الحالة', select('status', optsFromDict('action_status'), params.status))}
        ${fld('الأولوية', select('priority', optsFromDict('priority'), params.priority))}
        ${tags.length ? fld('الحالة المخصصة', select('status_tag', tags.map(t => ({ value: t, label: t })), params.status_tag)) : ''}
        <label class="fld"><span>المتأخرة فقط</span><input type="checkbox" name="overdue" value="1" style="width:auto" ${params.overdue ? 'checked' : ''}></label>
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn" type="button" id="act-add">+ إجراء جديد</button>
        <a class="btn secondary sm" href="/api/export/actions" download>⬇ تصدير</a>
      </form>
      <div id="act-table"></div>`;
    const tbl = el.querySelector('#act-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', render: r => `${esc(r.ref)}${r.escalated ? ' <span class="badge b-critical">مصعد</span>' : ''}` },
        { title: 'المشروع', key: 'project_name' },
        { title: 'الوصف', render: r => esc(r.description).slice(0, 50) },
        { title: 'المسؤول', key: 'assignee' },
        { title: 'الأولوية', render: r => badge('priority', r.priority, UI.SEV_CLASS[r.priority]) },
        { title: 'الاستحقاق', render: r => fmtDate(r.due_date) + (r.overdue ? ' <span class="badge b-critical">متأخر</span>' : '') },
        { title: 'الإنجاز', render: r => `<div style="display:flex;align-items:center;gap:.4rem"><div class="progressbar" style="width:60px"><div style="width:${r.progress}%"></div></div>${r.progress}%</div>` },
        { title: 'الحالة', render: r => badge('action_status', r.status) + UI.tagBadge(r.status_tag) },
        { title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` },
      ],
      rows,
    });
    UI.bindRows(tbl, rows, r => actionDetail(r));
    tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      actionDetail(rows.find(x => x.id === Number(b.dataset.edit)));
    }));
    el.querySelector('#act-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      if (!d.overdue) delete d.overdue; else d.overdue = '1';
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/actions' + (q ? `?${q}` : '');
    });
    el.querySelector('#act-add').onclick = () => window.ActionForm({}).then(s => s && App.refreshRoute());

    async function actionDetail(a) {
      const [atts, tags] = await Promise.all([
        api(`/api/attachments?entity_type=action&entity_id=${a.id}`),
        UI.customStatuses(),
      ]);
      const next = (ACT_NEXT[a.status] || []).filter(x => !x.admin || isAdmin);
      const m = UI.modal({
        title: `${a.ref} — إجراء تصحيحي`,
        wide: true,
        body: `
          <dl class="kv">
            <dt>المشروع</dt><dd>${esc(a.project_name)}</dd>
            <dt>المصدر</dt><dd>${a.source_type === 'observation' ? 'ملاحظة' : a.source_type === 'incident' ? 'حادث' : a.source_type === 'risk' ? 'خطر' : 'يدوي'} ${a.source_id ? '#' + a.source_id : ''}</dd>
            <dt>الوصف</dt><dd>${esc(a.description)}</dd>
            <dt>الإجراء المطلوب</dt><dd>${esc(a.required_action || '—')}</dd>
            <dt>المسؤول</dt><dd>${esc(a.assignee || '—')}</dd>
            <dt>الأولوية</dt><dd>${badge('priority', a.priority, UI.SEV_CLASS[a.priority])}</dd>
            <dt>المدة</dt><dd>${fmtDate(a.start_date)} ← ${fmtDate(a.due_date)}</dd>
            <dt>الحالة</dt><dd>${badge('action_status', a.status)} ${a.escalated ? '<span class="badge b-critical">مصعد تلقائياً</span>' : ''}</dd>
          </dl>
          <div class="form-grid" style="margin-top:.8rem">
            <label class="fld"><span>نسبة الإنجاز: <b id="prog-val">${a.progress}%</b></span>
              <input type="range" id="act-prog" min="0" max="100" step="5" value="${a.progress}"></label>
            ${fld('الحالة المخصصة (وسم)', `<span id="act-tag-wrap">${UI.tagSelect('act_status_tag', tags, a.status_tag || '')}</span>`)}
          </div>
          <h3 style="margin-top:.6rem">🛠 الإجراءات المتخذة</h3>
          <div style="font-size:.74rem;color:var(--ink-3);margin-bottom:.3rem">إلزامي قبل طلب التحقق — نسبة الإنجاز المدخلة هنا تحدّث الإجراء تلقائياً</div>
          <div id="act-updates">${UI.spinner()}</div>
          <h3 style="margin-top:.6rem">أدلة التنفيذ</h3>
          ${UI.attachmentGrid(atts)}
          <div class="btn-row" style="margin-top:.6rem">
            <label class="btn secondary sm">⬆ إرفاق دليل تنفيذ<input type="file" id="act-up" multiple hidden></label>
          </div>`,
        footer: `${next.map((x, i2) => `<button class="btn ${x.danger ? 'danger' : ''}" data-n="${i2}">${x.label}</button>`).join('')}
          <button class="btn secondary" id="act-save-prog">حفظ نسبة الإنجاز</button>`,
      });
      UI.renderUpdates(m.el.querySelector('#act-updates'), 'action', a.id, {
        showProgress: true,
        locked: ['closed', 'rejected'].includes(a.status),
      });
      const prog = m.el.querySelector('#act-prog');
      prog.addEventListener('input', () => { m.el.querySelector('#prog-val').textContent = prog.value + '%'; });
      m.el.querySelector('#act-save-prog').onclick = async () => {
        await api(`/api/actions/${a.id}`, { method: 'PUT', body: {
          progress: Number(prog.value),
          status_tag: m.el.querySelector('[name="act_status_tag"]').value,
        } });
        toast('تم حفظ التحديثات');
        m.close(); App.refreshRoute();
      };
      m.el.querySelector('#act-up').addEventListener('change', async e2 => {
        if (!e2.target.files.length) return;
        await UI.uploadAttachments('action', a.id, e2.target.files, 'evidence');
        toast('تم رفع أدلة التنفيذ');
        m.close(); actionDetail(a);
      });
      next.forEach((x, i2) => {
        m.el.querySelector(`[data-n="${i2}"]`).onclick = async () => {
          try {
            await api(`/api/actions/${a.id}/transition`, { method: 'POST', body: { to: x.to } });
            toast('تم تحديث حالة الإجراء');
            m.close(); App.refreshRoute();
          } catch (e3) { toast(e3.message, 'error'); }
        };
      });
    }
  }

  // ===== تصاريح العمل =====
  const PERMIT_NEXT = {
    requested: [{ to: 'under_review', label: 'بدء المراجعة', admin: true }, { to: 'cancelled', label: 'إلغاء', admin: true, danger: true }],
    under_review: [{ to: 'approved', label: 'اعتماد', admin: true }, { to: 'cancelled', label: 'إلغاء', admin: true, danger: true }],
    approved: [{ to: 'active', label: 'تفعيل السريان' }, { to: 'cancelled', label: 'إلغاء', admin: true, danger: true }],
    active: [{ to: 'suspended', label: 'تعليق', admin: true, danger: true }, { to: 'closed', label: 'إغلاق' }],
    suspended: [{ to: 'active', label: 'إعادة تفعيل', admin: true }, { to: 'closed', label: 'إغلاق' }],
  };

  async function renderPermits(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [rows, projects] = await Promise.all([
      api('/api/permits' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
    ]);
    const isAdmin = user.role === 'admin';
    el.innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="accent"></div><div class="lbl">الإجمالي</div><div class="val">${rows.length}</div></div>
        <div class="stat good"><div class="accent"></div><div class="lbl">سارية</div><div class="val">${rows.filter(r => r.status === 'active').length}</div></div>
        <div class="stat info"><div class="accent"></div><div class="lbl">بانتظار الاعتماد</div><div class="val">${rows.filter(r => ['requested', 'under_review'].includes(r.status)).length}</div></div>
        <div class="stat warn"><div class="accent"></div><div class="lbl">معلقة</div><div class="val">${rows.filter(r => r.status === 'suspended').length}</div></div>
      </div>
      <form class="filters" id="prm-filters" style="margin-top:1rem">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('نوع التصريح', select('ptype', optsFromDict('ptype'), params.ptype))}
        ${fld('الحالة', select('status', optsFromDict('permit_status'), params.status))}
        <button class="btn sm" type="submit">تصفية</button>
        <button class="btn" type="button" id="prm-add">+ طلب تصريح</button>
      </form>
      <div id="prm-table"></div>`;
    const tbl = el.querySelector('#prm-table');
    tbl.innerHTML = UI.dataTable({
      columns: [
        { title: 'المرجع', key: 'ref' },
        { title: 'النوع', render: r => badge('ptype', r.ptype, 'b-brand') },
        { title: 'المشروع', key: 'project_name' },
        { title: 'السريان', render: r => `${fmtDate(r.valid_from)} ← ${fmtDate(r.valid_to)}` },
        { title: 'المسؤول', key: 'responsible' },
        { title: 'تحقق ميداني', render: r => r.field_verified ? '<span class="badge b-good">تم</span>' : '<span class="badge b-neutral">لم يتم</span>' },
        { title: 'الحالة', render: r => badge('permit_status', r.status) + UI.tagBadge(r.status_tag) },
        { title: 'إجراءات', render: r => `<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>` },
      ],
      rows,
    });
    UI.bindRows(tbl, rows, r => permitDetail(r));
    tbl.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      permitDetail(rows.find(x => x.id === Number(b.dataset.edit)));
    }));
    el.querySelector('#prm-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/permits' + (q ? `?${q}` : '');
    });
    el.querySelector('#prm-add').onclick = () => {
      const m = UI.modal({
        title: 'طلب تصريح عمل',
        body: `<form id="prm-form" class="form-grid">
          ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), '', { allowEmpty: false }), { required: true })}
          ${fld('نوع التصريح', select('ptype', optsFromDict('ptype'), 'hotwork', { allowEmpty: false }), { required: true })}
          ${fld('وصف الأعمال', `<textarea name="description"></textarea>`, { full: true })}
          ${fld('مقدم الطلب', `<input name="requester">`)}
          ${fld('المسؤول عن التنفيذ', `<input name="responsible">`)}
          ${fld('بداية السريان', `<input name="valid_from" type="date">`)}
          ${fld('نهاية السريان', `<input name="valid_to" type="date">`)}
          ${fld('متطلبات السلامة', `<textarea name="safety_requirements">عزل منطقة العمل، معدات وقاية كاملة، مراقب سلامة متواجد، طفاية حريق صالحة.</textarea>`, { full: true })}
        </form>`,
        footer: `<button class="btn" id="prm-save">تقديم الطلب</button>`,
      });
      m.el.querySelector('#prm-save').onclick = async () => {
        const d = UI.formData(m.el.querySelector('#prm-form'));
        d.project_id = Number(d.project_id);
        try {
          const r = await api('/api/permits', { method: 'POST', body: d });
          toast(`تم تقديم طلب التصريح ${r.ref}`);
          m.close(); App.refreshRoute();
        } catch (e) { toast(e.message, 'error'); }
      };
    };

    async function permitDetail(p) {
      const tags = await UI.customStatuses();
      const next = (PERMIT_NEXT[p.status] || []).filter(x => !x.admin || isAdmin);
      const m = UI.modal({
        title: `${p.ref} — تصريح ${label('ptype', p.ptype)}`,
        body: `<dl class="kv">
            <dt>المشروع</dt><dd>${esc(p.project_name)}</dd>
            <dt>الوصف</dt><dd>${esc(p.description || '—')}</dd>
            <dt>مقدم الطلب</dt><dd>${esc(p.requester || '—')}</dd>
            <dt>المسؤول</dt><dd>${esc(p.responsible || '—')}</dd>
            <dt>السريان</dt><dd>${fmtDate(p.valid_from)} ← ${fmtDate(p.valid_to)}</dd>
            <dt>متطلبات السلامة</dt><dd>${esc(p.safety_requirements || '—')}</dd>
            <dt>الحالة</dt><dd>${badge('permit_status', p.status)}</dd>
            <dt>التحقق الميداني</dt><dd>${p.field_verified ? 'تم التحقق' : 'لم يتم'}</dd>
          </dl>
          ${p.status === 'active' && !p.field_verified ? `<button class="btn secondary sm" id="prm-verify" style="margin-top:.6rem">✔ تسجيل التحقق الميداني</button>` : ''}
          <div class="btn-row" style="margin-top:.8rem;align-items:flex-end">
            <label class="fld" style="min-width:200px;margin:0"><span>الحالة المخصصة (وسم)</span>
              ${UI.tagSelect('prm_status_tag', tags, p.status_tag || '')}</label>
            <button type="button" class="btn sm secondary" id="prm-save-tag">حفظ الوسم</button>
          </div>
          <h3 style="margin-top:1rem">🛠 الإجراءات المتخذة</h3>
          <div style="font-size:.74rem;color:var(--ink-3);margin-bottom:.3rem">وثّق تنفيذ اشتراطات السلامة — إلزامي قبل إغلاق التصريح</div>
          <div id="prm-updates">${UI.spinner()}</div>`,
        footer: next.length ? next.map((x, i2) => `<button class="btn ${x.danger ? 'danger' : ''}" data-n="${i2}">${x.label}</button>`).join('') : null,
      });
      UI.renderUpdates(m.el.querySelector('#prm-updates'), 'permit', p.id, {
        locked: ['closed', 'cancelled'].includes(p.status),
      });
      next.forEach((x, i2) => {
        m.el.querySelector(`[data-n="${i2}"]`).onclick = async () => {
          try {
            await api(`/api/permits/${p.id}/transition`, { method: 'POST', body: { to: x.to } });
            toast('تم تحديث حالة التصريح');
            m.close(); App.refreshRoute();
          } catch (e) { toast(e.message, 'error'); }
        };
      });
      m.el.querySelector('#prm-save-tag').onclick = async () => {
        await api(`/api/permits/${p.id}`, { method: 'PUT', body: { status_tag: m.el.querySelector('[name="prm_status_tag"]').value } });
        toast('تم حفظ الحالة المخصصة');
        m.close(); App.refreshRoute();
      };
      const v = m.el.querySelector('#prm-verify');
      if (v) v.onclick = async () => {
        await api(`/api/permits/${p.id}`, { method: 'PUT', body: { field_verified: 1 } });
        toast('تم تسجيل التحقق الميداني');
        m.close(); App.refreshRoute();
      };
    }
  }

  window.Pages.risks = { title: 'تقييم المخاطر', render: renderRisks };
  window.Pages.incidents = {
    title: 'إدارة الحوادث والإصابات',
    render: (el, ctx) => ctx.args.length ? renderIncidentDetail(el, ctx) : renderIncidents(el, ctx),
  };
  window.Pages.actions = { title: 'الإجراءات التصحيحية والوقائية CAPA', render: renderActions };
  window.Pages.permits = { title: 'تصاريح العمل', render: renderPermits };
})();
