// لوحة المعلومات التنفيذية + صفحة مؤشرات الأداء
window.Pages = window.Pages || {};
(function () {
  const { esc, label, badge, fmtNum, fld, select, optsFromDict } = UI;

  function filterBar(params, projects, parties, observers) {
    const contractors = parties.filter(p => p.kind === 'contractor');
    return `
    <form class="filters no-print" id="dash-filters">
      ${fld('من تاريخ', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
      ${fld('إلى تاريخ', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
      ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
      ${fld('نوع المشروع', select('project_type', optsFromDict('project_type'), params.project_type))}
      ${fld('المقاول', select('contractor_id', contractors.map(p => ({ value: p.id, label: p.name })), params.contractor_id))}
      ${observers ? fld('الراصد', select('observer_id', observers.map(o => ({ value: o.id, label: o.full_name })), params.observer_id)) : ''}
      ${fld('الخطورة', select('severity', optsFromDict('severity'), params.severity))}
      ${fld('التصنيف', select('category', optsFromDict('category'), params.category))}
      ${fld('حالة المعالجة', select('status', optsFromDict('obs_status'), params.status))}
      <button class="btn sm" type="submit">تطبيق</button>
      <button class="btn sm secondary" type="button" id="dash-reset">إعادة تعيين</button>
    </form>`;
  }

  function stat(lbl, val, cls = '', suffix = '', route = '') {
    return `<div class="stat ${cls} ${route ? 'clickable' : ''}" ${route ? `data-goto="${route}"` : ''}>
      <div class="accent"></div><div class="lbl">${esc(lbl)}</div>
      <div class="val">${val}${suffix ? `<small> ${suffix}</small>` : ''}</div></div>`;
  }

  async function render(el, { params, user }) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const [d, projects, parties, insights] = await Promise.all([
      api('/api/dashboard' + (qs ? `?${qs}` : '')),
      api('/api/auth/me').then(m => m.projects),
      api('/api/parties'),
      api('/api/ai/insights'),
    ]);
    let observers = null;
    if (user.role === 'admin') {
      observers = (await api('/api/users')).filter(u => u.role === 'observer');
    }

    const o = d.observations, t = d.tours;
    el.innerHTML = `
      ${d.midday_ban?.in_season ? `
      <div class="card no-print" style="border-color:var(--warn);background:var(--warn-soft);margin-bottom:1rem;display:flex;gap:.8rem;align-items:center;flex-wrap:wrap">
        <span style="font-size:1.4rem">☀️</span>
        <div style="flex:1;min-width:240px">
          <b>حظر العمل تحت أشعة الشمس ساري حالياً</b>
          <div style="font-size:.78rem;color:var(--ink-2)">يُحظر العمل في الأماكن المكشوفة من ${d.midday_ban.hours} خلال الفترة ${d.midday_ban.period} — وفق قرار وزارة الموارد البشرية والتنمية الاجتماعية. أي مخالفة تُرصد ضمن تصنيف «الصحة المهنية».</div>
        </div>
        <a class="btn sm secondary" href="#/observations?category=health">ملاحظات الصحة المهنية</a>
      </div>` : ''}
      ${filterBar(params, projects, parties, observers)}
      <div class="grid cols-6">
        ${stat('المشاريع النشطة', fmtNum(d.projects.active), 'good', '', '#/projects')}
        ${stat('نسبة تنفيذ الجولات', t.execution_rate, t.execution_rate >= 80 ? 'good' : t.execution_rate >= 60 ? 'warn' : 'critical', '%', '#/tours')}
        ${stat('ملاحظات مفتوحة', fmtNum(o.open), o.open > 50 ? 'warn' : '', '', '#/observations?open_only=1')}
        ${stat('حرجة مفتوحة', fmtNum(o.critical_open), o.critical_open ? 'critical' : 'good', '', '#/observations?severity=critical&open_only=1')}
        ${stat('متجاوزة الاستحقاق', fmtNum(o.overdue), o.overdue ? 'critical' : 'good', '', '#/observations?escalated=1')}
        ${stat('نسبة الالتزام', d.compliance_rate, d.compliance_rate >= 85 ? 'good' : d.compliance_rate >= 70 ? 'warn' : 'critical', '%')}
      </div>
      <div class="grid cols-6" style="margin-top:1rem">
        ${stat('الحوادث المسجلة', fmtNum(d.incidents.total), d.incidents.total ? 'warn' : 'good', '', '#/incidents')}
        ${stat('شبه الحادثة', fmtNum(d.incidents.near_miss), 'info', '', '#/incidents')}
        ${stat('إجراءات مفتوحة', fmtNum(d.actions.open), '', '', '#/actions')}
        ${stat('إجراءات متأخرة', fmtNum(d.actions.overdue), d.actions.overdue ? 'critical' : 'good', '', '#/actions?overdue=1')}
        ${stat('إغلاق ضمن المدة', o.on_time_closure_rate, o.on_time_closure_rate >= 80 ? 'good' : 'warn', '%')}
        ${stat('متوسط زمن المعالجة', o.avg_closure_days, '', 'يوم')}
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>اتجاه الملاحظات الأسبوعي</h3>
          <div class="sub">آخر 12 أسبوعاً — المسجلة مقابل المغلقة</div>
          <div class="chart-box"><canvas id="ch-trend"></canvas></div>
        </div>
        <div class="card">
          <h3>الملاحظات حسب درجة الخطورة</h3>
          <div class="sub">التوزيع خلال الفترة المحددة</div>
          <div class="chart-box"><canvas id="ch-sev"></canvas></div>
        </div>
      </div>
      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>أعلى تصنيفات الملاحظات</h3>
          <div class="sub">حسب عدد الملاحظات المسجلة</div>
          <div class="chart-box tall"><canvas id="ch-cat"></canvas></div>
        </div>
        <div class="card">
          <h3>الحوادث حسب النوع</h3>
          <div class="sub">جميع الحوادث المسجلة في الفترة</div>
          <div class="chart-box tall"><canvas id="ch-inc"></canvas></div>
        </div>
      </div>

      <div class="grid cols-2" style="margin-top:1rem">
        <div class="card">
          <h3>مؤشر السلامة العام للمشاريع</h3>
          <div class="sub">المشاريع الأعلى والأقل التزاماً (التزام التفتيش + إغلاق الملاحظات − الحوادث)</div>
          <div id="proj-perf"></div>
        </div>
        <div class="card">
          <h3>المؤشرات الاستباقية واللاحقة</h3>
          <div class="sub">Leading & Lagging Indicators</div>
          <div class="grid cols-2">
            <div>
              <div class="nav-group" style="margin:0 0 .5rem">استباقية Leading</div>
              <dl class="kv">
                <dt>جولات منفذة</dt><dd>${fmtNum(d.leading.tours_completed)}</dd>
                <dt>بلاغات شبه حادثة</dt><dd>${fmtNum(d.leading.near_miss_reported)}</dd>
                <dt>نسبة الالتزام</dt><dd>${d.leading.compliance_rate}%</dd>
                <dt>تصاريح سارية</dt><dd>${fmtNum(d.leading.active_permits)}</dd>
              </dl>
            </div>
            <div>
              <div class="nav-group" style="margin:0 0 .5rem">لاحقة Lagging</div>
              <dl class="kv">
                <dt>إجمالي الحوادث</dt><dd>${fmtNum(d.lagging.incidents_total)}</dd>
                <dt>الإصابات</dt><dd>${fmtNum(d.lagging.injuries)}</dd>
                <dt>ساعات مفقودة</dt><dd>${fmtNum(d.lagging.lost_hours)}</dd>
                <dt>TRIR</dt><dd>${d.lagging.trir}</dd>
                <dt>LTIFR</dt><dd>${d.lagging.ltifr}</dd>
              </dl>
            </div>
          </div>
          <h3 style="margin-top:1.2rem">أداء المقاولين</h3>
          <div id="contractor-perf"></div>
        </div>
      </div>

      <div class="card" style="margin-top:1rem">
        <h3>💡 التحليل الذكي والتوصيات</h3>
        <div class="sub">استنتاجات آلية من بيانات الفترة — القرار النهائي للمختص</div>
        <div id="insights"></div>
      </div>`;

    // الفلاتر
    const form = el.querySelector('#dash-filters');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d2 = UI.formData(form);
      const q = new URLSearchParams(Object.entries(d2).filter(([, v]) => v)).toString();
      location.hash = '#/dashboard' + (q ? `?${q}` : '');
    });
    el.querySelector('#dash-reset').onclick = () => { location.hash = '#/dashboard'; };
    el.querySelectorAll('[data-goto]').forEach(s => s.addEventListener('click', () => { location.hash = s.dataset.goto; }));

    // الرسوم — ألوان الخطورة الثابتة (حالة، ليست سلاسل)
    const sevColors = Charts.SEV_COLOR();
    const sevOrder = ['low', 'medium', 'high', 'critical'];
    const sevData = sevOrder.map(s => (d.by_severity.find(x => x.severity === s) || {}).c || 0);
    Charts.doughnut('ch-sev', sevOrder.map(s => label('severity', s)), sevData, sevOrder.map(s => sevColors[s]));

    const wk = d.weekly_trend;
    Charts.line('ch-trend', wk.map(w => w.wk.split('-')[1]),
      [{ label: 'المسجلة', data: wk.map(w => w.created) },
       { label: 'المغلقة', data: wk.map(w => w.closed) }]);

    Charts.hbar('ch-cat', d.by_category.map(c => label('category', c.category)), d.by_category.map(c => c.c));

    const inc = d.incidents.by_type;
    Charts.bar('ch-inc', inc.map(i => label('itype', i.itype)), [{ label: 'العدد', data: inc.map(i => i.c) }]);

    // جدول أداء المشاريع
    const pp = d.project_performance;
    el.querySelector('#proj-perf').innerHTML = UI.dataTable({
      columns: [
        { title: 'المشروع', key: 'name', render: r => `<a href="#/projects/${r.id}">${esc(r.name)}</a>` },
        { title: 'الالتزام', render: r => `${r.compliance}%` },
        { title: 'ملاحظات مفتوحة', key: 'obs_open' },
        { title: 'حوادث', key: 'incidents' },
        { title: 'مؤشر السلامة', render: r => `
          <div style="display:flex;align-items:center;gap:.5rem">
            <div class="progressbar" style="flex:1"><div style="width:${r.safety_index}%;background:${r.safety_index >= 75 ? 'var(--good)' : r.safety_index >= 50 ? 'var(--warn)' : 'var(--critical)'}"></div></div>
            <b>${r.safety_index}</b></div>` },
      ],
      rows: pp,
    });

    el.querySelector('#contractor-perf').innerHTML = UI.dataTable({
      columns: [
        { title: 'المقاول / الاستشاري', key: 'name' },
        { title: 'متوسط التقييم', render: r => `
          <div style="display:flex;align-items:center;gap:.5rem">
            <div class="progressbar" style="flex:1"><div style="width:${r.avg_score}%"></div></div>
            <b>${r.avg_score ?? '—'}</b></div>` },
      ],
      rows: d.contractor_performance,
    });

    // التحليل الذكي
    const kindBadge = { repeat: 'b-high', predict: 'b-critical', anomaly: 'b-medium', summary: 'b-brand' };
    el.querySelector('#insights').innerHTML = insights.map(i => `
      <div style="display:flex;gap:.7rem;padding:.6rem 0;border-bottom:1px solid var(--grid)">
        <span class="badge ${kindBadge[i.kind] || 'b-neutral'}" style="align-self:flex-start;flex-shrink:0">${esc(i.title)}</span>
        <div style="font-size:.86rem;color:var(--ink-2)">${esc(i.body)}</div>
      </div>`).join('') || '<div class="empty-state">لا توجد استنتاجات حالياً</div>';
  }

  // ===== صفحة مؤشرات الأداء =====
  async function renderKpis(el, { params }) {
    const projects = (await api('/api/auth/me')).projects;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    const kpis = await api('/api/kpis' + (qs ? `?${qs}` : ''));
    const stCls = { good: 'b-good', warning: 'b-medium', critical: 'b-critical' };
    el.innerHTML = `
      <form class="filters no-print" id="kpi-filters">
        ${fld('من تاريخ', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى تاريخ', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        <button class="btn sm" type="submit">تطبيق</button>
        <button class="btn sm secondary no-print" type="button" onclick="window.print()">🖨 طباعة</button>
      </form>
      <div class="print-header"><div class="o">تقرير مؤشرات الأداء — منصة السلامة</div><div class="m">${UI.dualDate()}</div></div>
      <div class="grid cols-3">
        ${kpis.map(k => `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem">
            <h3 style="font-size:.9rem;margin:0">${esc(k.name)}</h3>
            <span class="badge ${stCls[k.status]}">${label('kpi_status', k.status)}</span>
          </div>
          <div style="font-size:2rem;font-weight:800;margin:.5rem 0 .2rem">${k.value}<small style="font-size:.9rem;color:var(--ink-3)"> ${esc(k.unit)}</small></div>
          <div style="font-size:.74rem;color:var(--ink-3)">المستهدف: ${k.value !== undefined ? (k.direction === 'higher' ? '≥' : '≤') : ''} ${k.target} ${esc(k.unit)}</div>
          <div class="progressbar" style="margin:.6rem 0">
            <div style="width:${Math.min(100, k.direction === 'higher' ? (k.value / k.target) * 100 : (k.target / Math.max(k.value, 0.01)) * 100)}%;background:var(--${k.status === 'good' ? 'good' : k.status === 'warning' ? 'warn' : 'critical'})"></div>
          </div>
          <dl class="kv" style="font-size:.76rem">
            <dt>المعادلة</dt><dd style="font-weight:400">${esc(k.formula)}</dd>
            <dt>المصدر</dt><dd style="font-weight:400">${esc(k.source)}</dd>
            <dt>الدورية</dt><dd style="font-weight:400">${esc(k.frequency)}</dd>
          </dl>
        </div>`).join('')}
      </div>`;
    const form = el.querySelector('#kpi-filters');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(form);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/kpis' + (q ? `?${q}` : '');
    });
  }

  window.Pages.dashboard = { title: 'لوحة المعلومات التنفيذية', render };
  window.Pages.kpis = { title: 'مؤشرات الأداء الرئيسية', render: renderKpis };
})();
