// NodeNote — основная логика интерфейса. Бэкенд — Supabase (см. db.js).
(function () {
  'use strict';

  /* ====================== КОНСТАНТЫ ====================== */

  const TRASH_TTL = 14 * 24 * 60 * 60 * 1000;
  // Настройки (prefs.js); значения по умолчанию — если модуль не загрузился.
  const pref = (k, def) => (window.Prefs ? Prefs.get(k) : def);
  const doneVisible = () => +pref('doneVisible', 5);
  const autosaveDelay = () => ({ fast: 350, normal: 700, slow: 1500 }[pref('autosave', 'normal')] || 700);
  const RETRY_DELAY = 5000;

  // Служебные записи в таблице items (старые настройки ИИ и коллекция ссылок) —
  // не показываем их в списках.
  const SERVICE_IDS = new Set([
    '00000000-0000-0000-0000-0000000a1a1a',
    '00000000-0000-0000-0000-0000000b2b2b',
  ]);

  const ACCENTS = [
    { id: 'mono',   label: 'Моно' },
    { id: 'blue',   label: 'Синий' },
    { id: 'violet', label: 'Фиолетовый' },
    { id: 'green',  label: 'Зелёный' },
    { id: 'orange', label: 'Оранжевый' },
    { id: 'pink',   label: 'Розовый' },
  ];

  const ICONS = {
    task: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    theme: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    metrics: '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    account: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    ban: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>',
    // Тулбар редактора
    heading: '<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>',
    bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic: '<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>',
    strike: '<path d="M16 6.5C15.2 5 13.7 4 12 4c-2.5 0-4.5 1.6-4.5 3.8 0 1.1.5 2 1.4 2.7"/><path d="M8 17.5C8.8 19 10.3 20 12 20c2.5 0 4.5-1.6 4.5-3.8 0-.8-.2-1.5-.7-2.2"/><line x1="4" y1="12" x2="20" y2="12"/>',
    ul: '<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    ol: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 4h1v5"/><path d="M4 9h2"/><path d="M6 20H4c0-1.2 2-2 2-3.2 0-.6-.5-.8-1-.8s-1 .3-1 .8"/>',
    checklist: '<rect x="3" y="4" width="6" height="6" rx="1.5"/><path d="M3.5 17l2 2 3.5-3.5"/><line x1="13" y1="7" x2="21" y2="7"/><line x1="13" y1="17" x2="21" y2="17"/>',
    quote: '<line x1="4" y1="5" x2="4" y2="19"/><line x1="9" y1="8" x2="20" y2="8"/><line x1="9" y1="12" x2="18" y2="12"/><line x1="9" y1="16" x2="15" y2="16"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/>',
    chart: '<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7" rx="1"/><rect x="12" y="6" width="3" height="11" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
    mono: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    tree: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h6"/><path d="M12 6v12h3"/>',
    clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    back: '<polyline points="15 18 9 12 15 6"/>',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="18" x2="8" y2="14"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="16" y1="18" x2="16" y2="16"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M20 9V5a1 1 0 0 0-1-1h-4"/><path d="M4 15v4a1 1 0 0 0 1 1h4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/>',
    expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
    shrink: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>',
    star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  };

  function svgIcon(name, size = 16, sw = 1.8) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  const state = {
    mode: 'tasks',
    themePref: 'dark',
    accent: 'mono',
    items: [],
    loaded: false,
    authReady: false,
    animateNext: true,
    search: { type: 'all' },
    links: { group: '', query: '' },
    editingId: null,
    editingType: 'task',
  };

  /* ====================== УТИЛИТЫ ====================== */

  const $ = (id) => document.getElementById(id);

  const uid = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));

  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const pad2 = (n) => String(n).padStart(2, '0');
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  // «сегодня, 14:00», «завтра, 09:30», «15 ноя, 22:27», «15 ноя 2027»
  function fmtHuman(ts, withTime = true) {
    if (!ts) return '';
    const d = new Date(ts);
    const day0 = startOfDay(ts);
    const today0 = startOfDay();
    const time = withTime ? `, ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
    const diffDays = Math.round((day0 - today0) / 86400000);
    if (diffDays === 0) return 'сегодня' + time;
    if (diffDays === 1) return 'завтра' + time;
    if (diffDays === -1) return 'вчера' + time;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}${time}`;
  }

  function toLocalInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  const fromLocalInput = (v) => (v ? (new Date(v).getTime() || null) : null);

  function remaining(deadline) {
    if (!deadline) return null;
    const diff = deadline - Date.now();
    const m = Math.floor(Math.abs(diff) / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    const s = d > 0 ? `${d} д ${h % 24} ч` : h > 0 ? `${h} ч ${m % 60} мин` : `${m} мин`;
    return {
      diff,
      text: diff < 0 ? `просрочено на ${s}` : `через ${s}`,
      kind: diff < 0 ? 'overdue' : diff < 24 * 3600 * 1000 ? 'soon' : 'ok',
    };
  }

  const startOfDay = (ts) => { const d = new Date(ts || Date.now()); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const normImp = (v) => (v === 'red' ? 'red' : 'green');
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  // Короткий текстовый анонс записи для списков (без markdown-разметки).
  function plainPreview(text, max = 220) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' [код] ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [изображение] ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,3}|>)\s+/gm, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
      .replace(/\*\*|~~|`/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  // Анонс для карточек с сохранением строк: списки, чек-листы, нумерация.
  function previewLines(text, maxLines = 6) {
    const out = [];
    let inCode = false;
    for (const raw of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      if (/^```/.test(raw.trim())) { if (!inCode) out.push('<span class="pl-code">‹код›</span>'); inCode = !inCode; continue; }
      if (inCode) continue;
      let line = raw.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
      if (!line || /^\|[\s\-:|]+\|$/.test(line)) continue;
      let cls = '', mark = '';
      let m;
      if ((m = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/))) { mark = m[1] === ' ' ? '☐' : '☑'; cls = m[1] === ' ' ? '' : 'pl-done'; line = m[2]; }
      else if ((m = line.match(/^[-*]\s+(.*)$/))) { mark = '•'; line = m[1]; }
      else if ((m = line.match(/^(\d+)\.\s+(.*)$/))) { mark = m[1] + '.'; line = m[2]; }
      else if ((m = line.match(/^#{1,3}\s+(.*)$/))) { cls = 'pl-h'; line = m[1]; }
      else if ((m = line.match(/^>\s?(.*)$/))) { cls = 'pl-q'; line = m[1]; }
      line = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|~~|`|\*/g, '').replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' · ');
      if (!line && !mark) continue;
      out.push(`<span class="pl ${cls}">${mark ? `<b class="pl-m">${escapeHtml(mark)}</b>` : ''}${escapeHtml(line.slice(0, 140))}</span>`);
      if (out.length >= maxLines) break;
    }
    return out.join('');
  }

  /* ====================== MARKDOWN ====================== */

  function highlightCode(code, lang) {
    const cls = 'language-' + (lang || 'plain');
    if (window.Prism && lang && Prism.languages[lang]) {
      try { return `<pre class="${cls}"><code class="${cls}">${Prism.highlight(code, Prism.languages[lang], lang)}</code></pre>`; } catch { /* fallthrough */ }
    }
    return `<pre class="${cls}"><code>${escapeHtml(code)}</code></pre>`;
  }

  // График: ```chart
  //   3, 7, 4, 9          — просто числа
  //   Пн: 3, Вт: 7        — с подписями (через запятую или с новой строки)
  // Рисуется HTML-столбцами — текст не растягивается при любой ширине.
  function renderChart(src) {
    const items = String(src).split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean).map((t) => {
      const m = t.match(/^(.*?)[:=]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
      if (m) return { label: m[1].trim(), v: parseFloat(m[2].replace(',', '.')) };
      const n = t.match(/-?\d+(?:[.,]\d+)?/);
      return n ? { label: '', v: parseFloat(n[0].replace(',', '.')) } : null;
    }).filter(Boolean).slice(0, 40);
    if (!items.length) return '';
    const max = Math.max(...items.map((x) => x.v), 0) || 1;
    const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    return `<div class="chart"><div class="cb-cols">${items.map((x) => `
      <div class="cb-col" title="${escapeHtml(x.label ? x.label + ': ' : '')}${fmt(x.v)}">
        <span class="cb-val">${fmt(x.v)}</span>
        <div class="cb-bar" style="height:${Math.max(2, (Math.max(0, x.v) / max) * 100).toFixed(1)}%"></div>
        ${items.some((y) => y.label) ? `<span class="cb-lab">${escapeHtml(x.label)}</span>` : ''}
      </div>`).join('')}</div></div>`;
  }

  function renderTable(rows) {
    if (!rows.length) return '';
    let html = '<div class="table-wrap"><table><thead><tr>';
    rows[0].forEach((c) => { html += `<th>${renderInline(c.trim())}</th>`; });
    html += '</tr></thead><tbody>';
    rows.slice(1).forEach((r) => {
      html += '<tr>' + r.map((c) => `<td>${renderInline(c.trim())}</td>`).join('') + '</tr>';
    });
    return html + '</tbody></table></div>';
  }

  const safeUrl = (u) => (/^(https?:\/\/|data:image\/)/i.test(u) ? u : '#');
  const isImageUrl = (u) => /^data:image\//i.test(u) || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(u);

  function renderInline(text) {
    let s = escapeHtml(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0001${codes.length - 1}\u0001`; });
    s = s.replace(/!\[([^\]]*)\]\(nf:([\w-]+)\)/g, (m, alt, id) =>
      `<img class="md-img" data-nfimg="${id}" alt="${alt}">`);
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, alt, url) =>
      `<img class="md-img" src="${safeUrl(url)}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) =>
      `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (m, pre, url) =>
      `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  // Переключить n-й пункт чек-листа в тексте (без учёта блоков кода).
  function toggleChecklist(text, n) {
    const lines = text.split('\n');
    let inCode = false, k = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i].trim())) { inCode = !inCode; continue; }
      if (inCode) continue;
      const m = lines[i].match(/^(\s*[-*]\s+\[)([ xX])(\].*)$/);
      if (!m) continue;
      if (k++ === n) { lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3]; return lines.join('\n'); }
    }
    return text;
  }

  const isRich = (t) => /```|^\s*\|.+\||!\[[^\]]*\]\(|^\s*[-*]\s+\[[ xX]\]/m.test(t || '');

  function renderBody(text) {
    if (!text) return '';
    let src = text.replace(/\r\n/g, '\n');
    const blocks = [];
    let cbIndex = 0;

    src = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, body) => {
      if (lang === 'chart') blocks.push(renderChart(body));
      else if (lang === 'html') {
        // HTML показываем как страницу в изолированной «песочнице» (без скриптов) + код под спойлером.
        blocks.push(`<div class="html-embed"><iframe sandbox="" loading="lazy" title="HTML" srcdoc="${escapeHtml(body)}"></iframe><details><summary>Код HTML</summary>${highlightCode(body.replace(/\n$/, ''), 'html')}</details></div>`);
      }
      else blocks.push(highlightCode(body.replace(/\n$/, ''), lang));
      return `\n\u0000B${blocks.length - 1}\u0000\n`;
    });

    src = src.replace(/(^\|.+\|[ \t]*\n\|[-\s|:]+\|[ \t]*\n(?:\|.*\|[ \t]*(?:\n|$))+)/gm, (block) => {
      const rows = block.trim().split('\n').filter((l) => !/^\|[\s\-:|]+\|$/.test(l.trim()))
        .map((l) => l.trim().replace(/^\||\|$/g, '').split('|'));
      blocks.push(renderTable(rows));
      return `\u0000B${blocks.length - 1}\u0000\n`;
    });

    const out = [];
    let listType = null;
    const openList = (t, cls) => {
      const key = t + (cls || '');
      if (listType !== key) { closeList(); out.push(`<${t}${cls ? ` class="${cls}"` : ''}>`); listType = key; }
    };
    const closeList = () => { if (listType) { out.push(listType.startsWith('ol') ? '</ol>' : '</ul>'); listType = null; } };

    for (const raw of src.split('\n')) {
      const ph = raw.match(/^\u0000B(\d+)\u0000$/);
      if (ph) { closeList(); out.push(blocks[+ph[1]]); continue; }
      if (!raw.trim()) { closeList(); continue; }

      const bare = raw.trim();
      if (/^https?:\/\/\S+$/.test(bare) && isImageUrl(bare)) {
        closeList();
        out.push(`<p class="md-img-block"><img class="md-img" src="${escapeHtml(safeUrl(bare))}" alt="" loading="lazy"></p>`);
        continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(bare)) { closeList(); out.push('<hr>'); continue; }

      const h = raw.match(/^(#{1,3})\s+(.+)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`); continue; }

      const q = raw.match(/^>\s?(.*)$/);
      if (q) { closeList(); out.push(`<blockquote>${renderInline(q[1])}</blockquote>`); continue; }

      const cl = raw.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/);
      if (cl) {
        openList('ul', 'checklist');
        const on = cl[1] !== ' ';
        out.push(`<li class="${on ? 'on' : ''}" data-cb="${cbIndex++}"><span class="cb" role="checkbox" aria-checked="${on}">${on ? svgIcon('check', 12, 3) : ''}</span><span>${renderInline(cl[2])}</span></li>`);
        continue;
      }

      const ul = raw.match(/^\s*[-*]\s+(.+)$/);
      if (ul) { openList('ul'); out.push(`<li>${renderInline(ul[1])}</li>`); continue; }

      const ol = raw.match(/^\s*(\d+)\.\s+(.*)$/);
      if (ol) {
        if (listType !== 'ol') { closeList(); out.push(`<ol start="${+ol[1]}">`); listType = 'ol'; }
        out.push(`<li>${renderInline(ol[2])}</li>`);
        continue;
      }

      closeList();
      out.push(`<p>${renderInline(raw)}</p>`);
    }
    closeList();
    return out.join('');
  }

  /* ====================== УВЕДОМЛЕНИЯ ====================== */

  function toast(msg, kind = 'info', ms = 2800, action) {
    const stack = $('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span class="toast-dot"></span><span class="toast-msg">${escapeHtml(msg)}</span>`;
    const dismiss = () => {
      if (!el.isConnected || el.classList.contains('leaving')) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 260);
    };
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action';
      b.textContent = action.label;
      b.addEventListener('click', () => { dismiss(); action.onClick(); });
      el.appendChild(b);
    }
    stack.appendChild(el);
    while (stack.children.length > 3) stack.firstElementChild.remove();
    setTimeout(dismiss, action ? Math.max(ms, 5000) : ms);
  }

  function askConfirm({ title, message, actionText = 'Удалить', danger = true }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="modal modal-xs confirm">
          <div class="confirm-title">${escapeHtml(title)}</div>
          ${message ? `<div class="confirm-msg">${escapeHtml(message)}</div>` : ''}
          <div class="confirm-actions">
            <button class="btn ghost" data-act="no" type="button">Отмена</button>
            <button class="btn ${danger ? 'danger-solid' : 'primary'}" data-act="yes" type="button">${escapeHtml(actionText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      const done = (val) => {
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => overlay.remove(), 240);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      document.addEventListener('keydown', onKey, true);
      overlay.querySelector('[data-act="yes"]').addEventListener('click', () => done(true));
      overlay.querySelector('[data-act="no"]').addEventListener('click', () => done(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
      setTimeout(() => overlay.querySelector('[data-act="yes"]').focus(), 30);
    });
  }

  // Диалог с несколькими вариантами. Возвращает id выбранного варианта или null.
  function askChoice({ title, message = '', choices = [] }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="modal modal-xs confirm">
          <div class="confirm-title">${escapeHtml(title)}</div>
          ${message ? `<div class="confirm-msg">${escapeHtml(message)}</div>` : ''}
          <div class="choice-list">
            ${choices.map((c, i) => `<button class="btn ${c.danger ? 'danger-solid' : i === 0 ? 'primary' : ''} choice" data-choice="${escapeHtml(c.id)}" type="button">
              <span>${escapeHtml(c.label)}</span>${c.hint ? `<small>${escapeHtml(c.hint)}</small>` : ''}</button>`).join('')}
            <button class="btn ghost" data-choice="" type="button">Отмена</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      const done = (val) => {
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => overlay.remove(), 240);
        resolve(val || null);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      overlay.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('click', () => done(b.dataset.choice)));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
    });
  }

  function askText({ title, value = '', placeholder = '', actionText = 'Сохранить', extraText = '' }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <form class="modal modal-xs confirm">
          <div class="confirm-title">${escapeHtml(title)}</div>
          <input class="input" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
          <div class="confirm-actions">
            ${extraText ? `<button class="btn ghost danger" data-act="extra" type="button">${escapeHtml(extraText)}</button><span class="spacer"></span>` : ''}
            <button class="btn ghost" data-act="no" type="button">Отмена</button>
            <button class="btn primary" type="submit">${escapeHtml(actionText)}</button>
          </div>
        </form>`;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('open'));
      const input = overlay.querySelector('input');
      const done = (val) => {
        overlay.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        setTimeout(() => overlay.remove(), 240);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', onKey, true);
      overlay.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      overlay.querySelector('[data-act="no"]').addEventListener('click', () => done(null));
      const extra = overlay.querySelector('[data-act="extra"]');
      if (extra) extra.addEventListener('click', () => done({ extra: true }));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
      setTimeout(() => { input.focus(); input.select(); }, 30);
    });
  }

  /* ====================== ДАННЫЕ ====================== */

  const isDeleted = (it) => !!it.deleted;
  const visible = (it) => !it.deleted;

  // Записи, которые не удалось отправить на сервер (нет сети и т.п.).
  // Повторяем отправку при появлении сети и по таймеру.
  const pendingSync = new Map();
  let retryTimer = null;

  function normalizeItem(it) {
    it.importance = normImp(it.importance);
    // Раньше черновики прятались до явного «Сохранить». Теперь всё
    // сохраняется само, поэтому старые черновики — обычные записи.
    it.draft = false;
    return it;
  }

  function upsertLocal(item) {
    const idx = state.items.findIndex((x) => x.id === item.id);
    if (idx >= 0) state.items[idx] = item; else state.items.push(item);
  }

  async function loadItems() {
    if (!Auth.isSignedIn()) { state.items = []; state.loaded = true; return; }
    try {
      await DB.purgeExpired().catch(() => {});
      const all = await DB.allItems();
      // Строки проектов (проекты, блоки, записи, файлы) живут в projects.js.
      const isProjectRow = (x) => String(x.category || '').startsWith('__nf_');
      if (window.Projects) Projects.ingest(all.filter(isProjectRow));
      if (window.Media) Media.ingest(all);
      state.items = all.filter((x) => !SERVICE_IDS.has(x.id) && !isProjectRow(x)).map(normalizeItem);
      // Через минуту после загрузки — уборка картинок без владельца.
      setTimeout(() => {
        if (!window.Media || !Auth.isSignedIn()) return;
        const P = window.Projects && Projects._;
        Media.cleanup((owner) => {
          const it = state.items.find((x) => x.id === owner);
          if (it) return it.body || '';
          const b = P && P.block(owner);
          if (b) return b.content || '';
          const e = P && P.entry(owner);
          if (e) return e.text || '';
          if (owner && editor.overlay && state.editingId === owner) return editor.bodyEl.value;
          return undefined;
        });
      }, 60000);
      // Локальные несохранённые правки важнее того, что пришло с сервера.
      pendingSync.forEach((it) => upsertLocal(it));
    } catch (e) {
      console.error('[load]', e);
      toast('Не удалось загрузить записи', 'err');
    }
    state.loaded = true;
  }

  async function persist(item, { touch = true } = {}) {
    if (touch) item.updatedAt = Date.now();
    item.draft = false;
    upsertLocal(item);
    if (!Auth.isSignedIn()) throw new Error('Нужно войти в аккаунт');
    try {
      const saved = normalizeItem(await DB.upsertItem(item));
      // Пока шёл запрос, запись могли изменить ещё раз — не затираем свежее.
      const cur = state.items.find((x) => x.id === saved.id);
      if (!cur || (cur.updatedAt || 0) <= (item.updatedAt || 0)) upsertLocal(saved);
      pendingSync.delete(item.id);
      return saved;
    } catch (e) {
      pendingSync.set(item.id, item);
      scheduleRetry();
      throw e;
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(retryPending, RETRY_DELAY * 3);
  }

  async function retryPending() {
    if (!pendingSync.size || !Auth.isSignedIn()) return;
    const list = [...pendingSync.values()];
    let ok = 0;
    for (const it of list) {
      try { await persist(it, { touch: false }); ok++; } catch { /* останется в очереди */ }
    }
    if (ok && !pendingSync.size) toast('Все изменения сохранены', 'ok');
  }

  const persistQuiet = (item) => persist(item).catch((e) => {
    console.error('[save]', e);
    toast('Нет связи — сохраню, когда появится сеть', 'err', 3600);
  });

  async function softDeleteItem(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return null;
    it.deleted = true;
    it.deletedAt = Date.now();
    await persistQuiet(it);
    return it;
  }

  async function restoreItem(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.deleted = false;
    delete it.deletedAt;
    await persistQuiet(it);
  }

  async function purgeItem(id) {
    state.items = state.items.filter((x) => x.id !== id);
    pendingSync.delete(id);
    if (!Auth.isSignedIn()) return;
    try { await DB.deleteItem(id); } catch (e) { console.error('[delete]', e); toast('Ошибка удаления', 'err'); }
  }

  // Удаление с возможностью «Отменить» вместо подтверждающего окна.
  async function deleteWithUndo(id) {
    const it = await softDeleteItem(id);
    render();
    if (!it) return;
    toast('Перемещено в корзину', 'info', 5000, {
      label: 'Отменить',
      onClick: async () => { await restoreItem(id); render(); },
    });
  }

  /* ====================== ТЕМА ====================== */

  const systemLight = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolvedTheme = () => (state.themePref === 'system' ? (systemLight() ? 'light' : 'dark') : state.themePref);

  function applyTheme() {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    root.dataset.theme = resolvedTheme();
    root.dataset.accent = state.accent;
    try {
      localStorage.setItem('nf.theme', state.themePref);
      localStorage.setItem('nf.accent', state.accent);
    } catch { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#09090b');
    setTimeout(() => root.classList.remove('theme-switching'), 400);
  }

  function toggleTheme() {
    state.themePref = resolvedTheme() === 'dark' ? 'light' : 'dark';
    applyTheme();
    if ($('settingsOverlay').classList.contains('open')) renderSettings();
  }

  /* ====================== ВКЛАДКИ ====================== */

  function moveIndicator(container) {
    if (!container) return;
    const ind = container.querySelector('.tabs-indicator, .seg-indicator');
    const active = container.querySelector('button.active');
    if (!ind || !active) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function updateModeTabs() {
    document.querySelectorAll('#modeTabs button').forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    moveIndicator($('modeTabs'));
    const fab = $('fabAdd');
    if (fab) fab.title = { tasks: 'Новая задача', notes: 'Новая заметка', links: 'Добавить ссылку', projects: 'Новый проект' }[state.mode];
  }

  const MODES = ['tasks', 'notes', 'links', 'projects'];

  function setMode(mode) {
    if (!MODES.includes(mode)) mode = 'tasks';
    if (state.mode === mode) {
      // Повторный тап по «Проекты» внутри проекта — возврат к списку.
      if (mode === 'projects' && window.Projects && Projects.openId) Projects.close();
      return;
    }
    if (mode !== 'projects' && window.Projects && Projects.openId) Projects.close({ silent: true });
    clearSelections();
    state.mode = mode;
    try { localStorage.setItem('nf.mode', mode); } catch { /* ignore */ }
    state.animateNext = true;
    updateModeTabs();
    render();
    window.scrollTo({ top: 0 });
  }

  /* ====================== РЕНДЕР ГЛАВНОГО ЭКРАНА ====================== */

  function render() {
    const root = $('viewRoot');
    const animate = state.animateNext;
    state.animateNext = false;
    root.classList.toggle('animate', animate);

    if (!state.authReady) { root.innerHTML = renderSkeleton(); return; }
    if (!Auth.isConfigured() || !Auth.isSignedIn()) {
      root.innerHTML = renderWelcome();
      bindWelcome();
      return;
    }
    if (!state.loaded) { root.innerHTML = renderSkeleton(); return; }

    if (state.mode === 'projects') { Projects.render(root, animate); return; }
    if (state.mode === 'tasks') root.innerHTML = renderTasksView();
    else if (state.mode === 'notes') root.innerHTML = renderNotesView();
    else root.innerHTML = renderLinksView();

    if (state.mode === 'links') bindLinksView(); else bindRows(root);
    const add = $('addBtn');
    if (add) add.addEventListener('click', addForCurrentMode);
  }

  function renderSkeleton() {
    return `<div class="skeleton">${'<div class="sk-row"></div>'.repeat(4)}</div>`;
  }

  function renderWelcome() {
    const configured = Auth.isConfigured();
    return `
      <section class="welcome">
        <img class="welcome-mark" src="/icons/icon.svg" alt="" width="72" height="72">
        <h1>Задачи, заметки и ссылки — в одном месте</h1>
        <p>Всё сохраняется само и синхронизируется между устройствами.</p>
        ${configured
          ? `<button class="btn primary lg" id="welcomeLogin">${googleIcon()} Войти через Google</button>`
          : `<p class="hint">Supabase не настроен. Заполни <code>SUPABASE_URL</code> и <code>SUPABASE_ANON_KEY</code> в <code>.env</code> и перезапусти сервер.</p>`}
      </section>`;
  }

  function bindWelcome() {
    const b = $('welcomeLogin');
    if (b) b.addEventListener('click', () => Auth.signInWithGoogle().catch((e) => toast(e.message, 'err')));
  }

  function viewHead(title, sub, addLabel) {
    return `
      <div class="view-head">
        <div>
          <h1 class="view-title">${title}</h1>
          <div class="view-sub">${sub}</div>
        </div>
        ${addLabel ? `<div class="view-actions">
          <button class="btn ${listSel ? 'primary' : ''}" id="selectBtn" title="Выбрать несколько">${svgIcon('checklist', 16)}<span>${listSel ? 'Готово' : 'Выбрать'}</span></button>
          <button class="btn primary add-btn" id="addBtn">${svgIcon('plus', 16, 2.2)}<span>${addLabel}</span></button>
        </div>` : ''}
      </div>`;
  }

  /* ====================== ВЫБОР НЕСКОЛЬКИХ ЗАПИСЕЙ ====================== */
  let listSel = null;   // Set выбранных id или null

  function setListSelect(on, firstId) {
    listSel = on ? new Set(firstId ? [firstId] : []) : null;
    render();
    updateListSelectBar();
  }

  function clearSelections() {
    if (listSel) { listSel = null; hideSelectBar(); }
    if (typeof linkSel !== 'undefined' && linkSel) { linkSel = null; hideSelectBar(); }
  }

  function toggleSelected(id, rowEl) {
    if (!listSel) return;
    if (listSel.has(id)) listSel.delete(id); else listSel.add(id);
    const sw = rowEl && rowEl.closest('.swipe-item');
    if (sw) sw.classList.toggle('selected', listSel.has(id));
    updateListSelectBar();
  }

  function updateListSelectBar() {
    if (!listSel) { hideSelectBar(); return; }
    const isTasks = state.mode === 'tasks';
    const chosen = () => state.items.filter((x) => listSel.has(x.id));
    showSelectBar({
      count: listSel.size,
      noun: isTasks ? ['задача', 'задачи', 'задач'] : ['заметка', 'заметки', 'заметок'],
      actions: [
        { id: 'all', label: 'Все', icon: 'checklist' },
        { id: 'side', label: 'Рядом', icon: 'columns', need: 1, max: 3 },
        { id: 'imp', label: 'Важность', icon: 'star', need: 1 },
        ...(isTasks ? [{ id: 'done', label: 'Выполнено', icon: 'check', need: 1 }] : []),
        { id: 'del', label: 'Удалить', icon: 'trash', danger: true, need: 1 },
      ],
      onAction: async (act) => {
        const items = chosen();
        if (act === 'all') {
          const all = state.items.filter((x) => visible(x) && x.type === (isTasks ? 'task' : 'note')).map((x) => x.id);
          listSel = listSel.size === all.length ? new Set() : new Set(all);
          render(); updateListSelectBar();
        } else if (act === 'side') {
          const ids = items.map((x) => x.id);
          setListSelect(false);
          if (window.Workspace) Workspace.open(ids);
        } else if (act === 'imp') {
          const to = items.every((x) => x.importance === 'red') ? 'green' : 'red';
          items.forEach((x) => { x.importance = to; persistQuiet(x); });
          toast(to === 'red' ? 'Отмечены как важные' : 'Отмечены как обычные', 'ok', 1800);
          render(); updateListSelectBar();
        } else if (act === 'done') {
          const to = !items.every((x) => x.done);
          items.forEach((x) => { x.done = to; persistQuiet(x); });
          setListSelect(false);
        } else if (act === 'del') {
          const ids = items.map((x) => x.id);
          for (const id of ids) await softDeleteItem(id);
          setListSelect(false);
          toast(`В корзине: ${ids.length}`, 'info', 5000, { label: 'Отменить', onClick: async () => { for (const id of ids) await restoreItem(id); render(); } });
        }
      },
      onClose: () => setListSelect(false),
    });
  }

  function sortActiveTasks(items) {
    const mode = pref('taskSort', 'deadline');
    if (mode === 'importance') return [...items].sort((a, b) => ((b.importance === 'red') - (a.importance === 'red')) || (a.deadline || Infinity) - (b.deadline || Infinity) || (b.updatedAt || 0) - (a.updatedAt || 0));
    if (mode === 'created') return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return [...items].sort((a, b) => {
      const ad = a.deadline || Infinity, bd = b.deadline || Infinity;
      if (ad !== bd) return ad - bd;
      if (a.importance !== b.importance) return a.importance === 'red' ? -1 : 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function renderTasksView() {
    const tasks = state.items.filter((x) => x.type === 'task' && visible(x));
    const active = sortActiveTasks(tasks.filter((x) => !x.done));
    const done = tasks.filter((x) => x.done).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const DONE_VISIBLE = doneVisible();
    const shownDone = done.slice(0, DONE_VISIBLE);
    const important = active.filter((x) => x.importance === 'red').length;
    const overdue = active.filter((x) => x.deadline && x.deadline < Date.now()).length;

    const subParts = [`${active.length} ${plural(active.length, 'активная', 'активные', 'активных')}`];
    if (important) subParts.push(`<span class="sub-red">${important} ${plural(important, 'важная', 'важные', 'важных')}</span>`);
    if (overdue) subParts.push(`<span class="sub-red">${overdue} просрочено</span>`);

    let i = 0;
    const activeHtml = active.length
      ? `<div class="list">${active.map((t) => renderTaskRow(t, i++)).join('')}</div>`
      : `<div class="empty">${svgIcon('task', 28, 1.5)}<div>Всё сделано</div><small>Нажми «+», чтобы добавить задачу</small></div>`;

    const doneHtml = shownDone.length ? `
      <div class="section-head">
        <span>Недавно выполненные</span>
        <span class="section-count">${done.length > DONE_VISIBLE ? `${DONE_VISIBLE} из ${done.length}` : done.length}</span>
      </div>
      <div class="list list-done">${shownDone.map((t) => renderTaskRow(t, i++)).join('')}</div>
      ${done.length > DONE_VISIBLE ? `<button class="more-link" id="showDoneSearch">Остальные выполненные — в поиске</button>` : ''}
    ` : '';

    return viewHead('Задачи', subParts.join(' · '), 'Задача') + activeHtml + doneHtml;
  }

  function renderNotesView() {
    const sortBy = pref('noteSort', 'updated');
    const impFirst = pref('importantFirst', true);
    const notes = state.items.filter((x) => x.type === 'note' && visible(x)).sort((a, b) => {
      if (impFirst && a.importance !== b.importance) return a.importance === 'red' ? -1 : 1;
      if (sortBy === 'title') return (a.title || '').localeCompare(b.title || '', 'ru');
      if (sortBy === 'created') return (b.createdAt || 0) - (a.createdAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    const imp = notes.filter((x) => x.importance === 'red').length;
    const sub = `${notes.length} ${plural(notes.length, 'заметка', 'заметки', 'заметок')}${imp ? ` · <span class="sub-red">${imp} ${plural(imp, 'важная', 'важные', 'важных')}</span>` : ''}`;
    const body = notes.length
      ? `<div class="notes-grid view-${pref('noteView', 'grid')}">${notes.map(renderNoteCard).join('')}</div>`
      : `<div class="empty">${svgIcon('note', 28, 1.5)}<div>Пока нет заметок</div><small>Нажми «+», чтобы записать мысль</small></div>`;
    return viewHead('Заметки', sub, 'Заметка') + body;
  }

  function swipeWrap(id, i, inner, extraCls = '') {
    return `
      <div class="swipe-item ${extraCls} ${listSel && listSel.has(id) ? 'selected' : ''}" data-id="${id}" style="--i:${Math.min(i, 14)}">
        ${listSel ? `<span class="sel-box" aria-hidden="true">${svgIcon('check', 12, 3)}</span>` : ''}
        <div class="swipe-actions"><button class="swipe-delete" data-swipe-delete aria-label="Удалить">${svgIcon('trash', 18)}</button></div>
        ${inner}
      </div>`;
  }

  function renderTaskRow(it, i) {
    const rem = it.done ? null : remaining(it.deadline);
    const desc = pref('taskDesc', true) ? previewLines(it.body, 2) : '';
    const meta = [];
    if (it.deadline) {
      meta.push(`<span class="meta-pill ${rem ? rem.kind : 'muted'}" title="${escapeHtml(fmtTime(it.deadline))}">${svgIcon('clock', 12, 2)}${escapeHtml(fmtHuman(it.deadline))}${rem && rem.kind !== 'ok' ? ` · ${escapeHtml(rem.text)}` : ''}</span>`);
    }
    if (it.importance === 'red' && !it.done) meta.push('<span class="meta-pill red"><span class="dot red"></span>Важно</span>');
    const inner = `
      <div class="row task-row ${it.done ? 'done' : ''} imp-${it.importance}" data-open="${it.id}" tabindex="0">
        <button class="check" data-toggle="${it.id}" aria-label="${it.done ? 'Вернуть в работу' : 'Отметить выполненной'}" aria-pressed="${it.done}">
          ${svgIcon('check', 13, 3)}
        </button>
        <div class="row-body">
          <div class="row-title"><span>${escapeHtml(it.title || plainPreview(it.body, 80) || 'Без названия')}</span></div>
          ${desc && it.title ? `<div class="note-lines task-lines">${desc}</div>` : ''}
          ${meta.length ? `<div class="row-meta">${meta.join('')}</div>` : ''}
        </div>
        ${taskThumb(it)}
        <button class="row-del" data-del="${it.id}" title="В корзину" aria-label="В корзину">${svgIcon('trash', 16)}</button>
      </div>`;
    return swipeWrap(it.id, i, inner);
  }

  // Миниатюра задачи справа: картинка из текста или узор.
  function taskThumb(it) {
    const img = window.Media && Media.firstImage(it.body);
    if (img) {
      return `<span class="task-thumb">${img.id
        ? `<img data-nfimg="${escapeHtml(img.id)}" alt="">`
        : `<img src="${escapeHtml(img.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`}</span>`;
    }
    if (!window.Patterns || !pref('covers', true)) return '';
    return `<span class="task-thumb">${Patterns.html(it.id, { style: pref('coverStyle', 'auto'), w: 120, h: 120 })}</span>`;
  }

  function coverHtml(body, it) {
    const img = window.Media && Media.firstImage(body);
    if (!img) {
      // Нет картинки — генеративный узор (если включено в настройках).
      if (!it || !window.Patterns || !pref('covers', true) || pref('noteView', 'grid') === 'list') return '';
      return `<div class="note-cover is-pattern">${Patterns.html(it.id, { style: pref('coverStyle', 'auto'), h: 120 })}</div>`;
    }
    return img.id
      ? `<div class="note-cover"><img data-nfimg="${escapeHtml(img.id)}" alt=""></div>`
      : `<div class="note-cover"><img src="${escapeHtml(img.url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  }

  function renderNoteCard(it, i) {
    const lines = previewLines(it.body, 7);
    const imp = it.importance === 'red';
    const inner = `
      <div class="row note-card ${it.font === 'mono' ? 'mono' : ''} ${imp ? 'is-important' : ''}" data-open="${it.id}" tabindex="0">
        ${coverHtml(it.body, it)}
        <div class="row-body">
          <div class="row-title">${imp ? '<i class="imp-glow" title="Важная"></i>' : ''}${escapeHtml(it.title || 'Без названия')}</div>
          ${lines ? `<div class="note-lines">${lines}</div>` : ''}
          <div class="row-meta"><span class="meta-plain">${escapeHtml(fmtHuman(it.updatedAt))}</span></div>
        </div>
        <button class="row-del" data-del="${it.id}" title="В корзину" aria-label="В корзину">${svgIcon('trash', 16)}</button>
      </div>`;
    return swipeWrap(it.id, i, inner);
  }

  /* ====================== СОБЫТИЯ СПИСКОВ ====================== */

  function bindRows(scope) {
    scope.querySelectorAll('[data-toggle]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = state.items.find((x) => x.id === el.dataset.toggle);
        if (!it) return;
        it.done = !it.done;
        if (window.Prefs) Prefs.haptic(it.done ? 14 : 8);
        const row = el.closest('.swipe-item');
        if (row) row.classList.add(it.done ? 'completing' : 'reopening');
        el.setAttribute('aria-pressed', String(it.done));
        el.closest('.row').classList.toggle('done', it.done);
        persistQuiet(it);
        setTimeout(render, 420);
      });
    });

    if (listSel) scope.classList.add('selecting'); else scope.classList.remove('selecting');
    scope.querySelectorAll('[data-open]').forEach((el) => {
      // Долгое нажатие (телефон) — включает выбор.
      let lp = null;
      el.addEventListener('touchstart', () => {
        clearTimeout(lp);
        lp = setTimeout(() => {
          lp = 'fired';
          if (window.Prefs) Prefs.haptic(12);
          if (!listSel) setListSelect(true, el.dataset.open); else toggleSelected(el.dataset.open, el);
        }, 480);
      }, { passive: true });
      ['touchmove', 'touchend', 'touchcancel'].forEach((ev) => el.addEventListener(ev, () => { if (lp !== 'fired') clearTimeout(lp); }, { passive: true }));
      const open = () => {
        if (lp === 'fired') { lp = null; return; }
        if (listSel) { toggleSelected(el.dataset.open, el); return; }
        const sw = el.closest('.swipe-item');
        if (sw && sw.classList.contains('open')) { closeSwipe(sw); return; }
        const it = state.items.find((x) => x.id === el.dataset.open);
        if (it) openEditor(it);
      };
      el.addEventListener('click', (e) => { if (!e.target.closest('button') || (listSel && !e.target.closest('[data-toggle]'))) open(); });
      el.addEventListener('contextmenu', (e) => { if (lp === 'fired') e.preventDefault(); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) open(); });
    });

    scope.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', (e) => { e.stopPropagation(); deleteWithUndo(b.dataset.del); });
    });

    const more = $('showDoneSearch');
    if (more) more.addEventListener('click', () => openSearch('done'));
    const selBtn = $('selectBtn');
    if (selBtn) selBtn.addEventListener('click', () => setListSelect(!listSel));

    bindSwipe(scope);
  }

  /* --- Свайп влево для удаления (телефоны) --- */
  const SWIPE_WIDTH = 76;

  function closeSwipe(el) {
    el.classList.remove('open');
    const c = el.querySelector('.row');
    if (c) c.style.transform = '';
    setTimeout(() => { if (!el.classList.contains('open')) el.classList.remove('swiping'); }, 360);
  }

  function bindSwipe(scope) {
    if (listSel) return;
    scope.querySelectorAll('.swipe-item').forEach((el) => {
      const content = el.querySelector('.row');
      let startX = null, startY = null, dragging = false, baseX = 0, lastX = 0;

      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dragging = false;
        baseX = el.classList.contains('open') ? -SWIPE_WIDTH : 0;
        lastX = baseX;
        document.querySelectorAll('.swipe-item.open').forEach((o) => { if (o !== el) closeSwipe(o); });
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        if (startX === null) return;
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)) { startX = null; return; }
          dragging = true;
          el.classList.add('swiping');
          content.style.transition = 'none';
        }
        e.preventDefault();
        lastX = Math.max(-SWIPE_WIDTH - 24, Math.min(0, baseX + dx));
        content.style.transform = `translateX(${lastX}px)`;
      }, { passive: false });

      el.addEventListener('touchend', () => {
        if (startX === null) return;
        const was = dragging;
        startX = null; dragging = false;
        content.style.transition = '';
        if (!was) return;
        if (lastX < -36) { el.classList.add('open'); content.style.transform = `translateX(-${SWIPE_WIDTH}px)`; }
        else closeSwipe(el);
      });

      const del = el.querySelector('[data-swipe-delete]');
      if (del) del.addEventListener('click', (e) => { e.stopPropagation(); deleteWithUndo(el.dataset.id); });
    });
  }

  /* ====================== РЕДАКТОР (с автосохранением) ====================== */

  const editor = {
    overlay: null, modal: null, scroll: null,
    titleEl: null, bodyEl: null, previewEl: null, deadlineEl: null,
    importance: 'green', font: 'sans', done: false, preview: false,
    dirty: false, timer: null, chain: Promise.resolve(),
  };

  const TOOL_GROUPS = [
    [
      { id: 'heading', icon: 'heading', label: 'Заголовок' },
      { id: 'bold', icon: 'bold', label: 'Жирный', key: 'Ctrl+B' },
      { id: 'italic', icon: 'italic', label: 'Курсив', key: 'Ctrl+I' },
      { id: 'strike', icon: 'strike', label: 'Зачёркнутый' },
    ],
    [
      { id: 'ul', icon: 'ul', label: 'Список' },
      { id: 'ol', icon: 'ol', label: 'Нумерованный список' },
      { id: 'checklist', icon: 'checklist', label: 'Чек-лист' },
      { id: 'quote', icon: 'quote', label: 'Цитата' },
    ],
    [
      { id: 'code', icon: 'code', label: 'Код' },
      { id: 'link', icon: 'link', label: 'Ссылка', key: 'Ctrl+K' },
      { id: 'table', icon: 'table', label: 'Таблица' },
      { id: 'image', icon: 'image', label: 'Изображение' },
      { id: 'chart', icon: 'chart', label: 'График' },
    ],
  ];

  // Текущее поле, к которому применяется форматирование (редактор записи
  // или редактор блока проекта — см. projects.js).
  let fmtTA = null;

  function toolbarHtml({ font = true } = {}) {
    const groups = TOOL_GROUPS.map((g) => `<div class="tool-group">${g.map((t) =>
      `<button type="button" class="tool" data-tool="${t.id}" title="${t.label}${t.key ? ' (' + t.key + ')' : ''}" aria-label="${t.label}">${svgIcon(t.icon, 17)}</button>`
    ).join('')}</div>`).join('<span class="tool-sep"></span>');
    return `
      <div class="tool-scroll">${groups}</div>
      <div class="tool-group tool-right">
        ${font ? `<button type="button" class="tool" data-tool="font" title="Моноширинный шрифт" aria-label="Моноширинный шрифт" aria-pressed="false">${svgIcon('mono', 17)}</button>` : ''}
        <button type="button" class="tool" data-tool="preview" title="Просмотр" aria-label="Просмотр" aria-pressed="false">${svgIcon('eye', 17)}</button>
      </div>`;
  }

  function renderToolbar() {
    $('editorToolbar').innerHTML = toolbarHtml();
  }

  /* --- Правка текста с сохранением истории «Отменить» (Ctrl+Z) --- */
  function replaceRange(start, end, text, selStart, selEnd) {
    const ta = fmtTA;
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const s = selStart ?? start + text.length;
    ta.setSelectionRange(s, selEnd ?? s);
  }

  function wrapSelection(before, after, placeholder) {
    const ta = fmtTA;
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    // Повторное нажатие снимает форматирование.
    if (v.slice(a - before.length, a) === before && v.slice(b, b + after.length) === after) {
      replaceRange(a - before.length, b + after.length, v.slice(a, b), a - before.length, b - before.length);
      return;
    }
    const inner = v.slice(a, b) || placeholder;
    replaceRange(a, b, before + inner + after, a + before.length, a + before.length + inner.length);
  }

  function lineBounds() {
    const ta = fmtTA;
    const v = ta.value;
    let { selectionStart: a, selectionEnd: b } = ta;
    if (b > a && v[b - 1] === '\n') b--;
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    let le = v.indexOf('\n', b);
    if (le === -1) le = v.length;
    return { ls, le };
  }

  const PREFIX_RE = {
    checklist: /^(\s*)[-*]\s+\[[ xX]\]\s?/,
    ul: /^(\s*)[-*]\s+/,
    ol: /^(\s*)\d+\.\s+/,
    quote: /^(\s*)>\s?/,
  };
  const anyListPrefix = /^(\s*)([-*]\s+\[[ xX]\]\s?|[-*]\s+|\d+\.\s+|>\s?)/;

  function hasPrefix(line, kind) {
    if (kind === 'ul') return PREFIX_RE.ul.test(line) && !PREFIX_RE.checklist.test(line);
    return PREFIX_RE[kind].test(line);
  }

  function toggleLinePrefix(kind) {
    const ta = fmtTA;
    const { ls, le } = lineBounds();
    const lines = ta.value.slice(ls, le).split('\n');
    const nonEmpty = lines.filter((l) => l.trim());
    const allHave = nonEmpty.length && nonEmpty.every((l) => hasPrefix(l, kind));
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim() && lines.length > 1) return l;
      const stripped = l.replace(anyListPrefix, '$1');
      if (allHave) return stripped;
      const indent = (stripped.match(/^\s*/) || [''])[0];
      const rest = stripped.slice(indent.length);
      const prefix = kind === 'ul' ? '- ' : kind === 'checklist' ? '- [ ] ' : kind === 'quote' ? '> ' : `${++n}. `;
      return indent + prefix + rest;
    }).join('\n');
    replaceRange(ls, le, out, ls + out.length);
  }

  function toggleHeading() {
    const ta = fmtTA;
    const { ls, le } = lineBounds();
    const line = ta.value.slice(ls, le).split('\n')[0];
    const lineEnd = ls + line.length;
    const m = line.match(/^(#{1,3})\s+/);
    const level = m ? m[1].length : 0;
    const rest = m ? line.slice(m[0].length) : line;
    const next = level >= 3 ? rest : '#'.repeat(level + 1) + ' ' + rest;
    replaceRange(ls, lineEnd, next, ls + next.length);
  }

  function insertBlock(text, selectFrom, selectLen) {
    const ta = fmtTA;
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const before = a > 0 && v[a - 1] !== '\n' ? '\n' : '';
    const after = v[b] && v[b] !== '\n' ? '\n' : '';
    const full = before + text + after;
    const s = selectFrom != null ? a + before.length + selectFrom : a + full.length;
    replaceRange(a, b, full, s, selectLen != null ? s + selectLen : s);
  }

  function applyTool(id) {
    if (id === 'font') { setFont(editor.font === 'mono' ? 'sans' : 'mono'); scheduleSave(); return; }
    if (id === 'preview') { setPreview(!editor.preview); return; }
    if (editor.preview) setPreview(false);
    applyFormat(editor.bodyEl, id);
  }

  // Применяет кнопку панели форматирования к произвольному textarea.
  function applyFormat(ta, id) {
    fmtTA = ta;
    const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    switch (id) {
      case 'heading': toggleHeading(); break;
      case 'bold': wrapSelection('**', '**', 'жирный'); break;
      case 'italic': wrapSelection('*', '*', 'курсив'); break;
      case 'strike': wrapSelection('~~', '~~', 'текст'); break;
      case 'ul': case 'ol': case 'checklist': case 'quote': toggleLinePrefix(id); break;
      case 'code':
        if (sel.includes('\n') || !sel) insertBlock('```\n' + (sel || 'код') + '\n```', 4, (sel || 'код').length);
        else wrapSelection('`', '`', 'код');
        break;
      case 'link': {
        const a = ta.selectionStart;
        if (/^https?:\/\/\S+$/.test(sel.trim())) replaceRange(a, ta.selectionEnd, `[ссылка](${sel.trim()})`, a + 1, a + 8);
        else {
          const label = sel || 'текст';
          const text = `[${label}](https://)`;
          replaceRange(a, ta.selectionEnd, text, a + label.length + 3, a + text.length - 1);
        }
        break;
      }
      case 'table': insertBlock('| Столбец 1 | Столбец 2 |\n| --- | --- |\n| | |', 2, 9); break;
      case 'image':
        if (window.Media) { Media.pick(ta); break; }
        insertBlock('![описание](https://)', 13, 8);
        break;
      case 'chart': insertBlock('```chart\nПн: 3, Вт: 7, Ср: 4, Чт: 9, Пт: 6\n```', 9, 31); break;
    }
  }

  // Enter внутри списка продолжает его: «7.» → «8.», «- » → «- ».
  // Enter на пустом пункте завершает список.
  function onBodyKeydown(e) {
    const ta = e.currentTarget || e.target;
    fmtTA = ta;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'и') { e.preventDefault(); applyFormat(ta, 'bold'); return; }
      if (k === 'i' || k === 'ш') { e.preventDefault(); applyFormat(ta, 'italic'); return; }
      if (k === 'k' || k === 'л') { e.preventDefault(); e.stopPropagation(); applyFormat(ta, 'link'); return; }
    }
    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = ta;
      if (a === b && !e.shiftKey) replaceRange(a, b, '  ');
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || mod || e.isComposing || !pref('listContinue', true)) return;
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    if (a !== b) return;
    const ls = v.lastIndexOf('\n', a - 1) + 1;
    const line = v.slice(ls, a);
    let m, next = null;
    if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)$/))) next = m[3].trim() ? `${m[1]}${+m[2] + 1}. ` : '';
    else if ((m = line.match(/^(\s*)([-*])\s+\[[ xX]\]\s*(.*)$/))) next = m[3].trim() ? `${m[1]}${m[2]} [ ] ` : '';
    else if ((m = line.match(/^(\s*)([-*])\s+(.*)$/))) next = m[3].trim() ? `${m[1]}${m[2]} ` : '';
    else if ((m = line.match(/^(\s*)>\s?(.*)$/))) next = m[2].trim() ? `${m[1]}> ` : '';
    if (next === null) return;
    e.preventDefault();
    if (next === '') replaceRange(ls, a, '');            // пустой пункт — выходим из списка
    else replaceRange(a, a, '\n' + next);
  }

  function setPreview(on) {
    editor.preview = !!on;
    editor.bodyEl.hidden = editor.preview;
    editor.previewEl.hidden = !editor.preview;
    if (editor.preview) {
      const html = renderBody(editor.bodyEl.value);
      editor.previewEl.innerHTML = html || '<p class="muted">Пока пусто</p>';
      editor.previewEl.classList.toggle('font-mono', editor.font === 'mono');
    }
    const tb = $('editorToolbar');
    tb.classList.toggle('previewing', editor.preview);
    const pb = tb.querySelector('[data-tool="preview"]');
    if (pb) { pb.classList.toggle('active', editor.preview); pb.setAttribute('aria-pressed', String(editor.preview)); }
    if (!editor.preview) requestAnimationFrame(autoGrow);
  }

  function setFont(v) {
    editor.font = v === 'mono' ? 'mono' : 'sans';
    editor.bodyEl.classList.toggle('font-mono', editor.font === 'mono');
    editor.previewEl.classList.toggle('font-mono', editor.font === 'mono');
    const b = document.querySelector('#editorToolbar [data-tool="font"]');
    if (b) { b.classList.toggle('active', editor.font === 'mono'); b.setAttribute('aria-pressed', String(editor.font === 'mono')); }
    requestAnimationFrame(autoGrow);
  }

  function setImportance(v) {
    editor.importance = normImp(v);
    document.querySelectorAll('#impSwitch button').forEach((b) => {
      const on = b.dataset.imp === editor.importance;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    });
    $('impSwitch').dataset.value = editor.importance;
  }

  function setDone(v) {
    editor.done = !!v;
    const b = $('doneToggle');
    b.classList.toggle('active', editor.done);
    b.setAttribute('aria-pressed', String(editor.done));
  }

  function updateDeadlineLabel() {
    const ts = fromLocalInput(editor.deadlineEl.value);
    const label = $('deadlineLabel');
    const pill = $('deadlinePill');
    const rem = ts && !editor.done ? remaining(ts) : null;
    label.textContent = ts ? fmtHuman(ts) : 'Дедлайн';
    pill.classList.toggle('has-value', !!ts);
    pill.dataset.kind = rem ? rem.kind : '';
    $('deadlineClear').hidden = !ts;
  }

  function setEditorType(type) {
    state.editingType = type === 'note' ? 'note' : 'task';
    document.querySelectorAll('#editorTypeSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.editingType));
    moveIndicator($('editorTypeSwitch'));
    const isTask = state.editingType === 'task';
    $('taskMeta').hidden = false;
    $('deadlinePill').hidden = !isTask;
    $('doneToggle').hidden = !isTask;
    if (!isTask) $('deadlineClear').hidden = true; else updateDeadlineLabel();
    editor.bodyEl.placeholder = state.editingType === 'task'
      ? 'Детали задачи, подзадачи…'
      : 'Просто пиши. Markdown работает: **жирный**, - список, ```код```';
  }

  function setSaveState(s) {
    const el = $('saveState');
    const text = { idle: '', pending: 'Изменено', saving: 'Сохранение…', saved: 'Сохранено', error: 'Нет связи — повторю' }[s] || '';
    el.dataset.state = s;
    el.innerHTML = text ? `<span class="ss-dot"></span><span>${text}</span>` : '';
  }

  function updateCharCount() {
    const text = editor.bodyEl.value;
    const words = (text.trim().match(/\S+/g) || []).length;
    $('charCount').textContent = `${words} ${plural(words, 'слово', 'слова', 'слов')} · ${text.length} ${plural(text.length, 'символ', 'символа', 'символов')}`;
  }

  // Поле текста растёт вместе с содержимым: скролл один — у всей карточки.
  function autoGrow() {
    const ta = editor.bodyEl;
    if (!ta || ta.hidden) return;
    const sc = editor.scroll;
    const top = sc.scrollTop;
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight + 2, 180) + 'px';
    sc.scrollTop = top;
  }

  function openEditor(item, type) {
    if (editor.overlay.classList.contains('open')) flushSave();
    clearTimeout(editor.timer);
    editor.dirty = false;
    state.editingId = item ? item.id : uid();
    editor.isNew = !item;

    const t = item || { title: '', body: '', importance: 'green', deadline: null, font: pref('monoDefault', false) ? 'mono' : 'sans', done: false };
    editor.bodyEl.spellcheck = !!pref('spellcheck', true);
    editor.titleEl.value = t.title || '';
    editor.bodyEl.value = t.body || '';
    editor.bodyEl.dataset.owner = state.editingId;
    editor.deadlineEl.value = toLocalInput(t.deadline);
    setImportance(t.importance);
    setDone(t.done);
    setFont(t.font);
    // Заметки с таблицами, кодом, картинками или чек-листами открываются
    // в режиме чтения — нажатие на текст переключает в правку.
    const rm = pref('readMode', 'auto');
    setPreview(!!item && !!t.body.trim() && (rm === 'always' || (rm === 'auto' && isRich(t.body))));

    const ov = editor.overlay;
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    setEditorType(item ? item.type : type);
    updateDeadlineLabel();
    updateCharCount();
    setSaveState(item ? 'saved' : 'idle');
    editor.scroll.scrollTop = 0;

    requestAnimationFrame(() => {
      moveIndicator($('editorTypeSwitch'));
      autoGrow();
      if (!item) editor.titleEl.focus();
    });
  }

  function readEditor() {
    return {
      id: state.editingId,
      type: state.editingType,
      title: editor.titleEl.value.trim(),
      body: editor.bodyEl.value,
      font: editor.font,
      importance: editor.importance,
      deadline: fromLocalInput(editor.deadlineEl.value),
      done: editor.done,
    };
  }

  function scheduleSave() {
    if (!state.editingId) return;
    editor.dirty = true;
    setSaveState('pending');
    clearTimeout(editor.timer);
    editor.timer = setTimeout(flushSave, autosaveDelay());
  }

  // Сохраняет текущее состояние редактора. Вызовы выстраиваются в очередь,
  // поэтому два сохранения никогда не идут параллельно.
  function flushSave() {
    clearTimeout(editor.timer);
    if (!editor.dirty || !state.editingId) return editor.chain;
    editor.dirty = false;
    const snap = readEditor();
    editor.chain = editor.chain.then(() => doSave(snap)).catch((e) => console.error('[autosave]', e));
    return editor.chain;
  }

  async function doSave(snap) {
    const existing = state.items.find((x) => x.id === snap.id);
    if (!existing && !snap.title && !snap.body.trim()) {
      if (state.editingId === snap.id) setSaveState('idle');
      return;
    }
    const item = existing ? { ...existing } : { id: snap.id, createdAt: Date.now(), deleted: false, done: false };
    item.type = snap.type;
    item.title = snap.title;
    item.body = snap.body;
    item.font = snap.font;
    if (snap.type === 'task') {
      item.deadline = snap.deadline;
      item.importance = snap.importance;
      item.done = snap.done;
    } else {
      item.deadline = null;
      item.importance = snap.importance;
      item.done = false;
    }

    const isCurrent = () => state.editingId === snap.id;
    if (isCurrent()) setSaveState('saving');
    try {
      await persist(item);
      if (isCurrent()) setSaveState(editor.dirty ? 'pending' : 'saved');
      if (window.Links) Links.ingestFromItem(item);
    } catch (e) {
      console.error('[save]', e);
      if (isCurrent()) {
        setSaveState('error');
        editor.dirty = true;
        clearTimeout(editor.timer);
        editor.timer = setTimeout(flushSave, RETRY_DELAY);
      }
    }
    render();
  }

  async function closeEditor() {
    if (!editor.overlay.classList.contains('open')) return;
    const id = state.editingId;
    const p = flushSave();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    editor.overlay.classList.remove('open');
    editor.overlay.setAttribute('aria-hidden', 'true');
    await p;
    if (state.editingId === id) state.editingId = null;
    clearTimeout(editor.timer); // повтор после ошибки подхватит pendingSync
    render();
  }

  async function deleteFromEditor() {
    const id = state.editingId;
    clearTimeout(editor.timer);
    editor.dirty = false;
    await editor.chain;
    editor.overlay.classList.remove('open');
    editor.overlay.setAttribute('aria-hidden', 'true');
    state.editingId = null;
    if (state.items.some((x) => x.id === id)) await deleteWithUndo(id);
    else render();
  }

  function bindEditor() {
    editor.overlay = $('editorOverlay');
    editor.modal = $('editorModal');
    editor.scroll = $('editorScroll');
    editor.titleEl = $('editorTitle');
    editor.bodyEl = $('editorBody');
    editor.previewEl = $('editorPreview');
    editor.deadlineEl = $('editorDeadline');

    renderToolbar();

    document.querySelectorAll('#editorTypeSwitch button').forEach((b) => {
      b.addEventListener('click', () => { setEditorType(b.dataset.type); scheduleSave(); });
    });

    $('editorDone').addEventListener('click', closeEditor);
    $('editorClose').addEventListener('click', closeEditor);
    $('editorDelete').addEventListener('click', deleteFromEditor);
    $('editorSide').addEventListener('click', async () => {
      if (!window.Workspace) return;
      const id = state.editingId;
      await closeEditor();
      if (!state.items.some((x) => x.id === id)) { toast('Сначала напиши что-нибудь — пустую запись не открыть рядом', 'info'); return; }
      Workspace.open([id], { pick: true });
    });
    editor.overlay.addEventListener('mousedown', (e) => { if (e.target === editor.overlay) closeEditor(); });

    document.querySelectorAll('#impSwitch button').forEach((b) => {
      b.addEventListener('click', () => { setImportance(b.dataset.imp); scheduleSave(); });
    });
    $('doneToggle').addEventListener('click', () => { setDone(!editor.done); updateDeadlineLabel(); scheduleSave(); });
    $('deadlineClear').addEventListener('click', () => { editor.deadlineEl.value = ''; updateDeadlineLabel(); scheduleSave(); });
    $('deadlinePill').addEventListener('click', async () => {
      if (!window.DatePicker) return;
      const res = await DatePicker.open({ value: fromLocalInput(editor.deadlineEl.value), title: 'Дедлайн' });
      if (!res) return;
      editor.deadlineEl.value = res.clear ? '' : toLocalInput(res.ts);
      updateDeadlineLabel();
      scheduleSave();
    });

    editor.titleEl.addEventListener('input', scheduleSave);
    editor.titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); editor.bodyEl.focus(); }
    });
    editor.bodyEl.addEventListener('input', () => { updateCharCount(); autoGrow(); scheduleSave(); });
    editor.bodyEl.addEventListener('keydown', onBodyKeydown);
    bindImageDrop(editor.bodyEl);
    window.addEventListener('resize', () => { if (editor.overlay.classList.contains('open')) { autoGrow(); moveIndicator($('editorTypeSwitch')); } });

    const tb = $('editorToolbar');
    // mousedown не уводит фокус из textarea — выделение не теряется.
    tb.addEventListener('mousedown', (e) => { if (e.target.closest('.tool')) e.preventDefault(); });
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('.tool');
      if (b) applyTool(b.dataset.tool);
    });
    editor.previewEl.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-cb]');
      if (li && (e.target.closest('.cb') || e.target === li)) {
        editor.bodyEl.value = toggleChecklist(editor.bodyEl.value, +li.dataset.cb);
        setPreview(true);
        scheduleSave();
        return;
      }
      if (e.target.closest('a, img, summary, iframe, details, .chart, table')) return;
      if (window.getSelection && String(window.getSelection())) return; // выделяют текст — не мешаем
      setPreview(false);
      editor.bodyEl.focus();
    });

    // Сохраняем при уходе со страницы / сворачивании приложения.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
    window.addEventListener('beforeunload', (e) => {
      if (editor.dirty || pendingSync.size) { flushSave(); e.preventDefault(); e.returnValue = ''; }
    });
  }

  // Картинки из буфера обмена и перетаскиванием — сразу в текст.
  function bindImageDrop(ta) {
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
      if (files.length && window.Media) { e.preventDefault(); e.stopPropagation(); Media.insertImages(ta, files); }
    }, true);
    ta.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    ta.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
      if (files.length && window.Media) { e.preventDefault(); e.stopPropagation(); Media.insertImages(ta, files); }
    }, true);
  }

  function addForCurrentMode() {
    if (!Auth.isSignedIn()) { openAccountModal(); return; }
    if (state.mode === 'projects') { Projects.addAction(); return; }
    if (state.mode === 'links') {
      const inp = $('linkAddInput');
      if (inp) { inp.focus(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      return;
    }
    openEditor(null, state.mode === 'notes' ? 'note' : 'task');
  }

  /* ====================== ПАНЕЛЬ ВЫБОРА (общая) ====================== */

  function showSelectBar({ count, noun, actions, onAction, onClose }) {
    let bar = $('selectBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'selectBar';
      bar.className = 'select-bar';
      bar.setAttribute('role', 'toolbar');
      document.body.appendChild(bar);
      requestAnimationFrame(() => bar.classList.add('open'));
    }
    bar.innerHTML = `
      <button class="icon-btn sm sb-close" data-sb="__close" aria-label="Выйти из выбора">${svgIcon('close', 16, 2.2)}</button>
      <span class="sb-count"><b>${count}</b> ${plural(count, noun[0], noun[1], noun[2])}</span>
      <div class="sb-actions">${actions.map((a) => `<button class="sb-btn ${a.danger ? 'danger' : ''}" data-sb="${a.id}" ${a.need && count < a.need ? 'disabled' : ''} ${a.max && count > a.max ? 'disabled' : ''}>${svgIcon(a.icon, 17)}<span>${a.label}</span></button>`).join('')}</div>`;
    bar.querySelectorAll('[data-sb]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.sb === '__close') onClose(); else onAction(b.dataset.sb);
    }));
    document.body.classList.add('has-select-bar');
  }

  function hideSelectBar() {
    const bar = $('selectBar');
    document.body.classList.remove('has-select-bar');
    if (!bar) return;
    bar.classList.remove('open');
    bar.id = '';
    setTimeout(() => bar.remove(), 260);
  }

  /* ====================== ССЫЛКИ ====================== */

  function hueOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function shortPath(url) {
    try {
      const u = new URL(url);
      const p = (u.pathname === '/' ? '' : decodeURIComponent(u.pathname)) + (u.search || '');
      return p.length > 48 ? p.slice(0, 47) + '…' : p;
    } catch { return ''; }
  }

  function filteredLinks() {
    const q = state.links.query.trim().toLowerCase();
    const g = state.links.group;
    return Links.links
      .filter((l) => {
        if (g === '__none' && l.group) return false;
        if (g && g !== '__none' && l.group !== g) return false;
        if (q && !(l.url + ' ' + (l.title || '') + ' ' + (l.domain || '')).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function renderLinksView() {
    const total = Links.links.length;
    if (state.links.group && state.links.group !== '__none' && !Links.groups.some((g) => g.id === state.links.group)) state.links.group = '';
    return `
      ${viewHead('Ссылки', `${total} ${plural(total, 'ссылка', 'ссылки', 'ссылок')}`, '')}
      <form class="link-add" id="linkAddForm" autocomplete="off">
        <span class="link-add-ico">${svgIcon('link', 18)}</span>
        <input id="linkAddInput" type="text" inputmode="url" placeholder="Вставь ссылку…" aria-label="Новая ссылка" enterkeyhint="done">
        <button class="btn primary" type="submit">Добавить</button>
      </form>
      <div class="link-tools">
        <div class="chips chips-scroll" id="linkGroups"></div>
        <label class="mini-search">
          ${svgIcon('search', 15)}
          <input id="linkSearch" type="search" placeholder="Найти" value="${escapeHtml(state.links.query)}" aria-label="Поиск по ссылкам">
        </label>
        <button class="btn sm ${linkSel ? 'primary' : ''}" id="linkSelectBtn">${svgIcon('checklist', 15)}<span>${linkSel ? 'Готово' : 'Выбрать'}</span></button>
      </div>
      <div class="links-list" id="linksList"></div>`;
  }

  function renderLinkGroups() {
    const box = $('linkGroups');
    if (!box) return;
    const links = Links.links;
    const g = state.links.group;
    const count = (id) => links.filter((l) => l.group === id).length;
    const noGroup = links.filter((l) => !l.group).length;
    const chips = [`<button class="chip ${!g ? 'active' : ''}" data-group="">Все <span class="chip-n">${links.length}</span></button>`];
    Links.groups.forEach((gr) => chips.push(
      `<button class="chip ${g === gr.id ? 'active' : ''}" data-group="${escapeHtml(gr.id)}">${svgIcon('folder', 13)}${escapeHtml(gr.name)} <span class="chip-n">${count(gr.id)}</span></button>`));
    if (Links.groups.length && noGroup) chips.push(`<button class="chip ${g === '__none' ? 'active' : ''}" data-group="__none">Без группы <span class="chip-n">${noGroup}</span></button>`);
    chips.push(`<button class="chip chip-add" id="groupAdd" title="Новая группа">${svgIcon('plus', 13, 2.2)}Группа</button>`);
    if (g && g !== '__none') chips.push(`<button class="chip chip-ghost" id="groupEdit" title="Переименовать или удалить группу">${svgIcon('more', 15, 2.4)}</button>`);
    box.innerHTML = chips.join('');

    box.querySelectorAll('[data-group]').forEach((b) => {
      b.addEventListener('click', () => {
        state.links.group = b.dataset.group;
        state.animateNext = true;
        renderLinkGroups();
        renderLinksList();
      });
      // Сюда можно перетащить ссылку.
      if (b.dataset.group === '') return;
      b.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nf-link')) { e.preventDefault(); b.classList.add('drop-ok'); } });
      b.addEventListener('dragleave', () => b.classList.remove('drop-ok'));
      b.addEventListener('drop', (e) => {
        b.classList.remove('drop-ok');
        const id = e.dataTransfer.getData('text/nf-link');
        if (!id) return;
        e.preventDefault();
        moveLinks([id], b.dataset.group === '__none' ? '' : b.dataset.group);
      });
    });
    $('groupAdd').addEventListener('click', async () => {
      const name = await askText({ title: 'Новая группа', placeholder: 'Например, «Учёба»', actionText: 'Создать' });
      if (!name) return;
      const gr = Links.addGroup(name);
      if (gr) { state.links.group = gr.id; renderLinkGroups(); renderLinksList(); }
    });
    const edit = $('groupEdit');
    if (edit) edit.addEventListener('click', () => openGroupMenu(g));
  }

  async function openGroupMenu(id) {
    const gr = Links.groups.find((x) => x.id === id);
    if (!gr) return;
    const res = await askText({ title: 'Группа', value: gr.name, actionText: 'Сохранить', extraText: 'Удалить группу' });
    if (!res) return;
    if (res.extra) {
      const n = Links.links.filter((l) => l.group === id).length;
      const ok = await askConfirm({
        title: `Удалить группу «${gr.name}»?`,
        message: n ? `Ссылки (${n}) останутся — просто без группы.` : '',
        actionText: 'Удалить',
      });
      if (!ok) return;
      Links.removeGroup(id);
      state.links.group = '';
    } else {
      Links.renameGroup(id, res);
    }
    renderLinkGroups();
    renderLinksList();
  }

  /* --- Выбор нескольких ссылок, перенос в группы --- */
  let linkSel = null;   // Set выбранных id или null (режим выбора выключен)

  async function pickGroup(title) {
    const choice = await askChoice({
      title,
      choices: [
        ...Links.groups.map((g) => ({ id: 'g:' + g.id, label: g.name })),
        { id: 'g:', label: 'Без группы' },
        { id: 'new', label: '+ Новая группа…' },
      ],
    });
    if (!choice) return undefined;
    if (choice === 'new') {
      const name = await askText({ title: 'Новая группа', placeholder: 'Например, «Учёба»', actionText: 'Создать' });
      if (!name || typeof name !== 'string') return undefined;
      const g = Links.addGroup(name);
      return g ? g.id : undefined;
    }
    return choice.slice(2);
  }

  function moveLinks(ids, group) {
    const n = Links.updateMany(ids.map((id) => ({ id, patch: { group } })));
    const gname = group ? (Links.groups.find((g) => g.id === group) || {}).name : 'Без группы';
    toast(`${n} ${plural(n, 'ссылка перенесена', 'ссылки перенесены', 'ссылок перенесено')} → ${gname}`, 'ok', 2200);
  }

  function setLinkSelect(on) {
    linkSel = on ? new Set() : null;
    renderLinksList();
    const b = $('linkSelectBtn');
    if (b) { b.classList.toggle('primary', !!linkSel); b.querySelector('span').textContent = linkSel ? 'Готово' : 'Выбрать'; }
    updateLinkSelectBar();
  }

  function updateLinkSelectBar() {
    if (!linkSel) { hideSelectBar(); return; }
    showSelectBar({
      count: linkSel.size,
      noun: ['ссылка', 'ссылки', 'ссылок'],
      actions: [
        { id: 'all', label: 'Все', icon: 'checklist' },
        { id: 'move', label: 'В группу', icon: 'folder', need: 1 },
        { id: 'copy', label: 'Копировать', icon: 'copy', need: 1 },
        { id: 'del', label: 'Удалить', icon: 'trash', danger: true, need: 1 },
      ],
      onAction: async (act) => {
        const ids = [...linkSel];
        if (act === 'all') {
          const all = filteredLinks().map((l) => l.id);
          linkSel = linkSel.size === all.length ? new Set() : new Set(all);
          renderLinksList(); updateLinkSelectBar();
        } else if (act === 'move') {
          const g = await pickGroup(`Перенести ${ids.length} ${plural(ids.length, 'ссылку', 'ссылки', 'ссылок')} в…`);
          if (g === undefined) return;
          moveLinks(ids, g);
          setLinkSelect(false);
        } else if (act === 'copy') {
          const urls = Links.links.filter((l) => linkSel.has(l.id)).map((l) => l.url).join('\n');
          try { await navigator.clipboard.writeText(urls); toast('Ссылки скопированы', 'ok', 1800); } catch { toast('Не удалось скопировать', 'err'); }
        } else if (act === 'del') {
          const removed = Links.removeMany(ids);
          setLinkSelect(false);
          toast(`Удалено: ${removed.length}`, 'info', 5000, { label: 'Отменить', onClick: () => Links.restoreMany(removed) });
        }
      },
      onClose: () => setLinkSelect(false),
    });
  }

  // Обложки и заголовки ссылок — автоматически (через /api/preview).
  const previewPending = new Set();
  let previewBatch = [];
  let previewTimer = null;
  function queuePreviews(links) {
    if (!window.Media || !pref('linkPreviews', true)) return;
    const week = 7 * 24 * 3600 * 1000;
    links.filter((l) => !l.previewAt || (!l.image && Date.now() - l.previewAt > week)).slice(0, 24).forEach((l) => {
      if (previewPending.has(l.id)) return;
      previewPending.add(l.id);
      Media.preview(l.url).then((d) => {
        const patch = { previewAt: Date.now() };
        if (d && d.image) patch.image = d.image;
        if (d && d.title && !l.title) patch.title = d.title.slice(0, 160);
        if (d && d.description) patch.desc = d.description.slice(0, 200);
        previewBatch.push({ id: l.id, patch });
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => { const b = previewBatch; previewBatch = []; Links.updateMany(b); }, 600);
      });
    });
  }

  function renderLinksList() {
    const list = $('linksList');
    if (!list) return;
    const links = filteredLinks();
    const animate = state.animateNext;
    state.animateNext = false;
    list.classList.toggle('animate', animate);
    list.classList.toggle('selecting', !!linkSel);
    if (!links.length) {
      const empty = Links.links.length
        ? '<div class="empty small">Ничего не найдено</div>'
        : `<div class="empty">${svgIcon('link', 28, 1.5)}<div>Ссылок пока нет</div><small>Вставь ссылку выше — или просто упомяни её в заметке, она появится здесь сама</small></div>`;
      list.innerHTML = empty;
      return;
    }
    const groupName = (id) => (Links.groups.find((g) => g.id === id) || {}).name || '';
    const canDrag = window.matchMedia && matchMedia('(pointer: fine)').matches;
    list.innerHTML = links.map((l, i) => {
      const title = l.title || l.domain || l.url;
      const sub = [l.title ? l.domain : '', shortPath(l.url)].filter(Boolean).join('');
      const gname = !state.links.group && l.group ? groupName(l.group) : '';
      const sel = linkSel && linkSel.has(l.id);
      return `
        <div class="link-card ${sel ? 'selected' : ''} ${l.image ? 'has-thumb' : ''}" style="--i:${Math.min(i, 14)};--h:${hueOf(l.domain || l.url)}" data-link="${escapeHtml(l.id)}" ${canDrag && !linkSel ? 'draggable="true"' : ''}>
          ${linkSel ? `<span class="sel-box" aria-hidden="true">${svgIcon('check', 12, 3)}</span>` : ''}
          <a class="link-main" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
            ${l.image
              ? `<span class="link-thumb"><img src="${escapeHtml(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
              : window.Patterns && pref('covers', true)
                ? `<span class="link-thumb">${Patterns.html(l.domain || l.url, { style: pref('coverStyle', 'auto'), w: 160, h: 110, label: escapeHtml((l.domain || '?')[0].toUpperCase()) })}</span>`
                : `<span class="link-avatar">${escapeHtml((l.domain || '?')[0].toUpperCase())}</span>`}
            <span class="link-text">
              <span class="link-title">${escapeHtml(title)}</span>
              <span class="link-sub">${escapeHtml(sub || l.url)}${gname ? ` <span class="link-group">${svgIcon('folder', 11)}${escapeHtml(gname)}</span>` : ''}</span>
            </span>
          </a>
          <div class="link-actions">
            <button class="icon-btn sm" data-move title="Переместить в группу" aria-label="Переместить в группу">${svgIcon('folder', 16)}</button>
            <button class="icon-btn sm" data-copy title="Копировать" aria-label="Копировать ссылку">${svgIcon('copy', 16)}</button>
            <button class="icon-btn sm" data-edit title="Изменить" aria-label="Изменить ссылку">${svgIcon('more', 18, 2.4)}</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => {
      const card = img.closest('.link-card');
      img.closest('.link-thumb').replaceWith(Object.assign(document.createElement('span'), { className: 'link-avatar', textContent: (card.querySelector('.link-title').textContent || '?')[0].toUpperCase() }));
    }, { once: true }));

    list.querySelectorAll('.link-card').forEach((card) => {
      const id = card.dataset.link;
      card.addEventListener('click', (e) => {
        if (!linkSel) return;
        e.preventDefault();
        if (linkSel.has(id)) linkSel.delete(id); else linkSel.add(id);
        card.classList.toggle('selected', linkSel.has(id));
        updateLinkSelectBar();
      });
      card.querySelector('[data-copy]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const l = Links.links.find((x) => x.id === id);
        if (!l) return;
        try { await navigator.clipboard.writeText(l.url); toast('Ссылка скопирована', 'ok', 1800); }
        catch { toast('Не удалось скопировать', 'err'); }
      });
      card.querySelector('[data-move]').addEventListener('click', async (e) => {
        e.stopPropagation();
        const g = await pickGroup('Переместить в группу');
        if (g !== undefined) moveLinks([id], g);
      });
      card.querySelector('[data-edit]').addEventListener('click', (e) => { e.stopPropagation(); openLinkEditor(id); });
      // Перетаскивание на группу (компьютер).
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/nf-link', id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
        document.body.classList.add('dragging-link');
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); document.body.classList.remove('dragging-link'); });
    });
    queuePreviews(links);
  }

  function bindLinksView() {
    renderLinkGroups();
    renderLinksList();
    $('linkAddForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('linkAddInput');
      const raw = inp.value.trim();
      if (!raw) { inp.focus(); return; }
      const group = state.links.group && state.links.group !== '__none' ? state.links.group : '';
      const link = Links.addLink(raw, { group });
      if (!link) { toast('Это не похоже на ссылку', 'err'); inp.classList.add('shake'); setTimeout(() => inp.classList.remove('shake'), 400); return; }
      inp.value = '';
      renderLinkGroups();
      renderLinksList();
      updateLinksSub();
    });
    $('linkAddInput').addEventListener('paste', () => {
      // Вставили ссылку — сразу добавляем, без лишнего нажатия.
      setTimeout(() => {
        const v = $('linkAddInput').value.trim();
        if (/^https?:\/\/\S+$/.test(v)) $('linkAddForm').requestSubmit();
      }, 0);
    });
    $('linkSearch').addEventListener('input', (e) => { state.links.query = e.target.value; renderLinksList(); });
    $('linkSelectBtn').addEventListener('click', () => setLinkSelect(!linkSel));
    if (linkSel) updateLinkSelectBar();
  }

  function updateLinksSub() {
    const sub = document.querySelector('#viewRoot .view-sub');
    const n = Links.links.length;
    if (sub && state.mode === 'links') sub.textContent = `${n} ${plural(n, 'ссылка', 'ссылки', 'ссылок')}`;
  }

  function openLinkEditor(id) {
    const l = Links.links.find((x) => x.id === id);
    if (!l) return;
    const body = $('linkBody');
    const groups = Links.groups;
    body.innerHTML = `
      <div class="link-preview" style="--h:${hueOf(l.domain || l.url)}">
        <span class="link-avatar lg">${escapeHtml((l.domain || '?')[0].toUpperCase())}</span>
        <div class="link-text">
          <span class="link-title">${escapeHtml(l.domain)}</span>
          <a class="link-sub" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a>
        </div>
      </div>
      <label class="field">
        <span class="field-label">Название</span>
        <input class="input" id="linkTitleInput" type="text" value="${escapeHtml(l.title || '')}" placeholder="${escapeHtml(l.domain)}" autocomplete="off">
      </label>
      <div class="field">
        <span class="field-label">Группа</span>
        <div class="chips wrap" id="linkGroupPick">
          <button class="chip ${!l.group ? 'active' : ''}" data-pick="">Без группы</button>
          ${groups.map((g) => `<button class="chip ${l.group === g.id ? 'active' : ''}" data-pick="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join('')}
          <button class="chip chip-add" id="linkGroupNew">${svgIcon('plus', 13, 2.2)}Новая</button>
        </div>
      </div>
      <div class="link-edit-actions">
        <a class="btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${svgIcon('external', 15)}Открыть</a>
        <button class="btn ghost" id="linkBlock" title="Новые ссылки с этого сайта не будут собираться из заметок">${svgIcon('ban', 15)}Не собирать ${escapeHtml(l.domain)}</button>
        <button class="btn ghost danger" id="linkDelete">${svgIcon('trash', 15)}Удалить</button>
      </div>`;

    openOverlay('linkOverlay');

    const titleInput = $('linkTitleInput');
    titleInput.addEventListener('input', () => { Links.updateLink(id, { title: titleInput.value.trim() }); });
    titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') closeOverlay('linkOverlay'); });
    body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      Links.updateLink(id, { group: b.dataset.pick });
      body.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('active', x === b));
    }));
    $('linkGroupNew').addEventListener('click', async () => {
      const name = await askText({ title: 'Новая группа', placeholder: 'Название', actionText: 'Создать' });
      if (!name) return;
      const gr = Links.addGroup(name);
      if (gr) { Links.updateLink(id, { group: gr.id }); openLinkEditor(id); }
    });
    $('linkBlock').addEventListener('click', () => {
      Links.addBlock(l.domain);
      toast(`Ссылки с ${l.domain} больше не собираются автоматически`, 'info', 3200);
      $('linkBlock').disabled = true;
    });
    $('linkDelete').addEventListener('click', () => {
      const removed = Links.removeLink(id);
      closeOverlay('linkOverlay');
      toast('Ссылка удалена', 'info', 5000, { label: 'Отменить', onClick: () => Links.restoreLink(removed) });
    });
  }

  /* ====================== ОВЕРЛЕИ ====================== */

  function openOverlay(id) {
    const o = $(id);
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
  }

  function closeOverlay(id) {
    const o = $(id);
    if (!o || !o.classList.contains('open')) return;
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
    if (id === 'linkOverlay' && state.mode === 'links') { renderLinkGroups(); renderLinksList(); }
  }

  function bindOverlays() {
    document.querySelectorAll('.modal-overlay').forEach((o) => {
      if (o.id === 'editorOverlay' || o.classList.contains('custom-close')) return;
      o.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeOverlay(o.id)));
      o.addEventListener('mousedown', (e) => { if (e.target === o) closeOverlay(o.id); });
    });
  }

  // Оверлеи со своей логикой закрытия (например, с автосохранением).
  const closeHooks = {};

  function topOverlay() {
    const open = [...document.querySelectorAll('.modal-overlay.open')];
    return open[open.length - 1] || null;
  }

  /* ====================== НАСТРОЙКИ ====================== */

  function openSettings() {
    renderSettings();
    openOverlay('settingsOverlay');
  }

  let settingsTab = 'look';
  const SETTINGS_TABS = [
    ['look', 'Вид'], ['notes', 'Заметки'], ['tasks', 'Задачи'], ['editor', 'Редактор'], ['links', 'Ссылки'], ['data', 'Данные'],
  ];

  function renderSettings() {
    const body = $('settingsBody');
    const P = window.Prefs;
    const g = (k) => P.get(k);
    const trashCount = state.items.filter(isDeleted).length + (window.Projects ? Projects.trashed().length : 0);
    const block = Links.blocklist;

    const opts = (key, list) => `<div class="opt-chips" role="radiogroup">${list.map(([v, l]) =>
      `<button type="button" class="chip ${String(g(key)) === String(v) ? 'active' : ''}" data-pref="${key}" data-val="${escapeHtml(String(v))}" role="radio" aria-checked="${String(g(key)) === String(v)}">${l}</button>`).join('')}</div>`;
    const row = (label, hint, control) => `<div class="set-row"><span class="set-text"><span class="set-label">${label}</span>${hint ? `<small>${hint}</small>` : ''}</span>${control}</div>`;
    const sw = (key, label, hint) => `<label class="set-row switch-row"><span class="set-text"><span class="set-label">${label}</span>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" data-pref-bool="${key}" ${g(key) ? 'checked' : ''}></label>`;

    const coverPreview = window.Patterns ? `<div class="cover-demo">${['grid', 'waves', 'arcs', 'triangles', 'rings', 'dots'].map((st, i) =>
      `<button type="button" class="cover-opt ${g('coverStyle') === st ? 'active' : ''}" data-pref="coverStyle" data-val="${st}" title="${st}">${Patterns.html('demo-' + i, { style: st, w: 160, h: 90 })}</button>`).join('')}
      <button type="button" class="cover-opt auto ${g('coverStyle') === 'auto' ? 'active' : ''}" data-pref="coverStyle" data-val="auto">Разные</button></div>` : '';

    const panes = {
      look: `
        ${row('Тема', '', `<div class="opt-chips">${[['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Авто']].map(([v, l]) => `<button type="button" class="chip ${state.themePref === v ? 'active' : ''}" data-theme-pref="${v}">${l}</button>`).join('')}</div>`)}
        ${row('Акцент', '', `<div class="swatches" role="radiogroup" aria-label="Акцентный цвет">${ACCENTS.map((a) => `<button type="button" class="swatch sw-${a.id} ${state.accent === a.id ? 'active' : ''}" data-accent="${a.id}" title="${a.label}" aria-label="${a.label}" role="radio" aria-checked="${state.accent === a.id}"></button>`).join('')}</div>`)}
        ${row('Размер текста', 'Заметки, задачи и редактор', opts('textSize', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']]))}
        ${row('Плотность списков', '', opts('density', [['compact', 'Плотно'], ['normal', 'Обычно'], ['cozy', 'Просторно']]))}
        ${row('Скругления', '', opts('radius', [['sharp', 'Острые'], ['normal', 'Обычные'], ['round', 'Круглые']]))}
        ${row('Шрифт интерфейса', '', opts('uiFont', [['geist', 'Geist'], ['system', 'Системный'], ['serif', 'С засечками']]))}
        ${sw('motion', 'Анимации', 'Плавные появления и переходы')}
        ${sw('haptics', 'Вибрация', 'Лёгкий отклик при отметке задач и выборе (телефон)')}
        ${row('Открывать при запуске', '', opts('startMode', [['last', 'Последний'], ['tasks', 'Задачи'], ['notes', 'Заметки'], ['links', 'Ссылки'], ['projects', 'Проекты']]))}`,
      notes: `
        ${row('Вид списка', '', opts('noteView', [['grid', 'Плитка'], ['list', 'Список']]))}
        ${row('Сортировка', '', opts('noteSort', [['updated', 'По изменению'], ['created', 'По созданию'], ['title', 'По названию']]))}
        ${sw('importantFirst', 'Важные наверху', 'Важные заметки всегда в начале списка')}
        ${row('Режим чтения', 'Как открывать существующие заметки', opts('readMode', [['auto', 'Авто'], ['always', 'Всегда'], ['never', 'Сразу правка']]))}
        ${sw('covers', 'Автообложки', 'Если в заметке нет картинки — красивый узор, подобранный под тему')}
        <div class="set-sub">Стиль узоров</div>
        ${coverPreview}`,
      tasks: `
        ${row('Сортировка задач', '', opts('taskSort', [['deadline', 'По дедлайну'], ['importance', 'Сначала важные'], ['created', 'Новые сверху']]))}
        ${row('Выполненные в списке', 'Остальные — в поиске', opts('doneVisible', [[0, 'Скрыть'], [3, '3'], [5, '5'], [10, '10']]))}
        ${sw('taskDesc', 'Показывать описание', 'Первые строки текста под названием задачи')}`,
      editor: `
        ${row('Автосохранение', 'Через сколько сохранять после ввода', opts('autosave', [['fast', 'Сразу'], ['normal', 'Обычно'], ['slow', 'Реже']]))}
        ${sw('listContinue', 'Продолжать списки по Enter', '«7.» → «8.», «- » → «- »')}
        ${sw('spellcheck', 'Проверка орфографии', '')}
        ${sw('monoDefault', 'Моноширинный шрифт для новых записей', 'Удобно для кода и таблиц')}`,
      links: `
        ${sw('linkPreviews', 'Обложки и заголовки ссылок', 'Подгружаются автоматически со страниц')}
        <label class="set-row switch-row"><span class="set-text"><span class="set-label">Собирать ссылки из записей</span><small>Ссылки из текста задач и заметок сами попадают в раздел «Ссылки»</small></span><input type="checkbox" class="switch" id="autoCollect" ${Links.isAutoCollect() ? 'checked' : ''}></label>
        ${block.length ? `<div class="set-sub">Не собирать с этих сайтов</div>
          <div class="chips wrap">${block.map((b) => `<span class="chip static">${escapeHtml(b.value)}<button type="button" class="chip-x" data-unblock="${escapeHtml(b.value)}" aria-label="Убрать">${svgIcon('close', 12, 2.4)}</button></span>`).join('')}</div>` : ''}`,
      data: `
        <div class="nav-grid">
          <button class="nav-card" id="navMetrics">${svgIcon('metrics', 18)}<span>Аналитика</span></button>
          <button class="nav-card" id="navTrash">${svgIcon('trash', 18)}<span>Корзина</span>${trashCount ? `<span class="badge">${trashCount}</span>` : ''}</button>
          <button class="nav-card" id="navBackup">${svgIcon('download', 18)}<span>Резервная копия</span></button>
          <button class="nav-card" id="navCache">${svgIcon('theme', 18)}<span>Обновить приложение</span></button>
        </div>
        <p class="hint set-note">Резервная копия — один JSON-файл со всеми задачами, заметками, ссылками и проектами (без файлов). «Обновить приложение» очищает кэш и загружает свежую версию — помогает, если что-то выглядит странно.</p>
        <div class="set-sub keys-section">Горячие клавиши</div>
        <div class="keys keys-section">
          <div><kbd>Ctrl</kbd><kbd>K</kbd><span>команды и поиск</span></div>
          <div><kbd>Ctrl</kbd><kbd>N</kbd><span>новая запись</span></div>
          <div><kbd>/</kbd><span>поиск</span></div>
          <div><kbd>Esc</kbd><span>закрыть (всё сохранится)</span></div>
        </div>
        <div class="set-foot"><span>NodeNote · настройки хранятся на этом устройстве</span><button class="btn ghost sm danger" id="prefsReset">Сбросить настройки</button></div>`,
    };

    body.innerHTML = `
      <div class="set-tabs" role="tablist">${SETTINGS_TABS.map(([k, l]) => `<button type="button" class="set-tab ${k === settingsTab ? 'active' : ''}" data-stab="${k}" role="tab">${l}</button>`).join('')}</div>
      <div class="set-pane">${panes[settingsTab]}</div>`;

    body.querySelectorAll('[data-stab]').forEach((b) => b.addEventListener('click', () => { settingsTab = b.dataset.stab; renderSettings(); }));
    body.querySelectorAll('[data-pref]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.pref;
      const raw = b.dataset.val;
      const v = typeof P.defaults[key] === 'number' ? +raw : raw;
      P.set(key, v);
      body.querySelectorAll(`[data-pref="${key}"]`).forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on)); });
    }));
    body.querySelectorAll('[data-pref-bool]').forEach((c) => c.addEventListener('change', () => P.set(c.dataset.prefBool, c.checked)));
    body.querySelectorAll('[data-theme-pref]').forEach((b) => b.addEventListener('click', () => {
      state.themePref = b.dataset.themePref;
      body.querySelectorAll('[data-theme-pref]').forEach((x) => x.classList.toggle('active', x === b));
      applyTheme();
    }));
    body.querySelectorAll('[data-accent]').forEach((b) => b.addEventListener('click', () => {
      state.accent = b.dataset.accent;
      body.querySelectorAll('[data-accent]').forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on)); });
      applyTheme();
    }));
    const ac = $('autoCollect');
    if (ac) ac.addEventListener('change', (e) => Links.setAutoCollect(e.target.checked));
    body.querySelectorAll('[data-unblock]').forEach((b) => b.addEventListener('click', () => { Links.removeBlock(b.dataset.unblock); renderSettings(); }));
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('navMetrics', () => { closeOverlay('settingsOverlay'); openMetrics(); });
    on('navTrash', () => { closeOverlay('settingsOverlay'); openTrash(); });
    on('navBackup', exportBackup);
    on('navCache', refreshApp);
    on('prefsReset', async () => {
      if (!(await askConfirm({ title: 'Сбросить настройки?', message: 'Тема и данные останутся, вернутся только настройки по умолчанию.', actionText: 'Сбросить' }))) return;
      P.reset(); renderSettings();
    });
  }

  // Резервная копия всего в один JSON-файл.
  function exportBackup() {
    const data = {
      format: 'nodenote.backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: state.items.filter((x) => !x.deleted).map((x) => ({
        id: x.id, type: x.type, title: x.title, body: x.body, importance: x.importance,
        deadline: x.deadline ? new Date(x.deadline).toISOString() : null, done: !!x.done,
        createdAt: x.createdAt ? new Date(x.createdAt).toISOString() : null,
        updatedAt: x.updatedAt ? new Date(x.updatedAt).toISOString() : null,
      })),
      links: { links: Links.links, groups: Links.groups },
      projects: window.Projects ? Projects.list().map((p) => Projects.exportJson(p.id)) : [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nodenote-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Резервная копия сохранена', 'ok');
  }

  // Полное обновление: очистить кэш service worker и перезагрузить.
  async function refreshApp() {
    await flushSave();
    try {
      if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch { /* ignore */ }
    location.reload();
  }

  /* ====================== АНАЛИТИКА ====================== */

  function openMetrics() {
    renderMetrics();
    openOverlay('metricsOverlay');
  }

  function renderMetrics() {
    const tasks = state.items.filter((x) => x.type === 'task' && visible(x));
    const notes = state.items.filter((x) => x.type === 'note' && visible(x));
    const total = tasks.length;
    const done = tasks.filter((x) => x.done).length;
    const active = total - done;
    const overdue = tasks.filter((x) => !x.done && x.deadline && x.deadline < Date.now()).length;
    const pct = total ? Math.round((done / total) * 100) : 0;

    const DAYS = 14;
    const today0 = startOfDay();
    const buckets = Array.from({ length: DAYS }, (_, i) => ({ ts: today0 - (DAYS - 1 - i) * 86400000, count: 0 }));
    tasks.forEach((t) => {
      const idx = Math.round((startOfDay(t.createdAt || 0) - buckets[0].ts) / 86400000);
      if (idx >= 0 && idx < DAYS) buckets[idx].count++;
    });

    const red = tasks.filter((t) => t.importance === 'red').length;
    const weekday = [0, 0, 0, 0, 0, 0, 0];
    tasks.forEach((t) => { if (t.deadline) weekday[new Date(t.deadline).getDay()]++; });
    const shortDate = (ts) => { const d = new Date(ts); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`; };

    $('metricsBody').innerHTML = `
      <div class="metrics-grid">
        <div class="metric"><div class="k">Задач</div><div class="v">${total}</div><div class="s">${active} в работе</div></div>
        <div class="metric"><div class="k">Выполнено</div><div class="v ok">${pct}%</div><div class="s">${done} ${plural(done, 'задача', 'задачи', 'задач')}</div></div>
        <div class="metric"><div class="k">Просрочено</div><div class="v ${overdue ? 'err' : ''}">${overdue}</div><div class="s">нужно внимание</div></div>
        <div class="metric"><div class="k">Заметок</div><div class="v">${notes.length}</div><div class="s">${Links.links.length} ${plural(Links.links.length, 'ссылка', 'ссылки', 'ссылок')}</div></div>
      </div>
      <div class="metrics-section">
        <div class="metrics-head">Новые задачи · 14 дней</div>
        <div class="chart-card">${svgBarChart(buckets.map((b, i) => ({ value: b.count, label: i % 2 === 0 ? shortDate(b.ts) : '' })))}</div>
      </div>
      <div class="metrics-two">
        <div class="metrics-section">
          <div class="metrics-head">По важности</div>
          <div class="chart-card">${svgDonut([
            { value: red, color: 'var(--red)', label: 'Важные' },
            { value: total - red, color: 'var(--green)', label: 'Обычные' },
          ])}</div>
        </div>
        <div class="metrics-section">
          <div class="metrics-head">Дедлайны по дням недели</div>
          <div class="chart-card">${svgBarChart(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label, i) => ({ value: weekday[(i + 1) % 7], label })), { height: 170, width: 420 })}</div>
        </div>
      </div>`;
  }

  function svgBarChart(data, opts = {}) {
    const W = opts.width || 760, H = opts.height || 160, padX = 8, padTop = 16, padBot = 22;
    const max = Math.max(...data.map((d) => d.value), 1);
    const stepX = (W - padX * 2) / data.length;
    const barW = Math.max(4, stepX * 0.62);
    let out = '';
    data.forEach((d, i) => {
      const h = (d.value / max) * (H - padTop - padBot);
      const x = padX + i * stepX + (stepX - barW) / 2;
      const y = H - padBot - h;
      out += `<rect class="chart-bar ${d.value === 0 ? 'dim' : ''}" style="--i:${i}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="4"/>`;
      if (d.value) out += `<text class="chart-value" x="${(x + barW / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${d.value}</text>`;
      if (d.label) out += `<text class="chart-label" x="${(x + barW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.label}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
  }

  function svgDonut(segments) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const size = 132, R = 54, r = 38, cx = size / 2, cy = size / 2, mid = (R + r) / 2;
    const C = 2 * Math.PI * mid;
    let offset = 0, arcs = '';
    if (total) segments.forEach((s) => {
      if (!s.value) return;
      const len = (s.value / total) * C;
      arcs += `<circle class="donut-arc" cx="${cx}" cy="${cy}" r="${mid}" fill="none" stroke="${s.color}" stroke-width="${R - r}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
    });
    return `
      <div class="donut-wrap">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${mid}" fill="none" stroke="var(--surface-3)" stroke-width="${R - r}"/>
          ${arcs}
          <text class="donut-total" x="${cx}" y="${cy}" dy="8" text-anchor="middle">${total}</text>
        </svg>
        <div class="donut-legend">
          ${segments.map((s) => `<div class="legend-row"><span class="swatch-dot" style="background:${s.color}"></span><span>${s.label}</span><b>${s.value}${total ? ` · ${Math.round((s.value / total) * 100)}%` : ''}</b></div>`).join('')}
        </div>
      </div>`;
  }

  /* ====================== КОРЗИНА ====================== */

  function openTrash() {
    renderTrashList();
    openOverlay('trashOverlay');
  }

  function renderTrashList() {
    const list = $('trashList');
    const projects = window.Projects ? Projects.trashed().map((p) => ({ ...p, isProject: true })) : [];
    const items = state.items.filter(isDeleted).concat(projects).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
    $('trashEmptyBtn').disabled = !items.length;
    if (!items.length) { list.innerHTML = `<div class="empty small">${svgIcon('trash', 24, 1.5)}<div>Корзина пуста</div></div>`; return; }
    list.innerHTML = items.map((it) => {
      const days = Math.max(0, Math.ceil((TRASH_TTL - (Date.now() - (it.deletedAt || 0))) / 86400000));
      return `
        <div class="trash-row">
          <span class="trash-ico">${svgIcon(it.isProject ? 'folder' : it.type === 'task' ? 'task' : 'note', 16)}</span>
          <div class="row-body">
            <div class="row-title">${it.isProject ? 'Проект: ' : ''}${escapeHtml(it.title || plainPreview(it.body, 60) || 'Без названия')}</div>
            <div class="row-desc">удалится через ${days} ${plural(days, 'день', 'дня', 'дней')}</div>
          </div>
          <button class="btn sm" data-restore="${it.id}" ${it.isProject ? 'data-project' : ''}>Вернуть</button>
          <button class="icon-btn sm" data-purge="${it.id}" ${it.isProject ? 'data-project' : ''} title="Удалить навсегда" aria-label="Удалить навсегда">${svgIcon('close', 16)}</button>
        </div>`;
    }).join('');
    list.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      if (b.hasAttribute('data-project')) await Projects.restore(b.dataset.restore);
      else await restoreItem(b.dataset.restore);
      renderTrashList(); render(); toast('Восстановлено', 'ok');
    }));
    list.querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await askConfirm({ title: 'Удалить навсегда?', message: 'Это действие нельзя отменить.' }))) return;
      if (b.hasAttribute('data-project')) await Projects.purge(b.dataset.purge);
      else await purgeItem(b.dataset.purge);
      renderTrashList(); render();
    }));
  }

  function bindTrash() {
    $('trashEmptyBtn').addEventListener('click', async () => {
      const all = state.items.filter(isDeleted);
      const projects = window.Projects ? Projects.trashed() : [];
      if (!all.length && !projects.length) return;
      if (!(await askConfirm({ title: 'Очистить корзину?', message: `${all.length} ${plural(all.length, 'запись будет удалена', 'записи будут удалены', 'записей будут удалены')} безвозвратно.`, actionText: 'Очистить' }))) return;
      for (const it of all) await purgeItem(it.id);
      for (const p of projects) await Projects.purge(p.id);
      renderTrashList(); render();
    });
  }

  /* ====================== АККАУНТ ====================== */

  const googleIcon = () => `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.9 36.5 44 31.1 44 24c0-1.3-.1-2.3-.4-3.5z"/>
  </svg>`;

  function openAccountModal() {
    renderAccountBody();
    openOverlay('accountOverlay');
  }

  function renderAccountBody() {
    const body = $('accountBody');
    const user = Auth.user;
    if (!Auth.isConfigured()) {
      body.innerHTML = `<p class="hint">Supabase не настроен. Заполни <code>SUPABASE_URL</code> и <code>SUPABASE_ANON_KEY</code> в файле <code>.env</code> и перезапусти сервер.</p>`;
      return;
    }
    if (!user) {
      body.innerHTML = `
        <p class="hint">Войди через Google — задачи, заметки и ссылки будут синхронизироваться между устройствами.</p>
        <button class="btn primary lg block" id="accGoogle">${googleIcon()} Войти через Google</button>`;
      $('accGoogle').addEventListener('click', () => Auth.signInWithGoogle().catch((e) => toast(e.message, 'err')));
      return;
    }
    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Пользователь';
    const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
    body.innerHTML = `
      <div class="account-user">
        ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer">` : `<div class="avatar-lg">${escapeHtml(name[0].toUpperCase())}</div>`}
        <div class="account-text">
          <div class="name">${escapeHtml(name)}</div>
          <div class="email">${escapeHtml(user.email || '')}</div>
        </div>
      </div>
      <div class="sync-note"><span class="ss-dot ok"></span>Синхронизация включена${pendingSync.size ? ` · ${pendingSync.size} в очереди` : ''}</div>
      <div class="row-actions">
        <button class="btn" id="accSync">Обновить с сервера</button>
        <button class="btn ghost danger" id="accSignOut">Выйти</button>
      </div>`;
    $('accSync').addEventListener('click', async () => {
      await retryPending();
      await loadItems();
      await Links.loadFromCloud();
      render();
      toast('Обновлено', 'ok');
    });
    $('accSignOut').addEventListener('click', async () => {
      await flushSave();
      await Auth.signOut();
      state.items = [];
      closeOverlay('accountOverlay');
      render();
    });
  }

  function updateAccountChip() {
    const label = $('authLabel'), icon = $('authIcon'), avatar = $('authAvatar');
    const chip = $('accountBtn');
    const u = Auth.user;
    if (u) {
      const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email || 'Аккаунт';
      label.textContent = String(name).split(' ')[0];
      icon.style.display = 'none';
      avatar.hidden = false;
      const pic = u.user_metadata?.avatar_url || u.user_metadata?.picture;
      avatar.style.backgroundImage = pic ? `url("${encodeURI(pic)}")` : '';
      avatar.textContent = pic ? '' : String(name)[0].toUpperCase();
      chip.classList.add('signed-in');
    } else {
      label.textContent = 'Войти';
      icon.style.display = '';
      avatar.hidden = true;
      chip.classList.remove('signed-in');
    }
  }

  /* ====================== ПОИСК ====================== */

  function searchSnippet(text, needle) {
    const plain = plainPreview(text, 5000);
    const idx = needle ? plain.toLowerCase().indexOf(needle) : -1;
    if (idx === -1) return escapeHtml(plain.slice(0, 140));
    const start = Math.max(0, idx - 40);
    const end = Math.min(plain.length, idx + needle.length + 90);
    return (start > 0 ? '…' : '') + escapeHtml(plain.slice(start, idx)) + '<mark>' + escapeHtml(plain.slice(idx, idx + needle.length)) + '</mark>' + escapeHtml(plain.slice(idx + needle.length, end)) + (end < plain.length ? '…' : '');
  }

  function highlightMatch(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const qs = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp('(' + qs + ')', 'ig'), '<mark>$1</mark>');
  }

  function searchFilter(type, needle) {
    return state.items.filter((x) => {
      if (!visible(x)) return false;
      if (type === 'task' && x.type !== 'task') return false;
      if (type === 'note' && x.type !== 'note') return false;
      if (type === 'red' && !(x.importance === 'red' && !x.done)) return false;
      if (type === 'done' && !(x.type === 'task' && x.done)) return false;
      if (needle && !((x.title || '') + ' ' + (x.body || '')).toLowerCase().includes(needle)) return false;
      return true;
    });
  }

  function searchItemHtml(it, needle, i) {
    const isTask = it.type === 'task';
    let side = '';
    if (isTask && it.done) side = '<span class="sr-side muted">выполнено</span>';
    else if (isTask && it.deadline) {
      const rem = remaining(it.deadline);
      side = `<span class="sr-side ${rem.kind}">${escapeHtml(fmtHuman(it.deadline, false))}</span>`;
    } else side = `<span class="sr-side">${escapeHtml(fmtHuman(it.updatedAt, false))}</span>`;
    const snippet = it.body ? searchSnippet(it.body, needle) : '';
    return `
      <button class="search-result ${i === 0 ? 'active' : ''}" data-open="${it.id}">
        <span class="sr-ico ${isTask ? 'is-task' : 'is-note'} ${it.done ? 'is-done' : ''}">${svgIcon(isTask ? (it.done ? 'check' : 'task') : 'note', 16)}</span>
        <span class="sr-body">
          <span class="sr-title">${it.importance === 'red' && !it.done ? '<i class="imp-glow"></i>' : ''}${highlightMatch(it.title || plainPreview(it.body, 60) || 'Без названия', needle)}</span>
          ${snippet ? `<span class="sr-desc">${snippet}</span>` : ''}
        </span>
        ${side}
      </button>`;
  }

  function renderSearch() {
    const body = $('searchBody');
    const raw = $('searchInput').value.trim();
    const needle = raw.toLowerCase();
    const type = state.search.type;
    $('searchClear').hidden = !raw;

    // Счётчики на фильтрах.
    document.querySelectorAll('#searchType .sf').forEach((b) => {
      const n = searchFilter(b.dataset.type, needle).length;
      b.querySelector('span').textContent = needle || b.dataset.type !== 'all' ? String(n) : '';
      b.classList.toggle('active', b.dataset.type === type);
    });

    let i = 0;
    const group = (title, items, html) => (items.length ? `<div class="search-section"><span>${title}</span><b>${items.length}</b></div>${html}` : '');

    if (!needle && type === 'all') {
      const recent = [...state.items].filter(visible).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);
      body.innerHTML = recent.length
        ? group('Недавние', recent, recent.map((it) => searchItemHtml(it, '', i++)).join(''))
        : '<div class="search-empty">Здесь появятся твои записи</div>';
    } else {
      const matches = searchFilter(type, needle).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 80);
      const tasks = matches.filter((x) => x.type === 'task');
      const notes = matches.filter((x) => x.type === 'note');
      const proj = needle && type === 'all' && window.Projects && Projects.searchItems ? Projects.searchItems(needle) : [];
      const taskHtml = tasks.map((it) => searchItemHtml(it, needle, i++)).join('');
      const noteHtml = notes.map((it) => searchItemHtml(it, needle, i++)).join('');
      const projHtml = proj.map((p) => `
        <button class="search-result ${i++ === 0 ? 'active' : ''}" data-proj="${p.kind}:${p.id}">
          <span class="sr-ico is-proj">${svgIcon(p.kind === 'block' ? 'tree' : 'note', 16)}</span>
          <span class="sr-body">
            <span class="sr-title">${highlightMatch(p.title, needle)}</span>
            <span class="sr-desc">${escapeHtml(p.project)}${p.text ? ' · ' + searchSnippet(p.text, needle) : ''}</span>
          </span>
          <span class="sr-side">${p.kind === 'block' ? 'блок' : 'запись'}</span>
        </button>`).join('');
      const html = group('Задачи', tasks, taskHtml)
        + group('Заметки', notes, noteHtml)
        + group('Проекты', proj, projHtml);
      body.innerHTML = html || `<div class="search-empty">${svgIcon('search', 26, 1.6)}<div>Ничего не нашлось</div><small>${raw ? `по запросу «${escapeHtml(raw)}»` : 'в этом фильтре'}</small></div>`;
    }

    body.querySelectorAll('[data-open]').forEach((btn) => btn.addEventListener('click', () => {
      const it = state.items.find((x) => x.id === btn.dataset.open);
      if (!it) return;
      closeOverlay('searchOverlay');
      openEditor(it);
    }));
    body.querySelectorAll('[data-proj]').forEach((btn) => btn.addEventListener('click', () => {
      const [kind, id] = btn.dataset.proj.split(':');
      closeOverlay('searchOverlay');
      Projects.openItem(kind, id);
    }));
  }

  function openSearch(type = 'all') {
    if (!Auth.isSignedIn()) { openAccountModal(); return; }
    state.search.type = type;
    $('searchInput').value = '';
    renderSearch();
    openOverlay('searchOverlay');
    setTimeout(() => $('searchInput').focus(), 50);
  }

  function moveActive(container, selector, dir) {
    const items = [...container.querySelectorAll(selector)];
    if (!items.length) return;
    let idx = items.findIndex((el) => el.classList.contains('active'));
    idx = dir > 0 ? (idx + 1) % items.length : idx <= 0 ? items.length - 1 : idx - 1;
    items.forEach((el) => el.classList.remove('active'));
    items[idx].classList.add('active');
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  function bindSearch() {
    $('searchBtn').addEventListener('click', () => openSearch());
    const input = $('searchInput');
    input.addEventListener('input', renderSearch);
    document.querySelectorAll('#searchType .sf').forEach((c) => c.addEventListener('click', () => {
      state.search.type = c.dataset.type;
      renderSearch();
      input.focus();
    }));
    $('searchClear').addEventListener('click', () => { input.value = ''; renderSearch(); input.focus(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive($('searchBody'), '.search-result', 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive($('searchBody'), '.search-result', -1); }
      else if (e.key === 'Enter') {
        const active = document.querySelector('#searchBody .search-result.active');
        if (active) { e.preventDefault(); active.click(); }
      }
    });
  }

  /* ====================== КОМАНДНАЯ ПАЛИТРА (Ctrl/⌘+K) ====================== */

  let paletteEntries = [];

  function paletteCommands() {
    const signedIn = Auth.isSignedIn();
    return [
      { icon: 'task', title: 'Новая задача', hint: 'Ctrl+N', run: () => openEditor(null, 'task') },
      { icon: 'note', title: 'Новая заметка', hint: '', run: () => openEditor(null, 'note') },
      { icon: 'link', title: 'Добавить ссылку', hint: '', run: () => { setMode('links'); setTimeout(() => $('linkAddInput')?.focus(), 60); } },
      { icon: 'folder', title: 'Новый проект', hint: '', run: () => { setMode('projects'); Projects.createDialog(); } },
      { icon: 'task', title: 'Раздел: Задачи', hint: '', run: () => setMode('tasks') },
      { icon: 'note', title: 'Раздел: Заметки', hint: '', run: () => setMode('notes') },
      { icon: 'link', title: 'Раздел: Ссылки', hint: '', run: () => setMode('links') },
      { icon: 'folder', title: 'Раздел: Проекты', hint: '', run: () => setMode('projects') },
      { icon: 'theme', title: 'Сменить тему', hint: resolvedTheme() === 'dark' ? 'тёмная' : 'светлая', run: toggleTheme },
      { icon: 'metrics', title: 'Аналитика', hint: '', run: openMetrics },
      { icon: 'trash', title: 'Корзина', hint: '', run: openTrash },
      { icon: 'settings', title: 'Настройки', hint: '', run: openSettings },
      { icon: 'account', title: signedIn ? 'Аккаунт' : 'Войти', hint: signedIn ? (Auth.user?.email || '') : 'Google', run: openAccountModal },
    ];
  }

  function renderPalette() {
    const q = $('paletteInput').value.trim();
    const ql = q.toLowerCase();
    const cmds = paletteCommands().filter((c) => !q || c.title.toLowerCase().includes(ql));
    const items = !q ? [] : state.items
      .filter((x) => visible(x) && ((x.title || '') + ' ' + (x.body || '')).toLowerCase().includes(ql))
      .slice(0, 8)
      .map((x) => ({ icon: x.type === 'task' ? 'task' : 'note', title: x.title || 'Без названия', hint: x.type === 'task' ? 'задача' : 'заметка', run: () => openEditor(x) }));
    paletteEntries = cmds.concat(items);
    const row = (c, i) => `<button class="palette-item ${i === 0 ? 'active' : ''}" data-pi="${i}"><span class="pi-ico">${svgIcon(c.icon, 17)}</span><span class="pi-title">${highlightMatch(c.title, q)}</span><span class="pi-hint">${escapeHtml(c.hint)}</span></button>`;
    const parts = [];
    if (cmds.length) parts.push('<div class="palette-section">Команды</div>', ...cmds.map((c, i) => row(c, i)));
    if (items.length) parts.push('<div class="palette-section">Записи</div>', ...items.map((c, i) => row(c, i + cmds.length)));
    if (!parts.length) parts.push('<div class="empty small">Ничего не найдено</div>');
    const list = $('paletteList');
    list.innerHTML = parts.join('');
    list.querySelectorAll('.palette-item').forEach((btn) => {
      btn.addEventListener('click', () => runPaletteEntry(+btn.dataset.pi));
      btn.addEventListener('mousemove', () => {
        if (btn.classList.contains('active')) return;
        list.querySelectorAll('.palette-item').forEach((x) => x.classList.toggle('active', x === btn));
      });
    });
  }

  function runPaletteEntry(i) {
    const entry = paletteEntries[i];
    closeOverlay('paletteOverlay');
    if (entry) entry.run();
  }

  function openPalette() {
    $('paletteInput').value = '';
    renderPalette();
    openOverlay('paletteOverlay');
    setTimeout(() => $('paletteInput').focus(), 30);
  }

  function bindPalette() {
    const input = $('paletteInput');
    input.addEventListener('input', renderPalette);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive($('paletteList'), '.palette-item', 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive($('paletteList'), '.palette-item', -1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const active = document.querySelector('#paletteList .palette-item.active');
        if (active) runPaletteEntry(+active.dataset.pi);
      }
    });
  }

  /* ====================== ПРОЧЕЕ ====================== */

  // Блокировка прокрутки фона под окнами. На iPhone overflow:hidden не
  // помогает — фиксируем body и возвращаем позицию прокрутки при закрытии.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function bindScrollLock() {
    let locked = false, savedY = 0;
    const update = () => {
      const anyOpen = !!document.querySelector('.modal-overlay.open, .annot');
      document.documentElement.classList.toggle('no-scroll', anyOpen);
      if (!isIOS || anyOpen === locked) return;
      locked = anyOpen;
      const b = document.body.style;
      if (anyOpen) {
        savedY = window.scrollY;
        b.position = 'fixed'; b.top = `-${savedY}px`; b.left = '0'; b.right = '0';
      } else {
        b.position = ''; b.top = ''; b.left = ''; b.right = '';
        window.scrollTo(0, savedY);
      }
    };
    new MutationObserver(update).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'], childList: true });
    update();
  }

  // Приложение не масштабируется: на iPhone блокируем жест «щипок»
  // (Safari игнорирует user-scalable=no), двойной тап гасит touch-action в CSS.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

  // Высота видимой области с учётом экранной клавиатуры (iOS/Android).
  function bindViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const set = () => {
      root.setProperty('--vvh', vv.height + 'px');
      root.setProperty('--vvt', vv.offsetTop + 'px');
      // Открыта экранная клавиатура → панель форматирования прилипает к ней.
      const kb = window.innerHeight - vv.height > 140 && /TEXTAREA|INPUT/.test((document.activeElement || {}).tagName || '');
      document.documentElement.classList.toggle('kb-open', kb);
    };
    document.addEventListener('focusin', () => setTimeout(set, 50));
    document.addEventListener('focusout', () => setTimeout(set, 120));
    vv.addEventListener('resize', set);
    vv.addEventListener('scroll', set);
    set();
  }

  function bindNetwork() {
    window.addEventListener('offline', () => toast('Нет соединения — изменения сохранятся позже', 'err', 4200));
    window.addEventListener('online', () => { toast('Соединение восстановлено', 'ok'); retryPending(); });
  }

  function bindHotkeys() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (document.querySelector('.confirm-overlay')) return;
        const top = topOverlay();
        if (!top) {
          if (window.Projects && Projects.onEscape()) e.preventDefault();
          return;
        }
        e.preventDefault();
        if (top.id === 'editorOverlay') closeEditor();
        else if (closeHooks[top.id]) closeHooks[top.id]();
        else closeOverlay(top.id);
        return;
      }
      if (mod && (k === 'k' || k === 'л')) {
        if (document.activeElement === editor.bodyEl) return; // в редакторе — вставка ссылки
        e.preventDefault();
        openPalette();
        return;
      }
      if (mod && (k === 'n' || k === 'т') && !e.shiftKey) {
        if (!Auth.isSignedIn()) return;
        e.preventDefault();
        if (editor.overlay.classList.contains('open')) return;
        openEditor(null, state.mode === 'notes' ? 'note' : 'task');
        return;
      }
      if (mod && (k === 's' || k === 'ы')) {
        e.preventDefault();
        if (editor.overlay.classList.contains('open')) { editor.dirty = true; flushSave(); }
        return;
      }
      if (e.key === '/' && !mod) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (topOverlay()) return;
        e.preventDefault();
        openSearch();
      }
    });
  }

  // Service worker: офлайн-режим + аккуратное обновление по кнопке.
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    let reg;
    try { reg = await navigator.serviceWorker.register('/service-worker.js'); } catch { return; }
    if (!reg) return;
    const offer = (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return;
      toast('Доступна новая версия NodeNote', 'info', 15000, {
        label: 'Обновить',
        onClick: async () => { await flushSave(); worker.postMessage('SKIP_WAITING'); },
      });
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    let reloading = false;
    // Перезагружаемся только при обновлении: при самой первой установке
    // worker тоже берёт управление (clients.claim), но перезагрузка не нужна.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
    // Проверяем обновления при возвращении в приложение и раз в час.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
  }

  /* ====================== СТАРТ ====================== */

  async function init() {
    try {
      state.themePref = localStorage.getItem('nf.theme') || 'dark';
      state.accent = localStorage.getItem('nf.accent') || 'mono';
      state.mode = localStorage.getItem('nf.mode') || 'tasks';
      const sm = pref('startMode', 'last');
      if (sm && sm !== 'last') state.mode = sm;
    } catch { /* ignore */ }
    if (!['dark', 'light', 'system'].includes(state.themePref)) state.themePref = 'dark';
    if (!ACCENTS.some((a) => a.id === state.accent)) state.accent = 'mono';
    if (!MODES.includes(state.mode)) state.mode = 'tasks';
    applyTheme();
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { if (state.themePref === 'system') applyTheme(); });
    }

    bindEditor();
    bindOverlays();
    bindTrash();
    bindHotkeys();
    bindPalette();
    bindNetwork();
    bindSearch();
    bindScrollLock();
    bindViewport();

    $('themeBtn').addEventListener('click', toggleTheme);
    $('settingsBtn').addEventListener('click', openSettings);
    $('accountBtn').addEventListener('click', openAccountModal);
    $('fabAdd').addEventListener('click', addForCurrentMode);
    document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    window.addEventListener('resize', () => moveIndicator($('modeTabs')));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveIndicator($('modeTabs')));

    // Настройки поменялись — перерисовываем экран.
    if (window.Prefs) Prefs.onChange(() => { state.animateNext = false; render(); });

    // Ссылки поменялись (в т.ч. пришли из облака) — обновляем раздел.
    Links.onChange(() => {
      if (state.mode !== 'links' || $('linkOverlay').classList.contains('open')) return;
      const active = document.activeElement;
      if (active && (active.id === 'linkSearch' || active.id === 'linkAddInput')) { renderLinkGroups(); renderLinksList(); updateLinksSub(); return; }
      render();
    });

    updateModeTabs();
    render(); // скелетон / экран входа, пока ждём сессию

    await Auth.ready;
    state.authReady = true;
    updateAccountChip();

    let lastUserId = Auth.user?.id || null;
    Auth.onChange(async (u) => {
      updateAccountChip();
      if ($('accountOverlay').classList.contains('open')) renderAccountBody();
      const id = u?.id || null;
      if (id === lastUserId) return; // обновление токена — не перезагружаем
      lastUserId = id;
      if (id) {
        state.loaded = false; state.animateNext = true; render();
        await loadItems();
        Links.loadFromCloud();
      } else {
        state.items = []; state.loaded = false;
        if (window.Projects) Projects.reset();
      }
      state.animateNext = true;
      render();
    });

    if (Auth.isSignedIn()) {
      await loadItems();
      Links.loadFromCloud();
    }
    state.animateNext = true;
    render();
    registerSW();
    setInterval(() => { if (pendingSync.size) retryPending(); }, 30000);
    // Раз в минуту обновляем «через N мин» в списке задач.
    setInterval(() => { if (state.mode === 'tasks' && !topOverlay() && Auth.isSignedIn()) render(); }, 60000);

    // Ярлыки PWA: /?action=new-task или /?action=new-note
    const params = new URLSearchParams(location.search);
    const action = params.get('action');
    if (params.get('mode') && MODES.includes(params.get('mode'))) setMode(params.get('mode'));
    if (params.has('action') || params.has('mode') || params.has('source')) history.replaceState(history.state, '', location.pathname + location.hash);
    if (Auth.isSignedIn()) {
      if (action === 'new-task') openEditor(null, 'task');
      else if (action === 'new-note') openEditor(null, 'note');
    }
  }

  // Общие функции для модуля проектов (projects.js).
  window.NF = {
    $, svgIcon, ICONS, escapeHtml, uid, plural, fmtTime, fmtHuman, startOfDay, pad2,
    renderBody, plainPreview, previewLines, toggleChecklist, isRich, highlightCode, renderTable, bindImageDrop,
    insertText(ta, text) { fmtTA = ta; insertBlock(text); },
    toast, askConfirm, askText, askChoice, openOverlay, closeOverlay, closeHooks, topOverlay,
    toolbarHtml, applyFormat, onBodyKeydown, setMode, moveIndicator, showSelectBar, hideSelectBar,
    openEditor: (it) => openEditor(it),
    // Сохранить запись (для режима «Рядом»): true — сохранено на сервере.
    saveItem: (item) => persist(item).then(() => { if (window.Links) Links.ingestFromItem(item); return true; }).catch(() => false),
    render: () => render(),
    get mode() { return state.mode; },
    get items() { return state.items; },
    get animate() { return state.animateNext; },
    set animate(v) { state.animateNext = v; },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
