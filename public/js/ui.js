// مكونات الواجهة المشتركة + قاموس المصطلحات
(function () {
  // ===== القواميس العربية =====
  const L = {
    severity: { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' },
    obs_status: {
      draft: 'مسودة', submitted: 'مسجلة', under_review: 'تحت المراجعة', approved: 'معتمدة',
      assigned: 'محالة للمعالجة', in_progress: 'جارٍ التنفيذ', pending_verification: 'بانتظار التحقق',
      closed: 'مغلقة', rejected: 'مرفوضة', reopened: 'معاد فتحها',
    },
    otype: { observation: 'ملاحظة', violation: 'مخالفة' },
    tour_status: { planned: 'مخططة', in_progress: 'قيد التنفيذ', completed: 'منفذة', missed: 'فائتة', cancelled: 'ملغاة' },
    action_status: { open: 'مفتوح', in_progress: 'جارٍ التنفيذ', pending_verification: 'بانتظار التحقق', closed: 'مغلق', rejected: 'مرفوض', reopened: 'معاد فتحه' },
    permit_status: { requested: 'مطلوب', under_review: 'تحت المراجعة', approved: 'معتمد', active: 'ساري', suspended: 'معلق', cancelled: 'ملغى', closed: 'مغلق' },
    incident_status: { open: 'مفتوح', investigating: 'قيد التحقيق', actions: 'إجراءات جارية', closed: 'مغلق' },
    risk_status: { open: 'مفتوح', mitigating: 'قيد المعالجة', monitoring: 'تحت المراقبة', closed: 'مغلق' },
    project_status: { active: 'نشط', suspended: 'متوقف', completed: 'مكتمل', cancelled: 'ملغى' },
    itype: {
      accident: 'حادث', injury: 'إصابة', fatality: 'وفاة', property: 'أضرار ممتلكات', fire: 'حريق',
      spill: 'انسكاب', near_miss: 'شبه حادثة', unsafe_condition: 'حالة غير آمنة', unsafe_act: 'سلوك غير آمن',
    },
    ptype: {
      hotwork: 'أعمال ساخنة', excavation: 'حفريات', height: 'عمل على ارتفاع', lifting: 'رفع',
      electrical: 'كهرباء', confined: 'أماكن مغلقة', road_closure: 'إغلاق طرق وتحويلات', other: 'أعمال خطرة أخرى',
    },
    category: {
      ppe: 'معدات الوقاية الشخصية', height: 'العمل على المرتفعات', excavation: 'الحفريات والخنادق',
      lifting: 'الرافعات ومعدات الرفع', equipment: 'المعدات والآليات', traffic: 'التحويلات المرورية',
      electrical: 'الأعمال الكهربائية', confined: 'الأماكن المغلقة', hotwork: 'الأعمال الساخنة واللحام',
      scaffold: 'السقالات والسلالم', hazmat: 'المواد الخطرة', storage: 'التخزين والمستودعات',
      housekeeping: 'النظافة والترتيب', firstaid: 'الإسعافات الأولية', emergency: 'خطط الطوارئ',
      fire: 'مكافحة الحريق', welfare: 'سلامة العمال والمرافق', signage: 'اللوحات والحواجز',
      training: 'التدريب والتوعية', permits: 'تصاريح العمل', public: 'حماية الجمهور والمشاة',
      environment: 'السلامة البيئية', emissions: 'الضوضاء والغبار', health: 'الصحة المهنية',
      ergonomics: 'الرفع اليدوي وبيئة العمل',
    },
    party: { contractor: 'المقاول', consultant: 'الاستشاري', other: 'جهة أخرى' },
    project_type: {
      roads: 'طرق', bridges: 'جسور', tunnels: 'أنفاق', drainage: 'تصريف مياه',
      water: 'مياه وصرف صحي', electrical: 'كهرباء وإنارة', landscape: 'تجميل وتحسين', buildings: 'مبانٍ', other: 'أخرى',
    },
    result: { pass: 'مطابق', fail: 'غير مطابق', na: 'غير منطبق', followup: 'يحتاج متابعة' },
    period: { morning: 'صباحية', evening: 'مسائية' },
    kpi_status: { good: 'جيد', warning: 'يحتاج انتباه', critical: 'متدنٍ' },
    priority: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' },
    rca: { '5whys': 'الأسباب الخمسة (5 Whys)', fishbone: 'مخطط عظمة السمكة', rca: 'تحليل السبب الجذري RCA' },
    role: {
      admin: 'مدير النظام', safety_supervisor: 'مشرف سلامة', project_manager: 'مدير مشروع',
      observer: 'راصد ميداني', viewer: 'قراءة فقط', contractor: 'ممثل مقاول',
    },
    perm: {
      record_observations: 'تسجيل الملاحظات والحوادث والإجراءات',
      approve_observations: 'اعتماد الملاحظات وإدارة سير عملها',
      close_observations: 'اعتماد الإغلاق وإعادة الفتح',
      assign_tours: 'تخطيط الجولات وتوزيعها',
      approve_permits: 'مراجعة واعتماد التصاريح',
      manage_projects: 'إدارة المشاريع والمقاولين والتقييم',
      edit_checklists: 'إدارة نماذج التفتيش',
      view_reports: 'التقارير والمؤشرات والتصدير',
    },
  };
  function label(dict, key) { return (L[dict] && L[dict][key]) || key || '—'; }

  const SEV_CLASS = { low: 'b-low', medium: 'b-medium', high: 'b-high', critical: 'b-critical' };
  const STATUS_CLASS = {
    closed: 'b-good', completed: 'b-good', active: 'b-good', approved: 'b-brand', pass: 'b-good',
    rejected: 'b-critical', missed: 'b-critical', fail: 'b-critical', fatality: 'b-critical',
    reopened: 'b-high', suspended: 'b-high', escalated: 'b-critical', in_progress: 'b-info',
    investigating: 'b-info', mitigating: 'b-info', monitoring: 'b-brand',
  };
  function badge(dict, key, cls) {
    const c = cls || SEV_CLASS[key] || STATUS_CLASS[key] || 'b-neutral';
    return `<span class="badge ${c}">${esc(label(dict, key))}</span>`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return s;
    return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    const d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d)) return s;
    return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' }) +
      ' ' + d.toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', { hour: '2-digit', minute: '2-digit' });
  }
  function fmtNum(n) { return Number(n ?? 0).toLocaleString('en-US'); }
  // التاريخ الهجري (تقويم أم القرى) — المعيار الحكومي السعودي
  function fmtHijri(s) {
    const d = s ? new Date(String(s).replace(' ', 'T')) : new Date();
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn',
      { year: 'numeric', month: 'long', day: 'numeric' }).format(d) + ' هـ';
  }
  function dualDate(s) {
    return `${fmtDate(s || new Date().toISOString())} م — ${fmtHijri(s)}`;
  }
  function fmtMoney(n) { return Number(n ?? 0).toLocaleString('en-US') + ' ريال'; }

  // ===== التنبيهات =====
  function toast(msg, type = 'ok', ms = 3800) {
    const el = document.createElement('div');
    el.className = `toast ${type === 'error' ? 'error' : type === 'warn' ? 'warn' : ''}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // ===== المودال =====
  function modal({ title, body, footer, wide, onClose }) {
    const root = document.getElementById('modal-root');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-label="${esc(title)}">
        <div class="modal-head"><h3>${esc(title)}</h3>
          <button class="icon-btn m-close" aria-label="إغلاق">✕</button></div>
        <div class="modal-body"></div>
        ${footer !== null ? '<div class="modal-foot"></div>' : ''}
      </div>`;
    const bodyEl = overlay.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    if (footer && footer !== null) {
      const footEl = overlay.querySelector('.modal-foot');
      if (typeof footer === 'string') footEl.innerHTML = footer; else footEl.appendChild(footer);
    }
    function close() { overlay.remove(); onClose && onClose(); }
    overlay.querySelector('.m-close').onclick = close;
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    root.appendChild(overlay);
    return { el: overlay, close, body: bodyEl };
  }

  function confirmDialog(msg, { danger = false, okText = 'تأكيد' } = {}) {
    return new Promise(resolve => {
      const m = modal({
        title: 'تأكيد العملية',
        body: `<p style="margin:0">${esc(msg)}</p>`,
        footer: `<button class="btn ${danger ? 'danger' : ''} c-ok">${esc(okText)}</button>
                 <button class="btn secondary c-cancel">إلغاء</button>`,
        onClose: () => resolve(false),
      });
      m.el.querySelector('.c-ok').onclick = () => { resolve(true); m.el.remove(); };
      m.el.querySelector('.c-cancel').onclick = () => { resolve(false); m.el.remove(); };
    });
  }

  // مودال إدخال نص (سبب رفض/إعادة فتح…)
  function promptDialog(title, placeholder = '') {
    return new Promise(resolve => {
      const m = modal({
        title,
        body: `<textarea class="p-input" placeholder="${esc(placeholder)}"></textarea>`,
        footer: `<button class="btn p-ok">حفظ</button><button class="btn secondary p-cancel">إلغاء</button>`,
        onClose: () => resolve(null),
      });
      m.el.querySelector('.p-ok').onclick = () => {
        const v = m.el.querySelector('.p-input').value.trim();
        if (!v) return toast('أدخل النص المطلوب', 'warn');
        resolve(v); m.el.remove();
      };
      m.el.querySelector('.p-cancel').onclick = () => { resolve(null); m.el.remove(); };
    });
  }

  // ===== جدول بيانات =====
  function dataTable({ columns, rows, onRow, empty = 'لا توجد سجلات مطابقة' }) {
    if (!rows.length) return `<div class="empty-state">${esc(empty)}</div>`;
    const head = columns.map(c => `<th>${esc(c.title)}</th>`).join('');
    const body = rows.map((r, i) => {
      const tds = columns.map(c => `<td>${c.render ? c.render(r, i) : esc(r[c.key])}</td>`).join('');
      return `<tr class="${onRow ? 'rowlink' : ''}" data-i="${i}">${tds}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function bindRows(container, rows, onRow) {
    if (!onRow) return;
    container.querySelectorAll('tr.rowlink').forEach(tr => {
      tr.addEventListener('click', () => onRow(rows[Number(tr.dataset.i)]));
    });
  }

  // ===== حقول النماذج =====
  function fld(labelText, inner, { required = false, full = false } = {}) {
    return `<label class="fld ${full ? 'full' : ''}"><span>${esc(labelText)} ${required ? '<i class="req">*</i>' : ''}</span>${inner}</label>`;
  }
  function select(name, options, value = '', { allowEmpty = true, emptyLabel = 'الكل' } = {}) {
    const opts = (allowEmpty ? [`<option value="">${esc(emptyLabel)}</option>`] : [])
      .concat(options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`));
    return `<select name="${esc(name)}">${opts.join('')}</select>`;
  }
  function optsFromDict(dict) {
    return Object.entries(L[dict] || {}).map(([value, label]) => ({ value, label }));
  }

  // ضغط صورة عبر Canvas قبل الرفع (يحافظ على وضوح مقبول)
  async function compressImage(file, maxDim = 1600, quality = 0.8) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 900 * 1024) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      if (!blob) return file;
      return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
    } catch { return file; }
  }

  // ===== محرر التحديد على الصور (سهم/دائرة/مستطيل/خط حر) =====
  function annotateImage(file) {
    return new Promise(async resolve => {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) return resolve(file);
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);

      const m = modal({
        title: `✏️ تحديد على الصورة — ${file.name}`,
        wide: true,
        body: `
          <div class="btn-row no-print" style="margin-bottom:.6rem">
            <button type="button" class="btn sm an-tool" data-tool="arrow">➤ سهم</button>
            <button type="button" class="btn sm secondary an-tool" data-tool="ellipse">◯ دائرة</button>
            <button type="button" class="btn sm secondary an-tool" data-tool="rect">▭ مستطيل</button>
            <button type="button" class="btn sm secondary an-tool" data-tool="free">〰 خط حر</button>
            <span style="width:12px"></span>
            <button type="button" class="btn sm an-color" data-color="#e11d1d" style="background:#e11d1d">أحمر</button>
            <button type="button" class="btn sm secondary an-color" data-color="#f5b400" style="color:#f5b400">أصفر</button>
            <span style="flex:1"></span>
            <button type="button" class="btn sm secondary" id="an-undo">↩ تراجع</button>
            <button type="button" class="btn sm secondary" id="an-clear">🗑 مسح الكل</button>
          </div>
          <div style="overflow:auto;max-height:60vh;text-align:center;background:var(--surface-2);border-radius:8px">
            <canvas id="an-canvas" width="${W}" height="${H}"
              style="max-width:100%;height:auto;touch-action:none;cursor:crosshair;display:inline-block"></canvas>
          </div>`,
        footer: `<button class="btn" id="an-save">حفظ الصورة المعلَّمة</button>
                 <button class="btn secondary" id="an-skip">تخطي — الأصلية دون تعديل</button>`,
        onClose: () => resolve(file),
      });

      const canvas = m.el.querySelector('#an-canvas');
      const ctx = canvas.getContext('2d');
      const shapes = [];
      let tool = 'arrow', color = '#e11d1d', current = null;
      const LW = Math.max(4, Math.round(W / 220));

      function drawShape(s) {
        ctx.strokeStyle = s.color; ctx.lineWidth = LW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        if (s.tool === 'free') {
          s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        } else if (s.tool === 'rect') {
          ctx.rect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
        } else if (s.tool === 'ellipse') {
          ctx.ellipse((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, Math.abs(s.x1 - s.x0) / 2 || 1, Math.abs(s.y1 - s.y0) / 2 || 1, 0, 0, Math.PI * 2);
        } else { // سهم
          ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1);
          const ang = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), hl = LW * 3.2;
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x1 - hl * Math.cos(ang - 0.45), s.y1 - hl * Math.sin(ang - 0.45));
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x1 - hl * Math.cos(ang + 0.45), s.y1 - hl * Math.sin(ang + 0.45));
        }
        ctx.stroke();
      }
      function redraw() {
        ctx.drawImage(bmp, 0, 0, W, H);
        shapes.forEach(drawShape);
        if (current) drawShape(current);
      }
      redraw();

      function pos(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
      }
      canvas.addEventListener('pointerdown', e => {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        const p = pos(e);
        current = tool === 'free'
          ? { tool, color, points: [p] }
          : { tool, color, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      });
      canvas.addEventListener('pointermove', e => {
        if (!current) return;
        const p = pos(e);
        if (tool === 'free') current.points.push(p);
        else { current.x1 = p.x; current.y1 = p.y; }
        redraw();
      });
      canvas.addEventListener('pointerup', () => {
        if (current) { shapes.push(current); current = null; redraw(); }
      });

      m.el.querySelectorAll('.an-tool').forEach(b => b.onclick = () => {
        tool = b.dataset.tool;
        m.el.querySelectorAll('.an-tool').forEach(x => x.classList.toggle('secondary', x !== b));
      });
      m.el.querySelectorAll('.an-color').forEach(b => b.onclick = () => {
        color = b.dataset.color;
        m.el.querySelectorAll('.an-color').forEach(x => x.classList.toggle('secondary', x !== b));
      });
      m.el.querySelector('#an-undo').onclick = () => { shapes.pop(); redraw(); };
      m.el.querySelector('#an-clear').onclick = () => { shapes.length = 0; redraw(); };
      m.el.querySelector('#an-skip').onclick = () => { resolve(file); m.close(); };
      m.el.querySelector('#an-save').onclick = () => {
        canvas.toBlob(blob => {
          const out = blob
            ? new File([blob], file.name.replace(/\.\w+$/, '') + '-معلمة.jpg', { type: 'image/jpeg' })
            : file;
          resolve(out); m.close();
        }, 'image/jpeg', 0.88);
      };
    });
  }

  // تمرير مجموعة ملفات على المحرر (الصور فقط، والبقية تمر كما هي)
  async function annotateImages(files) {
    const out = [];
    for (const f of files) {
      out.push(f.type.startsWith('image/') && f.type !== 'image/gif' ? await annotateImage(f) : f);
    }
    return out;
  }

  // رفع مرفقات كيان
  async function uploadAttachments(entityType, entityId, files, kind = 'photo') {
    const fd = new FormData();
    fd.append('entity_type', entityType);
    fd.append('entity_id', entityId);
    fd.append('kind', kind);
    for (const f of files) fd.append('files', await compressImage(f));
    return api('/api/attachments', { method: 'POST', body: fd });
  }

  function attachmentGrid(list) {
    if (!list || !list.length) return '<div class="empty-state" style="padding:1rem">لا توجد مرفقات</div>';
    return `<div class="attachment-grid">` + list.map(a => {
      const isImg = /^image\//.test(a.mime);
      return `<a class="att" href="/uploads/${esc(a.filename)}" target="_blank" title="${esc(a.original_name)}">
        ${isImg ? `<img src="/uploads/${esc(a.filename)}" alt="" loading="lazy">` : `<div style="height:76px;display:grid;place-items:center;font-size:1.6rem">📄</div>`}
        <span class="nm">${esc(a.original_name || a.filename)}</span></a>`;
    }).join('') + `</div>`;
  }

  // الحصول على الموقع الجغرافي
  function getLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
    });
  }

  function spinner() { return `<div class="empty-state">جارٍ التحميل…</div>`; }

  // دلتا المقارنة بالفترة السابقة — direction: 'higher' الأعلى أفضل / 'lower' الأقل أفضل
  function deltaBadge(cur, prev, direction = 'higher') {
    cur = Number(cur) || 0; prev = Number(prev) || 0;
    if (prev === 0 && cur === 0) return `<span style="color:var(--ink-3);font-size:.68rem">﹦ دون تغيير</span>`;
    if (prev === 0) return `<span style="color:var(--ink-3);font-size:.68rem" title="لا بيانات للفترة السابقة">جديد</span>`;
    const pct = Math.round((cur - prev) / Math.abs(prev) * 100);
    if (pct === 0) return `<span style="color:var(--ink-3);font-size:.68rem" title="السابقة: ${prev}">﹦ دون تغيير</span>`;
    const improved = direction === 'higher' ? pct > 0 : pct < 0;
    const color = improved ? 'var(--good)' : 'var(--critical)';
    const arrow = pct > 0 ? '▲' : '▼';
    return `<span style="color:${color};font-weight:700;font-size:.7rem" title="الفترة السابقة: ${prev}">${arrow} ${pct > 0 ? '+' : ''}${pct}%</span>`;
  }

  // ===== الحالات المخصصة (تُدار من الإعدادات) =====
  let _customStatuses = null;
  async function customStatuses(force = false) {
    if (_customStatuses && !force) return _customStatuses;
    try {
      const s = await api('/api/settings');
      _customStatuses = JSON.parse(s.custom_statuses || '[]');
    } catch { _customStatuses = []; }
    return _customStatuses;
  }
  function invalidateCustomStatuses() { _customStatuses = null; }
  function tagBadge(tag) {
    return tag ? ` <span class="badge b-info">${esc(tag)}</span>` : '';
  }
  function tagSelect(name, list, value = '') {
    return select(name, list.map(t => ({ value: t, label: t })), value, { emptyLabel: '— بدون —' });
  }

  // ===== سجل الإجراءات المتخذة (مكوّن مشترك: ملاحظات، CAPA، حوادث، تصاريح) =====
  // opts: { showProgress: عرض حقل نسبة الإنجاز، locked: منع الإضافة (سجل مغلق) }
  async function renderUpdates(container, entityType, entityId, opts = {}) {
    let updates = [];
    try { updates = await api(`/api/updates?entity_type=${entityType}&entity_id=${entityId}`); }
    catch { container.innerHTML = '<div class="empty-state">تعذر تحميل سجل الإجراءات</div>'; return; }

    const listHtml = updates.length ? `<ul class="timeline" style="margin-top:.6rem">` + updates.map(u => `
      <li>
        <div class="t">${esc(u.full_name || 'مستخدم')}
          ${u.progress != null ? `<span class="badge b-brand">الإنجاز ${u.progress}%</span>` : ''}</div>
        <div style="font-size:.84rem;margin:.15rem 0">${esc(u.body)}</div>
        <div class="d">${fmtDateTime(u.created_at)}</div>
        ${u.attachments.length ? attachmentGrid(u.attachments) : ''}
      </li>`).join('') + `</ul>`
      : '<div class="empty-state" style="padding:.8rem">لم تُسجل إجراءات متخذة بعد</div>';

    container.innerHTML = `
      ${opts.locked ? '' : `
      <form class="upd-form no-print" style="margin-bottom:.4rem">
        <textarea name="body" placeholder="صف الإجراء الذي تم اتخاذه…" style="min-height:64px"></textarea>
        <div class="btn-row" style="margin-top:.5rem;align-items:center">
          <button class="btn sm" type="submit">＋ إضافة إجراء متخذ</button>
          <label class="btn secondary sm">📎 مرفقات<input type="file" name="files" accept="image/*,video/*,.pdf" capture="environment" multiple hidden></label>
          <button type="button" class="btn secondary sm upd-annotate" hidden>✏️ تحديد</button>
          ${opts.showProgress ? `<label style="display:flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--ink-2)">
            نسبة الإنجاز <input name="progress" type="number" min="0" max="100" placeholder="—" style="width:74px;padding:.3rem .5rem"> %</label>` : ''}
          <span class="upd-files-n" style="font-size:.74rem;color:var(--ink-3)"></span>
        </div>
      </form>`}
      <div class="upd-list">${listHtml}</div>`;

    const form = container.querySelector('.upd-form');
    if (!form) return;
    let files = [];
    form.querySelector('[name="files"]').addEventListener('change', e => {
      files = [...e.target.files];
      container.querySelector('.upd-files-n').textContent = files.length ? `${files.length} ملف` : '';
      const anBtn = form.querySelector('.upd-annotate');
      if (anBtn) anBtn.hidden = !files.some(f => f.type.startsWith('image/'));
    });
    const anBtn = form.querySelector('.upd-annotate');
    if (anBtn) anBtn.onclick = async () => {
      files = await annotateImages(files);
      container.querySelector('.upd-files-n').textContent = `${files.length} ملف (بعد التحديد)`;
    };
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = form.body.value.trim();
      if (!body) return toast('صف الإجراء المتخذ أولاً', 'warn');
      const progress = opts.showProgress && form.progress.value !== '' ? Number(form.progress.value) : undefined;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await api('/api/updates', {
          method: 'POST', queueable: true,
          body: { entity_type: entityType, entity_id: entityId, body, progress },
        });
        if (r.__queued) {
          toast('لا يوجد اتصال — حُفظ الإجراء محلياً وسيُزامن تلقائياً', 'warn');
        } else if (files.length) {
          try { await uploadAttachments('update', r.id, files, 'evidence'); }
          catch { toast('حُفظ الإجراء لكن تعذر رفع المرفقات', 'warn'); }
        }
        toast('تم توثيق الإجراء المتخذ');
        renderUpdates(container, entityType, entityId, opts);
        if (opts.onSaved) opts.onSaved();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  function formData(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = v; });
    form.querySelectorAll('input[type="checkbox"][name]').forEach(cb => { out[cb.name] = cb.checked; });
    return out;
  }

  window.UI = {
    L, label, badge, esc, fmtDate, fmtDateTime, fmtNum, fmtMoney, toast, modal, confirmDialog, promptDialog,
    dataTable, bindRows, fld, select, optsFromDict, compressImage, uploadAttachments, attachmentGrid,
    getLocation, spinner, formData, SEV_CLASS, renderUpdates,
    customStatuses, invalidateCustomStatuses, tagBadge, tagSelect, fmtHijri, dualDate,
    annotateImage, annotateImages, deltaBadge,
  };
})();
