// NodeFlow — раздел «Проекты».
// Проект = описание + дерево мыслей (блоки со связями родитель → дети) +
// журнал записей + файлы любых типов. Из проекта собирается печатный отчёт
// со статистикой работы.
//
// Хранение — в той же таблице items, без миграций. Тип строки задаётся
// полем category:
//   __nf_project — проект (body: JSON с описанием, цветом, статусом, активностью)
//   __nf_block   — блок дерева (body: JSON {p, parent, content, color, collapsed})
//   __nf_entry   — запись журнала (body: JSON {p, block, text})
//   __nf_file    — файл (body: data:-URL; метаданные в tags: p:, o:, m:, s:)
(function () {
  'use strict';

  const NF = window.NF;
  const { $, svgIcon, escapeHtml, uid, plural, fmtHuman, fmtTime, startOfDay, pad2, renderBody, plainPreview, toast, askConfirm, askText } = NF;

  const CAT = { project: '__nf_project', block: '__nf_block', entry: '__nf_entry', file: '__nf_file' };
  const COLORS = ['#3b82f6', '#f97316', '#8b5cf6', '#16a34a', '#ec4899', '#eab308', '#06b6d4', '#ef4444'];
  const STATUS = { active: 'В работе', paused: 'На паузе', done: 'Завершён' };
  const MAX_FILE = 10 * 1024 * 1024;      // 10 МБ на файл
  const TREE = { W: 212, H: 84, GX: 72, GY: 16, PAD: 40 };

  const S = { projects: [], blocks: [], entries: [], files: [] };
  const fileCache = new Map();             // id → data:-URL
  const views = new Map();                 // pid → { x, y, k }
  let openId = null;
  let hashChecked = false;

  /* ====================== УТИЛИТЫ ====================== */

  const parseJson = (s, def) => { try { const v = JSON.parse(s || ''); return v && typeof v === 'object' ? v : def; } catch { return def; } };
  const dayKey = (ts) => { const d = new Date(ts || Date.now()); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const words = (t) => (String(t || '').trim().match(/\S+/g) || []).length;
  const proj = (id) => S.projects.find((p) => p.id === id);
  const block = (id) => S.blocks.find((b) => b.id === id);
  const entry = (id) => S.entries.find((e) => e.id === id);
  const fileById = (id) => S.files.find((f) => f.id === id);
  const blocksOf = (pid) => S.blocks.filter((b) => b.p === pid);
  const entriesOf = (pid) => S.entries.filter((e) => e.p === pid);
  const filesOf = (pid) => S.files.filter((f) => f.p === pid);
  const filesOwned = (owner) => S.files.filter((f) => f.owner === owner);

  function fmtSize(n) {
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' КБ';
    return (n / 1024 / 1024).toFixed(1) + ' МБ';
  }

  function fmtDuration(min) {
    if (!min) return '—';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h} ч${m ? ` ${m} мин` : ''}` : `${m} мин`;
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    return `${d.getDate()} ${['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()]} ${d.getFullYear()}`;
  }

  const extOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();

  const CODE_LANG = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'clike', java: 'clike', kt: 'clike', go: 'clike',
    rs: 'clike', php: 'clike', swift: 'clike', dart: 'clike', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
    css: 'css', scss: 'css', xml: 'markup', svg: 'markup', sql: 'plain', yml: 'plain', yaml: 'plain', ini: 'plain', toml: 'plain',
  };

  function fileKind(f) {
    const e = extOf(f.name), m = f.mime || '';
    if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'].includes(e)) return 'image';
    if (m === 'application/pdf' || e === 'pdf') return 'pdf';
    if (['doc', 'docx', 'odt', 'rtf', 'pages'].includes(e)) return 'doc';
    if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(e)) return 'sheet';
    if (['html', 'htm'].includes(e)) return 'html';
    if (['md', 'markdown'].includes(e)) return 'md';
    if (CODE_LANG[e]) return 'code';
    if (m.startsWith('text/') || ['txt', 'log'].includes(e)) return 'text';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'archive';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    return 'other';
  }

  const KIND_LABEL = {
    image: 'Изображения', pdf: 'PDF', doc: 'Документы', sheet: 'Таблицы', html: 'HTML', md: 'Markdown',
    code: 'Код', text: 'Текст', archive: 'Архивы', video: 'Видео', audio: 'Аудио', other: 'Прочее',
  };
  const KIND_COLOR = {
    image: '#ec4899', pdf: '#ef4444', doc: '#3b82f6', sheet: '#16a34a', html: '#f97316', md: '#14b8a6',
    code: '#8b5cf6', text: '#64748b', archive: '#a16207', video: '#06b6d4', audio: '#0ea5e9', other: '#71717a',
  };
  const KIND_TAG = {
    image: 'IMG', pdf: 'PDF', doc: 'DOC', sheet: 'XLS', html: 'HTML', md: 'MD', code: '</>', text: 'TXT',
    archive: 'ZIP', video: 'VID', audio: 'AUD', other: 'FILE',
  };

  function dataUrlBytes(d) {
    const i = d.indexOf(',');
    const meta = d.slice(0, i);
    const payload = d.slice(i + 1);
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
  }
  const dataUrlText = (d) => new TextDecoder('utf-8').decode(dataUrlBytes(d));

  const scriptCache = new Map();
  function loadScript(src) {
    if (!scriptCache.has(src)) {
      scriptCache.set(src, new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = res; s.onerror = () => { scriptCache.delete(src); rej(new Error('Не удалось загрузить ' + src)); };
        document.head.appendChild(s);
      }));
    }
    return scriptCache.get(src);
  }

  /* ====================== ДАННЫЕ ====================== */

  function fromItem(it) {
    const base = { id: it.id, title: it.title || '', createdAt: it.createdAt || Date.now(), updatedAt: it.updatedAt || it.createdAt || Date.now(), deleted: !!it.deleted, deletedAt: it.deletedAt || null };
    switch (it.category) {
      case CAT.project: {
        const d = parseJson(it.body, {});
        return ['project', { ...base, desc: d.desc || '', color: d.color || COLORS[0], status: STATUS[d.status] ? d.status : 'active', activity: d.activity && typeof d.activity === 'object' ? d.activity : {} }];
      }
      case CAT.block: {
        const d = parseJson(it.body, {});
        return ['block', { ...base, p: d.p, parent: d.parent || null, content: d.content || '', color: d.color || '', collapsed: !!d.collapsed }];
      }
      case CAT.entry: {
        const d = parseJson(it.body, {});
        return ['entry', { ...base, p: d.p, block: d.block || null, text: d.text || '' }];
      }
      case CAT.file: {
        const meta = {};
        (it.tags || []).forEach((t) => { const i = String(t).indexOf(':'); if (i > 0) meta[t.slice(0, i)] = t.slice(i + 1); });
        return ['file', { ...base, name: it.title || 'файл', p: meta.p, owner: meta.o || meta.p, mime: meta.m || '', size: +meta.s || 0 }];
      }
    }
    return [null, null];
  }

  function toItem(kind, o) {
    const it = {
      id: o.id, type: 'note', title: o.title || '', category: CAT[kind], tags: [], done: false, font: 'sans', importance: 'green',
      createdAt: o.createdAt, updatedAt: o.updatedAt, deleted: !!o.deleted, deletedAt: o.deletedAt || null, body: '',
    };
    if (kind === 'project') it.body = JSON.stringify({ desc: o.desc, color: o.color, status: o.status, activity: o.activity });
    if (kind === 'block') it.body = JSON.stringify({ p: o.p, parent: o.parent, content: o.content, color: o.color, collapsed: o.collapsed });
    if (kind === 'entry') it.body = JSON.stringify({ p: o.p, block: o.block, text: o.text });
    if (kind === 'file') { it.title = o.name; it.tags = [`p:${o.p}`, `o:${o.owner}`, `m:${o.mime}`, `s:${o.size}`]; }
    return it;
  }

  function ingest(items) {
    S.projects = []; S.blocks = []; S.entries = []; S.files = [];
    items.forEach((it) => {
      const [kind, o] = fromItem(it);
      if (kind === 'project') S.projects.push(o);
      else if (kind === 'block') S.blocks.push(o);
      else if (kind === 'entry') S.entries.push(o);
      else if (kind === 'file') S.files.push(o);
    });
    // Несохранённые локальные правки важнее пришедших с сервера.
    pending.forEach((kind, id) => { const o = localCopies.get(id); if (o) upsertLocal(kind, o); });

    // Сироты (проект удалён окончательно) — подчищаем.
    const ids = new Set(S.projects.map((p) => p.id));
    const orphans = [...S.blocks, ...S.entries, ...S.files].filter((o) => !ids.has(o.p)).map((o) => o.id);
    if (orphans.length) {
      S.blocks = S.blocks.filter((o) => ids.has(o.p));
      S.entries = S.entries.filter((o) => ids.has(o.p));
      S.files = S.files.filter((o) => ids.has(o.p));
      DB.deleteMany(orphans).catch((e) => console.warn('[projects] orphans', e));
    }
    if (openId && !visibleProject(openId)) openId = null;
    if (!hashChecked) { hashChecked = true; syncFromHash(); }
  }

  function reset() {
    S.projects = []; S.blocks = []; S.entries = []; S.files = [];
    fileCache.clear(); openId = null;
  }

  const visibleProject = (id) => { const p = proj(id); return p && !p.deleted ? p : null; };

  function listFor(kind) {
    return kind === 'project' ? S.projects : kind === 'block' ? S.blocks : kind === 'entry' ? S.entries : S.files;
  }
  function upsertLocal(kind, o) {
    const list = listFor(kind);
    const i = list.findIndex((x) => x.id === o.id);
    if (i >= 0) list[i] = o; else list.push(o);
  }

  /* --- Очередь сохранения (с повтором при ошибке сети) --- */
  const pending = new Map();      // id → kind
  const localCopies = new Map();  // id → объект (для повторной отправки)
  let flushTimer = null;
  let flushDue = 0;
  let flushing = null;
  const saveListeners = new Set();
  const emitSave = (s) => saveListeners.forEach((cb) => cb(s));

  function save(kind, o, { touch = true, delay = 600 } = {}) {
    if (touch) o.updatedAt = Date.now();
    pending.set(o.id, kind);
    localCopies.set(o.id, o);
    emitSave('pending');
    // Не откладываем уже запланированную отправку: срабатывает самый ранний срок.
    const due = Date.now() + delay;
    if (flushTimer && flushDue <= due) return;
    clearTimeout(flushTimer);
    flushDue = due;
    flushTimer = setTimeout(flush, delay);
  }

  async function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (flushing) { await flushing; if (!pending.size) return; }
    if (!pending.size) return;
    const batch = [...pending.entries()];
    pending.clear();
    emitSave('saving');
    flushing = (async () => {
      let failed = false;
      for (const [id, kind] of batch) {
        const o = localCopies.get(id);
        if (!o) continue;
        try {
          await DB.upsertItem(toItem(kind, o));
          if (!pending.has(id)) localCopies.delete(id);
        } catch (e) {
          console.error('[projects] save', e);
          failed = true;
          if (!pending.has(id)) pending.set(id, kind);
        }
      }
      if (failed) {
        emitSave('error');
        flushDue = Date.now() + 5000;
        flushTimer = setTimeout(flush, 5000);
      } else emitSave(pending.size ? 'pending' : 'saved');
    })();
    await flushing;
    flushing = null;
  }

  window.addEventListener('online', () => { if (pending.size) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending.size) flush(); });
  window.addEventListener('beforeunload', (e) => { if (pending.size) { flush(); e.preventDefault(); e.returnValue = ''; } });

  /* --- Активность (для статистики) --- */
  const lastMinute = new Map();
  function track(pid) {
    const p = proj(pid);
    if (!p) return;
    const key = dayKey();
    const a = p.activity[key] || (p.activity[key] = { e: 0, m: 0 });
    a.e++;
    const mk = Math.floor(Date.now() / 60000);
    if (lastMinute.get(pid) !== mk) { a.m++; lastMinute.set(pid, mk); }
    const keys = Object.keys(p.activity).sort();
    if (keys.length > 730) keys.slice(0, keys.length - 730).forEach((k) => delete p.activity[k]);
    save('project', p, { delay: 1500 });
  }

  /* --- Создание / удаление --- */
  function createProject(title) {
    const now = Date.now();
    const p = { id: uid(), title, desc: '', color: COLORS[S.projects.length % COLORS.length], status: 'active', activity: {}, createdAt: now, updatedAt: now, deleted: false };
    S.projects.push(p);
    track(p.id);
    save('project', p, { delay: 0 });
    return p;
  }

  function createBlock(pid, parent, title) {
    const now = Date.now();
    const b = { id: uid(), p: pid, parent: parent || null, title, content: '', color: '', collapsed: false, createdAt: now, updatedAt: now };
    S.blocks.push(b);
    const par = parent && block(parent);
    if (par && par.collapsed) { par.collapsed = false; save('block', par); }
    save('block', b);
    track(pid);
    return b;
  }

  function createEntry(pid, text, blockId) {
    const now = Date.now();
    const e = { id: uid(), p: pid, block: blockId || null, title: '', text, createdAt: now, updatedAt: now };
    S.entries.push(e);
    save('entry', e, { delay: 0 });
    track(pid);
    if (window.Links) Links.ingest(text);
    return e;
  }

  function descendants(id) {
    const out = [];
    const walk = (pid) => S.blocks.filter((b) => b.parent === pid).forEach((b) => { out.push(b); walk(b.id); });
    walk(id);
    return out;
  }

  async function hardDelete(ids) {
    const set = new Set(ids);
    // Файлы, прикреплённые к удаляемым объектам.
    S.files.filter((f) => set.has(f.owner)).forEach((f) => set.add(f.id));
    S.blocks = S.blocks.filter((b) => !set.has(b.id));
    S.entries = S.entries.filter((e) => !set.has(e.id));
    S.files = S.files.filter((f) => !set.has(f.id));
    // Записи, ссылавшиеся на удалённые блоки, остаются — просто без привязки.
    S.entries.forEach((e) => { if (e.block && set.has(e.block)) { e.block = null; save('entry', e); } });
    set.forEach((id) => { pending.delete(id); localCopies.delete(id); fileCache.delete(id); });
    try { await DB.deleteMany([...set]); } catch (e) { console.error('[projects] delete', e); toast('Не удалось удалить на сервере', 'err'); }
  }

  async function deleteProject(id) {
    const p = proj(id);
    if (!p) return;
    p.deleted = true;
    p.deletedAt = Date.now();
    save('project', p, { delay: 0 });
    if (openId === id) close();
    NF.render();
    toast('Проект перемещён в корзину', 'info', 5000, { label: 'Отменить', onClick: () => restore(id) });
  }

  async function restore(id) {
    const p = proj(id);
    if (!p) return;
    p.deleted = false;
    p.deletedAt = null;
    save('project', p, { delay: 0 });
    NF.render();
  }

  async function purge(id) {
    const ids = [id, ...S.blocks.filter((b) => b.p === id).map((b) => b.id), ...S.entries.filter((e) => e.p === id).map((e) => e.id), ...S.files.filter((f) => f.p === id).map((f) => f.id)];
    S.projects = S.projects.filter((p) => p.id !== id);
    await hardDelete(ids);
  }

  const trashed = () => S.projects.filter((p) => p.deleted).map((p) => ({ id: p.id, title: p.title, deletedAt: p.deletedAt }));

  /* ====================== ФАЙЛЫ ====================== */

  function readAsDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  }

  // Большие фото ужимаем (до 2400 px по длинной стороне) — так они быстрее
  // грузятся и меньше места занимают в базе.
  async function prepareImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.2 * 1024 * 1024) return null;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      URL.revokeObjectURL(url);
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
      const data = c.toDataURL(type, 0.86);
      if (!data.startsWith('data:' + type)) return null;
      return data.length < file.size * 1.37 ? { data, mime: type } : null;
    } catch { return null; }
  }

  async function addFiles(fileList, { p, owner }) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      if (file.size > MAX_FILE) { toast(`«${file.name}» больше 10 МБ — пропущен`, 'err', 4000); continue; }
      let data, mime = file.type || '';
      try {
        const img = await prepareImage(file);
        if (img) { data = img.data; mime = img.mime; }
        else data = await readAsDataUrl(file);
      } catch { toast(`Не удалось прочитать «${file.name}»`, 'err'); continue; }
      let name = file.name || 'файл';
      if (mime === 'image/webp' && !/\.webp$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.webp';
      const now = Date.now();
      const f = { id: uid(), p, owner, name, mime, size: Math.round((data.length - data.indexOf(',') - 1) * 0.75), createdAt: now, updatedAt: now, uploading: true };
      S.files.push(f);
      fileCache.set(f.id, data);
      refreshFileViews();
      try {
        await DB.putItem({ ...toItem('file', f), body: data });
        f.uploading = false;
        added++;
      } catch (e) {
        console.error('[projects] upload', e);
        S.files = S.files.filter((x) => x.id !== f.id);
        fileCache.delete(f.id);
        toast(`«${name}» не загрузился: ${e.message || 'ошибка сети'}`, 'err', 5000);
      }
      refreshFileViews();
    }
    if (added) { track(p); toast(added === 1 ? 'Файл добавлен' : `Добавлено файлов: ${added}`, 'ok', 2000); }
  }

  async function getData(f) {
    if (fileCache.has(f.id)) return fileCache.get(f.id);
    const d = await DB.fileData(f.id);
    fileCache.set(f.id, d);
    return d;
  }

  async function deleteFile(id) {
    const f = fileById(id);
    if (!f) return;
    if (!(await askConfirm({ title: 'Удалить файл?', message: `«${f.name}» будет удалён навсегда.` }))) return;
    await hardDelete([id]);
    NF.closeOverlay('fileOverlay');
    refreshFileViews();
  }

  function pickFiles(target) {
    const input = $('projFileInput');
    input.value = '';
    input.onchange = () => addFiles(input.files, target);
    input.click();
  }

  const tagOf = (f) => { const k = fileKind(f), e = extOf(f.name); return k === 'sheet' && e ? e.toUpperCase().slice(0, 4) : KIND_TAG[k]; };

  function fileTile(f, { owner = false, compact = false } = {}) {
    const kind = fileKind(f);
    const where = owner ? ownerLabel(f) : '';
    return `
      <button class="file-tile ${compact ? 'compact' : ''} ${f.uploading ? 'uploading' : ''}" data-file="${f.id}" style="--fc:${KIND_COLOR[kind]}" title="${escapeHtml(f.name)}">
        <span class="file-thumb ${kind === 'image' ? 'is-img' : ''}" data-thumb="${kind === 'image' ? f.id : ''}">
          ${kind === 'image' && fileCache.has(f.id) ? `<img src="${escapeHtml(fileCache.get(f.id))}" alt="">` : `<span class="file-tag">${tagOf(f)}</span>`}
          ${f.uploading ? '<span class="file-spin"></span>' : ''}
        </span>
        <span class="file-info">
          <span class="file-name">${escapeHtml(f.name)}</span>
          <span class="file-sub">${fmtSize(f.size)}${where ? ' · ' + escapeHtml(where) : ''}</span>
        </span>
      </button>`;
  }

  function ownerLabel(f) {
    if (f.owner === f.p) return 'проект';
    const b = block(f.owner);
    if (b) return b.title || 'блок';
    if (entry(f.owner)) return 'запись';
    return '';
  }

  // Ленивая подгрузка миниатюр изображений.
  let thumbObserver = null;
  function hydrateThumbs(scope) {
    const els = scope.querySelectorAll('[data-thumb]:not([data-thumb=""])');
    if (!els.length) return;
    if (!thumbObserver) {
      thumbObserver = new IntersectionObserver((list) => {
        list.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          thumbObserver.unobserve(el);
          const f = fileById(el.dataset.thumb);
          if (!f || el.querySelector('img')) return;
          getData(f).then((d) => {
            if (!el.isConnected) return;
            el.innerHTML = `<img src="${escapeHtml(d)}" alt="">` + (f.uploading ? '<span class="file-spin"></span>' : '');
          }).catch(() => {});
        });
      }, { rootMargin: '200px' });
    }
    els.forEach((el) => { if (!el.querySelector('img')) thumbObserver.observe(el); });
  }

  function bindFileTiles(scope) {
    scope.querySelectorAll('[data-file]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = fileById(b.dataset.file);
      if (f && !f.uploading) openFile(f);
    }));
    hydrateThumbs(scope);
  }

  function refreshFileViews() {
    if (rec.id && $('recOverlay').classList.contains('open')) renderRecFiles();
    if (NF.mode === 'projects' && openId && !$('reportOverlay').classList.contains('open')) {
      const sec = $('projFiles');
      if (sec) { renderFilesSection(); }
      renderEntries();
      updateStats();
      drawTree();
    }
  }

  /* --- Просмотр файла --- */
  let viewerUrl = null;

  async function openFile(f) {
    const body = $('fileBody');
    const kind = fileKind(f);
    $('fileTitle').innerHTML = `<span class="file-tag sm" style="--fc:${KIND_COLOR[kind]}">${tagOf(f)}</span><span class="ft-name">${escapeHtml(f.name)}</span><span class="ft-size">${fmtSize(f.size)}</span>`;
    body.innerHTML = '<div class="viewer-loading"><span class="file-spin"></span>Загрузка…</div>';
    NF.openOverlay('fileOverlay');
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }

    $('fileDelete').onclick = () => deleteFile(f.id);
    let data;
    try { data = await getData(f); } catch (e) { body.innerHTML = `<div class="empty small">Не удалось загрузить файл</div>`; return; }
    const blob = () => new Blob([dataUrlBytes(data)], { type: f.mime || 'application/octet-stream' });
    const url = () => (viewerUrl || (viewerUrl = URL.createObjectURL(blob())));
    $('fileDownload').onclick = () => { const a = document.createElement('a'); a.href = url(); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); };
    $('fileOpen').onclick = () => window.open(url(), '_blank', 'noopener');

    const e = extOf(f.name);
    try {
      if (kind === 'image') body.innerHTML = `<div class="viewer-img"><img src="${escapeHtml(data)}" alt="${escapeHtml(f.name)}"></div>`;
      else if (kind === 'pdf') body.innerHTML = `<iframe class="viewer-frame" src="${url()}" title="${escapeHtml(f.name)}"></iframe>`;
      else if (kind === 'video') body.innerHTML = `<video class="viewer-media" src="${url()}" controls></video>`;
      else if (kind === 'audio') body.innerHTML = `<audio class="viewer-audio" src="${url()}" controls></audio>`;
      else if (kind === 'md') body.innerHTML = `<div class="md viewer-doc">${renderBody(dataUrlText(data))}</div>`;
      else if (kind === 'html') {
        const src = dataUrlText(data);
        body.innerHTML = `
          <div class="seg seg-sm viewer-switch"><button class="active" data-v="page">Страница</button><button data-v="code">Код</button></div>
          <iframe class="viewer-frame" sandbox="" srcdoc="${escapeHtml(src)}" title="${escapeHtml(f.name)}"></iframe>
          <div class="md viewer-code" hidden>${NF.highlightCode(src, 'html')}</div>`;
        body.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
          body.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('active', x === b));
          body.querySelector('iframe').hidden = b.dataset.v !== 'page';
          body.querySelector('.viewer-code').hidden = b.dataset.v !== 'code';
        }));
      } else if (kind === 'code') {
        const src = dataUrlText(data);
        body.innerHTML = `<div class="md viewer-code">${e === 'json' ? NF.highlightCode(prettyJson(src), 'json') : NF.highlightCode(src, CODE_LANG[e])}</div>`;
      } else if (kind === 'text') body.innerHTML = `<pre class="viewer-text">${escapeHtml(dataUrlText(data))}</pre>`;
      else if (e === 'csv' || e === 'tsv') body.innerHTML = `<div class="md">${csvTable(dataUrlText(data), e === 'tsv' ? '\t' : null)}</div>`;
      else if (kind === 'sheet') {
        body.innerHTML = '<div class="viewer-loading"><span class="file-spin"></span>Открываю таблицу…</div>';
        await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const wb = XLSX.read(dataUrlBytes(data), { type: 'array' });
        body.innerHTML = wb.SheetNames.map((n) => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false }).slice(0, 500);
          return `<h3 class="viewer-sheet">${escapeHtml(n)}</h3><div class="md">${rowsTable(rows)}</div>`;
        }).join('');
      } else if (e === 'docx') {
        body.innerHTML = '<div class="viewer-loading"><span class="file-spin"></span>Открываю документ…</div>';
        await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
        const res = await mammoth.convertToHtml({ arrayBuffer: dataUrlBytes(data).buffer });
        body.innerHTML = `<div class="md viewer-doc">${sanitizeHtml(res.value)}</div>`;
      } else {
        body.innerHTML = `<div class="empty small">${svgIcon('note', 26, 1.5)}<div>Предпросмотр для этого типа недоступен</div><small>Файл можно скачать или открыть в новой вкладке</small></div>`;
      }
    } catch (err) {
      console.error('[viewer]', err);
      body.innerHTML = `<div class="empty small"><div>Не получилось показать файл</div><small>${escapeHtml(err.message || '')}</small></div>`;
    }
  }

  function prettyJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }

  // Простая очистка HTML (из docx): убираем скрипты, обработчики и javascript:-ссылки.
  function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((n) => n.remove());
    doc.querySelectorAll('*').forEach((n) => {
      [...n.attributes].forEach((a) => {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      });
      if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
    });
    return doc.body.firstChild.innerHTML;
  }

  function parseCsv(text, delim) {
    const first = text.split('\n')[0] || '';
    const d = delim || ([';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; if (rows.length > 500) break; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim()));
  }

  const csvTable = (text, delim) => rowsTable(parseCsv(text, delim));

  function rowsTable(rows) {
    if (!rows.length) return '<p class="muted">Пусто</p>';
    const w = Math.max(...rows.map((r) => r.length));
    const cell = (c) => escapeHtml(c == null ? '' : String(c));
    return `<div class="table-wrap"><table><thead><tr>${Array.from({ length: w }, (_, i) => `<th>${cell(rows[0][i])}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${Array.from({ length: w }, (_, i) => `<td>${cell(r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  /* ====================== СТАТИСТИКА ====================== */

  function stats(pid) {
    const p = proj(pid);
    const blocks = blocksOf(pid), entries = entriesOf(pid), files = filesOf(pid);
    const days = new Set();
    let edits = 0, minutes = 0;
    Object.entries(p.activity || {}).forEach(([k, a]) => { if (a.e) days.add(k); edits += a.e || 0; minutes += a.m || 0; });
    [...blocks, ...entries, ...files].forEach((o) => days.add(dayKey(o.createdAt)));
    days.add(dayKey(p.createdAt));
    const wordCount = words(p.desc) + blocks.reduce((s, b) => s + words(b.title) + words(b.content), 0) + entries.reduce((s, e) => s + words(e.text), 0);
    const byKind = {};
    files.forEach((f) => { const k = fileKind(f); byKind[k] = (byKind[k] || 0) + 1; });
    let depth = 0;
    const walk = (parent, d) => blocks.filter((b) => (b.parent || null) === parent).forEach((b) => { depth = Math.max(depth, d); walk(b.id, d + 1); });
    walk(null, 1);
    const last = Math.max(p.updatedAt || 0, ...blocks.map((b) => b.updatedAt || 0), ...entries.map((e) => e.updatedAt || 0), ...files.map((f) => f.createdAt || 0));
    return {
      blocks: blocks.length, entries: entries.length, files: files.length, size: files.reduce((s, f) => s + f.size, 0),
      words: wordCount, days: days.size, minutes, edits, depth, byKind, last,
      span: Math.max(1, Math.round((startOfDay(p.status === 'done' ? last : Date.now()) - startOfDay(p.createdAt)) / 86400000) + 1),
    };
  }

  // Активность по дням: правки + созданные объекты.
  function series(pid, days) {
    const p = proj(pid);
    const today0 = startOfDay();
    const out = Array.from({ length: days }, (_, i) => {
      const ts = today0 - (days - 1 - i) * 86400000;
      const a = p.activity[dayKey(ts)];
      return { ts, v: a ? a.e : 0 };
    });
    const idx = (ts) => Math.round((startOfDay(ts) - out[0].ts) / 86400000);
    [...blocksOf(pid), ...entriesOf(pid), ...filesOf(pid)].forEach((o) => { const i = idx(o.createdAt); if (i >= 0 && i < days && !p.activity[dayKey(o.createdAt)]) out[i].v++; });
    return out;
  }

  function sparkline(pid, color) {
    const s = series(pid, 21).map((x) => x.v);
    const max = Math.max(...s, 1);
    const W = 120, H = 28;
    const pts = s.map((v, i) => `${(i / (s.length - 1) * W).toFixed(1)},${(H - 2 - v / max * (H - 4)).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ====================== СПИСОК ПРОЕКТОВ ====================== */

  function render(root, animate) {
    root.classList.toggle('animate', !!animate);
    if (openId && visibleProject(openId)) renderProject(root, openId);
    else { openId = null; renderList(root); }
  }

  function renderList(root) {
    const list = S.projects.filter((p) => !p.deleted).sort((a, b) => {
      const ra = a.status === 'done' ? 1 : 0, rb = b.status === 'done' ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (stats(b.id).last || 0) - (stats(a.id).last || 0);
    });
    const n = list.length;
    root.innerHTML = `
      <div class="view-head">
        <div>
          <h1 class="view-title">Проекты</h1>
          <div class="view-sub">${n} ${plural(n, 'проект', 'проекта', 'проектов')}</div>
        </div>
        <button class="btn primary add-btn" id="projNew">${svgIcon('plus', 16, 2.2)}<span>Проект</span></button>
      </div>
      ${n ? `<div class="proj-grid">${list.map(projectCard).join('')}</div>` : `
        <div class="empty proj-empty">
          ${svgIcon('folder', 30, 1.5)}
          <div>Здесь будут твои проекты</div>
          <small>Собирай мысли, заметки, документы и картинки в одном месте, строй дерево идей и делай отчёт для печати</small>
          <button class="btn primary" id="projNew2">${svgIcon('plus', 16, 2.2)}Создать проект</button>
        </div>`}`;
    root.querySelectorAll('[data-project]').forEach((c) => c.addEventListener('click', () => open(c.dataset.project)));
    ['projNew', 'projNew2'].forEach((id) => { const b = $(id); if (b) b.addEventListener('click', createDialog); });
  }

  function projectCard(p, i) {
    const st = stats(p.id);
    return `
      <button class="proj-card" data-project="${p.id}" style="--c:${p.color};--i:${Math.min(i, 14)}">
        <span class="proj-card-top">
          <span class="proj-dot"></span>
          <span class="status-pill s-${p.status}">${STATUS[p.status]}</span>
        </span>
        <span class="proj-card-title">${escapeHtml(p.title || 'Без названия')}</span>
        <span class="proj-card-desc">${escapeHtml(plainPreview(p.desc, 140)) || '<span class="muted">Без описания</span>'}</span>
        ${sparkline(p.id, p.color)}
        <span class="proj-card-stats">
          <span>${svgIcon('tree', 13)}${st.blocks}</span>
          <span>${svgIcon('note', 13)}${st.entries}</span>
          <span>${svgIcon('clip', 13)}${st.files}</span>
          <span class="proj-card-when">${escapeHtml(fmtHuman(st.last, false))}</span>
        </span>
      </button>`;
  }

  async function createDialog() {
    const name = await askText({ title: 'Новый проект', placeholder: 'Например, «Фитнес-приложение»', actionText: 'Создать' });
    if (!name || typeof name !== 'string') return;
    const p = createProject(name);
    open(p.id);
  }

  /* ====================== СТРАНИЦА ПРОЕКТА ====================== */

  function open(id) {
    if (!visibleProject(id)) return;
    openId = id;
    if (location.hash !== '#p/' + id) history.pushState({ nfProject: id }, '', '#p/' + id);
    if (NF.mode !== 'projects') { NF.setMode('projects'); }
    else { NF.animate = true; NF.render(); }
    window.scrollTo({ top: 0 });
  }

  function close({ silent = false } = {}) {
    if (!openId) return;
    openId = null;
    exitFullscreen();
    if (location.hash.startsWith('#p/')) {
      if (!silent && history.state && history.state.nfProject) { history.back(); return; }
      history.replaceState(null, '', location.pathname + location.search);
    }
    if (!silent) { NF.animate = true; NF.render(); }
  }

  function syncFromHash() {
    const m = location.hash.match(/^#p\/([\w-]+)$/);
    const id = m && visibleProject(m[1]) ? m[1] : null;
    if (id === openId) return;
    openId = id;
    if (id && NF.mode !== 'projects') { NF.setMode('projects'); return; }
    if (NF.mode === 'projects') { NF.animate = true; NF.render(); }
  }
  window.addEventListener('popstate', syncFromHash);

  function renderProject(root, pid) {
    const p = proj(pid);
    root.innerHTML = `
      <div class="proj-head" style="--c:${p.color}">
        <button class="back-link" id="projBack">${svgIcon('back', 16, 2)}Проекты</button>
        <div class="proj-title-row">
          <span class="proj-dot lg"></span>
          <h1 class="view-title">${escapeHtml(p.title || 'Без названия')}</h1>
          <span class="status-pill s-${p.status}">${STATUS[p.status]}</span>
        </div>
        ${p.desc ? `<div class="md proj-desc">${renderBody(p.desc)}</div>` : `<button class="proj-desc-empty" id="projDescAdd">+ Добавить описание проекта</button>`}
        <div class="proj-actions">
          <button class="btn primary" id="projReport">${svgIcon('report', 16)}Отчёт</button>
          <button class="btn" id="projSettings">${svgIcon('edit', 16)}Изменить</button>
        </div>
      </div>

      <div class="stat-row" id="projStats"></div>

      <section class="proj-sec">
        <div class="sec-head">
          <h2>Дерево мыслей</h2>
          <span class="sec-hint">Нажми на блок, чтобы открыть · «+» — добавить ветку</span>
        </div>
        <div class="tree-wrap" id="treeWrap" style="--c:${p.color}">
          <div class="tree-stage" id="treeStage"></div>
          <div class="tree-ctrl">
            <button class="icon-btn sm" data-tz="out" title="Уменьшить" aria-label="Уменьшить">${svgIcon('minus', 16, 2)}</button>
            <button class="icon-btn sm" data-tz="in" title="Увеличить" aria-label="Увеличить">${svgIcon('plus', 16, 2)}</button>
            <button class="icon-btn sm" data-tz="fit" title="Показать всё" aria-label="Показать всё">${svgIcon('fit', 16)}</button>
            <button class="icon-btn sm" data-tz="full" title="На весь экран" aria-label="На весь экран">${svgIcon('expand', 16)}</button>
          </div>
        </div>
      </section>

      <section class="proj-sec">
        <div class="sec-head"><h2>Записи</h2><span class="sec-hint" id="entriesCount"></span></div>
        <div class="composer" id="composer">
          <textarea id="composerText" rows="2" placeholder="Мысль, заметка, идея… (Ctrl+Enter — добавить)"></textarea>
          <div class="composer-files" id="composerFiles"></div>
          <div class="composer-bar">
            <button class="icon-btn sm" id="composerAttach" title="Прикрепить файлы" aria-label="Прикрепить файлы">${svgIcon('clip', 18)}</button>
            <span class="composer-hint">Можно перетащить файлы сюда или вставить картинку</span>
            <button class="btn primary sm" id="composerAdd">Добавить</button>
          </div>
        </div>
        <div class="entries" id="entries"></div>
      </section>

      <section class="proj-sec">
        <div class="sec-head"><h2>Файлы</h2><span class="sec-hint" id="filesCount"></span>
          <button class="btn sm sec-btn" id="projAddFiles">${svgIcon('plus', 14, 2.2)}Файлы</button>
        </div>
        <div id="projFiles"></div>
      </section>`;

    $('projBack').addEventListener('click', () => close());
    $('projReport').addEventListener('click', () => openReport(pid));
    $('projSettings').addEventListener('click', () => openSettings(pid));
    const da = $('projDescAdd');
    if (da) da.addEventListener('click', () => openSettings(pid, true));
    $('projAddFiles').addEventListener('click', () => pickFiles({ p: pid, owner: pid }));

    updateStats();
    bindTree();
    drawTree({ fit: !views.has(pid) });
    bindComposer(pid);
    renderEntries();
    renderFilesSection();
  }

  function updateStats() {
    const el = $('projStats');
    if (!el || !openId) return;
    const st = stats(openId);
    const tile = (v, k, title) => `<div class="stat" ${title ? `title="${escapeHtml(title)}"` : ''}><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`;
    el.innerHTML = [
      tile(st.blocks, plural(st.blocks, 'блок', 'блока', 'блоков')),
      tile(st.entries, plural(st.entries, 'запись', 'записи', 'записей')),
      tile(st.files, plural(st.files, 'файл', 'файла', 'файлов')),
      tile(st.days, plural(st.days, 'день работы', 'дня работы', 'дней работы')),
      tile(fmtDuration(st.minutes), 'в работе', 'Примерное время: считаются минуты, в которые ты что-то менял в проекте'),
    ].join('');
  }

  /* --- Журнал записей --- */
  let composerFiles = [];

  function bindComposer(pid) {
    composerFiles = [];
    const ta = $('composerText');
    const box = $('composer');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + 'px'; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); return; }
      NF.onBodyKeydown(e);
    });
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); composerFiles.push(...files); renderComposerFiles(); }
    });
    $('composerAttach').addEventListener('click', () => {
      const input = $('projFileInput');
      input.value = '';
      input.onchange = () => { composerFiles.push(...input.files); renderComposerFiles(); };
      input.click();
    });
    bindDrop(box, (files) => { composerFiles.push(...files); renderComposerFiles(); });
    const submit = async () => {
      const text = ta.value.trim();
      if (!text && !composerFiles.length) { ta.focus(); return; }
      const e = createEntry(pid, text, null);
      const files = composerFiles;
      composerFiles = [];
      ta.value = '';
      grow();
      renderComposerFiles();
      renderEntries(e.id);
      updateStats();
      if (files.length) await addFiles(files, { p: pid, owner: e.id });
    };
    $('composerAdd').addEventListener('click', submit);
  }

  function renderComposerFiles() {
    const el = $('composerFiles');
    if (!el) return;
    el.innerHTML = composerFiles.map((f, i) => `<span class="chip static">${svgIcon('clip', 13)}${escapeHtml(f.name)}<button type="button" class="chip-x" data-cf="${i}" aria-label="Убрать">${svgIcon('close', 12, 2.4)}</button></span>`).join('');
    el.querySelectorAll('[data-cf]').forEach((b) => b.addEventListener('click', () => { composerFiles.splice(+b.dataset.cf, 1); renderComposerFiles(); }));
  }

  function renderEntries(fresh) {
    const el = $('entries');
    if (!el || !openId) return;
    const list = entriesOf(openId).sort((a, b) => b.createdAt - a.createdAt);
    const c = $('entriesCount');
    if (c) c.textContent = list.length ? `${list.length}` : '';
    if (!list.length) { el.innerHTML = '<div class="empty small">Пока пусто. Запиши первую мысль — она сохранится с датой и попадёт в отчёт.</div>'; return; }
    el.innerHTML = list.map((e) => {
      const b = e.block && block(e.block);
      const files = filesOwned(e.id);
      return `
        <article class="entry ${e.id === fresh ? 'fresh' : ''}" data-entry="${e.id}" tabindex="0">
          <div class="entry-head">
            <time title="${escapeHtml(fmtTime(e.createdAt))}">${escapeHtml(fmtHuman(e.createdAt))}</time>
            ${b ? `<span class="entry-block">${svgIcon('tree', 12)}${escapeHtml(b.title || 'блок')}</span>` : ''}
          </div>
          ${e.title ? `<div class="entry-title">${escapeHtml(e.title)}</div>` : ''}
          ${e.text ? `<div class="md entry-body">${renderBody(e.text)}</div>` : ''}
          ${files.length ? `<div class="file-grid compact">${files.map((f) => fileTile(f, { compact: true })).join('')}</div>` : ''}
        </article>`;
    }).join('');
    el.querySelectorAll('[data-entry]').forEach((a) => {
      a.addEventListener('click', (ev) => { if (ev.target.closest('a,[data-file]')) return; openRec('entry', a.dataset.entry); });
      a.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === a) openRec('entry', a.dataset.entry); });
    });
    bindFileTiles(el);
  }

  function renderFilesSection() {
    const el = $('projFiles');
    if (!el || !openId) return;
    const files = filesOf(openId).sort((a, b) => b.createdAt - a.createdAt);
    const c = $('filesCount');
    if (c) c.textContent = files.length ? `${files.length} · ${fmtSize(files.reduce((s, f) => s + f.size, 0))}` : '';
    el.innerHTML = files.length
      ? `<div class="file-grid">${files.map((f) => fileTile(f, { owner: true })).join('')}</div>`
      : `<div class="drop-hint" id="projDrop">${svgIcon('upload', 22, 1.6)}<span>Перетащи сюда PDF, Word, таблицы, картинки, код — что угодно</span></div>`;
    bindFileTiles(el);
    const drop = $('projDrop');
    if (drop) drop.addEventListener('click', () => pickFiles({ p: openId, owner: openId }));
    bindDrop(el.closest('.proj-sec'), (files) => addFiles(files, { p: openId, owner: openId }));
  }

  function bindDrop(el, onFiles) {
    if (!el || el.dataset.drop) return;
    el.dataset.drop = '1';
    let depth = 0;
    el.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types?.includes('Files')) return; e.preventDefault(); depth++; el.classList.add('dragging'); });
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('dragging'); });
    el.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); depth = 0; el.classList.remove('dragging');
      onFiles([...e.dataTransfer.files]);
    });
  }

  /* --- Настройки проекта --- */
  function openSettings(pid, focusDesc) {
    const p = proj(pid);
    const body = $('projBody');
    body.innerHTML = `
      <label class="field"><span class="field-label">Название</span>
        <input class="input" id="psTitle" value="${escapeHtml(p.title)}" autocomplete="off"></label>
      <label class="field"><span class="field-label">Описание · цели, идея, заметки</span>
        <textarea class="input textarea" id="psDesc" rows="5" placeholder="О чём проект, какая цель, сроки…">${escapeHtml(p.desc)}</textarea></label>
      <div class="field"><span class="field-label">Цвет</span>
        <div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch ${p.color === c ? 'active' : ''}" data-pc="${c}" style="background:${c}" aria-label="Цвет"></button>`).join('')}</div></div>
      <div class="field"><span class="field-label">Статус</span>
        <div class="chips wrap">${Object.entries(STATUS).map(([k, v]) => `<button type="button" class="chip ${p.status === k ? 'active' : ''}" data-ps="${k}">${v}</button>`).join('')}</div></div>
      <div class="ps-foot">
        <span class="muted">Создан ${escapeHtml(fmtDate(p.createdAt))}</span>
        <button class="btn ghost danger" id="psDelete">${svgIcon('trash', 15)}Удалить проект</button>
      </div>`;
    NF.openOverlay('projOverlay');
    const upd = (patch) => { Object.assign(p, patch); save('project', p); rerenderSoon(); };
    $('psTitle').addEventListener('input', (e) => upd({ title: e.target.value.trim() || 'Без названия' }));
    $('psDesc').addEventListener('input', (e) => upd({ desc: e.target.value }));
    body.querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-pc]').forEach((x) => x.classList.toggle('active', x === b));
      upd({ color: b.dataset.pc });
    }));
    body.querySelectorAll('[data-ps]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-ps]').forEach((x) => x.classList.toggle('active', x === b));
      upd({ status: b.dataset.ps });
    }));
    $('psDelete').addEventListener('click', async () => {
      if (!(await askConfirm({ title: `Удалить «${p.title}»?`, message: 'Проект со всеми блоками, записями и файлами уйдёт в корзину на 14 дней.' }))) return;
      NF.closeOverlay('projOverlay');
      deleteProject(pid);
    });
    setTimeout(() => (focusDesc ? $('psDesc') : $('psTitle')).focus(), 60);
  }

  let rerenderTimer = null;
  function rerenderSoon() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => { if (NF.mode === 'projects') NF.render(); }, 250);
  }

  /* ====================== ДЕРЕВО МЫСЛЕЙ ====================== */

  // Раскладка «аккуратного дерева»: корень слева, ветки вправо.
  function layout(pid, { ignoreCollapsed = false } = {}) {
    const p = proj(pid);
    const all = blocksOf(pid);
    const ids = new Set(all.map((b) => b.id));
    const kidsOf = (parent) => all
      .filter((b) => (parent === null ? (!b.parent || !ids.has(b.parent)) : b.parent === parent))
      .sort((a, b) => a.createdAt - b.createdAt);
    const { W, H, GX, GY } = TREE;
    const nodes = [], edges = [];
    let cursor = 0;
    const seen = new Set();
    function place(node, depth, color) {
      node.x = depth * (W + GX);
      const kids = node.isRoot ? kidsOf(null) : kidsOf(node.id);
      node.total = kids.length;
      nodes.push(node);
      const showKids = (ignoreCollapsed || !node.collapsed) ? kids.filter((k) => !seen.has(k.id)) : [];
      if (!showKids.length) { node.y = cursor; cursor += H + GY; return; }
      const placed = showKids.map((k, i) => {
        seen.add(k.id);
        const c = k.color || (node.isRoot ? COLORS[i % COLORS.length] : color);
        const child = { id: k.id, title: k.title, collapsed: k.collapsed, color: c, block: k };
        place(child, depth + 1, c);
        edges.push({ from: node, to: child, color: c });
        return child;
      });
      node.y = (placed[0].y + placed[placed.length - 1].y) / 2;
    }
    const root = { id: 'root', isRoot: true, title: p.title, color: p.color };
    place(root, 0, p.color);
    const width = Math.max(...nodes.map((n) => n.x)) + W;
    const height = Math.max(...nodes.map((n) => n.y)) + H;
    return { nodes, edges, width, height };
  }

  function edgePath(e) {
    const { W, H } = TREE;
    const x1 = e.from.x + W, y1 = e.from.y + H / 2, x2 = e.to.x, y2 = e.to.y + H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  function nodeHtml(n) {
    const { W, H } = TREE;
    if (n.isRoot) {
      return `<div class="tnode root" data-node="root" style="left:${n.x}px;top:${n.y}px;width:${W}px;height:${H}px;--nc:${n.color}">
        <div class="tnode-title">${escapeHtml(n.title || 'Проект')}</div>
        <div class="tnode-meta">${svgIcon('folder', 12)}проект</div>
        <button class="tnode-add" data-add="root" title="Добавить ветку" aria-label="Добавить ветку">${svgIcon('plus', 14, 2.4)}</button>
      </div>`;
    }
    const b = n.block;
    const files = filesOwned(b.id).length;
    const meta = [];
    if (b.content.trim()) meta.push(`<span>${svgIcon('note', 12)}${words(b.content)}</span>`);
    if (files) meta.push(`<span>${svgIcon('clip', 12)}${files}</span>`);
    if (!meta.length) meta.push('<span class="muted">пусто</span>');
    return `<div class="tnode" data-node="${b.id}" style="left:${n.x}px;top:${n.y}px;width:${W}px;height:${H}px;--nc:${n.color}">
      <div class="tnode-title">${escapeHtml(b.title || 'Без названия')}</div>
      <div class="tnode-meta">${meta.join('')}</div>
      <button class="tnode-add" data-add="${b.id}" title="Добавить подблок" aria-label="Добавить подблок">${svgIcon('plus', 14, 2.4)}</button>
      ${n.total ? `<button class="tnode-fold ${b.collapsed ? 'folded' : ''}" data-fold="${b.id}" title="${b.collapsed ? 'Развернуть' : 'Свернуть'}">${b.collapsed ? n.total : '−'}</button>` : ''}
    </div>`;
  }

  function view(pid) {
    if (!views.has(pid)) views.set(pid, { x: 20, y: 20, k: 1 });
    return views.get(pid);
  }

  function applyView() {
    const st = $('treeStage');
    if (!st || !openId) return;
    const v = view(openId);
    st.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
  }

  let lastLayout = null;
  function drawTree({ fit = false } = {}) {
    const st = $('treeStage');
    if (!st || !openId) return;
    const L = layout(openId);
    lastLayout = L;
    const P = TREE.PAD;
    st.style.width = (L.width + P * 2) + 'px';
    st.style.height = (L.height + P * 2) + 'px';
    st.innerHTML = `
      <svg class="tree-edges" width="${L.width + P * 2}" height="${L.height + P * 2}" aria-hidden="true">
        <g transform="translate(${P},${P})">${L.edges.map((e) => `<path d="${edgePath(e)}" stroke="${e.color}"/>`).join('')}</g>
      </svg>
      <div class="tree-nodes" style="transform:translate(${P}px,${P}px)">${L.nodes.map(nodeHtml).join('')}</div>
      ${L.nodes.length === 1 ? `<div class="tree-hint" style="left:${P + TREE.W + 26}px;top:${P + 18}px">${svgIcon('back', 14, 2)}Нажми «+», чтобы добавить первую ветку: например, «Дизайн», «Техническая часть», «Реклама», «Тесты»</div>` : ''}`;
    if (fit) fitView(); else applyView();
  }

  function fitView() {
    const wrap = $('treeWrap');
    if (!wrap || !lastLayout || !openId) return;
    const P = TREE.PAD;
    const cw = lastLayout.width + P * 2, ch = lastLayout.height + P * 2;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    const k = Math.max(0.5, Math.min(1, ww / cw, wh / ch));
    const v = view(openId);
    v.k = k;
    v.x = Math.max(0, (ww - cw * k) / 2);
    v.y = Math.max(Math.min(0, wh - ch * k), (wh - ch * k) / 2);
    if (lastLayout.nodes.length === 1) { v.x = 8; }
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const v = view(openId);
    const k = Math.max(0.2, Math.min(2.2, v.k * factor));
    v.x = cx - (cx - v.x) * (k / v.k);
    v.y = cy - (cy - v.y) * (k / v.k);
    v.k = k;
    applyView();
  }

  let fullscreen = false;
  function toggleFullscreen(on = !fullscreen) {
    const wrap = $('treeWrap');
    if (!wrap) return;
    fullscreen = on;
    wrap.classList.toggle('full', on);
    document.documentElement.classList.toggle('no-scroll', on);
    const b = wrap.querySelector('[data-tz="full"]');
    if (b) { b.innerHTML = svgIcon(on ? 'shrink' : 'expand', 16); b.title = on ? 'Свернуть (Esc)' : 'На весь экран'; }
    requestAnimationFrame(fitView);
  }
  function exitFullscreen() { if (fullscreen) toggleFullscreen(false); }

  function bindTree() {
    const wrap = $('treeWrap');
    if (!wrap) return;
    fullscreen = false;
    const pointers = new Map();
    let start = null, pinch = null, moved = false, downTarget = null;

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest('.tree-ctrl')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const v = view(openId);
      if (pointers.size === 1) { start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y }; moved = false; downTarget = e.target; }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const r = wrap.getBoundingClientRect();
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: v.k, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, vx: v.x, vy: v.y };
        moved = true;
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const v = view(openId);
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const k = Math.max(0.2, Math.min(2.2, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
        v.x = pinch.cx - (pinch.cx - pinch.vx) * (k / pinch.k);
        v.y = pinch.cy - (pinch.cy - pinch.vy) * (k / pinch.k);
        v.k = k;
        applyView();
        return;
      }
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      wrap.classList.add('panning');
      v.x = start.vx + dx; v.y = start.vy + dy;
      applyView();
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      wrap.classList.remove('panning');
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        if (!moved && downTarget && e.type === 'pointerup') tap(downTarget);
        start = null; downTarget = null;
      }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('wheel', (e) => {
      const r = wrap.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else if (fullscreen || e.shiftKey) {
        e.preventDefault();
        const v = view(openId);
        v.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        v.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        applyView();
      }
    }, { passive: false });

    wrap.querySelectorAll('[data-tz]').forEach((b) => b.addEventListener('click', () => {
      const r = wrap.getBoundingClientRect();
      const t = b.dataset.tz;
      if (t === 'in') zoomAt(1.2, r.width / 2, r.height / 2);
      else if (t === 'out') zoomAt(1 / 1.2, r.width / 2, r.height / 2);
      else if (t === 'fit') fitView();
      else toggleFullscreen();
    }));
  }

  async function tap(target) {
    const add = target.closest('[data-add]');
    const fold = target.closest('[data-fold]');
    const node = target.closest('[data-node]');
    if (add) {
      const parent = add.dataset.add === 'root' ? null : add.dataset.add;
      const title = await askText({ title: parent ? 'Новый подблок' : 'Новая ветка', placeholder: parent ? 'Например, «Экран входа»' : 'Например, «Дизайн»', actionText: 'Добавить' });
      if (!title || typeof title !== 'string') return;
      createBlock(openId, parent, title);
      drawTree();
      updateStats();
      return;
    }
    if (fold) {
      const b = block(fold.dataset.fold);
      if (!b) return;
      b.collapsed = !b.collapsed;
      save('block', b, { touch: false });
      drawTree();
      return;
    }
    if (node) {
      if (node.dataset.node === 'root') openSettings(openId);
      else openRec('block', node.dataset.node);
    }
  }

  /* ====================== РЕДАКТОР БЛОКА / ЗАПИСИ ====================== */

  const rec = { kind: null, id: null, preview: false, saveTimer: null };

  function recObj() { return rec.kind === 'block' ? block(rec.id) : entry(rec.id); }

  function openRec(kind, id) {
    const o = kind === 'block' ? block(id) : entry(id);
    if (!o) return;
    if ($('recOverlay').classList.contains('open') && rec.id !== id) commitRec();
    rec.kind = kind; rec.id = id;
    const isBlock = kind === 'block';
    $('recTitle').value = o.title || '';
    $('recTitle').placeholder = isBlock ? 'Название блока' : 'Заголовок (необязательно)';
    $('recBody').value = isBlock ? o.content : o.text;
    $('recBody').placeholder = isBlock
      ? 'Опиши блок: задачи, идеи, решения. Работают списки, таблицы, ```код```, ```html …```'
      : 'Текст записи…';
    $('recKidsSec').hidden = !isBlock;
    setRecPreview(false);
    renderRecMeta();
    renderCrumbs();
    renderRecFiles();
    renderKids();
    updateRecCount();
    setRecSave(o.updatedAt ? 'saved' : 'idle');
    $('recScroll').scrollTop = 0;
    NF.openOverlay('recOverlay');
    requestAnimationFrame(recGrow);
  }

  function renderCrumbs() {
    const o = recObj();
    if (!o) return;
    const p = proj(o.p);
    const chain = [];
    if (rec.kind === 'block') {
      let cur = o.parent && block(o.parent);
      const guard = new Set();
      while (cur && !guard.has(cur.id)) { guard.add(cur.id); chain.unshift(cur); cur = cur.parent && block(cur.parent); }
    }
    $('recCrumbs').innerHTML = [
      `<button class="crumb" data-crumb="root" style="--nc:${p.color}"><span class="proj-dot"></span>${escapeHtml(p.title)}</button>`,
      ...chain.map((b) => `<button class="crumb" data-crumb="${b.id}">${escapeHtml(b.title || 'блок')}</button>`),
      rec.kind === 'entry' ? '<span class="crumb current">Запись</span>' : '',
    ].join('<span class="crumb-sep">/</span>');
    $('recCrumbs').querySelectorAll('[data-crumb]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.crumb === 'root') closeRec();
      else openRec('block', b.dataset.crumb);
    }));
  }

  function renderRecMeta() {
    const o = recObj();
    const el = $('recMeta');
    if (rec.kind === 'block') {
      const blocks = blocksOf(o.p);
      const banned = new Set([o.id, ...descendants(o.id).map((b) => b.id)]);
      const options = [`<option value="">${escapeHtml(proj(o.p).title)} (корень)</option>`]
        .concat(blocks.filter((b) => !banned.has(b.id)).map((b) => `<option value="${b.id}" ${o.parent === b.id ? 'selected' : ''}>${escapeHtml(b.title || 'Без названия')}</option>`));
      el.innerHTML = `
        <div class="rec-colors" title="Цвет ветки">
          <button type="button" class="swatch sm auto ${!o.color ? 'active' : ''}" data-bc="" title="Как у родителя" aria-label="Цвет как у родителя"></button>
          ${COLORS.map((c) => `<button type="button" class="swatch sm ${o.color === c ? 'active' : ''}" data-bc="${c}" style="background:${c}" aria-label="Цвет"></button>`).join('')}
        </div>
        <label class="pill-field parent-pick" title="Перенести в другую ветку">
          ${svgIcon('tree', 15)}<select id="recParent" aria-label="Родительский блок">${options.join('')}</select>
        </label>`;
      el.querySelectorAll('[data-bc]').forEach((b) => b.addEventListener('click', () => {
        o.color = b.dataset.bc;
        el.querySelectorAll('[data-bc]').forEach((x) => x.classList.toggle('active', x === b));
        changed();
      }));
      $('recParent').addEventListener('change', (e) => { o.parent = e.target.value || null; changed(); renderCrumbs(); });
    } else {
      const blocks = blocksOf(o.p);
      el.innerHTML = `
        <span class="rec-date">${svgIcon('clock', 14)}${escapeHtml(fmtTime(o.createdAt))}</span>
        <label class="pill-field parent-pick" title="Привязать к блоку дерева">
          ${svgIcon('tree', 15)}<select id="recParent" aria-label="Блок">
            <option value="">Без блока</option>
            ${blocks.map((b) => `<option value="${b.id}" ${o.block === b.id ? 'selected' : ''}>${escapeHtml(b.title || 'Без названия')}</option>`).join('')}
          </select>
        </label>`;
      $('recParent').addEventListener('change', (e) => { o.block = e.target.value || null; changed(); });
    }
  }

  function renderRecFiles() {
    const o = recObj();
    if (!o) return;
    const files = filesOwned(o.id);
    const el = $('recFiles');
    el.innerHTML = files.length
      ? files.map((f) => fileTile(f, { compact: true })).join('')
      : '<div class="drop-hint sm">Перетащи файлы сюда или нажми «+ Файл»</div>';
    bindFileTiles(el);
  }

  function renderKids() {
    if (rec.kind !== 'block') return;
    const o = recObj();
    const kids = S.blocks.filter((b) => b.parent === o.id).sort((a, b) => a.createdAt - b.createdAt);
    const el = $('recKids');
    el.innerHTML = kids.length
      ? kids.map((k) => `<button class="kid" data-kid="${k.id}"><span class="kid-dot" style="background:${k.color || 'var(--faint)'}"></span>${escapeHtml(k.title || 'Без названия')}<span class="kid-n">${S.blocks.filter((b) => b.parent === k.id).length || ''}</span></button>`).join('')
      : '<span class="muted small-text">Подблоков нет</span>';
    el.querySelectorAll('[data-kid]').forEach((b) => b.addEventListener('click', () => openRec('block', b.dataset.kid)));
  }

  function setRecSave(s) {
    const el = $('recSave');
    const text = { idle: '', pending: 'Изменено', saving: 'Сохранение…', saved: 'Сохранено', error: 'Нет связи — повторю' }[s] || '';
    el.dataset.state = s;
    el.innerHTML = text ? `<span class="ss-dot"></span><span>${text}</span>` : '';
  }
  saveListeners.add((s) => { if ($('recOverlay') && $('recOverlay').classList.contains('open')) setRecSave(s); });

  function updateRecCount() {
    const t = $('recBody').value;
    const w = words(t);
    $('recCount').textContent = `${w} ${plural(w, 'слово', 'слова', 'слов')} · ${filesOwned(rec.id).length} ${plural(filesOwned(rec.id).length, 'файл', 'файла', 'файлов')}`;
  }

  function recGrow() {
    const ta = $('recBody');
    if (ta.hidden) return;
    const sc = $('recScroll'), top = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight + 2, 160) + 'px';
    sc.scrollTop = top;
  }

  let trackTimer = null;
  function changed() {
    const o = recObj();
    if (!o) return;
    o.title = $('recTitle').value.trim();
    if (rec.kind === 'block') o.content = $('recBody').value; else o.text = $('recBody').value;
    save(rec.kind, o);
    clearTimeout(trackTimer);
    trackTimer = setTimeout(() => track(o.p), 400);
  }

  function commitRec() {
    const o = recObj();
    if (o && window.Links) Links.ingest((rec.kind === 'block' ? o.content : o.text) || '');
    flush();
  }

  function closeRec() {
    commitRec();
    NF.closeOverlay('recOverlay');
    rec.id = null;
    if (NF.mode === 'projects' && openId) { drawTree(); renderEntries(); updateStats(); renderFilesSection(); }
  }

  function setRecPreview(on) {
    rec.preview = !!on;
    $('recBody').hidden = rec.preview;
    $('recPreview').hidden = !rec.preview;
    if (rec.preview) $('recPreview').innerHTML = renderBody($('recBody').value) || '<p class="muted">Пока пусто</p>';
    const tb = $('recToolbar');
    tb.classList.toggle('previewing', rec.preview);
    const pb = tb.querySelector('[data-tool="preview"]');
    if (pb) { pb.classList.toggle('active', rec.preview); pb.setAttribute('aria-pressed', String(rec.preview)); }
    if (!rec.preview) requestAnimationFrame(recGrow);
  }

  async function deleteRec() {
    const o = recObj();
    if (!o) return;
    if (rec.kind === 'block') {
      const sub = descendants(o.id);
      const nf = [o, ...sub].reduce((s, b) => s + filesOwned(b.id).length, 0);
      const parts = [];
      if (sub.length) parts.push(`${sub.length} ${plural(sub.length, 'подблок', 'подблока', 'подблоков')}`);
      if (nf) parts.push(`${nf} ${plural(nf, 'файл', 'файла', 'файлов')}`);
      if (!(await askConfirm({ title: `Удалить «${o.title || 'блок'}»?`, message: parts.length ? `Вместе с ним удалятся ${parts.join(' и ')}.` : 'Блок будет удалён навсегда.' }))) return;
      NF.closeOverlay('recOverlay');
      rec.id = null;
      await hardDelete([o.id, ...sub.map((b) => b.id)]);
    } else {
      if (!(await askConfirm({ title: 'Удалить запись?', message: filesOwned(o.id).length ? 'Прикреплённые файлы тоже удалятся.' : 'Запись будет удалена навсегда.' }))) return;
      NF.closeOverlay('recOverlay');
      rec.id = null;
      await hardDelete([o.id]);
    }
    track(o.p);
    if (NF.mode === 'projects') NF.render();
  }

  function bindRec() {
    $('recToolbar').innerHTML = NF.toolbarHtml({ font: false });
    const tb = $('recToolbar');
    tb.addEventListener('mousedown', (e) => { if (e.target.closest('.tool')) e.preventDefault(); });
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('.tool');
      if (!b) return;
      if (b.dataset.tool === 'preview') { setRecPreview(!rec.preview); return; }
      if (rec.preview) setRecPreview(false);
      NF.applyFormat($('recBody'), b.dataset.tool);
    });
    $('recTitle').addEventListener('input', () => { changed(); });
    $('recTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('recBody').focus(); } });
    $('recBody').addEventListener('input', () => { changed(); updateRecCount(); recGrow(); });
    $('recBody').addEventListener('keydown', NF.onBodyKeydown);
    $('recBody').addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])];
      const o = recObj();
      if (files.length && o) { e.preventDefault(); addFiles(files, { p: o.p, owner: o.id }); }
    });
    $('recPreview').addEventListener('dblclick', () => setRecPreview(false));
    $('recClose').addEventListener('click', closeRec);
    $('recDone').addEventListener('click', closeRec);
    $('recDelete').addEventListener('click', deleteRec);
    $('recAttach').addEventListener('click', () => { const o = recObj(); if (o) pickFiles({ p: o.p, owner: o.id }); });
    $('recAddKid').addEventListener('click', async () => {
      const o = recObj();
      if (!o) return;
      const title = await askText({ title: 'Новый подблок', placeholder: 'Название', actionText: 'Добавить' });
      if (!title || typeof title !== 'string') return;
      createBlock(o.p, o.id, title);
      renderKids();
    });
    $('recOverlay').addEventListener('mousedown', (e) => { if (e.target.id === 'recOverlay') closeRec(); });
    bindDrop($('recOverlay').querySelector('.modal'), (files) => { const o = recObj(); if (o) addFiles(files, { p: o.p, owner: o.id }); });
    NF.closeHooks.recOverlay = closeRec;
  }

  /* ====================== ОТЧЁТ ====================== */

  const reportOpts = { stats: true, tree: true, blocks: true, entries: true, files: true, images: true };
  let reportPid = null;

  async function openReport(pid) {
    reportPid = pid;
    await flush();
    const opts = $('reportOpts');
    const labels = { stats: 'Статистика', tree: 'Дерево', blocks: 'Блоки', entries: 'Записи', files: 'Список файлов', images: 'Картинки' };
    opts.innerHTML = Object.entries(labels).map(([k, v]) => `<label class="opt"><input type="checkbox" data-opt="${k}" ${reportOpts[k] ? 'checked' : ''}><span>${v}</span></label>`).join('');
    opts.querySelectorAll('[data-opt]').forEach((c) => c.addEventListener('change', () => { reportOpts[c.dataset.opt] = c.checked; buildReport(); }));
    NF.openOverlay('reportOverlay');
    $('reportOverlay').scrollTop = 0;
    buildReport();
  }

  function closeReport() {
    NF.closeOverlay('reportOverlay');
    reportPid = null;
  }

  async function buildReport() {
    const pid = reportPid;
    const paper = $('reportPaper');
    if (!pid) return;
    const images = filesOf(pid).filter((f) => fileKind(f) === 'image');
    if (reportOpts.images && images.some((f) => !fileCache.has(f.id))) {
      paper.innerHTML = '<div class="viewer-loading"><span class="file-spin"></span>Загружаю изображения для отчёта…</div>';
      await Promise.all(images.map((f) => getData(f).catch(() => null)));
      if (pid !== reportPid) return;
    }
    paper.innerHTML = reportHtml(pid);
  }

  function reportTreeSvg(pid) {
    const L = layout(pid, { ignoreCollapsed: true });
    const { W, H } = TREE;
    const P = 10;
    const wrapText = (t, max) => {
      const ws = String(t || '').split(/\s+/);
      const lines = [''];
      ws.forEach((w) => {
        const cur = lines[lines.length - 1];
        if ((cur + ' ' + w).trim().length > max && cur) lines.push(w); else lines[lines.length - 1] = (cur + ' ' + w).trim();
      });
      if (lines.length > 2) { lines.length = 2; lines[1] = lines[1].slice(0, max - 1) + '…'; }
      return lines.map((l) => (l.length > max ? l.slice(0, max - 1) + '…' : l));
    };
    const nodes = L.nodes.map((n) => {
      const lines = wrapText(n.isRoot ? n.title : n.block.title || 'Без названия', 24);
      const ty = n.y + H / 2 - (lines.length - 1) * 9 + 5;
      return `<g>
        <rect x="${n.x}" y="${n.y + 6}" width="${W}" height="${H - 12}" rx="12" fill="${n.isRoot ? n.color : '#ffffff'}" stroke="${n.color}" stroke-width="${n.isRoot ? 0 : 2}"/>
        ${n.isRoot ? '' : `<rect x="${n.x}" y="${n.y + 6}" width="6" height="${H - 12}" rx="3" fill="${n.color}"/>`}
        ${lines.map((l, i) => `<text x="${n.x + W / 2}" y="${ty + i * 18}" text-anchor="middle" font-size="14" font-weight="${n.isRoot ? 700 : 600}" fill="${n.isRoot ? '#ffffff' : '#18181b'}">${escapeHtml(l)}</text>`).join('')}
      </g>`;
    }).join('');
    const edges = L.edges.map((e) => `<path d="${edgePath(e)}" fill="none" stroke="${e.color}" stroke-width="2" opacity=".7"/>`).join('');
    return `<svg class="rp-tree" viewBox="${-P} ${-P} ${L.width + P * 2} ${L.height + P * 2}" xmlns="http://www.w3.org/2000/svg" font-family="Geist, Inter, Arial, sans-serif">${edges}${nodes}</svg>`;
  }

  // Блоки в порядке обхода дерева с нумерацией 1, 1.1, 1.2…
  function orderedBlocks(pid) {
    const all = blocksOf(pid);
    const ids = new Set(all.map((b) => b.id));
    const out = [];
    const seen = new Set();
    const walk = (parent, prefix, depth) => {
      all.filter((b) => (parent === null ? (!b.parent || !ids.has(b.parent)) : b.parent === parent))
        .sort((a, b) => a.createdAt - b.createdAt)
        .forEach((b, i) => {
          if (seen.has(b.id)) return;
          seen.add(b.id);
          const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
          out.push({ b, num, depth });
          walk(b.id, num, depth + 1);
        });
    };
    walk(null, '', 0);
    return out;
  }

  function reportFiles(files) {
    if (!files.length) return '';
    const imgs = reportOpts.images ? files.filter((f) => fileKind(f) === 'image' && fileCache.has(f.id)) : [];
    const rest = files.filter((f) => !imgs.includes(f));
    return `
      ${imgs.length ? `<div class="rp-images">${imgs.map((f) => `<figure><img src="${escapeHtml(fileCache.get(f.id))}" alt=""><figcaption>${escapeHtml(f.name)}</figcaption></figure>`).join('')}</div>` : ''}
      ${rest.length ? `<div class="rp-attach">${rest.map((f) => `<span class="rp-file"><b style="color:${KIND_COLOR[fileKind(f)]}">${tagOf(f)}</b>${escapeHtml(f.name)} <i>${fmtSize(f.size)}</i></span>`).join('')}</div>` : ''}`;
  }

  function reportHtml(pid) {
    const p = proj(pid);
    const st = stats(pid);
    const o = reportOpts;
    const parts = [];

    parts.push(`
      <header class="rp-cover" style="--c:${p.color}">
        <div class="rp-kicker">Отчёт по проекту</div>
        <h1>${escapeHtml(p.title)}</h1>
        <div class="rp-meta">
          <span>Статус: <b>${STATUS[p.status]}</b></span>
          <span>Начат: <b>${fmtDate(p.createdAt)}</b></span>
          <span>Последняя активность: <b>${fmtDate(st.last)}</b></span>
          <span>Отчёт от ${fmtDate(Date.now())}</span>
        </div>
        ${p.desc ? `<div class="md rp-desc">${renderBody(p.desc)}</div>` : ''}
      </header>`);

    if (o.stats) {
      const ser = series(pid, 30);
      const max = Math.max(...ser.map((s) => s.v), 1);
      const W = 640, H = 120, bw = W / ser.length;
      const bars = ser.map((s, i) => {
        const h = s.v / max * (H - 24);
        const d = new Date(s.ts);
        return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 1.5).toFixed(1)}" rx="2" fill="${s.v ? p.color : '#e4e4e7'}"/>` +
          (i % 5 === 0 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" font-size="9" text-anchor="middle" fill="#71717a">${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}</text>` : '');
      }).join('');
      const kinds = Object.entries(st.byKind).sort((a, b) => b[1] - a[1]);
      const totalF = kinds.reduce((s, k) => s + k[1], 0) || 1;
      parts.push(`
        <section class="rp-section">
          <h2>Статистика</h2>
          <div class="rp-kpis">
            ${[
              [st.blocks, plural(st.blocks, 'блок', 'блока', 'блоков')],
              [st.depth, 'уровней дерева'],
              [st.entries, plural(st.entries, 'запись', 'записи', 'записей')],
              [st.files, `${plural(st.files, 'файл', 'файла', 'файлов')} · ${fmtSize(st.size)}`],
              [st.words, plural(st.words, 'слово', 'слова', 'слов')],
              [st.days, plural(st.days, 'день работы', 'дня работы', 'дней работы')],
              [fmtDuration(st.minutes), 'примерно в работе'],
              [st.span, plural(st.span, 'день с начала', 'дня с начала', 'дней с начала')],
            ].map(([v, k]) => `<div class="rp-kpi"><b>${v}</b><span>${k}</span></div>`).join('')}
          </div>
          <h3>Активность за 30 дней</h3>
          <svg class="rp-chart" viewBox="0 0 ${W} ${H}">${bars}</svg>
          ${kinds.length ? `
            <h3>Файлы по типам</h3>
            <div class="rp-stack">${kinds.map(([k, n]) => `<span style="flex:${n};background:${KIND_COLOR[k]}"></span>`).join('')}</div>
            <div class="rp-legend">${kinds.map(([k, n]) => `<span><i style="background:${KIND_COLOR[k]}"></i>${KIND_LABEL[k]} — ${n} (${Math.round(n / totalF * 100)}%)</span>`).join('')}</div>` : ''}
        </section>`);
    }

    const ob = orderedBlocks(pid);
    if (o.tree && ob.length) {
      parts.push(`
        <section class="rp-section rp-tree-sec">
          <h2>Структура проекта</h2>
          ${reportTreeSvg(pid)}
          <ol class="rp-outline">${ob.map(({ b, num, depth }) => `<li style="--d:${depth}"><span>${num}</span>${escapeHtml(b.title || 'Без названия')}</li>`).join('')}</ol>
        </section>`);
    }

    if (o.blocks && ob.length) {
      parts.push(`
        <section class="rp-section">
          <h2>Блоки</h2>
          ${ob.map(({ b, num, depth }) => {
            const files = filesOwned(b.id);
            const empty = !b.content.trim() && !files.length;
            return `<article class="rp-block" style="--d:${depth}">
              <h3><span class="rp-num">${num}</span>${escapeHtml(b.title || 'Без названия')}</h3>
              ${b.content.trim() ? `<div class="md">${renderBody(b.content)}</div>` : ''}
              ${o.files || o.images ? reportFiles(files) : ''}
              ${empty ? '<p class="rp-muted">Пока без описания</p>' : ''}
            </article>`;
          }).join('')}
        </section>`);
    }

    const es = entriesOf(pid).sort((a, b) => a.createdAt - b.createdAt);
    if (o.entries && es.length) {
      parts.push(`
        <section class="rp-section">
          <h2>Журнал записей</h2>
          ${es.map((e) => {
            const b = e.block && block(e.block);
            return `<article class="rp-entry">
              <div class="rp-entry-date">${escapeHtml(fmtTime(e.createdAt))}${b ? ` · ${escapeHtml(b.title)}` : ''}</div>
              ${e.title ? `<h4>${escapeHtml(e.title)}</h4>` : ''}
              ${e.text ? `<div class="md">${renderBody(e.text)}</div>` : ''}
              ${o.files || o.images ? reportFiles(filesOwned(e.id)) : ''}
            </article>`;
          }).join('')}
        </section>`);
    }

    const pf = filesOf(pid).filter((f) => f.owner === pid);
    if ((o.files || o.images) && pf.length) {
      parts.push(`<section class="rp-section"><h2>Материалы проекта</h2>${reportFiles(pf)}</section>`);
    }

    const all = filesOf(pid).sort((a, b) => a.createdAt - b.createdAt);
    if (o.files && all.length) {
      parts.push(`
        <section class="rp-section">
          <h2>Приложения</h2>
          <table class="rp-table"><thead><tr><th>№</th><th>Файл</th><th>Тип</th><th>Размер</th><th>Где</th><th>Добавлен</th></tr></thead>
          <tbody>${all.map((f, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(f.name)}</td><td>${KIND_LABEL[fileKind(f)]}</td><td>${fmtSize(f.size)}</td><td>${escapeHtml(ownerLabel(f))}</td><td>${fmtDate(f.createdAt)}</td></tr>`).join('')}</tbody></table>
        </section>`);
    }

    parts.push(`<footer class="rp-foot">NodeFlow · ${escapeHtml(p.title)} · ${fmtTime(Date.now())}</footer>`);
    return parts.join('');
  }

  function printReport() {
    document.body.classList.add('printing-report');
    const done = () => { document.body.classList.remove('printing-report'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1000); }, 50);
  }

  function bindReport() {
    $('reportClose').addEventListener('click', closeReport);
    $('reportPrint').addEventListener('click', printReport);
    NF.closeHooks.reportOverlay = closeReport;
  }

  /* ====================== ПРОЧЕЕ ====================== */

  function addAction() {
    if (!openId) { createDialog(); return; }
    const ta = $('composerText');
    if (ta) { ta.scrollIntoView({ block: 'center', behavior: 'smooth' }); ta.focus({ preventScroll: true }); }
  }

  function onEscape() {
    if (fullscreen) { toggleFullscreen(false); return true; }
    if (NF.mode === 'projects' && openId) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') { document.activeElement.blur(); return true; }
      close();
      return true;
    }
    return false;
  }

  window.addEventListener('resize', () => { if (fullscreen) fitView(); });

  document.addEventListener('DOMContentLoaded', () => {
    bindRec();
    bindReport();
  });

  window.Projects = {
    ingest, reset, render, open, close, createDialog, addAction, onEscape,
    trashed, restore, purge,
    get openId() { return openId; },
  };
})();
