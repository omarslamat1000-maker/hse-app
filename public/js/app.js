// نواة التطبيق: المصادقة، التوجيه، الهيكل العام، الإشعارات، الثيم
(function () {
  const { esc, toast, label } = UI;
  let currentUser = null;
  let unreadCount = 0;

  const ICONS = {
    dashboard: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    projects: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>',
    tours: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5.4-8 12-8 12S4 15.4 4 10a8 8 0 0 1 8-8z"/></svg>',
    checklist: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5h11M9 12h11M9 19h11M4 5l1 1 2-2M4 12l1 1 2-2M4 19l1 1 2-2"/></svg>',
    obs: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    risks: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>',
    incidents: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M12 8v4M12 16h.01"/></svg>',
    actions: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/></svg>',
    permits: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15l2 2 4-4"/></svg>',
    map: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 3-6 2v16l6-2 6 2 6-2V3l-6 2-6-2zM9 3v16M15 5v16"/></svg>',
    kpis: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/></svg>',
    reports: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>',
    contractors: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    users: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>',
    settings: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.63.28 1.08.9 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    audit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    field: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    escal: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg>',
    training: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  };
  const shieldSvg = (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 100 100"><path d="M50 5 L90 20 V48 C90 70 73 88 50 95 C27 88 10 70 10 48 V20 Z" fill="var(--brand)"/><path d="M32 50 L45 63 L70 36" stroke="white" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // ===== الهوية البصرية القابلة للتخصيص =====
  window.BRAND = { platform_name: 'منصة السلامة', org_name: '', primary_color: '', logo: null };
  function brandLogo(size = 30) {
    return window.BRAND.logo
      ? `<img src="${window.BRAND.logo}" alt="" style="height:${size + 6}px;max-width:${size * 2.6}px;object-fit:contain">`
      : shieldSvg(size);
  }
  window.brandLogo = brandLogo;

  function hexToHsl(hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if (!m) return null;
    let [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function applyBrand() {
    const B = window.BRAND;
    document.title = `${B.platform_name} — إدارة الأمن والسلامة والصحة المهنية`;
    let styleEl = document.getElementById('brand-style');
    if (B.primary_color && hexToHsl(B.primary_color)) {
      const { h, s, l } = hexToHsl(B.primary_color);
      const c = (ll, ss = s) => `hsl(${h} ${ss}% ${ll}%)`;
      if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'brand-style'; document.head.appendChild(styleEl); }
      styleEl.textContent = `
        :root { --brand:${c(l)}; --brand-hover:${c(Math.max(8, l - 7))}; --brand-soft:${c(94, Math.round(s * .45))}; --brand-soft-2:${c(89, Math.round(s * .45))};
                --brand-900:${c(Math.max(6, l - 22))}; --brand-700:${c(Math.max(8, l - 12))}; --brand-600:${c(l)}; }
        :root[data-theme="dark"] { --brand:${c(Math.min(70, l + 12))}; --brand-hover:${c(Math.min(76, l + 18))};
                --brand-soft:${c(15, Math.round(s * .5))}; --brand-soft-2:${c(20, Math.round(s * .5))}; }`;
    } else if (styleEl) styleEl.textContent = '';
  }
  async function loadBrand() {
    try {
      const b = await (await fetch('/api/brand')).json();
      window.BRAND = { ...window.BRAND, ...b };
    } catch {}
    applyBrand();
  }

  // ===== الثيم =====
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('hse_theme', t);
  }
  function initTheme() {
    const saved = localStorage.getItem('hse_theme');
    applyTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    window.dispatchEvent(new CustomEvent('hse:theme'));
  }

  // ===== شاشة تسجيل الدخول =====
  function renderLogin() {
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">${brandLogo(46)}
            <div><div class="t1">${esc(window.BRAND.platform_name)}</div>
            <div class="t2">إدارة الأمن والسلامة والصحة المهنية — مشاريع البنية التحتية</div></div>
          </div>
          <form id="login-form">
            ${UI.fld('اسم المستخدم', '<input name="username" autocomplete="username" required autofocus>', { required: true })}
            ${UI.fld('كلمة المرور', '<input name="password" type="password" autocomplete="current-password" required>', { required: true })}
            <button class="btn" style="width:100%" type="submit">تسجيل الدخول</button>
          </form>
          <div class="login-hint">
            <b>بيانات تجريبية:</b><br>
            مدير النظام: <code dir="ltr">admin / Admin@123</code><br>
            راصد ميداني: <code dir="ltr">rased1 / Rased@123</code>
          </div>
        </div>
      </div>`;
    document.getElementById('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const d = UI.formData(e.target);
        await api('/api/auth/login', { method: 'POST', body: d });
        await boot();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  // ===== الهيكل العام =====
  const NAV = [
    { group: 'الرئيسية' },
    { route: 'dashboard', title: 'لوحة المعلومات', icon: 'dashboard' },
    { route: 'field', title: 'الواجهة الميدانية', icon: 'field', roles: ['observer'] },
    { route: 'map', title: 'الخريطة التفاعلية', icon: 'map' },
    { group: 'العمليات الميدانية' },
    { route: 'tours', title: 'الجولات الميدانية', icon: 'tours' },
    { route: 'observations', title: 'الملاحظات والمخالفات', icon: 'obs' },
    { route: 'incidents', title: 'الحوادث والإصابات', icon: 'incidents' },
    { route: 'actions', title: 'الإجراءات التصحيحية', icon: 'actions' },
    { route: 'permits', title: 'تصاريح العمل', icon: 'permits' },
    { route: 'risks', title: 'سجل المخاطر', icon: 'risks' },
    { route: 'training', title: 'التوعية والتدريب', icon: 'training' },
    { group: 'الإدارة والتحليل' },
    { route: 'projects', title: 'المشاريع', icon: 'projects' },
    { route: 'kpis', title: 'مؤشرات الأداء', icon: 'kpis' },
    { route: 'contractors', title: 'المقاولون والتقييم', icon: 'contractors' },
    { route: 'reports', title: 'التقارير', icon: 'reports' },
    { group: 'النظام', roles: ['admin'] },
    { route: 'users', title: 'المستخدمون', icon: 'users', roles: ['admin'] },
    { route: 'checklists', title: 'نماذج التفتيش', icon: 'checklist', roles: ['admin'] },
    { route: 'escalation', title: 'التصعيد والمهل', icon: 'escal', roles: ['admin'] },
    { route: 'archive', title: 'الأرشيف', icon: 'permits', roles: ['admin'] },
    { route: 'audit', title: 'سجل العمليات', icon: 'audit', roles: ['admin'] },
    { route: 'settings', title: 'الإعدادات', icon: 'settings', roles: ['admin'] },
  ];

  // قائمة مخصصة لبوابة المقاول
  const CONTRACTOR_NAV = [
    { group: 'بوابة المقاول' },
    { route: 'portal', title: 'لوحة المتابعة', icon: 'dashboard' },
    { route: 'observations', title: 'الملاحظات المحالة علينا', icon: 'obs' },
    { route: 'actions', title: 'الإجراءات التصحيحية', icon: 'actions' },
  ];

  function renderShell() {
    const navList = currentUser.role === 'contractor' ? CONTRACTOR_NAV : NAV;
    const navHtml = navList.filter(n => !n.roles || n.roles.includes(currentUser.role)).map(n =>
      n.group
        ? `<div class="nav-group">${esc(n.group)}</div>`
        : `<a href="#/${n.route}" data-route="${n.route}">${ICONS[n.icon] || ''}<span>${esc(n.title)}</span>
           ${n.route === 'observations' ? '<span class="badge-mini" id="nav-critical" hidden></span>' : ''}</a>`
    ).join('');
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
        <aside class="sidebar">
          <div class="brand">${brandLogo(34)}<div><div class="t">${esc(window.BRAND.platform_name)}</div><div class="s">الأمن والسلامة والصحة المهنية</div></div></div>
          <nav class="nav" id="main-nav">${navHtml}</nav>
          <div class="sidebar-footer">v1.0 — ${esc(currentUser.full_name)}</div>
        </aside>
        <div class="main">
          <div class="offline-bar">⚠ أنت تعمل الآن دون اتصال — سيتم حفظ البيانات محلياً ومزامنتها تلقائياً عند عودة الاتصال</div>
          <header class="topbar">
            <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="القائمة">☰</button>
            <div style="min-width:0;flex:1">
              <div class="title" id="page-title" style="flex:none"></div>
              <div style="font-size:.66rem;color:var(--ink-3)" class="topbar-date">${UI.dualDate()}</div>
            </div>
            <button class="icon-btn" id="sync-btn" title="مزامنة البيانات المحفوظة محلياً" hidden>⟳</button>
            <button class="icon-btn" id="theme-toggle" title="الوضع الليلي/النهاري">◐</button>
            <button class="icon-btn" id="notif-btn" title="الإشعارات">🔔<span class="dot" id="notif-dot" hidden></span></button>
            <div class="user-chip">
              <div class="avatar">${esc(currentUser.full_name.trim().charAt(0))}</div>
              <div class="meta"><div class="n">${esc(currentUser.full_name)}</div>
              <div class="r">${UI.label('role', currentUser.role)}</div></div>
            </div>
            <button class="icon-btn" id="logout-btn" title="تسجيل الخروج">⎋</button>
          </header>
          <main class="content" id="page-content"></main>
        </div>
      </div>`;
    document.getElementById('theme-toggle').onclick = toggleTheme;
    document.getElementById('logout-btn').onclick = async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
      location.hash = '';
      currentUser = null;
      renderLogin();
    };
    document.getElementById('notif-btn').onclick = openNotifications;
    document.getElementById('menu-toggle').onclick = () => document.body.classList.toggle('sidebar-open');
    document.getElementById('sidebar-backdrop').onclick = () => document.body.classList.remove('sidebar-open');
    document.getElementById('main-nav').addEventListener('click', e => {
      if (e.target.closest('a')) document.body.classList.remove('sidebar-open');
    });
    const syncBtn = document.getElementById('sync-btn');
    syncBtn.onclick = async () => {
      const r = await OfflineSync.syncQueue();
      toast(r.synced ? `تمت مزامنة ${r.synced} سجل` : 'لا توجد بيانات بانتظار المزامنة');
      updateSyncBadge();
    };
    updateSyncBadge();
    window.addEventListener('hse:queued', updateSyncBadge);
    window.addEventListener('hse:synced', e => { toast(`تمت مزامنة ${e.detail.synced} سجل محفوظ محلياً`); updateSyncBadge(); refreshRoute(); });
  }

  function updateSyncBadge() {
    const btn = document.getElementById('sync-btn');
    if (btn) btn.hidden = OfflineSync.queueLength() === 0;
  }

  // ===== البث الفوري (SSE) =====
  let eventSource = null;
  const ENTITY_ROUTE = {
    observation: id => `#/observations/${id}`,
    incident: id => `#/incidents/${id}`,
    tour: id => `#/tours/${id}`,
    action: () => '#/actions',
    permit: () => '#/permits',
    report: id => `#/reports?type=archive&id=${id}`,
  };

  function criticalBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; g.gain.value = 0.06;
      o.start(); o.stop(ctx.currentTime + 0.18);
    } catch {}
  }

  function liveToast(n) {
    const el = document.createElement('div');
    el.className = `toast ${['critical', 'escalation'].includes(n.kind) ? 'error' : n.kind === 'warning' ? 'warn' : ''}`;
    el.style.cursor = 'pointer';
    el.innerHTML = `<b>${esc(n.title)}</b><div style="font-size:.78rem;color:var(--ink-2);margin-top:2px">${esc(n.body || '')}</div>`;
    el.onclick = () => {
      const route = ENTITY_ROUTE[n.entity_type];
      if (route && n.entity_id) location.hash = route(n.entity_id);
      el.remove();
    };
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  function connectStream() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource('/api/stream');
    eventSource.onmessage = e => {
      let n; try { n = JSON.parse(e.data); } catch { return; }
      unreadCount++;
      const dot = document.getElementById('notif-dot');
      if (dot) dot.hidden = false;
      liveToast(n);
      if (['critical', 'escalation', 'gosi'].includes(n.kind)) {
        criticalBeep();
        // إشعار نظام التشغيل (يظهر حتى والمتصفح بالخلفية)
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            const os = new Notification(n.title, { body: n.body || '', dir: 'rtl', lang: 'ar', tag: `hse-${n.entity_type}-${n.entity_id}` });
            os.onclick = () => {
              window.focus();
              const route = ENTITY_ROUTE[n.entity_type];
              if (route && n.entity_id) location.hash = route(n.entity_id);
            };
          } catch {}
        }
      }
    };
  }

  // ===== الإشعارات =====
  async function pollNotifications() {
    if (!currentUser) return;
    try {
      const d = await api('/api/notifications');
      unreadCount = d.unread;
      const dot = document.getElementById('notif-dot');
      if (dot) dot.hidden = unreadCount === 0;
    } catch {}
  }

  async function openNotifications() {
    // طلب إذن إشعارات النظام عند أول تفاعل مع الجرس
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    const d = await api('/api/notifications');
    const kindIcon = { critical: '🛑', escalation: '📣', warning: '⚠️', tour: '📍', info: 'ℹ️' };
    const items = d.items.length ? d.items.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <div class="ic">${kindIcon[n.kind] || 'ℹ️'}</div>
        <div><div style="font-weight:700">${esc(n.title)}</div>
          <div style="color:var(--ink-2)">${esc(n.body)}</div>
          <div style="font-size:.7rem;color:var(--ink-3);margin-top:2px">${UI.fmtDateTime(n.created_at)}</div></div>
      </div>`).join('') : '<div class="empty-state">لا توجد إشعارات</div>';
    const m = UI.modal({
      title: `مركز الإشعارات ${d.unread ? `(${d.unread} غير مقروء)` : ''}`,
      body: `<div style="max-height:55vh;overflow-y:auto">${items}</div>`,
      footer: `<button class="btn secondary" id="mark-read">تعليم الكل كمقروء</button>`,
    });
    m.el.querySelector('#mark-read').onclick = async () => {
      await api('/api/notifications/read', { method: 'PUT', body: {} });
      pollNotifications();
      m.close();
    };
  }

  // ===== المساعد الذكي «اسأل المنصة» =====
  function mountAskAssistant() {
    if (document.getElementById('ask-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'ask-fab'; fab.className = 'ask-fab no-print'; fab.title = 'اسأل المنصة';
    fab.textContent = '💬';
    document.body.appendChild(fab);
    let panel = null;
    fab.onclick = () => {
      if (panel) { panel.remove(); panel = null; return; }
      panel = document.createElement('div');
      panel.className = 'ask-panel no-print';
      panel.innerHTML = `
        <div class="ask-head"><span>💬 اسأل المنصة</span><button title="إغلاق">✕</button></div>
        <div class="ask-msgs" id="ask-msgs">
          <div class="ask-msg bot">أهلاً! اسألني عن بياناتك بالعربية، مثلاً:\n• كم ملاحظة حرجة مفتوحة؟\n• كم حادثاً هذا الشهر؟\n• أي مشروع الأكثر ملاحظات؟\n• ما نسبة الالتزام في مشروع النسيم؟</div>
        </div>
        <form class="ask-input"><input placeholder="اكتب سؤالك…" autocomplete="off"><button class="btn sm" type="submit">إرسال</button></form>`;
      document.body.appendChild(panel);
      panel.querySelector('.ask-head button').onclick = () => { panel.remove(); panel = null; };
      const msgs = panel.querySelector('#ask-msgs');
      const form = panel.querySelector('form');
      const input = form.querySelector('input');
      input.focus();
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const question = input.value.trim();
        if (!question) return;
        input.value = '';
        msgs.insertAdjacentHTML('beforeend', `<div class="ask-msg me">${esc(question)}</div>`);
        msgs.scrollTop = msgs.scrollHeight;
        try {
          const r = await api('/api/ai/ask', { method: 'POST', body: { question } });
          const links = (r.links || []).map(l =>
            `<div><button class="btn sm secondary" data-hash="${esc(l.hash)}">↗ ${esc(l.label)}</button></div>`).join('');
          msgs.insertAdjacentHTML('beforeend', `<div class="ask-msg bot">${esc(r.answer)}${links}</div>`);
          msgs.querySelectorAll('[data-hash]').forEach(b => b.onclick = () => {
            location.hash = b.dataset.hash;
            panel.remove(); panel = null;
          });
        } catch (err) {
          msgs.insertAdjacentHTML('beforeend', `<div class="ask-msg bot">تعذر: ${esc(err.message)}</div>`);
        }
        msgs.scrollTop = msgs.scrollHeight;
      });
    };
  }

  // ===== التوجيه =====
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [path, query] = h.split('?');
    const [route, ...rest] = path.split('/');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { route: route || 'dashboard', args: rest, params };
  }

  let lastRoute = null;
  async function refreshRoute() {
    if (!currentUser) return;
    const { route, args, params } = parseHash();
    const page = window.Pages[route];
    const contentEl = document.getElementById('page-content');
    if (!page) { contentEl.innerHTML = '<div class="empty-state">الصفحة غير موجودة</div>'; return; }
    if (page.roles && !page.roles.includes(currentUser.role)) {
      contentEl.innerHTML = '<div class="empty-state">لا تملك صلاحية الوصول لهذه الصفحة</div>'; return;
    }
    document.querySelectorAll('#main-nav a').forEach(a =>
      a.classList.toggle('active', a.dataset.route === route));
    document.getElementById('page-title').textContent = typeof page.title === 'function' ? page.title(args) : page.title;
    contentEl.innerHTML = UI.spinner();
    lastRoute = route;
    try {
      await page.render(contentEl, { args, params, user: currentUser });
    } catch (err) {
      console.error(err);
      contentEl.innerHTML = `<div class="empty-state">تعذر تحميل الصفحة: ${esc(err.message)}</div>`;
    }
  }

  window.addEventListener('hashchange', refreshRoute);
  window.addEventListener('hse:rerender', refreshRoute);

  // تطبيق الفلاتر فور الاختيار — أي تغيير في قوائم/تواريخ نموذج فلترة يرسل النموذج تلقائياً
  document.addEventListener('change', e => {
    const form = e.target.closest('form.filters');
    if (!form) return;
    const t = e.target;
    if (t.tagName === 'SELECT' || t.type === 'date' || t.type === 'month' || t.type === 'checkbox') {
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  // ===== الإقلاع =====
  async function boot() {
    try {
      currentUser = await api('/api/auth/me');
    } catch {
      renderLogin();
      return;
    }
    window.App.user = () => currentUser;
    renderShell();
    if (!location.hash) location.hash =
      currentUser.role === 'observer' ? '#/field' :
      currentUser.role === 'contractor' ? '#/portal' : '#/dashboard';
    if (currentUser.role === 'contractor' && ['#/dashboard', ''].includes(location.hash)) location.hash = '#/portal';
    await refreshRoute();
    pollNotifications();
    setInterval(pollNotifications, 120000); // احتياط — البث الفوري هو القناة الأساسية
    connectStream();
    mountAskAssistant();
    if (navigator.onLine) OfflineSync.syncQueue();
  }

  window.App = {
    user: () => currentUser,
    refreshRoute,
    onUnauthorized() { currentUser = null; renderLogin(); },
    pollNotifications,
  };
  window.Pages = window.Pages || {};

  // Service Worker للعمل دون اتصال
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  initTheme();
  loadBrand().then(boot);
})();
