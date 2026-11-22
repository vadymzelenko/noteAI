// NodeNote — картинки в тексте и предпросмотр ссылок.
//
// • Картинки хранятся внутри приложения (строки items с category '__nf_img',
//   содержимое — data:-URL), а в тексте стоит короткая метка ![подпись](nf:ID).
//   Никаких внешних ссылок: вставка с устройства, из буфера обмена,
//   перетаскиванием или подбор в Википедии / Wikimedia Commons.
// • Предпросмотр ссылок: сервер (/api/preview) достаёт заголовок и картинку
//   страницы (og:image) — карточки ссылок получают обложку автоматически.
(function () {
  'use strict';

  const NF = window.NF;
  const { $, escapeHtml, svgIcon, toast, uid, plural } = NF;

  const CAT = '__nf_img';
  const MAX_SIDE = 2000;
  const MAX_BYTES = 12 * 1024 * 1024;

  const meta = new Map();      // id → { id, owner, name, mime, size, createdAt }
  const cache = new Map();     // id → data:-URL (картинки заметок и файлы проектов)
  const loading = new Map();   // id → Promise

  /* ====================== ХРАНЕНИЕ ====================== */

  function ingest(rows) {
    meta.clear();
    rows.filter((r) => r.category === CAT).forEach((r) => {
      const m = {};
      (r.tags || []).forEach((t) => { const i = String(t).indexOf(':'); if (i > 0) m[t.slice(0, i)] = t.slice(i + 1); });
      meta.set(r.id, { id: r.id, owner: m.o || '', name: r.title || 'image', mime: m.m || 'image/jpeg', size: +m.s || 0, createdAt: r.createdAt || Date.now() });
    });
  }

  function getData(id) {
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    // Файлы проектов уже могут лежать в кэше projects.js.
    const pc = window.Projects && Projects._ && Projects._.fileCache;
    if (pc && pc.has(id)) { cache.set(id, pc.get(id)); return Promise.resolve(pc.get(id)); }
    if (!loading.has(id)) {
      loading.set(id, DB.fileData(id).then((d) => { cache.set(id, d); loading.delete(id); return d; })
        .catch((e) => { loading.delete(id); throw e; }));
    }
    return loading.get(id);
  }

  function readAsDataUrl(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }

  // Уменьшаем до 2000 px по длинной стороне и пережимаем в JPEG/WebP —
  // фото с телефона весят мегабайты, а в заметке это не нужно.
  async function compress(blob) {
    const type = blob.type || 'image/jpeg';
    if (/gif|svg/.test(type) && blob.size < 2 * 1024 * 1024) return { data: await readAsDataUrl(blob), mime: type };
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      if (k === 1 && blob.size < 400 * 1024) return { data: await readAsDataUrl(blob), mime: type };
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      const alpha = /png|webp/.test(type);
      if (!alpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      let out = alpha ? c.toDataURL('image/webp', 0.88) : c.toDataURL('image/jpeg', 0.86);
      let mime = alpha ? 'image/webp' : 'image/jpeg';
      if (alpha && !out.startsWith('data:image/webp')) { out = c.toDataURL('image/png'); mime = 'image/png'; }
      return { data: out, mime };
    } finally { URL.revokeObjectURL(url); }
  }

  async function store(blob, owner, name) {
    if (blob.size > MAX_BYTES) throw new Error('картинка больше 12 МБ');
    const { data, mime } = await compress(blob);
    const id = uid();
    const now = Date.now();
    const size = Math.round((data.length - data.indexOf(',') - 1) * 0.75);
    cache.set(id, data);
    meta.set(id, { id, owner, name, mime, size, createdAt: now });
    await DB.putItem({
      id, type: 'note', title: String(name || 'image').slice(0, 200), category: CAT,
      tags: [`o:${owner}`, `m:${mime}`, `s:${size}`], body: data,
      createdAt: now, updatedAt: now, deleted: false, done: false, font: 'sans', importance: 'green',
    });
    return id;
  }

  const altOf = (name) => String(name || 'фото').replace(/\.[a-z0-9]+$/i, '').replace(/[\[\]()]/g, '').slice(0, 60) || 'фото';

  // Вставить картинки в поле: сразу видно в тексте, загрузка — в фоне.
  async function insertImages(ta, files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return 0;
    const owner = ta.dataset.owner || 'loose';
    let done = 0;
    for (const f of imgs) {
      try {
        const id = await store(f, owner, f.name || 'фото');
        NF.insertText(ta, `![${altOf(f.name)}](nf:${id})`);
        done++;
      } catch (e) {
        console.error('[media] upload', e);
        toast(`Картинка не загрузилась: ${e.message || 'ошибка сети'}`, 'err', 4500);
      }
    }
    if (done) toast(done === 1 ? 'Картинка добавлена' : `Добавлено картинок: ${done}`, 'ok', 1800);
    return done;
  }

  /* ====================== ОТОБРАЖЕНИЕ ====================== */

  // Все <img data-nfimg> на странице получают src сами — где бы ни
  // отрисовывался markdown (редактор, карточки, проекты, отчёт).
  function hydrateEl(img) {
    const id = img.dataset.nfimg;
    if (!id || img.dataset.loaded) return Promise.resolve();
    img.dataset.loaded = '1';
    img.classList.add('nf-loading');
    return getData(id).then((d) => {
      img.src = d;
      img.classList.remove('nf-loading');
    }).catch(() => {
      img.classList.remove('nf-loading');
      img.classList.add('nf-missing');
      img.alt = (img.alt || 'картинка') + ' (не найдена)';
    });
  }

  function hydrate(root = document) {
    return Promise.all([...root.querySelectorAll('img[data-nfimg]:not([data-loaded])')].map(hydrateEl));
  }

  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('img[data-nfimg]')) hydrateEl(n);
        else if (n.querySelector && n.querySelector('img[data-nfimg]')) hydrate(n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Первая картинка в тексте — для обложки карточки.
  function firstImage(text) {
    const m = String(text || '').match(/!\[[^\]]*\]\((nf:[\w-]+|https?:\/\/[^)\s]+)\)/);
    if (!m) return null;
    return m[1].startsWith('nf:') ? { id: m[1].slice(3) } : { url: m[1] };
  }

  /* ====================== ВЫБОР ИСТОЧНИКА ====================== */

  function pickFromDevice(ta, { camera = false } = {}) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = !camera;
    if (camera) input.capture = 'environment';
    input.onchange = () => insertImages(ta, input.files);
    input.click();
  }

  async function pick(ta) {
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    const choice = await NF.askChoice({
      title: 'Добавить картинку',
      message: 'Картинка сохранится внутри заметки — без ссылок.',
      choices: [
        { id: 'device', label: 'С устройства', hint: 'галерея, файлы — можно сразу несколько' },
        { id: 'wiki', label: 'Подобрать автоматически', hint: sel ? `поиск по «${sel.slice(0, 40)}»` : 'поиск по заголовку или выделенному тексту' },
        ...(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? [{ id: 'camera', label: 'Снять камерой' }] : []),
      ],
    });
    if (choice === 'device') pickFromDevice(ta);
    else if (choice === 'camera') pickFromDevice(ta, { camera: true });
    else if (choice === 'wiki') openFinder(ta, sel || guessQuery(ta));
  }

  function guessQuery(ta) {
    // Текущая строка без markdown-разметки, иначе заголовок записи.
    const v = ta.value;
    const ls = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    let le = v.indexOf('\n', ta.selectionStart); if (le === -1) le = v.length;
    const line = v.slice(ls, le).replace(/^\s*([-*]|\d+\.|#+|>)\s*(\[[ xX]\]\s*)?/, '').replace(/^\d{1,2}:\d{2}\s+/, '').replace(/[*_~`]/g, '').trim();
    if (line && line.length < 80 && !/^!\[/.test(line)) return line;
    const title = ta.closest('.modal, .ws-pane')?.querySelector('.editor-title, .ws-title');
    return title ? title.value.trim() : '';
  }

  /* --- Поиск картинок: Википедия + Wikimedia Commons --- */
  async function searchImages(q) {
    const enc = encodeURIComponent(q);
    const wiki = (lang) => fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${enc}&gsrlimit=12&prop=pageimages&piprop=thumbnail&pithumbsize=1200&pilicense=any`)
      .then((r) => r.json())
      .then((d) => Object.values((d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
        .filter((p) => p.thumbnail && p.thumbnail.source)
        .map((p) => ({ title: p.title, src: p.thumbnail.source, thumb: p.thumbnail.source.replace(/\/\d+px-/, '/400px-'), source: `${lang}.wikipedia` })))
      .catch(() => []);
    const commons = fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${enc}%20filetype:bitmap&gsrlimit=16&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200`)
      .then((r) => r.json())
      .then((d) => Object.values((d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0))
        .map((p) => p.imageinfo && p.imageinfo[0]).filter((ii) => ii && ii.thumburl && /jpeg|png|webp/.test(ii.mime))
        .map((ii, i) => ({ title: `Commons #${i + 1}`, src: ii.thumburl, thumb: ii.thumburl.replace(/\/\d+px-/, '/400px-'), source: 'commons' })))
      .catch(() => []);
    const [ru, en, cm] = await Promise.all([wiki('ru'), wiki('en'), commons]);
    const seen = new Set();
    return [...ru, ...en, ...cm].filter((x) => (seen.has(x.src) ? false : seen.add(x.src))).slice(0, 30);
  }

  function openFinder(ta, query) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay finder-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = `
      <div class="modal modal-lg finder">
        <header class="modal-head">
          <form class="finder-search">
            ${svgIcon('search', 17)}
            <input type="search" value="${escapeHtml(query)}" placeholder="Что найти? Например, «Super Mario 64»" aria-label="Поиск картинок" enterkeyhint="search">
          </form>
          <button class="icon-btn" data-x aria-label="Закрыть">${svgIcon('close', 18, 2)}</button>
        </header>
        <div class="modal-body">
          <div class="finder-grid"></div>
          <p class="hint finder-note">Картинки из Википедии и Wikimedia Commons. Выбранная копируется в заметку.</p>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('open'));
    const grid = ov.querySelector('.finder-grid');
    const input = ov.querySelector('input');
    const close = () => {
      ov.classList.remove('open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => ov.remove(), 250);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-x]').addEventListener('click', close);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });

    let seq = 0;
    const run = async () => {
      const q = input.value.trim();
      if (!q) { grid.innerHTML = '<div class="empty small">Введи, что найти</div>'; return; }
      const my = ++seq;
      grid.innerHTML = Array.from({ length: 8 }, () => '<div class="finder-sk"></div>').join('');
      const res = await searchImages(q);
      if (my !== seq) return;
      if (!res.length) { grid.innerHTML = '<div class="empty small">Ничего не нашлось. Попробуй по-английски или короче.</div>'; return; }
      grid.innerHTML = res.map((r, i) => `<button class="finder-item" data-i="${i}" title="${escapeHtml(r.title)}"><img src="${escapeHtml(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span>${escapeHtml(r.title)}</span></button>`).join('');
      grid.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', async () => {
        const r = res[+b.dataset.i];
        b.classList.add('busy');
        try {
          const blob = await fetch(r.src, { referrerPolicy: 'no-referrer' }).then((x) => { if (!x.ok) throw new Error('HTTP ' + x.status); return x.blob(); });
          const id = await store(blob, ta.dataset.owner || 'loose', r.title);
          close();
          NF.insertText(ta, `![${altOf(r.title)}](nf:${id})`);
          toast('Картинка добавлена', 'ok', 1800);
        } catch (e) {
          b.classList.remove('busy');
          toast('Не удалось скачать картинку: ' + (e.message || 'ошибка'), 'err');
        }
      }));
    };
    ov.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
    setTimeout(() => { input.focus(); run(); }, 60);
  }

  /* ====================== ОЧИСТКА ====================== */

  // Удаляем картинки, у которых нет владельца, а также давно (7+ дней)
  // не упоминаемые в тексте своего владельца.
  function cleanup(textOf) {
    const week = 7 * 24 * 3600 * 1000;
    const dead = [];
    meta.forEach((m) => {
      const t = textOf(m.owner);
      if (t === undefined) { if (Date.now() - m.createdAt > 24 * 3600 * 1000) dead.push(m.id); return; }
      if (!String(t).includes('nf:' + m.id) && Date.now() - m.createdAt > week) dead.push(m.id);
    });
    if (!dead.length) return;
    dead.forEach((id) => { meta.delete(id); cache.delete(id); });
    DB.deleteMany(dead).catch((e) => console.warn('[media] cleanup', e));
  }

  /* ====================== ПРЕДПРОСМОТР ССЫЛОК ====================== */

  const PKEY = 'nf.previews';
  let previews = {};
  try { previews = JSON.parse(localStorage.getItem(PKEY) || '{}') || {}; } catch { previews = {}; }
  const savePreviews = () => {
    const keys = Object.keys(previews);
    if (keys.length > 400) keys.sort((a, b) => previews[a].at - previews[b].at).slice(0, keys.length - 400).forEach((k) => delete previews[k]);
    try { localStorage.setItem(PKEY, JSON.stringify(previews)); } catch { /* ignore */ }
  };
  const queue = [];
  let active = 0;

  async function token() {
    try { const { data } = await Auth.client.auth.getSession(); return data?.session?.access_token || ''; } catch { return ''; }
  }

  function preview(url) {
    const hit = previews[url];
    if (hit && Date.now() - hit.at < 14 * 24 * 3600 * 1000) return Promise.resolve(hit.data);
    return new Promise((resolve) => { queue.push({ url, resolve }); pump(); });
  }

  function pump() {
    while (active < 3 && queue.length) {
      const { url, resolve } = queue.shift();
      active++;
      (async () => {
        try {
          const t = await token();
          if (!t) { resolve(null); return; }
          const r = await fetch('/api/preview?url=' + encodeURIComponent(url), { headers: { Authorization: 'Bearer ' + t } });
          const data = r.ok ? await r.json() : null;
          previews[url] = { at: Date.now(), data: data || {} };
          savePreviews();
          resolve(data);
        } catch { resolve(null); }
        finally { active--; pump(); }
      })();
    }
  }

  window.Media = { ingest, insertImages, pick, openFinder, hydrate, getData, firstImage, cleanup, preview, cache, meta };
})();
