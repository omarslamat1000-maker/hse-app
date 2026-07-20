// طبقة الرسوم البيانية — Chart.js مع لوحة الألوان المعتمدة (مدققة CVD)
(function () {
  const registry = new Map(); // canvasId -> Chart

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function palette() {
    return [cssVar('--s1'), cssVar('--s2'), cssVar('--s3'), cssVar('--s4'),
            cssVar('--s5'), cssVar('--s6'), cssVar('--s7'), cssVar('--s8')];
  }
  function inkColors() {
    return { ink: cssVar('--ink-2'), grid: cssVar('--grid'), muted: cssVar('--ink-3') };
  }
  const SEV_COLOR = () => ({
    low: cssVar('--good'), medium: cssVar('--warn'), high: cssVar('--serious'), critical: cssVar('--critical'),
  });

  function baseOptions() {
    const { ink, grid } = inkColors();
    Chart.defaults.font.family = '"TheSansArabic", "Segoe UI", Tahoma, sans-serif';
    Chart.defaults.font.size = 12;
    return {
      responsive: true,
      maintainAspectRatio: false,
      locale: 'en-US',
      plugins: {
        legend: {
          rtl: true, textDirection: 'rtl', position: 'bottom',
          labels: { color: ink, boxWidth: 11, boxHeight: 11, borderRadius: 3, useBorderRadius: true, padding: 14 },
        },
        tooltip: { rtl: true, textDirection: 'rtl', boxPadding: 4 },
      },
      scales: {
        x: { ticks: { color: ink }, grid: { color: 'transparent' }, border: { color: grid } },
        y: { ticks: { color: ink, precision: 0 }, grid: { color: grid }, border: { display: false }, beginAtZero: true },
      },
    };
  }

  function destroyIfAny(id) {
    if (registry.has(id)) { registry.get(id).destroy(); registry.delete(id); }
  }

  function make(id, config) {
    const el = document.getElementById(id);
    if (!el) return null;
    destroyIfAny(id);
    const c = new Chart(el.getContext('2d'), config);
    registry.set(id, c);
    return c;
  }

  // أعمدة رفيعة بنهايات دائرية
  function bar(id, labels, datasets, opts = {}) {
    const pal = palette();
    const base = baseOptions();
    return make(id, {
      type: 'bar',
      data: {
        labels,
        datasets: datasets.map((d, i) => ({
          ...d,
          backgroundColor: d.backgroundColor || pal[i % 8],
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'start',
          maxBarThickness: 34,
          categoryPercentage: .7, barPercentage: .85,
        })),
      },
      options: deepMerge(base, { plugins: { legend: { display: datasets.length > 1 } } }, opts),
    });
  }

  function hbar(id, labels, data, opts = {}) {
    const base = baseOptions();
    return make(id, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data, backgroundColor: opts.colors || palette()[0], borderRadius: 4, maxBarThickness: 22 }],
      },
      options: deepMerge(base, {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: inkColors().ink, precision: 0 }, grid: { color: inkColors().grid }, beginAtZero: true, position: 'top' },
          y: { ticks: { color: inkColors().ink, autoSkip: false }, grid: { color: 'transparent' } },
        },
      }, opts.chart || {}),
    });
  }

  function line(id, labels, datasets, opts = {}) {
    const pal = palette();
    const base = baseOptions();
    return make(id, {
      type: 'line',
      data: {
        labels,
        datasets: datasets.map((d, i) => ({
          tension: .3, borderWidth: 2, pointRadius: 2.5, pointHoverRadius: 5,
          borderColor: d.color || pal[i % 8], backgroundColor: d.color || pal[i % 8],
          fill: false, ...d,
        })),
      },
      options: deepMerge(base, { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: datasets.length > 1 } } }, opts),
    });
  }

  function doughnut(id, labels, data, colors, opts = {}) {
    const base = baseOptions();
    return make(id, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data, backgroundColor: colors || palette(),
          borderColor: cssVar('--surface'), borderWidth: 2, hoverOffset: 6,
        }],
      },
      options: deepMerge({
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: base.plugins,
      }, opts),
    });
  }

  function deepMerge(...objs) {
    const out = {};
    for (const o of objs) {
      for (const [k, v] of Object.entries(o || {})) {
        out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
          ? deepMerge(out[k], v) : v;
      }
    }
    return out;
  }

  // إعادة رسم الكل عند تبديل الثيم
  window.addEventListener('hse:theme', () => {
    for (const [id, c] of registry) {
      // يُعاد بناء الرسوم من الصفحات نفسها؛ هنا نكتفي بالتدمير الآمن
      c.destroy();
    }
    registry.clear();
    window.dispatchEvent(new CustomEvent('hse:rerender'));
  });

  window.Charts = { bar, hbar, line, doughnut, palette, cssVar, SEV_COLOR, destroyIfAny };
})();
