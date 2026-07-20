// مركز التقارير — قابلة للطباعة (PDF عبر المتصفح) والتصدير CSV/Excel
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fld, select, fmtDate, fmtDateTime, fmtNum } = UI;

  const REPORTS = [
    { key: 'executive', title: 'تقرير السلامة التنفيذي', desc: 'ملخص شامل للمؤشرات والاتجاهات والمشاريع' },
    { key: 'observations', title: 'تقرير الملاحظات والمخالفات', desc: 'سجل تفصيلي بجميع الملاحظات حسب الفلاتر' },
    { key: 'overdue', title: 'تقرير الملاحظات المتأخرة', desc: 'الملاحظات المتجاوزة لتاريخ الاستحقاق مع أيام التأخير' },
    { key: 'incidents', title: 'تقرير الحوادث', desc: 'سجل الحوادث والإصابات والحالات شبه الحادثة' },
    { key: 'risks', title: 'تقرير المخاطر', desc: 'سجل المخاطر مع درجاتها قبل وبعد المعالجة' },
    { key: 'actions', title: 'تقرير الإجراءات التصحيحية', desc: 'حالة إجراءات CAPA ونسب الإنجاز' },
    { key: 'tours', title: 'تقرير الجولات', desc: 'الجولات المخططة والمنفذة والفائتة' },
    { key: 'tour_detail', title: 'تقرير جولة تفصيلي', desc: 'تقرير جولة واحدة بالنتائج والملاحظات والإحداثيات' },
  ];

  async function render(el, { params }) {
    const projects = (await api('/api/auth/me')).projects;
    if (params.type) return renderReport(el, params, projects);
    el.innerHTML = `
      <div class="grid cols-4">
        ${REPORTS.map(r => `
        <div class="card" style="cursor:pointer" data-r="${r.key}">
          <h3 style="font-size:.9rem">📄 ${esc(r.title)}</h3>
          <div style="font-size:.76rem;color:var(--ink-2)">${esc(r.desc)}</div>
        </div>`).join('')}
      </div>
      <div class="card" style="margin-top:1rem">
        <h3>التصدير المباشر إلى Excel/CSV</h3>
        <div class="btn-row">
          ${['observations|الملاحظات', 'incidents|الحوادث', 'actions|الإجراءات', 'tours|الجولات', 'projects|المشاريع', 'risks|المخاطر']
            .map(x => { const [k, t] = x.split('|'); return `<a class="btn secondary sm" href="/api/export/${k}" download>⬇ ${t}</a>`; }).join('')}
        </div>
      </div>`;
    el.querySelectorAll('[data-r]').forEach(c => c.addEventListener('click', () => {
      location.hash = `#/reports?type=${c.dataset.r}`;
    }));
  }

  function reportShell(title, meta, filtersHtml, bodyHtml) {
    return `
      <div class="btn-row no-print" style="margin-bottom:1rem">
        <a class="btn secondary sm" href="#/reports">→ جميع التقارير</a>
        <button class="btn sm" onclick="window.print()">🖨 طباعة / حفظ PDF</button>
      </div>
      ${filtersHtml || ''}
      <div class="card">
        <div class="print-header" style="display:flex">
          <svg width="40" height="40" viewBox="0 0 100 100"><path d="M50 5 L90 20 V48 C90 70 73 88 50 95 C27 88 10 70 10 48 V20 Z" fill="#0e7a43"/><path d="M32 50 L45 63 L70 36" stroke="white" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div><div class="o">${esc(title)}</div>
          <div style="font-size:.72rem;color:var(--ink-2)">${esc(meta.org || '')}</div></div>
          <div class="m">أُنشئ بواسطة: ${esc(meta.generated_by || '')}<br>${fmtDateTime(meta.generated_at)}<br>${UI.fmtHijri(meta.generated_at)}</div>
        </div>
        ${bodyHtml}
      </div>`;
  }

  function commonFilters(params, projects, extra = '') {
    return `<form class="filters no-print" id="rep-filters">
      <input type="hidden" name="type" value="${esc(params.type)}">
      ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
      ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
      ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
      ${extra}
      <button class="btn sm" type="submit">تطبيق</button>
    </form>`;
  }
  function bindFilters(el) {
    const f = el.querySelector('#rep-filters');
    if (f) f.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(f);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/reports' + (q ? `?${q}` : '');
    });
  }

  async function renderReport(el, params, projects) {
    const type = params.type;
    const qs = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== 'type')).toString();

    if (type === 'executive') {
      const [d, kpis] = await Promise.all([
        api('/api/dashboard' + (qs ? `?${qs}` : '')),
        api('/api/kpis' + (qs ? `?${qs}` : '')),
      ]);
      const meta = { org: 'وكالة البنية التحتية — إدارة الأمن والسلامة والصحة المهنية', generated_at: new Date().toISOString(), generated_by: App.user().full_name };
      el.innerHTML = reportShell('تقرير السلامة التنفيذي', meta, commonFilters(params, projects), `
        <div class="grid cols-4" style="margin-bottom:1rem">
          <div class="stat"><div class="accent"></div><div class="lbl">المشاريع النشطة</div><div class="val">${d.projects.active}</div></div>
          <div class="stat"><div class="accent"></div><div class="lbl">نسبة تنفيذ الجولات</div><div class="val">${d.tours.execution_rate}%</div></div>
          <div class="stat"><div class="accent"></div><div class="lbl">نسبة الالتزام</div><div class="val">${d.compliance_rate}%</div></div>
          <div class="stat"><div class="accent"></div><div class="lbl">إغلاق ضمن المدة</div><div class="val">${d.observations.on_time_closure_rate}%</div></div>
        </div>
        <div class="grid cols-2" style="margin-bottom:1rem">
          <div><h3>الملاحظات</h3>
            <dl class="kv">
              <dt>الإجمالي</dt><dd>${fmtNum(d.observations.total)}</dd>
              <dt>المفتوحة</dt><dd>${fmtNum(d.observations.open)}</dd>
              <dt>الحرجة المفتوحة</dt><dd>${fmtNum(d.observations.critical_open)}</dd>
              <dt>المتجاوزة للاستحقاق</dt><dd>${fmtNum(d.observations.overdue)}</dd>
              <dt>متوسط زمن المعالجة</dt><dd>${d.observations.avg_closure_days} يوم</dd>
            </dl></div>
          <div><h3>الحوادث والمؤشرات اللاحقة</h3>
            <dl class="kv">
              <dt>إجمالي الحوادث</dt><dd>${fmtNum(d.incidents.total)}</dd>
              <dt>الإصابات</dt><dd>${fmtNum(d.lagging.injuries)}</dd>
              <dt>شبه الحادثة</dt><dd>${fmtNum(d.incidents.near_miss)}</dd>
              <dt>TRIR</dt><dd>${d.lagging.trir}</dd>
              <dt>LTIFR</dt><dd>${d.lagging.ltifr}</dd>
            </dl></div>
        </div>
        <h3>مؤشر السلامة العام للمشاريع</h3>
        ${UI.dataTable({
          columns: [
            { title: 'المشروع', key: 'name' },
            { title: 'الالتزام %', key: 'compliance' },
            { title: 'ملاحظات مفتوحة', key: 'obs_open' },
            { title: 'حرجة', key: 'critical_open' },
            { title: 'حوادث', key: 'incidents' },
            { title: 'مؤشر السلامة', render: r => `<b>${r.safety_index}</b>/100` },
          ], rows: d.project_performance,
        })}
        <h3 style="margin-top:1rem">بطاقات المؤشرات</h3>
        ${UI.dataTable({
          columns: [
            { title: 'المؤشر', key: 'name' },
            { title: 'النتيجة', render: r => `${r.value} ${esc(r.unit)}` },
            { title: 'المستهدف', render: r => `${r.direction === 'higher' ? '≥' : '≤'} ${r.target}` },
            { title: 'الأداء', render: r => badge('kpi_status', r.status, r.status === 'good' ? 'b-good' : r.status === 'warning' ? 'b-medium' : 'b-critical') },
          ], rows: kpis,
        })}`);
      bindFilters(el);
      return;
    }

    if (type === 'tour_detail') {
      if (!params.tour_id) {
        const tours = await api('/api/tours?status=completed');
        el.innerHTML = `
          <div class="btn-row no-print" style="margin-bottom:1rem"><a class="btn secondary sm" href="#/reports">→ جميع التقارير</a></div>
          <div class="card"><h3>اختر جولة منفذة</h3><div id="pick"></div></div>`;
        const pick = el.querySelector('#pick');
        pick.innerHTML = UI.dataTable({
          columns: [
            { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
            { title: 'الراصد', key: 'observer_name' }, { title: 'التاريخ', render: r => fmtDate(r.planned_date) },
          ],
          rows: tours,
        });
        UI.bindRows(pick, tours, r => { location.hash = `#/reports?type=tour_detail&tour_id=${r.id}`; });
        return;
      }
      const { meta, tour: t } = await api(`/api/reports/tour_detail?tour_id=${params.tour_id}`);
      const atts = {};
      for (const o of t.observations) {
        atts[o.id] = await api(`/api/attachments?entity_type=observation&entity_id=${o.id}`);
      }
      el.innerHTML = reportShell(`تقرير جولة تفتيش — ${t.ref}`, meta, '', `
        <dl class="kv" style="margin-bottom:1rem">
          <dt>المشروع</dt><dd>${esc(t.project_name)} (${esc(t.project_code)})</dd>
          <dt>الراصد</dt><dd>${esc(t.observer_name)}</dd>
          <dt>الموقع</dt><dd>${esc(t.site || '—')}</dd>
          <dt>نموذج التفتيش</dt><dd>${esc(t.template_name || '—')}</dd>
          <dt>البداية</dt><dd>${fmtDateTime(t.started_at)}</dd>
          <dt>النهاية</dt><dd>${fmtDateTime(t.ended_at)}</dd>
          <dt>إحداثيات الحضور</dt><dd dir="ltr">${t.start_lat ? `${t.start_lat.toFixed(5)}, ${t.start_lng.toFixed(5)}` : '—'}</dd>
          <dt>التحقق الجغرافي</dt><dd>${t.geofence_ok == null ? '—' : t.geofence_ok ? 'داخل النطاق ✔' : 'خارج النطاق — ' + esc(t.geofence_note || '')}</dd>
        </dl>
        <h3>نتائج قائمة التفتيش (${t.results.length} بند)</h3>
        ${UI.dataTable({
          columns: [
            { title: '#', render: (r, i) => i + 1 },
            { title: 'البند', key: 'text' },
            { title: 'النتيجة', render: r => badge('result', r.result, r.result === 'pass' ? 'b-good' : r.result === 'fail' ? 'b-critical' : r.result === 'followup' ? 'b-medium' : 'b-neutral') },
            { title: 'ملاحظة', key: 'note' },
          ], rows: t.results,
        })}
        <h3 style="margin-top:1rem">الملاحظات المسجلة (${t.observations.length})</h3>
        ${t.observations.map(o => `
          <div style="border:1px solid var(--hairline);border-radius:10px;padding:.9rem;margin-bottom:.8rem;break-inside:avoid">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:.4rem">
              <b>${esc(o.ref)}</b>
              <span>${badge('severity', o.severity)} ${badge('obs_status', o.status)}</span>
            </div>
            <p style="font-size:.86rem;margin:.4rem 0">${esc(o.description)}</p>
            <div style="font-size:.74rem;color:var(--ink-3)" dir="ltr">${o.lat ? `${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}` : ''}</div>
            ${UI.attachmentGrid(atts[o.id])}
          </div>`).join('') || '<div class="empty-state">لا توجد ملاحظات</div>'}
        <div style="display:flex;justify-content:space-between;margin-top:2.5rem;padding-top:1rem;border-top:1px dashed var(--hairline)">
          <div style="text-align:center">توقيع الراصد<br><br>______________<br>${esc(t.observer_name)}</div>
          <div style="text-align:center">اعتماد مدير النظام<br><br>______________</div>
        </div>`);
      return;
    }

    // التقارير الجدولية العامة
    const defs = {
      observations: {
        title: 'تقرير الملاحظات والمخالفات',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'النوع', render: r => label('otype', r.otype) },
          { title: 'الوصف', render: r => esc(r.description).slice(0, 60) },
          { title: 'الخطورة', render: r => badge('severity', r.severity) },
          { title: 'الحالة', render: r => badge('obs_status', r.status) },
          { title: 'الراصد', key: 'observer_name' },
          { title: 'التسجيل', render: r => fmtDate(r.created_at) },
          { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
        ],
      },
      overdue: {
        title: 'تقرير الملاحظات المتأخرة',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'الوصف', render: r => esc(r.description).slice(0, 60) },
          { title: 'الخطورة', render: r => badge('severity', r.severity) },
          { title: 'الحالة', render: r => badge('obs_status', r.status) },
          { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
          { title: 'أيام التأخير', render: r => `<b style="color:var(--critical)">${r.days_overdue}</b>` },
        ],
      },
      incidents: {
        title: 'تقرير الحوادث',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'النوع', render: r => label('itype', r.itype) },
          { title: 'التاريخ', render: r => fmtDateTime(r.occurred_at) },
          { title: 'الوصف', render: r => esc(r.description).slice(0, 60) },
          { title: 'ساعات مفقودة', key: 'lost_hours' },
          { title: 'الحالة', render: r => badge('incident_status', r.status) },
        ],
      },
      risks: {
        title: 'تقرير المخاطر',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'الخطر', render: r => esc(r.description).slice(0, 60) },
          { title: 'الدرجة', render: r => `${r.likelihood}×${r.impact} = <b>${r.score}</b>` },
          { title: 'المتبقية', render: r => r.residual_score ?? '—' },
          { title: 'الحالة', render: r => badge('risk_status', r.status) },
        ],
      },
      actions: {
        title: 'تقرير الإجراءات التصحيحية',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'الوصف', render: r => esc(r.description).slice(0, 60) },
          { title: 'المسؤول', key: 'assignee' },
          { title: 'الاستحقاق', render: r => fmtDate(r.due_date) },
          { title: 'الإنجاز %', key: 'progress' },
          { title: 'الحالة', render: r => badge('action_status', r.status) },
        ],
      },
      tours: {
        title: 'تقرير الجولات',
        columns: [
          { title: 'المرجع', key: 'ref' }, { title: 'المشروع', key: 'project_name' },
          { title: 'الراصد', key: 'observer_name' },
          { title: 'الموعد', render: r => fmtDate(r.planned_date) },
          { title: 'الملاحظات', key: 'obs_count' },
          { title: 'الحالة', render: r => badge('tour_status', r.status) },
        ],
      },
    };
    const def = defs[type];
    if (!def) { el.innerHTML = '<div class="empty-state">تقرير غير معروف</div>'; return; }
    const { meta, rows } = await api(`/api/reports/${type}` + (qs ? `?${qs}` : ''));
    el.innerHTML = reportShell(def.title, meta, commonFilters(params, projects), `
      <div style="font-size:.78rem;color:var(--ink-2);margin-bottom:.6rem">عدد السجلات: <b>${rows.length}</b></div>
      ${UI.dataTable({ columns: def.columns, rows })}`);
    bindFilters(el);
  }

  window.Pages.reports = { title: 'مركز التقارير', render };
})();
