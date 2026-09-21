// NodeFlow — основная логика. Бэкенд — Supabase.
(function () {
  'use strict';

  const THEMES = ['noir', 'snow', 'graphite', 'azure', 'violet', 'sage'];
  const THEME_LABELS = { noir:'Noir', snow:'Snow', graphite:'Graphite', azure:'Azure', violet:'Violet', sage:'Sage' };
  const TRASH_TTL = 14 * 24 * 60 * 60 * 1000;

  const EMOJI = {
    smile:'😄', laugh:'😂', wink:'😉', cool:'😎', think:'🤔',
    heart:'❤️', fire:'🔥', star:'⭐', sparkles:'✨', boom:'💥',
    check:'✅', cross:'❌', warn:'⚠️', info:'ℹ️', question:'❓',
    idea:'💡', rocket:'🚀', target:'🎯', trophy:'🏆', medal:'🏅',
    code:'💻', bug:'🐛', book:'📚', memo:'📝', pin:'📌',
    chart:'📊', graph:'📈', calendar:'📅', clock:'⏰', bell:'🔔',
    lock:'🔒', key:'🔑', link:'🔗', package:'📦', gear:'⚙️',
    tada:'🎉', party:'🥳', clap:'👏', thumbsup:'👍', ok:'👌',
  };

  const state = {
    mode: 'tasks',
    theme: 'noir',
    items: [],
    filter: { importance: 'all', category: 'all', query: '' },
    filtersOpen: false,
    editingId: null,
    editingType: 'task',
  };

  /* ====================== УТИЛИТЫ ====================== */

  const uid = () => (crypto.randomUUID
      ? crypto.randomUUID()
      : 'i_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));

  const escapeHtml = (s) => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pad2 = (n) => String(n).padStart(2, '0');
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function toLocalInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
  const fromLocalInput = (v) => v ? (new Date(v).getTime() || null) : null;

  function remaining(deadline) {
    if (!deadline) return null;
    const diff = deadline - Date.now();
    const abs = Math.abs(diff);
    const m = Math.floor(abs / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    let s;
    if (d > 0) s = `${d}д ${h % 24}ч`;
    else if (h > 0) s = `${h}ч ${m % 60}м`;
    else s = `${m}м`;
    return { diff, text: diff < 0 ? `просрочено ${s}` : `через ${s}`, kind: diff < 0 ? 'overdue' : (diff < 24*3600*1000 ? 'soon' : 'ok') };
  }

  const startOfDay = (ts) => { const d = new Date(ts || Date.now()); d.setHours(0,0,0,0); return d.getTime(); };

  /* ====================== MARKDOWN ====================== */

  const renderEmoji = (t) => t.replace(/:([a-z0-9_+-]+):/gi, (m, n) => EMOJI[n.toLowerCase()] || m);

  function highlightCode(code, lang) {
    const cls = 'language-' + (lang || 'plain');
    if (window.Prism && lang && Prism.languages[lang]) {
      try { return `<pre class="${cls}"><code class="${cls}">${Prism.highlight(code, Prism.languages[lang], lang)}</code></pre>`; } catch {}
    }
    return `<pre class="${cls}"><code>${escapeHtml(code)}</code></pre>`;
  }

  function renderChart(values) {
    if (!values.length) return '';
    const max = Math.max(...values, 1);
    const W = 300, H = 100, barW = W / values.length;
    let bars = '';
    values.forEach((v, i) => {
      const h = (v / max) * (H - 20);
      const x = i * barW + 4;
      const y = H - 10 - h;
      bars += `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW-8).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
      bars += `<text class="label" x="${(x+(barW-8)/2).toFixed(1)}" y="${H-1}" text-anchor="middle">${v}</text>`;
    });
    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="axis" x1="0" y1="${H-10}" x2="${W}" y2="${H-10}"/>${bars}</svg></div>`;
  }

  function renderTable(rows) {
    if (!rows.length) return '';
    let html = '<table><thead><tr>';
    rows[0].forEach((c) => { html += `<th>${escapeHtml(c.trim())}</th>`; });
    html += '</tr></thead><tbody>';
    rows.slice(1).forEach((r) => {
      html += '<tr>';
      r.forEach((c) => { html += `<td>${escapeHtml(c.trim())}</td>`; });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  function renderInline(text) {
    let s = escapeHtml(text);
    s = s.replace(/@\[([a-zA-Z0-9_-]+)\]/g, (_, id) => {
      const it = state.items.find((x) => x.id === id);
      const label = it ? escapeHtml(it.title || '(без названия)') : 'missing';
      return `<a class="ref" data-ref="${id}" href="#">↗ ${label}</a>`;
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return renderEmoji(s);
  }

  function renderBody(text) {
    if (!text) return '';
    let src = text.replace(/\r\n/g, '\n');
    const blocks = [];

    src = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, body) => {
      if (lang === 'chart') {
        // Достаём все числа из строки, что бы вокруг них ни было —
        // скобки, лишние пробелы, запятые — вместо наивного split(),
        // который ломался на "[3, 7, 4, 9, 6]" (терял крайние числа
        // из-за скобок и подхватывал лишний 0 из пустого "хвоста").
        const nums = (body.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        blocks.push(renderChart(nums));
      } else {
        blocks.push(highlightCode(body, lang));
      }
      return `\u0000B${blocks.length-1}\u0000`;
    });

    src = src.replace(/(^\|.+\|\s*\n\|[-\s|:]+\|\s*\n(?:\|.*\|\s*\n?)+)/gm, (block) => {
      const rows = block.trim().split('\n').filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
          .map((l) => l.replace(/^\||\|$/g, '').split('|'));
      blocks.push(renderTable(rows));
      return `\u0000B${blocks.length-1}\u0000`;
    });

    const lines = src.split('\n');
    const out = [];
    let listType = null;
    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

    for (const raw of lines) {
      const ph = raw.match(/^\u0000B(\d+)\u0000$/);
      if (ph) { closeList(); out.push(blocks[+ph[1]]); continue; }
      // Пустая строка сама по себе не должна разрывать список —
      // иначе каждый пункт, отделённый пустой строкой, начинает
      // нумерацию заново с 1. Список закроется естественным образом,
      // как только встретится строка другого типа (см. ветки ниже).
      if (!raw.trim()) { continue; }

      const h = raw.match(/^(#{1,3})\s+(.+)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`); continue; }

      const q = raw.match(/^>\s?(.+)$/);
      if (q) { closeList(); out.push(`<blockquote>${renderInline(q[1])}</blockquote>`); continue; }

      const ul = raw.match(/^[-*]\s+(.+)$/);
      if (ul) { if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; } out.push(`<li>${renderInline(ul[1])}</li>`); continue; }

      const ol = raw.match(/^\d+\.\s+(.+)$/);
      if (ol) { if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; } out.push(`<li>${renderInline(ol[1])}</li>`); continue; }

      closeList();
      out.push(`<p>${renderInline(raw)}</p>`);
    }
    closeList();
    return out.join('');
  }

  /* ====================== ФИЛЬТР / СОРТ ====================== */

  const deleted = (it) => !!it.deleted;
  const draft = (it) => !!it.draft;
  // Черновики (не сохранённые явно кнопкой «Сохранить») и удалённые записи
  // ведут себя одинаково с точки зрения обычных списков/поиска/аналитики —
  // они скрыты отовсюду и всплывают только в своих отдельных модалках
  // («Черновики» / «Корзина»).
  const hidden = (it) => deleted(it) || draft(it);

  function sortTasks(items) {
    return [...items].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ad = a.deadline || Infinity;
      const bd = b.deadline || Infinity;
      return ad - bd;
    });
  }
  const sortNotes = (items) => [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  function applyFilter(items, type) {
    const q = state.filter.query.trim().toLowerCase();
    return items.filter((it) => {
      if (it.type !== type) return false;
      if (hidden(it)) return false;
      if (type === 'task' && state.filter.importance !== 'all' && it.importance !== state.filter.importance) return false;
      if (state.filter.category !== 'all' && (it.category || '') !== state.filter.category) return false;
      if (q) {
        const hay = ((it.title||'') + ' ' + (it.body||'') + ' ' + (it.tags||[]).join(' ')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* ====================== СИНХРОНИЗАЦИЯ ====================== */

  let syncStatusTimer = null;

  function setSyncStatus(text, kind) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.className = 'sync-status ' + (kind || '');
    el.setAttribute('aria-label', text || '');
    el.title = text || '';
    // «Сохранено»/ошибку гасим через пару секунд, «Сохранение…» держим,
    // пока идёт запрос — иначе точка постоянно висит в шапке.
    if (kind === 'ok' || kind === 'err') {
      clearTimeout(syncStatusTimer);
      syncStatusTimer = setTimeout(() => {
        el.className = 'sync-status';
        el.removeAttribute('aria-label');
        el.title = '';
      }, 2600);
    }
  }

  /* --- Тост-уведомления (ненавязчивая обратная связь) --- */
  function toast(msg, kind = 'info', ms = 2600) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = `<span class="dot"></span><span>${escapeHtml(msg)}</span>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    }, ms);
  }

  async function loadItems() {
    if (!Auth.isSignedIn()) { state.items = []; return; }
    setSyncStatus('Загрузка…', 'busy');
    try {
      await DB.purgeExpired();
      await DB.purgeExpiredDrafts();
      const all = await DB.allItems();
      // Служебная запись с настройками ИИ (см. ai.js) не должна попадать
      // в обычные списки/фильтры/метрики — убираем её здесь один раз.
      state.items = all.filter((x) => x.id !== '__ai_settings__' && x.title !== '__ai_settings__');
      setSyncStatus('Сохранено', 'ok');
    } catch (e) {
      console.error('[load]', e);
      setSyncStatus('Ошибка загрузки', 'err');
    }
  }

  async function persist(item) {
    item.updatedAt = Date.now();
    const idx = state.items.findIndex((x) => x.id === item.id);
    if (idx >= 0) state.items[idx] = item; else state.items.push(item);

    if (!Auth.isSignedIn()) { setSyncStatus('Не авторизован', 'err'); return; }

    setSyncStatus('Сохранение…', 'busy');
    try {
      const saved = await DB.upsertItem(item);
      const i = state.items.findIndex((x) => x.id === saved.id);
      if (i >= 0) state.items[i] = saved;
      setSyncStatus('Сохранено', 'ok');
    } catch (e) {
      console.error('[save]', e);
      setSyncStatus('Ошибка сохранения', 'err');
    }
  }

  async function purgeItem(id) {
    state.items = state.items.filter((x) => x.id !== id);
    if (!Auth.isSignedIn()) return;
    try {
      await DB.deleteItem(id);
      setSyncStatus('Сохранено', 'ok');
    } catch (e) {
      console.error('[delete]', e);
      setSyncStatus('Ошибка удаления', 'err');
    }
  }

  async function softDeleteItem(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.deleted = true; it.deletedAt = Date.now();
    await persist(it);
  }
  async function restoreItem(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.deleted = false; delete it.deletedAt;
    await persist(it);
  }

  /* ====================== ИИ: БЫСТРОЕ ДОБАВЛЕНИЕ С ГЛАВНОГО ЭКРАНА ====================== */

  async function runQuickAdd(text, btn, input) {
    if (!text) return;
    if (!AI.config.enabled) {
      toast('ИИ не настроен — открой «Настройки» → ИИ', 'err');
      return;
    }
    if (!Auth.isSignedIn()) {
      toast('Нужно войти в аккаунт, чтобы сохранять записи', 'err');
      return;
    }

    const prevLabel = btn.textContent;
    btn.disabled = true; input.disabled = true;
    btn.textContent = 'Думаю…';
    try {
      const parsed = await AI.createFromText(text);
      const now = Date.now();
      const item = {
        id: uid(),
        type: parsed.type,
        title: parsed.title,
        body: parsed.body,
        category: parsed.category,
        tags: parsed.tags,
        font: 'sans',
        references: [],
        done: false,
        deleted: false,
        createdAt: now,
      };
      if (parsed.type === 'task') {
        item.importance = parsed.importance;
        item.deadline = parsed.deadline;
      }
      await persist(item);
      input.value = '';
      render();
      toast(`Добавлено: ${parsed.title || 'запись'}`, 'ok');
    } catch (e) {
      console.error('[quick-add]', e);
      toast('Не получилось разобрать запрос', 'err');
    } finally {
      btn.disabled = false; input.disabled = false;
      btn.textContent = prevLabel;
    }
  }

  /* ====================== ТЕМА / РЕЖИМ ====================== */

  function applyTheme(name) {
    state.theme = name;
    document.body.dataset.theme = name;
    // Держим theme-color (цвет статус-бара PWA) в тон текущей теме.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
      meta.setAttribute('content', bg || '#000000');
    }
    const el = document.getElementById('themeLabel');
    if (el) el.textContent = THEME_LABELS[name] || name;
    localStorage.setItem('nf.theme', name);
  }
  function cycleTheme() {
    const idx = THEMES.indexOf(state.theme);
    applyTheme(THEMES[(idx + 1) % THEMES.length]);
  }
  function updateModeButton() {
    const el = document.getElementById('modeLabel');
    if (el) el.textContent = state.mode === 'tasks' ? 'Задачи' : 'Заметки';
  }
  function toggleMode() {
    state.mode = state.mode === 'tasks' ? 'notes' : 'tasks';
    localStorage.setItem('nf.mode', state.mode);
    updateModeButton();
    render();
  }

  /* ====================== РЕНДЕР ====================== */

  function render() {
    const root = document.getElementById('viewRoot');
    root.innerHTML = state.mode === 'tasks' ? renderTasksView() : renderNotesView();
    bindViewEvents();
  }

  function allCategories(type) {
    const set = new Set();
    state.items.forEach((it) => { if (it.type === type && it.category && !hidden(it)) set.add(it.category); });
    return [...set].sort();
  }

  function renderQuickAddBar() {
    return `
      <div class="quick-add-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.9 4.9L19 9.8l-5.1 1.9L12 16.6l-1.9-4.9L5 9.8l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>
        <input type="text" id="quickAddInput" placeholder="Написать ИИ">
        <button class="btn primary sm" id="quickAddBtn">Добавить</button>
      </div>
    `;
  }

  function renderFiltersPanel() {
    const cats = allCategories(state.mode === 'tasks' ? 'task' : 'note');
    const catOptions = ['<option value="all">Все категории</option>']
        .concat(cats.map((c) => `<option value="${escapeHtml(c)}" ${state.filter.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`))
        .join('');

    const impChips = state.mode === 'tasks' ? `
      <button class="chip ${state.filter.importance==='all'?'active':''}" data-imp="all">Все</button>
      <button class="chip ${state.filter.importance==='red'?'active':''}" data-imp="red"><span class="dot" style="background:var(--err)"></span>Важно</button>
      <button class="chip ${state.filter.importance==='yellow'?'active':''}" data-imp="yellow"><span class="dot" style="background:var(--warn)"></span>Средне</button>
      <button class="chip ${state.filter.importance==='green'?'active':''}" data-imp="green"><span class="dot" style="background:var(--ok)"></span>Не срочно</button>
    ` : '';

    return `
      <div class="filters-panel ${state.filtersOpen ? 'open' : ''}" id="filtersPanel">
        <div class="filters-inner">
          <div class="search-box">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="filterQuery" placeholder="Поиск…" value="${escapeHtml(state.filter.query)}">
          </div>
          <div class="chip-row">${impChips}</div>
          <select class="select-sm" id="filterCategory">${catOptions}</select>
        </div>
      </div>
    `;
  }

  function renderTaskRow(it) {
    const rem = remaining(it.deadline);
    const cls = rem ? (rem.kind === 'overdue' ? 'timer overdue' : rem.kind === 'soon' ? 'timer soon' : 'timer') : 'timer';
    const tags = (it.tags||[]).map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('');
    const cat = it.category ? `<span class="mini-tag muted">${escapeHtml(it.category)}</span>` : '';
    const desc = it.body ? `<div class="item-desc">${escapeHtml(it.body.replace(/```[\s\S]*?```/g, '[код]').slice(0, 200))}</div>` : '';
    return `
      <div class="item-row clickable ${it.done ? 'done' : ''}" data-id="${it.id}">
        <span class="importance-dot ${it.importance || 'green'}"></span>
        <div class="checkbox ${it.done ? 'checked' : ''}" data-toggle="${it.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="item-body">
          <div class="item-title ${it.done ? 'done' : ''}">${escapeHtml(it.title || '(без названия)')}</div>
          ${desc}
          <div class="item-meta">
            ${cat}${tags}
            ${rem ? `<span class="${cls}">⏱ ${escapeHtml(rem.text)} · ${escapeHtml(fmtTime(it.deadline))}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderNoteRow(it) {
    const tags = (it.tags||[]).map((t) => `<span class="mini-tag">#${escapeHtml(t)}</span>`).join('');
    const cat = it.category ? `<span class="mini-tag muted">${escapeHtml(it.category)}</span>` : '';
    const desc = it.body ? `<div class="item-desc">${escapeHtml(it.body.replace(/```[\s\S]*?```/g, '[код]').slice(0, 220))}</div>` : '';
    const refs = (it.references||[]).map((r) => {
      const t = state.items.find((x) => x.id === r);
      if (!t || t.deleted) return '';
      return `<a class="mini-tag accent" data-ref="${r}" href="#">↗ ${escapeHtml(t.title || '(без названия)')}</a>`;
    }).join('');
    return `
      <div class="item-row clickable" data-id="${it.id}">
        <div class="item-body">
          <div class="item-title">${escapeHtml(it.title || '(без названия)')}</div>
          ${desc}
          <div class="item-meta">${cat}${tags}${refs}</div>
        </div>
      </div>
    `;
  }

  function renderTasksView() {
    const activeTasks = state.items.filter((x) => x.type === 'task' && !hidden(x));
    const filteredActive = applyFilter(state.items, 'task').filter((x) => !x.done);
    const filteredDone = applyFilter(state.items, 'task').filter((x) => x.done);
    const sortedActive = sortTasks(filteredActive);
    const sortedDone = sortTasks(filteredDone);
    const total = activeTasks.length;
    const done = activeTasks.filter((x) => x.done).length;
    const active = total - done;
    const trashCount = state.items.filter(deleted).length;
    const draftsCount = state.items.filter(draft).filter((x) => !deleted(x)).length;

    const completedSection = sortedDone.length ? `
      <div class="section-title">Выполнено · ${sortedDone.length}</div>
      <div class="list">${sortedDone.map(renderTaskRow).join('')}</div>
    ` : '';

    return `
      <div class="view-head">
        <div>
          <h1 class="view-title">Задачи</h1>
          <div class="view-sub">${active} активных · ${done} выполнено</div>
        </div>
        <div class="view-actions">
          <button class="btn ghost sm filters-toggle ${state.filtersOpen ? 'open' : ''}" id="filtersToggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            Фильтры
          </button>
          <button class="btn ghost sm" id="metricsBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></svg>
            Аналитика
          </button>
          <button class="btn ghost sm" id="draftsBtn">Черновики${draftsCount ? ' · ' + draftsCount : ''}</button>
          <button class="btn ghost sm" id="trashBtn">Корзина${trashCount ? ' · ' + trashCount : ''}</button>
          <button class="btn primary" id="addBtn">+ Добавить</button>
        </div>
      </div>

      ${renderQuickAddBar()}
      ${renderFiltersPanel()}

      <div class="list">
        ${sortedActive.length ? sortedActive.map(renderTaskRow).join('') : '<div class="empty-state">Нет активных задач</div>'}
      </div>

      ${completedSection}
    `;
  }

  function renderNotesView() {
    const all = state.items.filter((x) => x.type === 'note' && !hidden(x));
    const sorted = sortNotes(applyFilter(state.items, 'note'));
    const trashCount = state.items.filter(deleted).length;
    const draftsCount = state.items.filter(draft).filter((x) => !deleted(x)).length;

    return `
      <div class="view-head">
        <div>
          <h1 class="view-title">Заметки</h1>
          <div class="view-sub">${all.length} записей</div>
        </div>
        <div class="view-actions">
          <button class="btn ghost sm filters-toggle ${state.filtersOpen ? 'open' : ''}" id="filtersToggle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
            Фильтры
          </button>
          <button class="btn ghost sm" id="metricsBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-7"/></svg>
            Аналитика
          </button>
          <button class="btn ghost sm" id="draftsBtn">Черновики${draftsCount ? ' · ' + draftsCount : ''}</button>
          <button class="btn ghost sm" id="trashBtn">Корзина${trashCount ? ' · ' + trashCount : ''}</button>
          <button class="btn primary" id="addBtn">+ Добавить</button>
        </div>
      </div>

      ${renderQuickAddBar()}
      ${renderFiltersPanel()}

      <div class="list">
        ${sorted.length ? sorted.map(renderNoteRow).join('') : '<div class="empty-state">Пока нет заметок</div>'}
      </div>
    `;
  }

  /* ====================== СОБЫТИЯ ГЛАВНОГО ЭКРАНА ====================== */

  function bindViewEvents() {
    const addBtn = document.getElementById('addBtn');
    if (addBtn) addBtn.addEventListener('click', () => openEditor(null, state.mode === 'tasks' ? 'task' : 'note'));

    const trashBtn = document.getElementById('trashBtn');
    if (trashBtn) trashBtn.addEventListener('click', openTrash);

    const draftsBtn = document.getElementById('draftsBtn');
    if (draftsBtn) draftsBtn.addEventListener('click', openDrafts);

    const quickAddBtn = document.getElementById('quickAddBtn');
    const quickAddInput = document.getElementById('quickAddInput');
    if (quickAddBtn && quickAddInput) {
      const run = () => runQuickAdd(quickAddInput.value.trim(), quickAddBtn, quickAddInput);
      quickAddBtn.addEventListener('click', run);
      quickAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    }

    const metricsBtn = document.getElementById('metricsBtn');
    if (metricsBtn) metricsBtn.addEventListener('click', openMetrics);

    const filtersToggle = document.getElementById('filtersToggle');
    if (filtersToggle) {
      filtersToggle.addEventListener('click', () => {
        state.filtersOpen = !state.filtersOpen;
        document.getElementById('filtersPanel').classList.toggle('open', state.filtersOpen);
        filtersToggle.classList.toggle('open', state.filtersOpen);
      });
    }

    document.querySelectorAll('.chip[data-imp]').forEach((c) => {
      c.addEventListener('click', () => { state.filter.importance = c.dataset.imp; render(); });
    });
    const catSel = document.getElementById('filterCategory');
    if (catSel) catSel.addEventListener('change', () => { state.filter.category = catSel.value; render(); });

    const q = document.getElementById('filterQuery');
    if (q) q.addEventListener('input', () => {
      state.filter.query = q.value;
      const root = document.getElementById('viewRoot');
      const list = root.querySelector('.list');
      if (!list) return;
      if (state.mode === 'tasks') {
        const activeFiltered = sortTasks(applyFilter(state.items, 'task').filter((x) => !x.done));
        const doneFiltered = sortTasks(applyFilter(state.items, 'task').filter((x) => x.done));
        list.innerHTML = activeFiltered.length ? activeFiltered.map(renderTaskRow).join('') : '<div class="empty-state">Нет активных задач</div>';
        let doneSection = root.querySelector('.section-title');
        let doneList = doneSection ? doneSection.nextElementSibling : null;
        if (doneFiltered.length) {
          if (!doneSection) {
            const wrap = document.createElement('div');
            wrap.innerHTML = `<div class="section-title">Выполнено · ${doneFiltered.length}</div><div class="list">${doneFiltered.map(renderTaskRow).join('')}</div>`;
            root.appendChild(wrap);
          } else {
            doneSection.textContent = `Выполнено · ${doneFiltered.length}`;
            doneList.innerHTML = doneFiltered.map(renderTaskRow).join('');
          }
        } else if (doneSection) {
          doneSection.remove();
          if (doneList) doneList.remove();
        }
        bindRowEvents(root);
      } else {
        const notes = sortNotes(applyFilter(state.items, 'note'));
        list.innerHTML = notes.length ? notes.map(renderNoteRow).join('') : '<div class="empty-state">Пока нет заметок</div>';
        bindRowEvents(root);
      }
    });

    bindRowEvents(document.getElementById('viewRoot'));
  }

  function bindRowEvents(scope) {
    scope.querySelectorAll('.checkbox[data-toggle]').forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const it = state.items.find((x) => x.id === el.dataset.toggle);
        if (!it) return;
        it.done = !it.done;
        // Оптимистичный UI: перерисовываем сразу, не дожидаясь ответа сети —
        // раньше ждали `await persist()` ДО render(), из-за чего галочка
        // «зависала» до ответа сервера. Само сохранение идёт в фоне;
        // при ошибке persist() уже показывает статус через setSyncStatus.
        render();
        persist(it).catch((err) => console.error('[toggle]', err));
      });
    });
    scope.querySelectorAll('.item-row[data-id]').forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        if (e.target.closest('.checkbox')) return;
        if (e.target.closest('a.ref, a.mini-tag')) return;
        const it = state.items.find((x) => x.id === el.dataset.id);
        if (it) openEditor(it, it.type);
      });
    });
    scope.querySelectorAll('a.ref, a.mini-tag[data-ref]').forEach((a) => {
      if (a.dataset.bound) return;
      a.dataset.bound = '1';
      a.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const it = state.items.find((x) => x.id === a.dataset.ref);
        if (it) openEditor(it, it.type);
      });
    });
  }

  /* ====================== АНАЛИТИКА ====================== */

  function openMetrics() {
    const overlay = document.getElementById('metricsOverlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    renderMetrics();
    if (window.gsap) {
      gsap.fromTo('#metricsBody .metric, #metricsBody .metrics-section',
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: .35, stagger: .04, ease: 'power2.out', clearProps: 'all' });
    }
  }
  function closeMetrics() {
    const o = document.getElementById('metricsOverlay');
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
  }

  function renderMetrics() {
    const body = document.getElementById('metricsBody');
    const tasks = state.items.filter((x) => x.type === 'task' && !hidden(x));
    const notes = state.items.filter((x) => x.type === 'note' && !hidden(x));
    const total = tasks.length;
    const done = tasks.filter((x) => x.done).length;
    const active = total - done;
    const overdue = tasks.filter((x) => !x.done && x.deadline && x.deadline < Date.now()).length;
    const pct = total ? Math.round((done/total)*100) : 0;

    const DAYS = 14;
    const today0 = startOfDay();
    const buckets = Array.from({ length: DAYS }, (_, i) => ({ ts: today0 - (DAYS-1-i)*86400000, count: 0 }));
    tasks.forEach((t) => {
      const day = startOfDay(t.createdAt || 0);
      const idx = Math.round((day - buckets[0].ts) / 86400000);
      if (idx >= 0 && idx < DAYS) buckets[idx].count++;
    });

    const imp = { red: 0, yellow: 0, green: 0 };
    tasks.forEach((t) => { imp[t.importance || 'green']++; });

    const catMap = {};
    tasks.forEach((t) => { if (t.category) catMap[t.category] = (catMap[t.category]||0) + 1; });
    const cats = Object.entries(catMap).sort((a,b) => b[1]-a[1]).slice(0, 6);
    const catsMax = cats.length ? cats[0][1] : 1;

    const weekday = [0,0,0,0,0,0,0];
    tasks.forEach((t) => { if (t.deadline) weekday[new Date(t.deadline).getDay()]++; });

    body.innerHTML = `
      <div class="metrics-grid">
        <div class="metric"><div class="k">Всего</div><div class="v">${total}</div></div>
        <div class="metric"><div class="k">Активных</div><div class="v">${active}</div></div>
        <div class="metric"><div class="k">Просрочено</div><div class="v err">${overdue}</div></div>
        <div class="metric"><div class="k">Готовность</div><div class="v ok">${pct}%</div></div>
      </div>

      <div class="metrics-section">
        <div class="metrics-section-head">Активность · 14 дней</div>
        <div class="metrics-chart-card">
          ${svgBarChart(buckets.map((b, i) => ({ value: b.count, label: i % 2 === 0 ? shortDate(b.ts) : '' })))}
        </div>
      </div>

      <div class="metrics-section">
        <div class="metrics-section-head">По дедлайнам · дни недели</div>
        <div class="metrics-chart-card">
          ${svgBarChart(['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((label,i)=>({value:weekday[(i+1)%7],label})), { height: 140 })}
        </div>
      </div>

      <div class="metrics-two-col metrics-section">
        <div>
          <div class="metrics-section-head">По важности</div>
          ${svgDonut([
      { value: imp.red, color: 'var(--err)', label: 'Важно' },
      { value: imp.yellow, color: 'var(--warn)', label: 'Средне' },
      { value: imp.green, color: 'var(--ok)', label: 'Не срочно' },
    ])}
        </div>
        <div>
          <div class="metrics-section-head">По категориям</div>
          <div class="metrics-chart-card">
            ${cats.length ? `
              <div class="cat-list">
                ${cats.map(([name, count]) => `
                  <div class="cat-row">
                    <span class="name">${escapeHtml(name)}</span>
                    <div class="track"><div class="fill" style="width:${(count/catsMax)*100}%"></div></div>
                    <span class="num">${count}</span>
                  </div>
                `).join('')}
              </div>
            ` : '<div class="empty-state" style="padding:24px 8px;border:none;background:transparent">Нет категорий</div>'}
          </div>
        </div>
      </div>

      <div class="metrics-section">
        <div class="metrics-section-head">Заметки</div>
        <div class="metrics-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:0">
          <div class="metric"><div class="k">Всего заметок</div><div class="v">${notes.length}</div></div>
          <div class="metric"><div class="k">Со ссылками</div><div class="v">${notes.filter(n => (n.references||[]).length).length}</div></div>
        </div>
      </div>
    `;
  }

  const shortDate = (ts) => { const d = new Date(ts); return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}`; };

  function svgBarChart(data, opts = {}) {
    if (!data.length) return '<div class="empty-state">Нет данных</div>';
    const W = 760, H = opts.height || 160, padX = 12, padTop = 12, padBot = 22;
    const max = Math.max(...data.map((d) => d.value), 1);
    const stepX = (W - padX*2) / data.length;
    const barW = Math.max(4, stepX - 6);
    let out = '';
    data.forEach((d, i) => {
      const h = (d.value/max) * (H - padTop - padBot);
      const x = padX + i*stepX + (stepX-barW)/2;
      const y = H - padBot - h;
      out += `<rect class="chart-bar ${d.value===0?'dim':''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="2"/>`;
      if (d.label) out += `<text class="chart-label" x="${(x+barW/2).toFixed(1)}" y="${H-6}" text-anchor="middle">${d.label}</text>`;
    });
    out += `<line class="chart-axis" x1="${padX}" y1="${H-padBot}" x2="${W-padX}" y2="${H-padBot}"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${out}</svg>`;
  }

  function svgDonut(segments) {
    const total = segments.reduce((s,x) => s + x.value, 0);
    const size = 140, R = 58, r = 40, cx = size/2, cy = size/2;
    if (!total) {
      return `
        <div class="donut-wrap">
          <svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${R-r}"/>
            <text class="donut-total" x="${cx}" y="${cy}" dy="8" text-anchor="middle">0</text>
          </svg>
          <div class="donut-legend">
            ${segments.map(s => `<div class="donut-legend-row"><span class="donut-swatch" style="background:${s.color}"></span><span class="donut-legend-label">${s.label}</span><span class="donut-legend-value">0</span></div>`).join('')}
          </div>
        </div>
      `;
    }
    const C = 2*Math.PI*((R+r)/2);
    let offset = 0, arcs = '';
    segments.forEach((s) => {
      if (!s.value) return;
      const len = (s.value/total)*C;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none" stroke="${s.color}" stroke-width="${R-r}" stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += len;
    });
    return `
      <div class="donut-wrap">
        <svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${cx}" cy="${cy}" r="${(R+r)/2}" fill="none" stroke="var(--surface-3)" stroke-width="${R-r}"/>
          ${arcs}
          <text class="donut-total" x="${cx}" y="${cy}" dy="8" text-anchor="middle">${total}</text>
        </svg>
        <div class="donut-legend">
          ${segments.map(s => `
            <div class="donut-legend-row">
              <span class="donut-swatch" style="background:${s.color}"></span>
              <span class="donut-legend-label">${s.label}</span>
              <span class="donut-legend-value">${s.value}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /* ====================== РЕДАКТОР (с autosave) ====================== */

  const editor = {
    overlay:null, titleEl:null, categoryEl:null, tagsEl:null,
    deadlineEl:null, importanceEl:null, fontEl:null,
    bodyEl:null, previewEl:null, refsEl:null,
    refsSelected: new Set(),
  };
  let autosaveTimer = null;
  let aiBusy = false;

  function openEditor(item, type) {
    // Раньше для новой записи editingId оставался null до самого "Сохранить".
    // Из-за этого двойной клик/тап по кнопке (или клик, пока предыдущий
    // persist() ещё летит по сети) создавал ДВЕ разные записи с разными id —
    // это и есть баг «дублирующиеся заметки». Теперь id генерируется сразу
    // при открытии редактора и остаётся неизменным до закрытия: и автосейв,
    // и ручное сохранение всегда делают upsert по одному и тому же id,
    // так что повторный вызов просто перезапишет ту же запись, а не создаст новую.
    state.editingId = item ? item.id : uid();
    state.editingType = item ? item.type : type;

    editor.overlay.classList.add('open');
    editor.overlay.setAttribute('aria-hidden', 'false');

    const t = item || {
      title:'', body:'', category:'', tags:[],
      importance:'green', deadline:null, font:'sans', references:[], done:false,
    };

    editor.titleEl.value = t.title || '';
    editor.categoryEl.value = t.category || '';
    editor.tagsEl.value = (t.tags||[]).join(', ');
    editor.deadlineEl.value = toLocalInput(t.deadline);
    editor.importanceEl.value = t.importance || 'green';
    editor.fontEl.value = t.font === 'mono' ? 'mono' : 'sans';
    editor.bodyEl.value = t.body || '';

    editor.refsSelected = new Set(t.references || []);
    renderRefPicker();
    renderCategoryDatalist();
    setEditorType(state.editingType);
    updatePreview();
    toggleAiPanel(false);
    document.getElementById('aiPromptInput').value = '';
    setTimeout(() => editor.titleEl.focus(), 50);
  }

  function closeEditor() {
    clearTimeout(autosaveTimer);
    editor.overlay.classList.remove('open');
    editor.overlay.setAttribute('aria-hidden', 'true');
    state.editingId = null;
  }

  function setEditorType(type) {
    state.editingType = type;
    document.querySelectorAll('#editorTypeSwitch button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    document.querySelectorAll('[data-task-only]').forEach((el) => { el.style.display = type === 'task' ? '' : 'none'; });
  }

  function renderCategoryDatalist() {
    const dl = document.getElementById('categoryList');
    const cats = new Set();
    state.items.forEach((it) => { if (it.category && !hidden(it)) cats.add(it.category); });
    dl.innerHTML = [...cats].map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  function renderRefPicker() {
    const others = state.items
        .filter((x) => x.id !== state.editingId && !hidden(x))
        .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0))
        .slice(0, 40);
    if (!others.length) {
      editor.refsEl.innerHTML = '<span class="mini-tag muted">нет доступных записей</span>';
      return;
    }
    editor.refsEl.innerHTML = others.map((o) => `
      <button type="button" class="ref-chip ${editor.refsSelected.has(o.id) ? 'on' : ''}" data-ref-id="${o.id}">
        ${o.type === 'task' ? '✓' : '¶'} ${escapeHtml(o.title || '(без названия)')}
      </button>
    `).join('');
    editor.refsEl.querySelectorAll('.ref-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.refId;
        if (editor.refsSelected.has(id)) editor.refsSelected.delete(id);
        else editor.refsSelected.add(id);
        btn.classList.toggle('on');
        scheduleAutosave();
      });
    });
  }

  function updateCharCount() {
    const el = document.getElementById('charCount');
    if (!el || !editor.bodyEl) return;
    const text = (editor.titleEl.value + '\n' + editor.bodyEl.value);
    const words = (text.trim().match(/\S+/g) || []).length;
    el.textContent = `${words} сл. · ${text.length} симв.`;
  }

  function updatePreview() {
    const body = editor.bodyEl.value;
    editor.previewEl.innerHTML = body.trim() ? renderBody(body) : '';
    updateCharCount();
  }

  function insertAtCursor(text) {
    const ta = editor.bodyEl;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + text.length;
    ta.focus();
    updatePreview();
    scheduleAutosave();
  }

  /* ---------- ИИ-помощник в редакторе ---------- */

  function setAiPanelStatus(text, kind) {
    const el = document.getElementById('aiPanelStatus');
    if (!el) return;
    el.innerHTML = kind === 'busy'
        ? `<span class="ai-spinner"></span>${escapeHtml(text)}`
        : escapeHtml(text);
    el.className = 'ai-status-line' + (kind ? ' ' + kind : '');
  }

  function setAiBusy(busy) {
    aiBusy = busy;
    document.querySelectorAll('.ai-quick-btn, #aiPromptSend').forEach((b) => { b.disabled = busy; });
  }

  async function runAiAction(action, customPrompt) {
    if (aiBusy) return;
    if (!AI.config.enabled) {
      setAiPanelStatus('ИИ не настроен — открой «Настройки» → ИИ', 'err');
      return;
    }
    const title = editor.titleEl.value.trim();
    const body = editor.bodyEl.value;
    if (action !== 'title' && !body.trim()) {
      setAiPanelStatus('Сначала напиши хоть немного текста', 'err');
      return;
    }

    setAiBusy(true);
    setAiPanelStatus(action === 'title' ? 'Придумываю заголовок…' : 'Работаю над текстом…', 'busy');
    try {
      const result = await AI.editText({ action, customPrompt, title, body });
      if (result.title !== undefined) {
        editor.titleEl.value = result.title;
      }
      if (result.body !== undefined) {
        editor.bodyEl.value = result.body;
        updatePreview();
      }
      scheduleAutosave();
      setAiPanelStatus('Готово', 'ok');
    } catch (e) {
      console.error('[ai]', e);
      setAiPanelStatus(e.message || 'Ошибка ИИ', 'err');
    } finally {
      setAiBusy(false);
    }
  }

  function toggleAiPanel(forceOpen) {
    const panel = document.getElementById('aiPanel');
    const open = forceOpen !== undefined ? forceOpen : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    if (open) {
      setAiPanelStatus('', '');
      setTimeout(() => document.getElementById('aiPromptInput')?.focus(), 200);
    }
  }

  function bindAiPanel() {
    document.getElementById('aiPanelToggle').addEventListener('click', () => toggleAiPanel());

    document.querySelectorAll('.ai-quick-btn').forEach((btn) => {
      btn.addEventListener('click', () => runAiAction(btn.dataset.aiAction));
    });

    const promptInput = document.getElementById('aiPromptInput');
    const send = () => {
      const text = promptInput.value.trim();
      if (!text) return;
      runAiAction('custom', text);
      promptInput.value = '';
    };
    document.getElementById('aiPromptSend').addEventListener('click', send);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  function readEditorInto(item) {
    item.type = state.editingType;
    item.title = editor.titleEl.value.trim();
    item.body = editor.bodyEl.value;
    item.category = editor.categoryEl.value.trim();
    item.tags = editor.tagsEl.value.split(',').map((s) => s.trim()).filter(Boolean);
    item.font = editor.fontEl.value === 'mono' ? 'mono' : 'sans';
    item.references = [...editor.refsSelected];
    if (item.type === 'task') {
      item.deadline = fromLocalInput(editor.deadlineEl.value);
      item.importance = editor.importanceEl.value;
    } else {
      delete item.deadline;
      delete item.importance;
      item.done = false;
    }
    return item;
  }

  // saveLock защищает от «гонки состояний»: пока идёт upsert в БД, повторный
  // вызов (автосейв сработал одновременно с ручным «Сохранить», либо два
  // быстрых клика/тапа) просто выходит, ничего не создавая — id записи один
  // и тот же (см. openEditor), поэтому даже параллельные upsert-ы по одному
  // id не могут породить дубликат, а лок нужен только чтобы не долбить сеть.
  let saveLock = false;

  async function persistFromEditor(isAutosave) {
    if (saveLock) return;
    const title = editor.titleEl.value.trim();
    const body = editor.bodyEl.value;
    if (!title && !body) return; // пустой черновик не сохраняем

    saveLock = true;
    try {
      const existing = state.items.find((x) => x.id === state.editingId);
      const item = existing ? { ...existing } : {
        id: state.editingId, type: state.editingType, done: false,
        createdAt: Date.now(), deleted: false, draft: true,
      };
      readEditorInto(item);
      // Автосейв (пока пользователь печатает и ещё не нажал «Сохранить»)
      // помечает запись как черновик — она не попадает в обычные списки/
      // фильтры/аналитику (см. hidden()) и видна только в модалке
      // «Черновики». Явное «Сохранить» ниже (isAutosave=false) всегда
      // снимает флаг draft и делает запись обычной — это единственное
      // место, где черновик становится настоящей задачей/заметкой.
      item.draft = isAutosave ? (item.draft !== false) : false;
      await persist(item);
    } finally {
      saveLock = false;
    }
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => persistFromEditor(true), 1500);
  }

  async function saveEditor() {
    clearTimeout(autosaveTimer);
    const saveBtn = document.getElementById('editorSave');
    // Кнопка блокируется немедленно и синхронно — до первого await — чтобы
    // второй клик/тап, случившийся, пока сеть ещё не ответила, был просто
    // проигнорирован, а не запустил параллельное сохранение.
    if (saveBtn && saveBtn.disabled) return;
    if (saveBtn) saveBtn.disabled = true;
    try {
      const title = editor.titleEl.value.trim();
      const body = editor.bodyEl.value;
      if (!title && !body) { closeEditor(); return; }
      await persistFromEditor(false);
      closeEditor();
      render();
      toast('Сохранено', 'ok');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteFromEditor() {
    if (!state.editingId) { closeEditor(); return; }
    if (!confirm('Переместить в корзину? Восстановить можно 14 дней.')) return;
    await softDeleteItem(state.editingId);
    closeEditor();
    render();
    toast('Перемещено в корзину', 'info');
  }

  function bindEditor() {
    editor.overlay = document.getElementById('editorOverlay');
    editor.titleEl = document.getElementById('editorTitle');
    editor.categoryEl = document.getElementById('editorCategory');
    editor.tagsEl = document.getElementById('editorTags');
    editor.deadlineEl = document.getElementById('editorDeadline');
    editor.importanceEl = document.getElementById('editorImportance');
    editor.fontEl = document.getElementById('editorFont');
    editor.bodyEl = document.getElementById('editorBody');
    editor.previewEl = document.getElementById('editorPreview');
    editor.refsEl = document.getElementById('editorRefs');

    document.querySelectorAll('#editorTypeSwitch button').forEach((b) => {
      b.addEventListener('click', () => { setEditorType(b.dataset.type); scheduleAutosave(); });
    });
    document.getElementById('editorSave').addEventListener('click', saveEditor);
    document.getElementById('editorCancel').addEventListener('click', closeEditor);
    document.getElementById('editorDelete').addEventListener('click', deleteFromEditor);
    bindAiPanel();

    editor.bodyEl.addEventListener('input', () => { updatePreview(); scheduleAutosave(); });
    ['input','change'].forEach((ev) => {
      [editor.titleEl, editor.categoryEl, editor.tagsEl, editor.deadlineEl, editor.importanceEl, editor.fontEl]
          .forEach((el) => el.addEventListener(ev, scheduleAutosave));
    });

    // По требованию UX: окно записи закрывается ТОЛЬКО по кнопке "Закрыть" (крестик)
    // или по "Сохранить" — клик по фону больше ничего не делает, чтобы случайный
    // клик мимо поля не закрывал редактор и не терял фокус на мобильном.
    document.getElementById('editorClose').addEventListener('click', saveEditor);

    document.querySelectorAll('.toolbar .tool').forEach((btn) => {
      btn.addEventListener('click', () => {
        const md = btn.dataset.md;
        if (md === '**') insertAtCursor('**жирный**');
        else if (md === '*') insertAtCursor('*курсив*');
        else if (md === 'code') insertAtCursor('\n```javascript\n// код\n```\n');
        else if (md === 'table') insertAtCursor('\n| A | B |\n| - | - |\n| 1 | 2 |\n');
        else if (md === 'chart') insertAtCursor('\n```chart\n[3, 7, 4, 9, 6]\n```\n');
      });
    });

    const pop = document.getElementById('emojiPopover');
    document.getElementById('emojiBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      pop.style.left = Math.min(rect.left, window.innerWidth - 316) + 'px';
      pop.style.top = (rect.bottom + 6) + 'px';
      pop.hidden = !pop.hidden;
    });
    pop.innerHTML = Object.keys(EMOJI).map((k) => `<button data-emoji="${k}" title=":${k}:">${EMOJI[k]}</button>`).join('');
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-emoji]');
      if (!b) return;
      insertAtCursor(':' + b.dataset.emoji + ':');
      pop.hidden = true;
    });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true; });
  }

  /* ====================== КОРЗИНА ====================== */

  function openTrash() {
    const o = document.getElementById('trashOverlay');
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
    renderTrashList();
  }
  function closeTrash() {
    const o = document.getElementById('trashOverlay');
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
  }
  function renderTrashList() {
    const list = document.getElementById('trashList');
    const items = state.items.filter(deleted).sort((a,b) => (b.deletedAt||0) - (a.deletedAt||0));
    if (!items.length) { list.innerHTML = '<div class="empty-state">Корзина пуста</div>'; return; }
    list.innerHTML = items.map((it) => {
      const days = Math.max(0, Math.ceil((TRASH_TTL - (Date.now() - (it.deletedAt||0))) / 86400000));
      return `
        <div class="item-row item-row-actions">
          <div class="item-body">
            <div class="item-title">${escapeHtml(it.title || '(без названия)')}</div>
            <div class="item-meta">
              <span class="mini-tag muted">${it.type === 'task' ? 'Задача' : 'Заметка'}</span>
              <span class="mini-tag muted">осталось ${days} дн.</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn sm" data-restore="${it.id}">Восстановить</button>
            <button class="btn sm ghost" data-purge="${it.id}">Удалить</button>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('[data-restore]').forEach((b) => {
      b.addEventListener('click', async () => { await restoreItem(b.dataset.restore); renderTrashList(); render(); toast('Восстановлено', 'ok'); });
    });
    list.querySelectorAll('[data-purge]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить навсегда?')) return;
        await purgeItem(b.dataset.purge);
        renderTrashList(); render(); toast('Удалено навсегда', 'info');
      });
    });
  }
  function bindTrash() {
    document.getElementById('trashClose').addEventListener('click', closeTrash);
    // Закрытие только по крестику — клик по фону больше не закрывает окно.
    document.getElementById('trashEmptyBtn').addEventListener('click', async () => {
      if (!confirm('Очистить корзину полностью?')) return;
      const all = state.items.filter(deleted);
      for (const it of all) await purgeItem(it.id);
      renderTrashList(); render();
    });
  }

  /* ====================== ЧЕРНОВИКИ ====================== */
  // Черновики — записи, автосохранённые во время печати, но ни разу не
  // подтверждённые явным нажатием «Сохранить» (см. persistFromEditor).
  // Они скрыты из обычных списков/фильтров/аналитики (см. hidden()) и
  // живут здесь, пока пользователь не откроет и не сохранит их явно,
  // либо не удалит — иначе через 14 дней с момента создания они
  // автоматически стираются (см. DB.purgeExpiredDrafts()).

  function openDrafts() {
    const o = document.getElementById('draftsOverlay');
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
    renderDraftsList();
  }
  function closeDrafts() {
    const o = document.getElementById('draftsOverlay');
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
  }
  function renderDraftsList() {
    const list = document.getElementById('draftsList');
    const items = state.items
        .filter((x) => draft(x) && !deleted(x))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!items.length) { list.innerHTML = '<div class="empty-state">Черновиков нет</div>'; return; }
    list.innerHTML = items.map((it) => {
      const days = Math.max(0, Math.ceil((TRASH_TTL - (Date.now() - (it.createdAt || 0))) / 86400000));
      return `
        <div class="item-row item-row-actions">
          <div class="item-body">
            <div class="item-title">${escapeHtml(it.title || '(без названия)')}</div>
            <div class="item-meta">
              <span class="mini-tag muted">${it.type === 'task' ? 'Задача' : 'Заметка'}</span>
              <span class="mini-tag muted">удалится через ${days} дн.</span>
            </div>
          </div>
          <div class="item-actions">
            <button class="btn sm" data-open-draft="${it.id}">Открыть</button>
            <button class="btn sm ghost" data-delete-draft="${it.id}">Удалить</button>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('[data-open-draft]').forEach((b) => {
      b.addEventListener('click', () => {
        const it = state.items.find((x) => x.id === b.dataset.openDraft);
        if (!it) return;
        closeDrafts();
        openEditor(it, it.type);
      });
    });
    list.querySelectorAll('[data-delete-draft]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Удалить черновик безвозвратно?')) return;
        await purgeItem(b.dataset.deleteDraft);
        renderDraftsList(); render();
      });
    });
  }
  function bindDrafts() {
    document.getElementById('draftsClose').addEventListener('click', closeDrafts);
    // Закрытие только по крестику — клик по фону больше не закрывает окно.
    document.getElementById('draftsEmptyBtn').addEventListener('click', async () => {
      if (!confirm('Удалить все черновики безвозвратно?')) return;
      const all = state.items.filter((x) => draft(x) && !deleted(x));
      for (const it of all) await purgeItem(it.id);
      renderDraftsList(); render();
    });
  }

  /* ====================== НАСТРОЙКИ / АККАУНТ ====================== */

  function setStatus(id, text, cls = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'status ' + cls;
  }

  function refreshAiSettingsForm() {
    const a = AI.config;
    const providerEl = document.getElementById('aiProvider');
    if (!providerEl) return; // модалка ещё не забинжена
    providerEl.value = a.provider || '';
    document.getElementById('aiKey').value = a.apiKey || '';
    document.getElementById('aiBaseUrl').value = a.baseUrl || '';
    document.getElementById('aiModel').value = a.model || '';
  }

  function bindSettings() {
    const overlay = document.getElementById('settingsOverlay');
    const close = () => { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true'); };
    document.getElementById('settingsClose').addEventListener('click', close);
    // Закрытие только по крестику — клик по фону больше не закрывает окно.

    document.getElementById('aiSave').addEventListener('click', async () => {
      AI.setConfig({
        provider: document.getElementById('aiProvider').value,
        apiKey: document.getElementById('aiKey').value.trim(),
        baseUrl: document.getElementById('aiBaseUrl').value.trim(),
        model: document.getElementById('aiModel').value.trim(),
      });
      const remember = document.getElementById('aiRemember');
      if (remember && remember.checked) {
        if (!Auth.isSignedIn()) {
          setStatus('aiStatus', 'Сохранено локально. Чтобы запомнить на аккаунте — сначала войди', 'err');
          return;
        }
        try {
          await AI.saveToCloud();
          setStatus('aiStatus', AI.config.enabled ? 'Сохранено на аккаунте' : 'ИИ выключен', AI.config.enabled ? 'ok' : '');
        } catch (e) {
          setStatus('aiStatus', 'Сохранено локально, но не на аккаунте: ' + e.message, 'err');
        }
      } else {
        setStatus('aiStatus', AI.config.enabled ? 'Сохранено на этом устройстве' : 'ИИ выключен', AI.config.enabled ? 'ok' : '');
      }
    });
    document.getElementById('aiTest').addEventListener('click', async () => {
      try { const out = await AI.test(); setStatus('aiStatus', 'Ответ: ' + out, 'ok'); }
      catch (e) { setStatus('aiStatus', e.message, 'err'); }
    });
    const forgetBtn = document.getElementById('aiForget');
    if (forgetBtn) {
      forgetBtn.addEventListener('click', async () => {
        if (!Auth.isSignedIn()) { setStatus('aiStatus', 'Не авторизован', 'err'); return; }
        if (!confirm('Удалить сохранённый на аккаунте ключ ИИ?')) return;
        try {
          await AI.clearCloud();
          setStatus('aiStatus', 'Удалено с аккаунта', 'ok');
        } catch (e) {
          setStatus('aiStatus', e.message, 'err');
        }
      });
    }

    document.getElementById('metricsClose').addEventListener('click', closeMetrics);
    // Закрытие только по крестику — клик по фону больше не закрывает окно.

    document.getElementById('settingsBtn').addEventListener('click', () => {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      refreshAiSettingsForm();
      const rememberEl = document.getElementById('aiRemember');
      const rememberRow = document.getElementById('aiRememberRow');
      if (rememberEl) rememberEl.checked = false;
      if (rememberRow) rememberRow.hidden = !Auth.isSignedIn();
      setStatus('aiStatus', '', '');
      refreshEmailSettingsForm();
      setStatus('emailStatus', '', '');
    });

    bindEmailSettings();
  }

  function refreshEmailSettingsForm() {
    const recipientEl = document.getElementById('emailRecipient');
    const enabledEl = document.getElementById('emailEnabled');
    if (!recipientEl || !window.Email) return;
    recipientEl.value = Email.getRecipient();
    enabledEl.checked = Email.isEnabled();
  }

  function bindEmailSettings() {
    const saveBtn = document.getElementById('emailSave');
    const testBtn = document.getElementById('emailTest');
    if (!saveBtn || !window.Email) return;

    saveBtn.addEventListener('click', () => {
      const recipient = document.getElementById('emailRecipient').value.trim();
      const enabled = document.getElementById('emailEnabled').checked;
      if (enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        setStatus('emailStatus', 'Укажи корректный email-адрес', 'err');
        return;
      }
      Email.setRecipient(recipient);
      Email.setEnabled(enabled);
      setStatus('emailStatus', enabled ? 'Email-напоминания включены' : 'Email-напоминания выключены', enabled ? 'ok' : '');
    });

    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      try {
        await Email.testEmail();
        setStatus('emailStatus', 'Тестовое письмо отправлено', 'ok');
      } catch (e) {
        setStatus('emailStatus', e.message, 'err');
      } finally {
        testBtn.disabled = false;
      }
    });
  }

  /* ====================== ПРОВЕРКА ДЕДЛАЙНОВ ДЛЯ EMAIL ====================== */

  let deadlineWatcherTimer = null;
  function startDeadlineWatcher() {
    clearInterval(deadlineWatcherTimer);
    if (!window.Email) return;
    const tick = () => { if (Auth.isSignedIn()) Email.checkDeadlines(state.items).catch(() => {}); };
    tick();
    deadlineWatcherTimer = setInterval(tick, 5 * 60 * 1000); // раз в 5 минут, пока вкладка открыта
  }

  function bindAccount() {
    const overlay = document.getElementById('accountOverlay');
    const close = () => { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true'); };
    document.getElementById('accountClose').addEventListener('click', close);
    // Закрытие только по крестику — клик по фону больше не закрывает окно.
    document.getElementById('accountBtn').addEventListener('click', () => {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      renderAccountBody();
    });
  }

  function renderAccountBody() {
    const body = document.getElementById('accountBody');
    const user = Auth.user;

    if (!Auth.isConfigured()) {
      body.innerHTML = `
        <p class="hint">Supabase не настроен. Заполни <code>SUPABASE_URL</code> и <code>SUPABASE_ANON_KEY</code> в файле <code>.env</code> в корне проекта.</p>
        <pre style="font-family:var(--font-mono);font-size:12px;background:var(--surface-2);padding:12px;border-radius:6px;border:1px solid var(--border);overflow-x:auto"><code>SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...</code></pre>
        <p class="hint">Затем перезапусти сервер.</p>
      `;
      return;
    }

    if (!user) {
      body.innerHTML = `
        <p class="hint">Войди через Google — все задачи и заметки будут храниться в твоём Supabase-проекте.</p>
        <div class="row-actions" style="margin-top:20px">
          <button class="btn primary" id="accGoogle" style="padding:10px 18px">
            <svg width="16" height="16" viewBox="0 0 48 48" style="margin-right:2px">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.3 5.3C40.9 36.5 44 31.1 44 24c0-1.3-.1-2.3-.4-3.5z"/>
            </svg>
            Войти через Google
          </button>
        </div>
        <div class="status" id="accStatus"></div>
      `;
      document.getElementById('accGoogle').addEventListener('click', async () => {
        try {
          setStatus('accStatus', 'Открываю Google…');
          await Auth.signInWithGoogle();
        } catch (e) { setStatus('accStatus', e.message, 'err'); }
      });
      return;
    }

    const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Пользователь';
    const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
    const initial = (name || '?')[0].toUpperCase();

    body.innerHTML = `
      <div class="account-user">
        ${avatar
        ? `<img src="${escapeHtml(avatar)}" alt="">`
        : `<div class="auth-avatar-lg">${escapeHtml(initial)}</div>`}
        <div style="min-width:0">
          <div class="name">${escapeHtml(name)}</div>
          <div class="email">${escapeHtml(user.email || '')}</div>
        </div>
      </div>
      <div class="row-actions">
        <button class="btn" id="accSync">Обновить с сервера</button>
        <button class="btn ghost" id="accSignOut">Выйти</button>
      </div>
      <div class="status ok">Синхронизация включена</div>
    `;
    document.getElementById('accSync').addEventListener('click', async () => {
      await loadItems();
      render();
      renderAccountBody();
    });
    document.getElementById('accSignOut').addEventListener('click', async () => {
      await Auth.signOut();
      state.items = [];
      render();
      renderAccountBody();
    });
  }

  function updateAccountChip() {
    const label = document.getElementById('authLabel');
    const icon = document.getElementById('authIcon');
    const avatar = document.getElementById('authAvatar');
    if (!label) return;
    const u = Auth.user;
    if (u) {
      const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email || 'Аккаунт';
      label.textContent = String(name).split(' ')[0];
      icon.style.display = 'none';
      avatar.hidden = false;

      const pic = u.user_metadata?.avatar_url || u.user_metadata?.picture;
      if (pic) {
        avatar.style.backgroundImage = `url(${escapeHtml(pic)})`;
        avatar.textContent = '';
      } else {
        avatar.style.backgroundImage = '';
        avatar.textContent = String(name)[0].toUpperCase();
      }
    } else {
      label.textContent = 'Войти';
      icon.style.display = '';
      avatar.hidden = true;
      avatar.style.backgroundImage = '';
      avatar.textContent = '';
    }
  }

  /* ====================== ИНТРО ====================== */

  function playIntro() {
    const intro = document.getElementById('intro');
    if (!intro) return;
    if (!window.gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { intro.remove(); return; }
    const tl = gsap.timeline({ onComplete: () => intro.remove(), defaults: { ease: 'power3.out' } });
    tl.fromTo('#introText', { opacity:0, y:10, scale:.98 }, { opacity:1, y:0, scale:1, duration:.6 })
        .to({}, { duration: .9 })
        .to('#introText', { opacity:0, y:-8, duration:.35, ease:'power2.in' })
        .to('.intro-left',  { xPercent: -100, duration:.9, ease:'expo.inOut' }, '-=.15')
        .to('.intro-right', { xPercent:  100, duration:.9, ease:'expo.inOut' }, '<')
        .to('.intro', { autoAlpha:0, duration:.2 }, '-=.1');
    gsap.fromTo('.topbar, .content-card', { opacity:0, y:10 }, { opacity:1, y:0, duration:.7, delay:.9, stagger:.08, ease:'power3.out', clearProps:'all' });
  }

  /* ====================== МОДАЛКИ-ХЕЛПЕРЫ (для палитры) ====================== */

  function openSettingsModal() {
    const overlay = document.getElementById('settingsOverlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    refreshAiSettingsForm();
    const rememberEl = document.getElementById('aiRemember');
    const rememberRow = document.getElementById('aiRememberRow');
    if (rememberEl) rememberEl.checked = false;
    if (rememberRow) rememberRow.hidden = !Auth.isSignedIn();
    setStatus('aiStatus', '', '');
    refreshEmailSettingsForm();
    setStatus('emailStatus', '', '');
  }

  function openAccountModal() {
    const overlay = document.getElementById('accountOverlay');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    renderAccountBody();
  }

  /* ====================== КОМАНДНАЯ ПАЛИТРА (⌘/Ctrl+K) ====================== */

  let paletteIndex = 0;
  let paletteEntries = [];

  function paletteCommands() {
    const signedIn = Auth.isSignedIn();
    return [
      { id:'new-task', icon:'🆕', title:'Новая задача', hint:'задача', run: () => openEditor(null, 'task') },
      { id:'new-note', icon:'📝', title:'Новая заметка', hint:'заметка', run: () => openEditor(null, 'note') },
      { id:'mode', icon:'🔁', title:'Переключить режим', hint: state.mode === 'tasks' ? 'сейчас задачи' : 'сейчас заметки', run: () => toggleMode() },
      { id:'theme', icon:'🎨', title:'Сменить тему', hint: THEME_LABELS[state.theme] || state.theme, run: () => cycleTheme() },
      { id:'metrics', icon:'📊', title:'Аналитика', hint:'статистика', run: () => openMetrics() },
      { id:'drafts', icon:'🗂', title:'Черновики', hint:'несохранённые', run: () => openDrafts() },
      { id:'trash', icon:'🗑', title:'Корзина', hint:'удалённые', run: () => openTrash() },
      { id:'settings', icon:'⚙️', title:'Настройки', hint:'ИИ и email', run: () => openSettingsModal() },
      { id:'account', icon:'👤', title: signedIn ? 'Аккаунт' : 'Войти', hint: signedIn ? (Auth.user?.email || 'аккаунт') : 'Google', run: () => openAccountModal() },
    ];
  }

  function paletteSearch(q) {
    if (!q) return [];
    const needle = q.toLowerCase();
    return state.items
        .filter((x) => !hidden(x))
        .filter((x) => ((x.title||'') + ' ' + (x.body||'') + ' ' + (x.tags||[]).join(' ')).toLowerCase().includes(needle))
        .slice(0, 8)
        .map((x) => ({
          id: 'item-' + x.id,
          icon: x.type === 'task' ? '✓' : '¶',
          title: x.title || '(без названия)',
          hint: x.type === 'task' ? 'задача' : 'заметка',
          run: () => openEditor(x, x.type),
        }));
  }

  function highlightMatch(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    try {
      const qs = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return safe.replace(new RegExp('(' + qs + ')', 'ig'), '<mark>$1</mark>');
    } catch { return safe; }
  }

  function paletteHtml(q) {
    const ql = q.toLowerCase();
    const cmds = paletteCommands().filter((c) => !q || c.title.toLowerCase().includes(ql));
    const items = paletteSearch(q);
    const parts = [];
    if (cmds.length) {
      parts.push('<div class="palette-section">Команды</div>');
      cmds.forEach((c) => parts.push(
        `<button class="palette-item" data-pid="${c.id}"><span class="pi-ico" style="width:18px;text-align:center;flex-shrink:0">${c.icon}</span><span class="pi-title">${highlightMatch(c.title, q)}</span><span class="pi-hint">${escapeHtml(c.hint)}</span></button>`));
    }
    if (items.length) {
      parts.push('<div class="palette-section">Записи</div>');
      items.forEach((c) => parts.push(
        `<button class="palette-item" data-pid="${c.id}"><span class="pi-ico" style="width:18px;text-align:center;flex-shrink:0">${c.icon}</span><span class="pi-title">${highlightMatch(c.title, q)}</span><span class="pi-hint">${escapeHtml(c.hint)}</span></button>`));
    }
    if (!parts.length) parts.push('<div class="palette-empty">Ничего не найдено</div>');
    return parts.join('');
  }

  function renderPalette(q) {
    const list = document.getElementById('paletteList');
    paletteEntries = paletteCommands()
        .filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()))
        .concat(paletteSearch(q));
    list.innerHTML = paletteHtml(q);
    list.querySelectorAll('.palette-item').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const entry = paletteEntries[i];
        closePalette();
        if (entry) entry.run();
      });
      btn.addEventListener('mousemove', () => { paletteIndex = i; updatePaletteActive(); });
    });
    paletteIndex = Math.min(paletteIndex, Math.max(0, paletteEntries.length - 1));
    updatePaletteActive();
  }

  function updatePaletteActive() {
    document.querySelectorAll('#paletteList .palette-item').forEach((btn, i) => btn.classList.toggle('active', i === paletteIndex));
    const active = document.querySelector('#paletteList .palette-item.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    const o = document.getElementById('paletteOverlay');
    if (!o) return;
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
    const input = document.getElementById('paletteInput');
    input.value = '';
    paletteIndex = 0;
    renderPalette('');
    input.focus();
  }

  function closePalette() {
    const o = document.getElementById('paletteOverlay');
    if (!o) return;
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
  }

  function bindPalette() {
    const input = document.getElementById('paletteInput');
    const overlay = document.getElementById('paletteOverlay');
    input.addEventListener('input', () => { paletteIndex = 0; renderPalette(input.value.trim()); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (paletteEntries.length) { paletteIndex = (paletteIndex + 1) % paletteEntries.length; updatePaletteActive(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (paletteEntries.length) { paletteIndex = (paletteIndex - 1 + paletteEntries.length) % paletteEntries.length; updatePaletteActive(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = paletteEntries[paletteIndex];
        closePalette();
        if (entry) entry.run();
      }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePalette(); });
  }

  /* ====================== ПОИСК ПО ЗАДАЧАМ И ЗАМЕТКАМ ====================== */

  function searchSnippet(text, needle) {
    const idx = text.toLowerCase().indexOf(needle);
    if (idx === -1) return escapeHtml(text.slice(0, 140));
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + needle.length + 80);
    const pre = escapeHtml(text.slice(start, idx));
    const match = escapeHtml(text.slice(idx, idx + needle.length));
    const post = escapeHtml(text.slice(idx + needle.length, end));
    return (start > 0 ? '…' : '') + pre + '<mark>' + match + '</mark>' + post + (end < text.length ? '…' : '');
  }

  function searchResultHtml(it, needle) {
    const meta = [];
    if (it.category) meta.push(`<span class="mini-tag muted">${escapeHtml(it.category)}</span>`);
    (it.tags || []).slice(0, 3).forEach((t) => meta.push(`<span class="mini-tag">#${escapeHtml(t)}</span>`));
    if (it.type === 'task' && it.deadline) {
      const rem = remaining(it.deadline);
      const cls = rem && rem.kind === 'overdue' ? 'timer overdue' : rem && rem.kind === 'soon' ? 'timer soon' : 'timer';
      meta.push(`<span class="${cls}">⏱ ${escapeHtml(rem ? rem.text : '')}</span>`);
    }
    const desc = it.body
        ? `<div class="search-desc">${searchSnippet(it.body, needle)}</div>`
        : '<div class="search-desc sr-none">Без текста</div>';
    return `
      <button class="search-result" data-open="${it.id}">
        <span class="sr-type">${it.type === 'task' ? '✓' : '¶'}</span>
        <span class="sr-body">
          <span class="sr-title">${highlightMatch(it.title || '(без названия)', needle)}</span>
          ${desc}
          <span class="sr-meta">${meta.join('')}</span>
        </span>
      </button>
    `;
  }

  function renderSearch(q) {
    const body = document.getElementById('searchBody');
    const needle = q.trim().toLowerCase();
    if (!needle) {
      body.innerHTML = '<div class="search-hint">Начни вводить — ищу сразу по заголовкам, тексту и тегам.<br>Переход между результатами — <kbd>↑</kbd> <kbd>↓</kbd>, открыть — <kbd>Enter</kbd></div>';
      return;
    }
    const tasks = state.items
        .filter((x) => x.type === 'task' && !hidden(x))
        .filter((x) => ((x.title||'') + ' ' + (x.body||'') + ' ' + (x.tags||[]).join(' ')).toLowerCase().includes(needle))
        .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));
    const notes = state.items
        .filter((x) => x.type === 'note' && !hidden(x))
        .filter((x) => ((x.title||'') + ' ' + (x.body||'') + ' ' + (x.tags||[]).join(' ')).toLowerCase().includes(needle))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const parts = [];
    if (tasks.length) {
      parts.push(`<div class="search-section">Задачи · ${tasks.length}</div>`);
      tasks.forEach((it) => parts.push(searchResultHtml(it, needle)));
    }
    if (notes.length) {
      parts.push(`<div class="search-section">Заметки · ${notes.length}</div>`);
      notes.forEach((it) => parts.push(searchResultHtml(it, needle)));
    }
    if (!parts.length) parts.push('<div class="empty-state">Ничего не найдено</div>');
    body.innerHTML = parts.join('');

    body.querySelectorAll('.search-result').forEach((btn) => {
      btn.addEventListener('click', () => {
        const it = state.items.find((x) => x.id === btn.dataset.open);
        if (!it) return;
        closeSearch();
        openEditor(it, it.type);
      });
    });
  }

  function openSearch() {
    const o = document.getElementById('searchOverlay');
    o.classList.add('open');
    o.setAttribute('aria-hidden', 'false');
    const input = document.getElementById('searchInput');
    input.value = '';
    renderSearch('');
    setTimeout(() => input.focus(), 60);
  }

  function closeSearch() {
    const o = document.getElementById('searchOverlay');
    o.classList.remove('open');
    o.setAttribute('aria-hidden', 'true');
  }

  function bindSearch() {
    document.getElementById('searchBtn').addEventListener('click', openSearch);
    document.getElementById('searchClose').addEventListener('click', closeSearch);
    const input = document.getElementById('searchInput');
    input.addEventListener('input', () => renderSearch(input.value));
    input.addEventListener('keydown', (e) => {
      const items = [...document.querySelectorAll('#searchBody .search-result')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!items.length) return;
        const idx = items.findIndex((el) => el.classList.contains('active'));
        const next = (idx + 1) % items.length;
        items.forEach((el) => el.classList.remove('active'));
        items[next].classList.add('active');
        items[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        const idx = items.findIndex((el) => el.classList.contains('active'));
        const prev = idx <= 0 ? items.length - 1 : idx - 1;
        items.forEach((el) => el.classList.remove('active'));
        items[prev].classList.add('active');
        items[prev].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        const active = document.querySelector('#searchBody .search-result.active');
        if (active) { e.preventDefault(); active.click(); }
      }
    });
  }

  /* ====================== СКРОЛЛ-ЛОК ФОНА ====================== */

  function bindScrollLock() {
    const overlays = document.querySelectorAll('.modal-overlay, .palette-overlay');
    const update = () => {
      const anyOpen = !!document.querySelector('.modal-overlay.open, .palette-overlay.open');
      document.documentElement.classList.toggle('no-scroll', anyOpen);
      document.body.classList.toggle('no-scroll', anyOpen);
    };
    overlays.forEach((el) => {
      new MutationObserver(update).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    update();
  }

  /* ====================== СЕТЬ (онлайн/офлайн) ====================== */

  function bindNetwork() {
    window.addEventListener('offline', () => toast('Нет соединения — работаем офлайн', 'err', 4200));
    window.addEventListener('online', () => toast('Соединение восстановлено', 'ok'));
  }

  /* ====================== ГОРЯЧИЕ КЛАВИШИ ====================== */

  function bindHotkeys() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const palette = document.getElementById('paletteOverlay');
        if (palette && palette.classList.contains('open')) { closePalette(); return; }
        if (editor.overlay.classList.contains('open')) closeEditor();
        document.querySelectorAll('.modal-overlay.open').forEach((o) => { o.classList.remove('open'); o.setAttribute('aria-hidden','true'); });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        openEditor(null, state.mode === 'tasks' ? 'task' : 'note');
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (editor.overlay.classList.contains('open')) { e.preventDefault(); saveEditor(); }
      }
      if (e.key === '/' && !(e.ctrlKey || e.metaKey)) {
        const tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (editor.overlay.classList.contains('open')) return;
        e.preventDefault();
        openSearch();
      }
    });
  }

  /* ====================== SERVICE WORKER ====================== */

  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('/service-worker.js'); } catch {}
  }

  /* ====================== СТАРТ ====================== */

  async function init() {
    state.theme = localStorage.getItem('nf.theme') || 'noir';
    state.mode = localStorage.getItem('nf.mode') || 'tasks';
    applyTheme(state.theme);
    updateModeButton();

    await Auth.ready;

    Auth.onChange(() => {
      updateAccountChip();
      const o = document.getElementById('accountOverlay');
      if (o && o.classList.contains('open')) renderAccountBody();
      if (Auth.isSignedIn()) {
        loadItems().then(render);
        AI.loadFromCloud().then((got) => { if (got) refreshAiSettingsForm(); });
      } else { state.items = []; setSyncStatus('', ''); render(); }
    });
    updateAccountChip();

    if (Auth.isSignedIn()) {
      await loadItems();
      await AI.loadFromCloud();
    }

    bindEditor();
    bindSettings();
    bindTrash();
    bindDrafts();
    bindHotkeys();
    bindAccount();
    bindPalette();
    bindNetwork();
    bindSearch();
    bindScrollLock();

    document.getElementById('themeBtn').addEventListener('click', cycleTheme);
    document.getElementById('modeBtn').addEventListener('click', toggleMode);
    document.getElementById('fabAdd').addEventListener('click', () => openEditor(null, state.mode === 'tasks' ? 'task' : 'note'));

    render();
    registerSW();
    startDeadlineWatcher();

    // Глубокие ссылки из ярлыков PWA: /?action=new-task или /?action=new-note
    const action = new URLSearchParams(location.search).get('action');
    if (action === 'new-task') openEditor(null, 'task');
    else if (action === 'new-note') openEditor(null, 'note');
  }

  document.addEventListener('DOMContentLoaded', () => {
    playIntro();
    init();
  });
})();
