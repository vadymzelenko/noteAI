// NodeFlow — печатный отчёт по проекту (печать / сохранение в PDF).
// Обложка с метаданными, содержание, статистика, структура (дерево + связи),
// блоки, журнал, содержимое файлов (картинки, PDF постранично, Word, Excel,
// CSV, код, текст), перечень файлов, сведения о документе.
// Режимы: цветной и чёрно-белый (под ч/б принтер, повышенная чёткость).
// Состав отчёта (разделы, отдельные блоки/записи/файлы, страницы PDF)
// сохраняется в проекте.
(function () {
  'use strict';

  const NF = window.NF;
  const { $, svgIcon, escapeHtml, plural, fmtTime, renderBody, toast, pad2 } = NF;
  const BRAND = 'VZstudio';
  const APP = 'NodeFlow';
  const FORMAT_VERSION = '2';

  const SECTIONS = [
    ['stats', 'Сводка и статистика'],
    ['tree', 'Структура проекта'],
    ['blocks', 'Блоки'],
    ['entries', 'Журнал записей'],
    ['contents', 'Содержимое файлов'],
    ['appendix', 'Перечень файлов'],
  ];
  const MONO_DASH = ['', '7 4', '2 3', '10 3 2 3', '4 4', '1 2', '12 4', '6 2 2 2'];
  const MONO_GRAY = ['#000000', '#3f3f3f', '#6b6b6b', '#8f8f8f', '#b0b0b0', '#cfcfcf'];
  const MAX_PDF_PAGES = 30;
  const MAX_ROWS = 300;
  const MAX_LINES = 400;

  let I = null;          // внутренние функции projects.js
  let pid = null;
  const prepCache = new Map();
  let buildSeq = 0;

  const proj = () => I.proj(pid);

  function cfg() {
    const p = proj();
    const r = (p.report = p.report && typeof p.report === 'object' ? p.report : {});
    r.sec = { stats: true, tree: true, blocks: true, entries: true, contents: true, appendix: true, ...(r.sec || {}) };
    r.exclude = Array.isArray(r.exclude) ? r.exclude : [];
    r.pages = r.pages && typeof r.pages === 'object' ? r.pages : {};
    r.mono = !!r.mono;
    return r;
  }
  const included = (id) => !cfg().exclude.includes(id);

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => I.save('project', proj(), { touch: false }), 500);
  }

  /* ====================== ОТКРЫТИЕ ====================== */

  function open(id) {
    I = window.Projects._;
    pid = id;
    renderBar();
    $('reportPanel').hidden = true;
    NF.openOverlay('reportOverlay');
    $('reportScroll').scrollTop = 0;
    build();
  }

  function close() {
    NF.closeOverlay('reportOverlay');
    pid = null;
  }

  function renderBar() {
    const c = cfg();
    $('reportMode').querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', (b.dataset.mode === 'mono') === c.mono));
    requestAnimationFrame(() => NF.moveIndicator($('reportMode')));
  }

  /* ====================== ПАНЕЛЬ «СОСТАВ» ====================== */

  function renderPanel() {
    const c = cfg();
    const p = proj();
    const ob = I.orderedBlocks(pid);
    const es = I.entriesOf(pid).sort((a, b) => a.createdAt - b.createdAt);
    const fs = I.filesOf(pid).sort((a, b) => a.createdAt - b.createdAt);
    const cb = (id, on) => `<input type="checkbox" data-inc="${id}" ${on ? 'checked' : ''}>`;
    $('reportPanelBody').innerHTML = `
      <section class="rpp-sec">
        <h4>Разделы</h4>
        ${SECTIONS.map(([k, v]) => `<label class="rpp-row"><input type="checkbox" data-sec="${k}" ${c.sec[k] ? 'checked' : ''}><span>${v}</span></label>`).join('')}
      </section>
      ${ob.length ? `<section class="rpp-sec">
        <h4>Блоки <button class="rpp-all" data-all="blocks">все</button></h4>
        ${ob.map(({ b, num, depth }) => `<label class="rpp-row" style="padding-left:${8 + depth * 14}px">${cb(b.id, included(b.id))}<span class="rpp-num">${num}</span><span class="rpp-t">${escapeHtml(b.title || 'Без названия')}</span></label>`).join('')}
      </section>` : ''}
      ${es.length ? `<section class="rpp-sec">
        <h4>Записи <button class="rpp-all" data-all="entries">все</button></h4>
        ${es.map((e) => `<label class="rpp-row">${cb(e.id, included(e.id))}<span class="rpp-t"><b>${escapeHtml(fmtTime(e.createdAt))}</b> ${escapeHtml(NF.plainPreview(e.title || e.text, 60))}</span></label>`).join('')}
      </section>` : ''}
      ${fs.length ? `<section class="rpp-sec">
        <h4>Файлы <button class="rpp-all" data-all="files">все</button></h4>
        ${fs.map((f) => {
          const kind = I.fileKind(f);
          return `<div class="rpp-file">
            <label class="rpp-row">${cb(f.id, included(f.id))}<span class="file-tag sm" style="--fc:${I.KIND_COLOR[kind]}">${I.tagOf(f)}</span><span class="rpp-t">${escapeHtml(f.name)}<small>${escapeHtml(fmtTime(f.createdAt))} · ${escapeHtml(I.ownerLabel(f))}</small></span></label>
            <div class="rpp-file-tools">
              ${kind === 'pdf' ? `<label class="rpp-pages">Страницы <input class="input" data-pages="${f.id}" value="${escapeHtml(c.pages[f.id] || '')}" placeholder="все, 1-3, 5"></label>
                <button class="btn sm" data-draw-pdf="${f.id}">${svgIcon('edit', 13)}Рисовать</button>` : ''}
              ${kind === 'image' ? `<button class="btn sm" data-draw="${f.id}">${svgIcon('edit', 13)}Рисовать</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </section>` : ''}
      <p class="hint rpp-hint">Выбор сохраняется в проекте. Пометки на картинках и страницах PDF сохраняются отдельными файлами — оригиналы не меняются.</p>`;

    const body = $('reportPanelBody');
    body.querySelectorAll('[data-sec]').forEach((x) => x.addEventListener('change', () => { cfg().sec[x.dataset.sec] = x.checked; persist(); buildSoon(); }));
    body.querySelectorAll('[data-inc]').forEach((x) => x.addEventListener('change', () => {
      const r = cfg();
      const set = new Set(r.exclude);
      if (x.checked) set.delete(x.dataset.inc); else set.add(x.dataset.inc);
      r.exclude = [...set];
      persist(); buildSoon();
    }));
    body.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      const ids = b.dataset.all === 'blocks' ? I.blocksOf(pid).map((x) => x.id) : b.dataset.all === 'entries' ? I.entriesOf(pid).map((x) => x.id) : I.filesOf(pid).map((x) => x.id);
      const r = cfg();
      const allOn = ids.every((id) => !r.exclude.includes(id));
      const set = new Set(r.exclude);
      ids.forEach((id) => (allOn ? set.add(id) : set.delete(id)));
      r.exclude = [...set];
      persist(); renderPanel(); buildSoon();
    }));
    body.querySelectorAll('[data-pages]').forEach((inp) => inp.addEventListener('input', () => {
      const r = cfg();
      if (inp.value.trim()) r.pages[inp.dataset.pages] = inp.value.trim(); else delete r.pages[inp.dataset.pages];
      persist(); buildSoon(800);
    }));
    body.querySelectorAll('[data-draw]').forEach((b) => b.addEventListener('click', async () => {
      const f = I.fileById(b.dataset.draw);
      if (!f) return;
      const nf = await I.annotateFile(f, await I.getData(f), { open: false });
      if (nf) { renderPanel(); build(); }
    }));
    body.querySelectorAll('[data-draw-pdf]').forEach((b) => b.addEventListener('click', async () => {
      const f = I.fileById(b.dataset.drawPdf);
      if (!f) return;
      const nf = await I.annotatePdfPage(f, { open: false });
      if (nf) { renderPanel(); build(); }
    }));
  }

  /* ====================== ПОДГОТОВКА ФАЙЛОВ ====================== */

  const clipLines = (t) => {
    const lines = String(t).split('\n');
    return lines.length > MAX_LINES ? { text: lines.slice(0, MAX_LINES).join('\n'), cut: lines.length - MAX_LINES } : { text: t, cut: 0 };
  };

  async function prepare(f) {
    const c = cfg();
    const key = `${f.id}|${c.pages[f.id] || ''}`;
    if (prepCache.has(key)) return prepCache.get(key);
    const kind = I.fileKind(f);
    const e = I.extOf(f.name);
    let html = '';
    try {
      if (kind === 'image') {
        html = `<div class="rp-figure"><img src="${escapeHtml(await I.getData(f))}" alt=""></div>`;
      } else if (kind === 'pdf') {
        const n = await I.pdfPageCount(f);
        let pages = I.parsePages(c.pages[f.id] || '', n);
        const extra = pages.length > MAX_PDF_PAGES ? pages.length - MAX_PDF_PAGES : 0;
        pages = pages.slice(0, MAX_PDF_PAGES);
        const imgs = [];
        for (const pg of pages) imgs.push(`<figure class="rp-page"><img src="${escapeHtml(await I.pdfPageImage(f, pg, { scale: 1.6 }))}" alt=""><figcaption>${escapeHtml(f.name)} — стр. ${pg} из ${n}</figcaption></figure>`);
        html = imgs.join('') + (extra ? `<p class="rp-note">Ещё ${extra} стр. не показаны — выбери страницы в «Составе».</p>` : '');
      } else if (kind === 'md') {
        html = `<div class="md">${renderBody(I.dataUrlText(await I.getData(f)))}</div>`;
      } else if (kind === 'text') {
        const { text, cut } = clipLines(I.dataUrlText(await I.getData(f)));
        html = `<pre class="rp-pre">${escapeHtml(text)}</pre>${cut ? `<p class="rp-note">… ещё ${cut} строк</p>` : ''}`;
      } else if (kind === 'code' || kind === 'html') {
        let src = I.dataUrlText(await I.getData(f));
        if (e === 'json') src = I.prettyJson(src);
        const { text, cut } = clipLines(src);
        html = `<div class="md">${NF.highlightCode(text, kind === 'html' ? 'html' : I.CODE_LANG[e])}</div>${cut ? `<p class="rp-note">… ещё ${cut} строк</p>` : ''}`;
      } else if (e === 'csv' || e === 'tsv') {
        html = `<div class="md">${I.csvTable(I.dataUrlText(await I.getData(f)), e === 'tsv' ? '\t' : null)}</div>`;
      } else if (kind === 'sheet') {
        await I.loadScript('/vendor/xlsx-0.18.5.full.min.js');
        const wb = XLSX.read(I.dataUrlBytes(await I.getData(f)), { type: 'array' });
        html = wb.SheetNames.slice(0, 5).map((n) => {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, blankrows: false }).slice(0, MAX_ROWS);
          return `<div class="rp-sheet-name">Лист «${escapeHtml(n)}»</div><div class="md">${I.rowsTable(rows)}</div>`;
        }).join('');
      } else if (e === 'docx') {
        await I.loadScript('/vendor/mammoth-1.8.0.browser.min.js');
        const res = await mammoth.convertToHtml({ arrayBuffer: I.dataUrlBytes(await I.getData(f)).buffer });
        html = `<div class="md rp-docx">${I.sanitizeHtml(res.value)}</div>`;
      } else {
        html = `<p class="rp-note">Этот тип файла нельзя показать на бумаге — он указан в перечне файлов.</p>`;
      }
    } catch (err) {
      console.error('[report] file', f.name, err);
      html = `<p class="rp-note">Не удалось показать содержимое: ${escapeHtml(err.message || 'ошибка')}</p>`;
    }
    prepCache.set(key, html);
    return html;
  }

  /* ====================== СБОРКА ====================== */

  let buildTimer = null;
  function buildSoon(ms = 250) { clearTimeout(buildTimer); buildTimer = setTimeout(build, ms); }

  async function build() {
    if (!pid) return;
    const seq = ++buildSeq;
    const c = cfg();
    const paper = $('reportPaper');
    paper.classList.toggle('mono', c.mono);
    const prepared = new Map();
    if (c.sec.contents) {
      const files = I.filesOf(pid).filter((f) => included(f.id) && ownerIncluded(f));
      const todo = files.filter((f) => !prepCache.has(`${f.id}|${c.pages[f.id] || ''}`));
      if (todo.length) paper.innerHTML = `<div class="viewer-loading"><span class="file-spin"></span><span id="rpProgress">Готовлю материалы отчёта…</span></div>`;
      let done = 0;
      for (const f of files) {
        prepared.set(f.id, await prepare(f));
        if (seq !== buildSeq) return;
        done++;
        const el = $('rpProgress');
        if (el && todo.length) el.textContent = `Готовлю материалы отчёта… ${done} / ${files.length}`;
      }
    }
    if (seq !== buildSeq) return;
    paper.innerHTML = html(prepared);
  }

  // Файл попадает в отчёт, только если включён его «владелец» (блок / запись).
  function ownerIncluded(f) {
    if (f.owner === f.p) return true;
    if (I.block(f.owner)) return cfg().sec.blocks && included(f.owner);
    if (I.entry(f.owner)) return cfg().sec.entries && included(f.owner);
    return true;
  }

  const authorName = () => {
    const u = window.Auth && Auth.user;
    if (!u) return '—';
    return u.user_metadata?.full_name || u.user_metadata?.name || u.email || '—';
  };

  function fmtDT(ts) { return ts ? fmtTime(ts) : '—'; }

  function fileCard(f, prepared, c) {
    const kind = I.fileKind(f);
    const meta = `${I.KIND_LABEL[kind]} · ${I.fmtSize(f.size)} · добавлен ${fmtDT(f.createdAt)}`;
    const body = c.sec.contents && prepared.has(f.id) ? prepared.get(f.id) : '';
    return `<div class="rp-file-card ${body ? 'has-body' : ''}">
      <div class="rp-file-head"><span class="rp-file-tag" style="--fc:${c.mono ? '#000' : I.KIND_COLOR[kind]}">${I.tagOf(f)}</span><b>${escapeHtml(f.name)}</b><span>${escapeHtml(meta)}</span></div>
      ${body ? `<div class="rp-file-body">${body}</div>` : ''}
    </div>`;
  }

  function filesBlock(owner, prepared, c) {
    const files = I.filesOwned(owner).filter((f) => included(f.id)).sort((a, b) => a.createdAt - b.createdAt);
    if (!files.length) return '';
    return `<div class="rp-files"><div class="rp-files-title">Файлы (${files.length})</div>${files.map((f) => fileCard(f, prepared, c)).join('')}</div>`;
  }

  function treeSvg(c) {
    const L = I.layout(pid, { ignoreCollapsed: true });
    const { W, H } = I.TREE;
    const P = 10;
    const colorIdx = new Map();
    const dashOf = (col) => {
      if (!colorIdx.has(col)) colorIdx.set(col, colorIdx.size);
      return MONO_DASH[colorIdx.get(col) % MONO_DASH.length];
    };
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
    const edges = L.edges.map((e) => c.mono
      ? `<path d="${I.edgePath(e)}" fill="none" stroke="#000" stroke-width="2" ${dashOf(e.color) ? `stroke-dasharray="${dashOf(e.color)}"` : ''}/>`
      : `<path d="${I.edgePath(e)}" fill="none" stroke="${e.color}" stroke-width="2" opacity=".75"/>`).join('');
    const nodes = L.nodes.map((n) => {
      const lines = wrapText(n.isRoot ? n.title : n.block.title || 'Без названия', 24);
      const ty = n.y + H / 2 - (lines.length - 1) * 9 + 5;
      const fill = n.isRoot ? (c.mono ? '#000' : n.color) : '#ffffff';
      const stroke = c.mono ? '#000' : n.color;
      const dash = c.mono && !n.isRoot ? dashOf(n.color) : '';
      return `<g>
        <rect x="${n.x}" y="${n.y + 6}" width="${W}" height="${H - 12}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="${n.isRoot ? 0 : c.mono ? 1.8 : 2}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>
        ${n.isRoot ? '' : `<rect x="${n.x}" y="${n.y + 6}" width="6" height="${H - 12}" rx="3" fill="${stroke}"/>`}
        ${lines.map((l, i) => `<text x="${n.x + W / 2}" y="${ty + i * 18}" text-anchor="middle" font-size="14" font-weight="${n.isRoot ? 700 : 600}" fill="${n.isRoot ? '#ffffff' : '#000000'}">${escapeHtml(l)}</text>`).join('')}
      </g>`;
    }).join('');
    const arrowFill = c.mono ? '#000' : '#52525b';
    const defs = `<defs><marker id="rpArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="${arrowFill}"/></marker></defs>`;
    let links = I.linksSvg(pid, L, { report: true });
    if (c.mono) links = links.replace(/stroke="#71717a"/g, 'stroke="#000"').replace(/fill="#52525b"/g, 'fill="#000"');
    return `<svg class="rp-tree" viewBox="${-P} ${-P} ${L.width + P * 2 + 120} ${L.height + P * 2}" xmlns="http://www.w3.org/2000/svg" font-family="Geist, Inter, Arial, sans-serif">${defs}${edges}${nodes}${links}</svg>`;
  }

  function activityChart(c) {
    const p = proj();
    const ser = I.series(pid, 30);
    const max = Math.max(...ser.map((s) => s.v), 1);
    const W = 640, H = 130, bw = W / ser.length;
    const grid = [0.25, 0.5, 0.75, 1].map((t) => `<line x1="0" x2="${W}" y1="${(H - 18 - t * (H - 28)).toFixed(1)}" y2="${(H - 18 - t * (H - 28)).toFixed(1)}" stroke="#e4e4e7" stroke-width="1"/>`).join('');
    const bars = ser.map((s, i) => {
      const h = s.v / max * (H - 28);
      const d = new Date(s.ts);
      return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 1.5).toFixed(1)}" rx="2" fill="${s.v ? (c.mono ? '#111' : p.color) : '#d4d4d8'}"/>` +
        (s.v ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${(H - 21 - h).toFixed(1)}" font-size="8.5" text-anchor="middle" fill="#3f3f46">${s.v}</text>` : '') +
        (i % 5 === 0 || i === ser.length - 1 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" font-size="9" text-anchor="middle" fill="#52525b">${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}</text>` : '');
    }).join('');
    return `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" font-family="Geist, Inter, Arial, sans-serif">${grid}${bars}</svg>`;
  }

  function html(prepared) {
    const c = cfg();
    const p = proj();
    const st = I.stats(pid);
    const now = Date.now();
    const sec = c.sec;
    const ob = I.orderedBlocks(pid);
    const obIn = ob.filter(({ b }) => included(b.id));
    const es = I.entriesOf(pid).filter((e) => included(e.id)).sort((a, b) => a.createdAt - b.createdAt);
    const projFiles = I.filesOwned(pid).filter((f) => included(f.id));
    const allFiles = I.filesOf(pid).filter((f) => included(f.id) && ownerIncluded(f)).sort((a, b) => a.createdAt - b.createdAt);
    const firstTs = Math.min(p.createdAt, ...I.blocksOf(pid).map((b) => b.createdAt), ...I.entriesOf(pid).map((e) => e.createdAt), ...I.filesOf(pid).map((f) => f.createdAt));
    const accent = c.mono ? '#000' : p.color;

    // Нумерация разделов.
    const toc = [];
    const head = (key, title) => { toc.push({ key, title }); return `<h2 id="rp-${key}"><span class="rp-sec-num">${toc.length}.</span>${escapeHtml(title)}</h2>`; };
    const parts = [];

    if (sec.stats) {
      const kinds = Object.entries(st.byKind).sort((a, b) => b[1] - a[1]);
      const totalF = kinds.reduce((s, k) => s + k[1], 0) || 1;
      const kc = (k, i) => (c.mono ? MONO_GRAY[i % MONO_GRAY.length] : I.KIND_COLOR[k]);
      parts.push(`<section class="rp-section">
        ${head('stats', 'Сводка и статистика')}
        <div class="rp-kpis">
          ${[
            [st.blocks, plural(st.blocks, 'блок', 'блока', 'блоков')],
            [I.linksOf(pid).length, plural(I.linksOf(pid).length, 'связь', 'связи', 'связей')],
            [st.entries, plural(st.entries, 'запись', 'записи', 'записей')],
            [st.files, `${plural(st.files, 'файл', 'файла', 'файлов')} · ${I.fmtSize(st.size)}`],
            [st.words, plural(st.words, 'слово', 'слова', 'слов')],
            [st.days, plural(st.days, 'день работы', 'дня работы', 'дней работы')],
            [I.fmtDuration(st.minutes), 'примерно в работе'],
            [st.span, plural(st.span, 'день с начала', 'дня с начала', 'дней с начала')],
          ].map(([v, k]) => `<div class="rp-kpi"><b>${v}</b><span>${k}</span></div>`).join('')}
        </div>
        <table class="rp-kv">
          <tr><th>Первая запись в проекте</th><td>${fmtDT(firstTs)}</td></tr>
          <tr><th>Последняя активность</th><td>${fmtDT(st.last)}</td></tr>
          <tr><th>Глубина дерева</th><td>${st.depth} ${plural(st.depth, 'уровень', 'уровня', 'уровней')}</td></tr>
        </table>
        <h3>Активность за 30 дней <small>(правки и новые материалы по дням)</small></h3>
        ${activityChart(c)}
        ${kinds.length ? `
          <h3>Файлы по типам</h3>
          <div class="rp-stack">${kinds.map(([k, n], i) => `<span style="flex:${n};background:${kc(k, i)}"></span>`).join('')}</div>
          <div class="rp-legend">${kinds.map(([k, n], i) => `<span><i style="background:${kc(k, i)}"></i>${I.KIND_LABEL[k]} — ${n} (${Math.round(n / totalF * 100)}%)</span>`).join('')}</div>` : ''}
      </section>`);
    }

    if (sec.tree && ob.length) {
      const links = I.linksOf(pid);
      parts.push(`<section class="rp-section rp-tree-sec">
        ${head('tree', 'Структура проекта')}
        ${treeSvg(c)}
        <h3>Оглавление блоков</h3>
        <ol class="rp-outline">${ob.map(({ b, num, depth }) => `<li style="--d:${depth}" class="${included(b.id) ? '' : 'off'}"><span>${num}</span>${escapeHtml(b.title || 'Без названия')}</li>`).join('')}</ol>
        ${links.length ? `<h3>Связи между блоками</h3><table class="rp-table"><thead><tr><th>Откуда</th><th></th><th>Куда</th><th>Подпись</th></tr></thead><tbody>${links.map((l) => `<tr><td>${escapeHtml(I.nodeTitle(pid, l.from))}</td><td>→</td><td>${escapeHtml(I.nodeTitle(pid, l.to))}</td><td>${escapeHtml(l.label || '')}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>`);
    }

    if (sec.blocks && obIn.length) {
      parts.push(`<section class="rp-section rp-break">
        ${head('blocks', 'Блоки')}
        ${obIn.map(({ b, num, depth }) => `<article class="rp-block" style="--d:${Math.min(depth, 4)}">
          <h3><span class="rp-num" style="color:${accent}">${num}</span>${escapeHtml(b.title || 'Без названия')}</h3>
          <div class="rp-dates">Создан ${fmtDT(b.createdAt)}${b.updatedAt && Math.abs(b.updatedAt - b.createdAt) > 60000 ? ` · изменён ${fmtDT(b.updatedAt)}` : ''}</div>
          ${b.content.trim() ? `<div class="md">${renderBody(b.content)}</div>` : '<p class="rp-muted">Без описания</p>'}
          ${filesBlock(b.id, prepared, c)}
        </article>`).join('')}
      </section>`);
    }

    if (sec.entries && es.length) {
      parts.push(`<section class="rp-section rp-break">
        ${head('entries', 'Журнал записей')}
        ${es.map((e) => {
          const b = e.block && I.block(e.block);
          return `<article class="rp-entry">
            <div class="rp-entry-date">${fmtDT(e.createdAt)}${b ? ` · блок «${escapeHtml(b.title)}»` : ''}</div>
            ${e.title ? `<h4>${escapeHtml(e.title)}</h4>` : ''}
            ${e.text ? `<div class="md">${renderBody(e.text)}</div>` : ''}
            ${filesBlock(e.id, prepared, c)}
          </article>`;
        }).join('')}
      </section>`);
    }

    if (projFiles.length && (sec.contents || sec.appendix)) {
      parts.push(`<section class="rp-section rp-break">
        ${head('materials', 'Материалы проекта')}
        ${projFiles.sort((a, b) => a.createdAt - b.createdAt).map((f) => fileCard(f, prepared, c)).join('')}
      </section>`);
    }

    if (sec.appendix && allFiles.length) {
      parts.push(`<section class="rp-section rp-break">
        ${head('appendix', 'Перечень файлов')}
        <table class="rp-table"><thead><tr><th>№</th><th>Файл</th><th>Тип</th><th>Размер</th><th>Где</th><th>Добавлен</th></tr></thead>
        <tbody>${allFiles.map((f, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(f.name)}</td><td>${I.KIND_LABEL[I.fileKind(f)]}</td><td>${I.fmtSize(f.size)}</td><td>${escapeHtml(I.ownerLabel(f))}</td><td>${fmtDT(f.createdAt)}</td></tr>`).join('')}</tbody></table>
      </section>`);
    }

    const metaRows = [
      ['Проект', escapeHtml(p.title)],
      ['Статус', I.STATUS[p.status]],
      ['Автор', escapeHtml(authorName())],
      ['Проект создан', fmtDT(p.createdAt)],
      ['Последняя активность', fmtDT(st.last)],
      ['Отчёт сформирован', fmtDT(now)],
      ['Режим печати', c.mono ? 'чёрно-белый' : 'цветной'],
      ['Состав', `${obIn.length} из ${ob.length} блоков · ${es.length} ${plural(es.length, 'запись', 'записи', 'записей')} · ${allFiles.length} ${plural(allFiles.length, 'файл', 'файла', 'файлов')}`],
      ['ID проекта', `<code>${escapeHtml(p.id)}</code>`],
      ['Сформировано в', `${APP} · ${BRAND} · формат отчёта v${FORMAT_VERSION}`],
    ];

    const cover = `<section class="rp-cover-page" style="--c:${accent}">
      <div class="rp-brand"><span class="rp-logo">VZ</span><span>${BRAND}</span><span class="rp-brand-app">${APP}</span></div>
      <div class="rp-cover-main">
        <div class="rp-kicker">Отчёт по проекту</div>
        <h1>${escapeHtml(p.title)}</h1>
        <div class="rp-status">${I.STATUS[p.status]}</div>
        ${p.desc ? `<div class="md rp-desc">${renderBody(p.desc)}</div>` : ''}
      </div>
      <table class="rp-kv rp-cover-kv">${metaRows.slice(0, 8).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      ${toc.length ? `<div class="rp-toc"><div class="rp-toc-title">Содержание</div><ol>${toc.map((t) => `<li>${escapeHtml(t.title)}</li>`).join('')}<li>Сведения о документе</li></ol></div>` : ''}
    </section>`;

    const meta = `<section class="rp-section rp-meta-sec">
      <h2><span class="rp-sec-num">${toc.length + 1}.</span>Сведения о документе</h2>
      <table class="rp-kv">${metaRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      <div class="rp-sign"><span class="rp-logo">VZ</span><div><b>${BRAND}</b><span>Отчёт сформирован ${fmtDT(now)} в ${APP}</span></div></div>
    </section>`;

    return `<div class="rp-doc">${cover}${parts.join('')}${meta}</div>`;
  }

  /* ====================== ПЕЧАТЬ ====================== */

  function print() {
    const p = proj();
    const c = cfg();
    const cssStr = (t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
    const left = `${BRAND} · ${p.title} · ${fmtTime(Date.now())}`;
    let style = $('rpPageStyle');
    if (!style) { style = document.createElement('style'); style.id = 'rpPageStyle'; document.head.appendChild(style); }
    style.textContent = `
      @page {
        size: A4; margin: 15mm 14mm 17mm;
        @bottom-left { content: ${cssStr(left)}; font: 8pt Arial, sans-serif; color: ${c.mono ? '#000' : '#71717a'}; }
        @bottom-right { content: "стр. " counter(page) " из " counter(pages); font: 8pt Arial, sans-serif; color: ${c.mono ? '#000' : '#71717a'}; }
      }
      @page :first { @bottom-left { content: none; } @bottom-right { content: none; } }`;
    const prevTitle = document.title;
    document.title = `${p.title} — отчёт ${fmtTime(Date.now()).slice(0, 10)}`;
    document.body.classList.add('printing-report');
    const done = () => {
      document.body.classList.remove('printing-report');
      document.title = prevTitle;
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(done, 1500); }, 60);
  }

  /* ====================== ПРИВЯЗКА ====================== */

  function bind() {
    $('reportClose').addEventListener('click', close);
    $('reportPrint').addEventListener('click', print);
    $('reportCompose').addEventListener('click', () => {
      const panel = $('reportPanel');
      panel.hidden = !panel.hidden;
      $('reportCompose').classList.toggle('active', !panel.hidden);
      if (!panel.hidden) renderPanel();
    });
    $('reportPanelClose').addEventListener('click', () => { $('reportPanel').hidden = true; $('reportCompose').classList.remove('active'); });
    $('reportMode').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      cfg().mono = b.dataset.mode === 'mono';
      persist();
      renderBar();
      build();
    }));
    NF.closeHooks.reportOverlay = () => {
      if (!$('reportPanel').hidden) { $('reportPanel').hidden = true; $('reportCompose').classList.remove('active'); return; }
      close();
    };
  }

  document.addEventListener('DOMContentLoaded', bind);

  window.Report = { open, close };
})();
