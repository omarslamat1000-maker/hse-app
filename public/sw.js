// Service Worker — تخزين هيكل التطبيق للعمل دون اتصال
const CACHE = 'hse-shell-v2';
const SHELL = [
  '/', '/index.html', '/css/app.css',
  '/js/api.js', '/js/ui.js', '/js/charts.js', '/js/app.js',
  '/js/pages/dashboard.js', '/js/pages/projects.js', '/js/pages/tours.js',
  '/js/pages/observations.js', '/js/pages/records.js', '/js/pages/mappage.js',
  '/js/pages/reports.js', '/js/pages/admin.js',
  '/vendor/chart.umd.js', '/vendor/leaflet.js', '/vendor/leaflet.css',
  '/img/login-bg.jpg',
  '/fonts/TheSansArabic-Plain.ttf', '/fonts/TheSansArabic-Bold.ttf',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return; // عمليات الإدخال تُدار من قائمة الانتظار في api.js
  if (url.pathname.startsWith('/api/')) return; // الـ API له تخزين خاص في localStorage
  // الهيكل: الشبكة أولاً مع الرجوع للتخزين
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : undefined))
    )
  );
});
