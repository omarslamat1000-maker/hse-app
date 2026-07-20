// الخريطة التفاعلية والتحليل المكاني — بفلاتر حية مرتبطة بالطبقات
window.Pages = window.Pages || {};
(function () {
  const { esc, label, fld, select, optsFromDict } = UI;
  let map = null;

  const SEV_HEX = { low: '#0ca30c', medium: '#eda100', high: '#eb6834', critical: '#d03b3b' };

  // أنماط الخريطة الأساسية
  const BASEMAPS = {
    osm: {
      name: '🗺 قياسي',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap',
    },
    light: {
      name: '☀️ فاتح',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '© OpenStreetMap © CARTO',
    },
    dark: {
      name: '🌙 داكن',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '© OpenStreetMap © CARTO',
    },
    satellite: {
      name: '🛰 قمر صناعي',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '© Esri — Maxar, Earthstar Geographics',
      labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
    },
  };
  function defaultBasemap() {
    const saved = localStorage.getItem('hse_basemap');
    if (saved && BASEMAPS[saved]) return saved;
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'osm';
  }

  async function render(el, { params }) {
    const projects = (await api('/api/auth/me')).projects;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    let data;
    try {
      data = await api('/api/map' + (qs ? `?${qs}` : ''));
    } catch (e) {
      el.innerHTML = `<div class="empty-state">تعذر تحميل بيانات الخريطة: ${esc(e.message)}</div>`;
      return;
    }

    // حالة الفلاتر الحية (client-side — تحدّث الطبقات فوراً)
    const live = {
      layers: { projects: true, geofence: true, observations: true, incidents: true, hotspots: true },
      severities: new Set(['low', 'medium', 'high', 'critical']),
      status: 'all',       // all | open | closed
      category: '',
      itype: '',
    };

    el.innerHTML = `
      <form class="filters" id="map-filters">
        ${fld('المشروع', select('project_id', projects.map(p => ({ value: p.id, label: p.name })), params.project_id))}
        ${fld('من', `<input type="date" name="from" value="${esc(params.from || '')}">`)}
        ${fld('إلى', `<input type="date" name="to" value="${esc(params.to || '')}">`)}
      </form>

      <div class="card" style="margin-bottom:1rem">
        <h3>🎛 فلاتر الخريطة التفاعلية</h3>
        <div class="sub">تُطبق فوراً على العلامات — انقر لتفعيل أو إخفاء</div>
        <div style="display:flex;flex-wrap:wrap;gap:1.4rem;align-items:flex-end">
          <div>
            <div class="nav-group" style="margin:0 0 .35rem">نمط الخريطة</div>
            <div class="btn-row" id="basemap-chips">
              ${Object.entries(BASEMAPS).map(([k, b]) =>
                `<button type="button" class="chip" data-basemap="${k}">${b.name}</button>`).join('')}
            </div>
          </div>
          <div>
            <div class="nav-group" style="margin:0 0 .35rem">الطبقات</div>
            <div class="btn-row" id="layer-chips">
              <button type="button" class="chip on" data-layer="projects">🏗 المشاريع <span class="cnt"></span></button>
              <button type="button" class="chip on" data-layer="geofence">⭕ النطاقات الجغرافية</button>
              <button type="button" class="chip on" data-layer="observations">⚠ الملاحظات <span class="cnt"></span></button>
              <button type="button" class="chip on" data-layer="incidents">◆ الحوادث <span class="cnt"></span></button>
              <button type="button" class="chip on" data-layer="hotspots">🔥 المناطق الساخنة <span class="cnt"></span></button>
            </div>
          </div>
          <div>
            <div class="nav-group" style="margin:0 0 .35rem">درجة الخطورة</div>
            <div class="btn-row" id="sev-chips">
              ${['critical', 'high', 'medium', 'low'].map(s => `
                <button type="button" class="chip on" data-sev="${s}">
                  <span class="sw" style="background:${SEV_HEX[s]}"></span>${label('severity', s)} <span class="cnt"></span>
                </button>`).join('')}
            </div>
          </div>
          <label class="fld" style="min-width:150px;margin:0"><span>حالة الملاحظة</span>
            <select id="f-status">
              <option value="all">الكل</option>
              <option value="open">المفتوحة فقط</option>
              <option value="closed">المغلقة فقط</option>
            </select></label>
          <label class="fld" style="min-width:170px;margin:0"><span>التصنيف</span>
            ${select('f_category', optsFromDict('category'), '')}</label>
          <label class="fld" style="min-width:150px;margin:0"><span>نوع الحادث</span>
            ${select('f_itype', optsFromDict('itype'), '')}</label>
          <button type="button" class="btn sm secondary" id="f-reset">إعادة تعيين</button>
        </div>
      </div>

      <div class="card">
        <div id="map-container" class="map-el"></div>
        <div class="legend-row">
          <span class="li"><span class="sw" style="background:#0e7a43"></span> مشروع</span>
          ${['low', 'medium', 'high', 'critical'].map(s => `<span class="li"><span class="sw" style="background:${SEV_HEX[s]};border-radius:50%"></span> ${label('severity', s)}</span>`).join('')}
          <span class="li" style="color:#d03b3b">◆ حادث</span>
          <span class="li" style="color:var(--ink-3)">الدائرة المتقطعة = منطقة ساخنة (كثافة ملاحظات مفتوحة)</span>
        </div>
      </div>
      <div class="grid cols-3" style="margin-top:1rem">
        <div class="stat"><div class="accent"></div><div class="lbl">مشاريع ظاهرة</div><div class="val" id="st-proj">0</div></div>
        <div class="stat warn"><div class="accent"></div><div class="lbl">ملاحظات ظاهرة</div><div class="val" id="st-obs">0</div></div>
        <div class="stat critical"><div class="accent"></div><div class="lbl">حوادث ظاهرة</div><div class="val" id="st-inc">0</div></div>
      </div>`;

    // ===== إنشاء الخريطة والطبقات =====
    if (map) { map.remove(); map = null; }
    const center = data.projects.length
      ? [data.projects.reduce((s, p) => s + p.lat, 0) / data.projects.length,
         data.projects.reduce((s, p) => s + p.lng, 0) / data.projects.length]
      : [24.7136, 46.6753];
    map = L.map('map-container', { zoomControl: true }).setView(center, 11);

    // طبقة الأساس القابلة للتبديل (تُحفظ في localStorage)
    let baseLayer = null, labelsLayer = null;
    function setBasemap(key) {
      const def = BASEMAPS[key] || BASEMAPS.osm;
      if (baseLayer) map.removeLayer(baseLayer);
      if (labelsLayer) { map.removeLayer(labelsLayer); labelsLayer = null; }
      baseLayer = L.tileLayer(def.url, { maxZoom: 19, attribution: def.attribution }).addTo(map);
      baseLayer.setZIndex(0);
      if (def.labels) {
        labelsLayer = L.tileLayer(def.labels, { maxZoom: 19 }).addTo(map);
        labelsLayer.setZIndex(1);
      }
      localStorage.setItem('hse_basemap', key);
      el.querySelectorAll('#basemap-chips .chip').forEach(c =>
        c.classList.toggle('on', c.dataset.basemap === key));
    }
    setBasemap(defaultBasemap());
    el.querySelectorAll('#basemap-chips .chip').forEach(chip =>
      chip.addEventListener('click', () => setBasemap(chip.dataset.basemap)));

    const G = {
      projects: L.layerGroup().addTo(map),
      geofence: L.layerGroup().addTo(map),
      observations: L.layerGroup().addTo(map),
      incidents: L.layerGroup().addTo(map),
      hotspots: L.layerGroup().addTo(map),
    };

    function filteredObservations() {
      return data.observations.filter(o => {
        if (!live.severities.has(o.severity)) return false;
        if (live.status === 'open' && ['closed', 'rejected'].includes(o.status)) return false;
        if (live.status === 'closed' && o.status !== 'closed') return false;
        if (live.category && o.category !== live.category) return false;
        return true;
      });
    }
    function filteredIncidents() {
      return data.incidents.filter(i => !live.itype || i.itype === live.itype);
    }

    // ===== إعادة رسم الطبقات حسب الفلاتر الحية =====
    function redraw() {
      Object.values(G).forEach(g => g.clearLayers());

      let projCount = 0;
      if (live.layers.projects) {
        for (const p of data.projects) {
          projCount++;
          const icon = L.divIcon({
            className: '',
            html: `<div style="background:#0e7a43;color:#fff;border-radius:8px;padding:3px 8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)">${esc(p.code)}</div>`,
            iconAnchor: [24, 12],
          });
          L.marker([p.lat, p.lng], { icon }).addTo(G.projects)
            .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.code)} — ${label('severity', p.risk_level)}<br>
              <a href="#/projects/${p.id}">فتح بطاقة المشروع</a>`);
        }
      }
      if (live.layers.geofence) {
        for (const p of data.projects)
          L.circle([p.lat, p.lng], { radius: p.geofence_radius || 500, color: '#0e7a43', weight: 1, fillOpacity: .05 }).addTo(G.geofence);
      }

      const obs = live.layers.observations ? filteredObservations() : [];
      for (const o of obs) {
        L.circleMarker([o.lat, o.lng], {
          radius: o.severity === 'critical' ? 8 : 6,
          color: '#fff', weight: 1.5,
          fillColor: SEV_HEX[o.severity] || '#888', fillOpacity: .92,
        }).addTo(G.observations).bindPopup(`<b>${esc(o.ref)}</b> — ${label('severity', o.severity)} — ${label('obs_status', o.status)}<br>
          ${label('category', o.category)}<br>${esc(o.description).slice(0, 90)}<br>
          <a href="#/observations/${o.id}">فتح الملاحظة</a>`);
      }

      const incs = live.layers.incidents ? filteredIncidents() : [];
      for (const i of incs) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="color:#d03b3b;font-size:19px;text-shadow:0 1px 3px rgba(0,0,0,.4)">◆</div>`,
          iconAnchor: [8, 10],
        });
        L.marker([i.lat, i.lng], { icon }).addTo(G.incidents)
          .bindPopup(`<b>${esc(i.ref)}</b> — ${label('itype', i.itype)}<br>${esc(i.description).slice(0, 90)}<br>
            <a href="#/incidents/${i.id}">فتح الحادث</a>`);
      }

      // المناطق الساخنة: تُحسب من الملاحظات المفلترة المفتوحة
      let hotCount = 0;
      if (live.layers.hotspots) {
        const cells = {};
        for (const o of obs) {
          if (['closed', 'rejected'].includes(o.status)) continue;
          const key = `${o.lat.toFixed(2)}:${o.lng.toFixed(2)}`;
          (cells[key] = cells[key] || { lat: 0, lng: 0, n: 0, crit: 0 });
          cells[key].lat += o.lat; cells[key].lng += o.lng; cells[key].n++;
          if (['high', 'critical'].includes(o.severity)) cells[key].crit++;
        }
        for (const c of Object.values(cells)) {
          if (c.n < 4) continue;
          hotCount++;
          L.circle([c.lat / c.n, c.lng / c.n], {
            radius: 250 + c.n * 40,
            color: c.crit >= 3 ? '#d03b3b' : '#eb6834',
            dashArray: '6 6', weight: 2, fillOpacity: .07,
          }).addTo(G.hotspots).bindPopup(`<b>منطقة ساخنة</b><br>${c.n} ملاحظة مفتوحة منها ${c.crit} مرتفعة/حرجة`);
        }
      }

      // العدادات الحية
      el.querySelector('#st-proj').textContent = projCount;
      el.querySelector('#st-obs').textContent = obs.length;
      el.querySelector('#st-inc').textContent = incs.length;
      el.querySelector('[data-layer="projects"] .cnt').textContent = `(${data.projects.length})`;
      el.querySelector('[data-layer="observations"] .cnt').textContent = `(${obs.length})`;
      el.querySelector('[data-layer="incidents"] .cnt').textContent = `(${incs.length})`;
      el.querySelector('[data-layer="hotspots"] .cnt').textContent = hotCount ? `(${hotCount})` : '';
      for (const s of ['low', 'medium', 'high', 'critical']) {
        const n = data.observations.filter(o => o.severity === s).length;
        el.querySelector(`[data-sev="${s}"] .cnt`).textContent = `(${n})`;
      }
    }

    // ===== ربط الفلاتر الحية =====
    el.querySelectorAll('#layer-chips .chip').forEach(chip => chip.addEventListener('click', () => {
      const k = chip.dataset.layer;
      live.layers[k] = !live.layers[k];
      chip.classList.toggle('on', live.layers[k]);
      redraw();
    }));
    el.querySelectorAll('#sev-chips .chip').forEach(chip => chip.addEventListener('click', () => {
      const s = chip.dataset.sev;
      if (live.severities.has(s)) live.severities.delete(s); else live.severities.add(s);
      chip.classList.toggle('on', live.severities.has(s));
      redraw();
    }));
    el.querySelector('#f-status').addEventListener('change', e => { live.status = e.target.value; redraw(); });
    el.querySelector('[name="f_category"]').addEventListener('change', e => { live.category = e.target.value; redraw(); });
    el.querySelector('[name="f_itype"]').addEventListener('change', e => { live.itype = e.target.value; redraw(); });
    el.querySelector('#f-reset').addEventListener('click', () => {
      live.layers = { projects: true, geofence: true, observations: true, incidents: true, hotspots: true };
      live.severities = new Set(['low', 'medium', 'high', 'critical']);
      live.status = 'all'; live.category = ''; live.itype = '';
      el.querySelectorAll('.chip').forEach(c => c.classList.add('on'));
      el.querySelector('#f-status').value = 'all';
      el.querySelector('[name="f_category"]').value = '';
      el.querySelector('[name="f_itype"]').value = '';
      redraw();
    });

    // فلاتر الخادم (المشروع/الفترة) — تعيد التحميل عبر الرابط
    el.querySelector('#map-filters').addEventListener('submit', e => {
      e.preventDefault();
      const d = UI.formData(e.target);
      const q = new URLSearchParams(Object.entries(d).filter(([, v]) => v)).toString();
      location.hash = '#/map' + (q ? `?${q}` : '');
    });

    redraw();
    setTimeout(() => map && map.invalidateSize(), 60);
  }

  window.Pages.map = { title: 'الخرائط والتحليل المكاني', render };
})();
