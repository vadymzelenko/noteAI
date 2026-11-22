// NodeNote — режим «Рядом»: 2–3 заметки или задачи открыты одновременно.
// На широком экране — колонки, на телефоне — вкладки. У каждой панели свой
// заголовок, панель форматирования, просмотр и автосохранение.
(function () {
  'use strict';

  const NF = window.NF;
  const { $, svgIcon, escapeHtml, plural, toast } = NF;
  const MAX = 3;
  const DELAY = 700;

  const ws = { ids: [], active: 0, panes: new Map() };   // id → { copy, timer, preview }

  function overlay() {
    let ov = $('wsOverlay');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'wsOverlay';
    ov.className = 'modal-overlay ws-overlay custom-close';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Рядом');
    ov.innerHTML = `
      <div class="ws">
        <header class="ws-head">
          <div class="ws-title-main">${svgIcon('columns', 18)}<b>Рядом</b><span id="wsCount"></span></div>
          <div class="ws-tabs" id="wsTabs" role="tablist"></div>
          <button class="btn sm" id="wsAdd">${svgIcon('plus', 15, 2.2)}<span>Добавить</span></button>
          <button class="icon-btn" id="wsClose" title="Закрыть (Esc)" aria-label="Закрыть">${svgIcon('close', 18, 2)}</button>
        </header>
        <div class="ws-panes" id="wsPanes"></div>
      </div>`;
    document.body.appendChild(ov);
    $('wsClose').addEventListener('click', close);
    $('wsAdd').addEventListener('click', addDialog);
    NF.closeHooks.wsOverlay = close;
    return ov;
  }

  const find = (id) => NF.items.find((x) => x.id === id);

  function open(ids, { pick = false } = {}) {
    ids = [...new Set(ids)].filter((id) => find(id)).slice(0, MAX);
    if (!ids.length) return;
    if (pick) setTimeout(addDialog, 250);
    const ov = overlay();
    ws.ids = ids;
    ws.active = 0;
    ws.panes.clear();
    renderAll();
    NF.openOverlay('wsOverlay');
    ov.dataset.n = ids.length;
  }

  function renderAll() {
    const ov = overlay();
    ov.dataset.n = ws.ids.length;
    $('wsCount').textContent = `${ws.ids.length} из ${MAX}`;
    $('wsAdd').hidden = ws.ids.length >= MAX;
    $('wsPanes').innerHTML = ws.ids.map((id, i) => paneHtml(id, i)).join('');
    ws.ids.forEach((id) => bindPane(id));
    renderTabs();
  }

  function renderTabs() {
    $('wsTabs').innerHTML = ws.ids.map((id, i) => {
      const it = find(id) || {};
      return `<button class="ws-tab ${i === ws.active ? 'active' : ''}" data-tab="${i}" role="tab">${escapeHtml((it.title || 'Без названия').slice(0, 24))}</button>`;
    }).join('');
    $('wsTabs').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      ws.active = +b.dataset.tab;
      renderTabs();
      document.querySelectorAll('.ws-pane').forEach((p, i) => p.classList.toggle('active', i === ws.active));
    }));
    document.querySelectorAll('.ws-pane').forEach((p, i) => p.classList.toggle('active', i === ws.active));
  }

  function paneHtml(id, i) {
    const it = find(id);
    const task = it.type === 'task';
    return `
      <section class="ws-pane ${i === ws.active ? 'active' : ''}" data-pane="${id}" style="--i:${i}">
        <div class="ws-pane-head">
          <span class="ws-kind">${svgIcon(task ? 'task' : 'note', 15)}${task ? 'Задача' : 'Заметка'}</span>
          <button class="ws-imp ${it.importance === 'red' ? 'on' : ''}" data-imp title="Важная / обычная" aria-label="Важность"><span class="dot"></span>${it.importance === 'red' ? 'Важная' : 'Обычная'}</button>
          ${task ? `<button class="ws-done ${it.done ? 'on' : ''}" data-done title="Выполнено">${svgIcon('check', 14, 2.6)}</button>` : ''}
          <span class="save-state" data-ss></span>
          <span class="ws-sp"></span>
          <button class="icon-btn sm" data-full title="Открыть полностью" aria-label="Открыть полностью">${svgIcon('expand', 15)}</button>
          <button class="icon-btn sm" data-remove title="Убрать из «Рядом»" aria-label="Убрать">${svgIcon('close', 15, 2.2)}</button>
        </div>
        <div class="ws-scroll">
          <input class="ws-title" value="${escapeHtml(it.title || '')}" placeholder="Заголовок" autocomplete="off">
          <div class="toolbar ws-toolbar">${NF.toolbarHtml({ font: false })}</div>
          <textarea class="editor-body ws-body" spellcheck="true" placeholder="Текст…">${escapeHtml(it.body || '')}</textarea>
          <div class="editor-preview md ws-preview" hidden></div>
        </div>
      </section>`;
  }

  function bindPane(id) {
    const el = document.querySelector(`.ws-pane[data-pane="${id}"]`);
    const it = find(id);
    const st = { copy: { ...it }, timer: null, preview: false };
    ws.panes.set(id, st);
    const title = el.querySelector('.ws-title');
    const ta = el.querySelector('.ws-body');
    const pv = el.querySelector('.ws-preview');
    const tb = el.querySelector('.ws-toolbar');
    const ss = el.querySelector('[data-ss]');
    ta.dataset.owner = id;

    const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 200) + 'px'; };
    const setSS = (s) => {
      const t = { pending: 'Изменено', saving: 'Сохранение…', saved: 'Сохранено', error: 'Нет связи' }[s] || '';
      ss.dataset.state = s; ss.innerHTML = t ? `<span class="ss-dot"></span><span>${t}</span>` : '';
    };
    const save = () => {
      clearTimeout(st.timer);
      st.dirty = false;
      setSS('saving');
      NF.saveItem({ ...st.copy }).then((ok) => setSS(ok ? 'saved' : 'error'));
    };
    const changed = () => {
      st.copy.title = title.value.trim();
      st.copy.body = ta.value;
      st.dirty = true;
      setSS('pending');
      clearTimeout(st.timer);
      st.timer = setTimeout(save, DELAY);
    };
    st.flush = () => { if (st.dirty) save(); };

    const setPreview = (on) => {
      st.preview = !!on;
      ta.hidden = st.preview;
      pv.hidden = !st.preview;
      if (st.preview) pv.innerHTML = NF.renderBody(ta.value) || '<p class="muted">Пока пусто</p>';
      tb.classList.toggle('previewing', st.preview);
      const pb = tb.querySelector('[data-tool="preview"]');
      if (pb) pb.classList.toggle('active', st.preview);
      if (!st.preview) requestAnimationFrame(grow);
    };

    title.addEventListener('input', () => { changed(); renderTabs(); });
    ta.addEventListener('input', () => { changed(); grow(); });
    ta.addEventListener('keydown', NF.onBodyKeydown);
    NF.bindImageDrop(ta);
    tb.addEventListener('mousedown', (e) => { if (e.target.closest('.tool')) e.preventDefault(); });
    tb.addEventListener('click', (e) => {
      const b = e.target.closest('.tool');
      if (!b) return;
      if (b.dataset.tool === 'preview') { setPreview(!st.preview); return; }
      if (st.preview) setPreview(false);
      NF.applyFormat(ta, b.dataset.tool);
    });
    pv.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-cb]');
      if (li) { ta.value = NF.toggleChecklist(ta.value, +li.dataset.cb); changed(); setPreview(true); return; }
      if (e.target.closest('a, img, summary, iframe, details, table')) return;
      setPreview(false); ta.focus();
    });
    el.querySelector('[data-imp]').addEventListener('click', (e) => {
      st.copy.importance = st.copy.importance === 'red' ? 'green' : 'red';
      const b = e.currentTarget;
      b.classList.toggle('on', st.copy.importance === 'red');
      b.lastChild.textContent = st.copy.importance === 'red' ? 'Важная' : 'Обычная';
      st.dirty = true; save();
    });
    const done = el.querySelector('[data-done]');
    if (done) done.addEventListener('click', () => {
      st.copy.done = !st.copy.done;
      done.classList.toggle('on', st.copy.done);
      st.dirty = true; save();
    });
    el.querySelector('[data-full]').addEventListener('click', () => {
      flushAll();
      NF.closeOverlay('wsOverlay');
      const cur = find(id);
      if (cur) NF.openEditor(cur);
    });
    el.querySelector('[data-remove]').addEventListener('click', () => {
      st.flush();
      ws.ids = ws.ids.filter((x) => x !== id);
      ws.panes.delete(id);
      if (!ws.ids.length) { close(); return; }
      ws.active = Math.min(ws.active, ws.ids.length - 1);
      renderAll();
    });
    setPreview(NF.isRich(ta.value));
    requestAnimationFrame(grow);
  }

  function flushAll() { ws.panes.forEach((st) => st.flush && st.flush()); }

  function close() {
    flushAll();
    NF.closeOverlay('wsOverlay');
    ws.ids = [];
    ws.panes.clear();
    NF.render();
  }

  async function addDialog() {
    if (ws.ids.length >= MAX) return;
    const pool = NF.items.filter((x) => !x.deleted && !ws.ids.includes(x.id))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 14);
    if (!pool.length) { toast('Больше нечего добавить', 'info'); return; }
    const choice = await NF.askChoice({
      title: 'Добавить рядом',
      choices: pool.map((x) => ({ id: x.id, label: (x.type === 'task' ? '☐ ' : '✎ ') + (x.title || NF.plainPreview(x.body, 40) || 'Без названия'), hint: NF.fmtHuman(x.updatedAt) })),
    });
    if (!choice) return;
    flushAll();
    ws.ids.push(choice);
    ws.active = ws.ids.length - 1;
    renderAll();
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });

  window.Workspace = {
    open,
    close,
    get isOpen() { return !!($('wsOverlay') && $('wsOverlay').classList.contains('open')); },
  };
})();
