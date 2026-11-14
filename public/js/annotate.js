// NodeFlow — редактор пометок поверх изображений и страниц PDF.
// Перо, маркер, стрелка, рамка, текст, обрезка; отмена/повтор.
// Annotator.open({ src, title }) → Promise<{ dataUrl, mime, ext } | null>
(function () {
  'use strict';

  const NF = window.NF;
  const { svgIcon, escapeHtml, askText } = NF;

  const MAX_SIDE = 2600;
  const COLORS = ['#ef4444', '#f97316', '#eab308', '#16a34a', '#2563eb', '#111111', '#ffffff'];
  const TOOLS = [
    { id: 'pen', label: 'Перо', icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>' },
    { id: 'marker', label: 'Маркер', icon: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>' },
    { id: 'arrow', label: 'Стрелка', icon: '<line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/>' },
    { id: 'rect', label: 'Рамка', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/>' },
    { id: 'text', label: 'Текст', icon: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>' },
    { id: 'crop', label: 'Обрезать', icon: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>' },
  ];
  const ICON = (path, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  function open({ src, title = 'Изображение' }) {
    return new Promise(async (resolve) => {
      let img;
      try { img = await loadImage(src); } catch { NF.toast('Не удалось открыть изображение', 'err'); resolve(null); return; }

      // Базовая картинка (ограничиваем размер, чтобы не тормозило).
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const base = document.createElement('canvas');
      base.width = Math.round(img.naturalWidth * k);
      base.height = Math.round(img.naturalHeight * k);
      const bctx = base.getContext('2d');
      bctx.fillStyle = '#fff';
      bctx.fillRect(0, 0, base.width, base.height);
      bctx.drawImage(img, 0, 0, base.width, base.height);

      const work = document.createElement('canvas');
      work.width = base.width; work.height = base.height;
      const wctx = work.getContext('2d');

      const st = { tool: 'pen', color: COLORS[0], size: 4, ops: [], redo: [], draft: null, vis: null };
      const unit = Math.max(1, Math.max(base.width, base.height) / 1000); // толщина относительно размера

      const el = document.createElement('div');
      el.className = 'annot';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = `
        <div class="annot-bar">
          <button class="btn ghost" data-a="cancel">Отмена</button>
          <div class="annot-title">${escapeHtml(title)}</div>
          <button class="btn primary" data-a="save">Сохранить</button>
        </div>
        <div class="annot-stage"><canvas class="annot-canvas"></canvas></div>
        <div class="annot-tools">
          <div class="annot-group">${TOOLS.map((t) => `<button class="tool ${t.id === st.tool ? 'active' : ''}" data-tool="${t.id}" title="${t.label}" aria-label="${t.label}">${ICON(t.icon)}</button>`).join('')}</div>
          <div class="annot-group">${COLORS.map((c) => `<button class="annot-color ${c === st.color ? 'active' : ''}" data-color="${c}" style="--ac:${c}" aria-label="Цвет ${c}"></button>`).join('')}</div>
          <div class="annot-group">
            <input type="range" min="1" max="16" value="${st.size}" class="annot-size" aria-label="Толщина">
            <button class="tool" data-a="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить">${ICON('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>')}</button>
            <button class="tool" data-a="redo" title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить">${ICON('<polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>')}</button>
            <button class="tool" data-a="clear" title="Убрать все пометки" aria-label="Убрать все пометки">${svgIcon('trash', 18)}</button>
          </div>
          <div class="annot-crop" hidden>
            <span>Выдели область</span>
            <button class="btn sm primary" data-a="cropok">Обрезать</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      document.documentElement.classList.add('no-scroll');
      requestAnimationFrame(() => el.classList.add('open'));

      const canvas = el.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const cropBar = el.querySelector('.annot-crop');

      // Видимая область с учётом обрезок: применяем операции по порядку.
      function render() {
        wctx.clearRect(0, 0, work.width, work.height);
        wctx.drawImage(base, 0, 0);
        let vis = { x: 0, y: 0, w: base.width, h: base.height };
        const all = st.draft ? st.ops.concat([st.draft]) : st.ops;
        for (const op of all) {
          if (op.type === 'crop') {
            if (op === st.draft) continue;
            vis = { x: vis.x + op.x, y: vis.y + op.y, w: op.w, h: op.h };
            continue;
          }
          wctx.save();
          wctx.translate(vis.x, vis.y);
          drawOp(wctx, op);
          wctx.restore();
        }
        st.vis = vis;
        if (canvas.width !== vis.w || canvas.height !== vis.h) { canvas.width = vis.w; canvas.height = vis.h; }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(work, vis.x, vis.y, vis.w, vis.h, 0, 0, vis.w, vis.h);
        if (st.draft && st.draft.type === 'crop') {
          const r = norm(st.draft);
          ctx.save();
          ctx.fillStyle = 'rgba(0,0,0,.45)';
          ctx.beginPath();
          ctx.rect(0, 0, canvas.width, canvas.height);
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.fill('evenodd');
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 * unit;
          ctx.setLineDash([8 * unit, 6 * unit]);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
          ctx.restore();
        }
        el.querySelector('[data-a="undo"]').disabled = !st.ops.length;
        el.querySelector('[data-a="redo"]').disabled = !st.redo.length;
      }

      const norm = (o) => ({ x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) });

      function drawOp(c, op) {
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = op.color;
        c.fillStyle = op.color;
        const w = op.size * unit;
        if (op.type === 'pen' || op.type === 'marker') {
          if (op.type === 'marker') { c.globalAlpha = 0.35; c.lineWidth = w * 4; c.lineCap = 'square'; }
          else c.lineWidth = w;
          const p = op.pts;
          c.beginPath();
          c.moveTo(p[0][0], p[0][1]);
          if (p.length === 1) c.lineTo(p[0][0] + 0.1, p[0][1] + 0.1);
          for (let i = 1; i < p.length - 1; i++) {
            const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
            c.quadraticCurveTo(p[i][0], p[i][1], mx, my);
          }
          if (p.length > 1) c.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
          c.stroke();
          c.globalAlpha = 1;
        } else if (op.type === 'rect') {
          const r = norm(op);
          c.lineWidth = w;
          c.strokeRect(r.x, r.y, r.w, r.h);
        } else if (op.type === 'arrow') {
          c.lineWidth = w;
          const ang = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
          const head = Math.max(12 * unit, w * 4);
          c.beginPath();
          c.moveTo(op.x1, op.y1);
          c.lineTo(op.x2 - Math.cos(ang) * head * 0.6, op.y2 - Math.sin(ang) * head * 0.6);
          c.stroke();
          c.beginPath();
          c.moveTo(op.x2, op.y2);
          c.lineTo(op.x2 - head * Math.cos(ang - 0.45), op.y2 - head * Math.sin(ang - 0.45));
          c.lineTo(op.x2 - head * Math.cos(ang + 0.45), op.y2 - head * Math.sin(ang + 0.45));
          c.closePath();
          c.fill();
        } else if (op.type === 'text') {
          const fs = Math.max(14, op.size * 6) * unit;
          c.font = `600 ${fs}px Geist, Inter, Arial, sans-serif`;
          c.textBaseline = 'top';
          const lines = op.text.split('\n');
          // Подложка для читаемости поверх любой картинки.
          const light = /^#f|^#e|^#ff/i.test(op.color);
          lines.forEach((ln, i) => {
            const y = op.y + i * fs * 1.25;
            c.lineWidth = fs * 0.22;
            c.strokeStyle = light ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.9)';
            c.strokeText(ln, op.x, y);
            c.fillText(ln, op.x, y);
          });
        }
      }

      // Экранные координаты → координаты видимой области.
      function pt(e) {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
      }

      let drawing = false;
      canvas.addEventListener('pointerdown', async (e) => {
        e.preventDefault();
        const [x, y] = pt(e);
        if (st.tool === 'text') {
          const text = await askText({ title: 'Текст пометки', placeholder: 'Например, «важно!»', actionText: 'Добавить' });
          if (!text || typeof text !== 'string') return;
          st.ops.push({ type: 'text', x, y, text, color: st.color, size: st.size });
          st.redo = [];
          render();
          return;
        }
        drawing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        st.draft = st.tool === 'pen' || st.tool === 'marker'
          ? { type: st.tool, pts: [[x, y]], color: st.color, size: st.size }
          : { type: st.tool, x1: x, y1: y, x2: x, y2: y, color: st.color, size: st.size };
        render();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing || !st.draft) return;
        const [x, y] = pt(e);
        if (st.draft.pts) st.draft.pts.push([x, y]);
        else { st.draft.x2 = Math.max(0, Math.min(canvas.width, x)); st.draft.y2 = Math.max(0, Math.min(canvas.height, y)); }
        render();
      });
      const finish = () => {
        if (!drawing) return;
        drawing = false;
        const d = st.draft;
        if (!d) return;
        if (d.type === 'crop') { cropBar.hidden = norm(d).w < 8 || norm(d).h < 8; render(); return; }
        st.draft = null;
        const tiny = !d.pts && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4;
        if (!tiny) { st.ops.push(d); st.redo = []; }
        render();
      };
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);

      function setTool(id) {
        st.tool = id;
        if (st.draft && st.draft.type === 'crop' && id !== 'crop') { st.draft = null; cropBar.hidden = true; render(); }
        el.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === id));
        canvas.dataset.tool = id;
      }

      el.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
      el.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
        st.color = b.dataset.color;
        el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x === b));
        if (st.tool === 'crop') setTool('pen');
      }));
      el.querySelector('.annot-size').addEventListener('input', (e) => { st.size = +e.target.value; });

      const undo = () => { if (st.ops.length) { st.redo.push(st.ops.pop()); render(); } };
      const redo = () => { if (st.redo.length) { st.ops.push(st.redo.pop()); render(); } };

      const close = (val) => {
        el.classList.remove('open');
        document.removeEventListener('keydown', onKey, true);
        document.documentElement.classList.remove('no-scroll');
        setTimeout(() => el.remove(), 250);
        resolve(val);
      };

      el.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        const act = a.dataset.a;
        if (act === 'undo') undo();
        else if (act === 'redo') redo();
        else if (act === 'clear') { if (st.ops.length) { st.redo = st.ops.slice().reverse(); st.ops = []; render(); } }
        else if (act === 'cropok') {
          const d = st.draft;
          if (!d) return;
          const r = norm(d);
          st.draft = null;
          cropBar.hidden = true;
          st.ops.push({ type: 'crop', x: Math.round(r.x), y: Math.round(r.y), w: Math.max(8, Math.round(r.w)), h: Math.max(8, Math.round(r.h)) });
          st.redo = [];
          setTool('pen');
          render();
        } else if (act === 'cancel') {
          if (st.ops.length && !(await NF.askConfirm({ title: 'Выйти без сохранения?', message: 'Пометки будут потеряны.', actionText: 'Выйти' }))) return;
          close(null);
        } else if (act === 'save') {
          st.draft = null;
          render();
          const png = /^data:image\/png/i.test(src) && canvas.width * canvas.height < 1.5e6;
          const mime = png ? 'image/png' : 'image/jpeg';
          close({ dataUrl: canvas.toDataURL(mime, 0.9), mime, ext: png ? 'png' : 'jpg' });
        }
      });

      const onKey = (e) => {
        if (document.querySelector('.confirm-overlay')) return;
        const mod = e.ctrlKey || e.metaKey;
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); el.querySelector('[data-a="cancel"]').click(); }
        else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
      };
      document.addEventListener('keydown', onKey, true);
      setTool('pen');
      render();
    });
  }

  window.Annotator = { open };
})();
