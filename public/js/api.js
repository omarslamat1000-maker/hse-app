// طبقة الاتصال بالخادم + قائمة انتظار العمل دون اتصال
(function () {
  const OFFLINE_QUEUE_KEY = 'hse_offline_queue';
  const CACHE_KEY = 'hse_get_cache';

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function writeQueue(q) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { return {}; }
  }
  function cachePut(url, data) {
    const c = readCache();
    c[url] = { data, at: Date.now() };
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* السعة ممتلئة */ }
  }

  async function api(url, options = {}) {
    const opts = { headers: {}, credentials: 'same-origin', ...options };
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (netErr) {
      // دون اتصال
      const method = (opts.method || 'GET').toUpperCase();
      if (method === 'GET') {
        const cached = readCache()[url];
        if (cached) return { ...cached.data, __cached: true, __cachedAt: cached.at };
        throw new ApiError('لا يوجد اتصال بالشبكة ولا توجد نسخة محفوظة من هذه البيانات', 0);
      }
      // عمليات الإدخال تدخل قائمة الانتظار (للراصد الميداني)
      if (options.queueable) {
        const q = readQueue();
        q.push({ url, options: { ...options, body: options.body }, at: Date.now(), id: Date.now() + '-' + Math.random().toString(36).slice(2) });
        writeQueue(q);
        window.dispatchEvent(new CustomEvent('hse:queued'));
        return { __queued: true, message: 'تم الحفظ محلياً وستتم المزامنة عند عودة الاتصال' };
      }
      throw new ApiError('لا يوجد اتصال بالشبكة — أعد المحاولة لاحقاً', 0);
    }
    if (res.status === 401 && !url.includes('/auth/')) {
      window.App && window.App.onUnauthorized();
      throw new ApiError('انتهت الجلسة — سجل الدخول مجدداً', 401);
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) {
      const err = new ApiError(data?.error || 'حدث خطأ غير متوقع', res.status);
      err.data = data;
      throw err;
    }
    if ((opts.method || 'GET').toUpperCase() === 'GET' && ct.includes('json')) cachePut(url, data);
    return data;
  }

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  // مزامنة قائمة الانتظار
  async function syncQueue() {
    const q = readQueue();
    if (!q.length) return { synced: 0 };
    let synced = 0;
    const remaining = [];
    for (const item of q) {
      try {
        const opts = { ...item.options };
        delete opts.queueable;
        await api(item.url, opts);
        synced++;
      } catch (e) {
        if (e.status === 0) { remaining.push(item); continue; } // ما زال دون اتصال
        // خطأ من الخادم (تكرار/تحقق) — لا نعيد المحاولة إلى ما لا نهاية
        if (e.status === 409) { synced++; continue; }
        remaining.push(item);
      }
    }
    writeQueue(remaining);
    if (synced) window.dispatchEvent(new CustomEvent('hse:synced', { detail: { synced } }));
    return { synced, remaining: remaining.length };
  }

  function queueLength() { return readQueue().length; }

  window.addEventListener('online', () => {
    document.body.classList.remove('is-offline');
    syncQueue();
  });
  window.addEventListener('offline', () => document.body.classList.add('is-offline'));
  if (!navigator.onLine) document.body.classList.add('is-offline');

  window.api = api;
  window.ApiError = ApiError;
  window.OfflineSync = { syncQueue, queueLength };
})();
