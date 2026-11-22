// NodeNote — генеративные обложки (как аватарки на GitHub, но аккуратнее).
// Узор детерминирован: у одной и той же записи всегда один и тот же рисунок.
// Цвета не «зашиты»: SVG использует CSS-переменные --pb/--p1/--p2/--p3,
// которые зависят от темы (тёмная — глубокие приглушённые тона, светлая —
// мягкие пастельные), поэтому обложки сами подстраиваются под тему.
//
// Patterns.html(seed, { style, hue, w, h, label }) → HTML-строка.
(function () {
  'use strict';

  const STYLES = ['grid', 'waves', 'arcs', 'triangles', 'rings', 'dots'];

  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Приглушённые «дизайнерские» оттенки — без кислотных цветов.
  const HUES = [8, 24, 38, 152, 168, 186, 200, 212, 226, 244, 262, 280, 322, 340];

  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const f = (n) => n.toFixed(1);

  function grid(r, W, H) {
    // Симметричная сетка, как у identicon: левая половина отражается вправо.
    const rows = 4, cols = 10, cs = H / rows, ox = (W - cols * cs) / 2;
    let out = '';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols / 2; x++) {
        const v = r();
        if (v < 0.42) continue;
        const cls = v > 0.86 ? 'p2' : v > 0.7 ? 'p3' : 'p1';
        const pad = cs * 0.1;
        [x, cols - 1 - x].forEach((xx) => {
          out += `<rect class="${cls}" x="${f(ox + xx * cs + pad)}" y="${f(y * cs + pad)}" width="${f(cs - pad * 2)}" height="${f(cs - pad * 2)}" rx="${f(cs * 0.18)}"/>`;
        });
      }
    }
    return out;
  }

  function waves(r, W, H) {
    let out = '';
    const n = 6;
    const amp = 8 + r() * 14, freq = 1 + r() * 1.6, phase = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const y0 = (H / (n + 1)) * (i + 1);
      let d = `M0 ${f(y0)}`;
      for (let x = 0; x <= W; x += 8) {
        const y = y0 + Math.sin((x / W) * Math.PI * 2 * freq + phase + i * 0.55) * amp;
        d += ` L${x} ${f(y)}`;
      }
      out += `<path class="s${(i % 3) + 1}" d="${d}" fill="none" stroke-width="${f(3 + (i % 2) * 2)}" stroke-linecap="round"/>`;
    }
    return out;
  }

  function arcs(r, W, H) {
    // Плитки «Трюше»: четверти окружностей в разных углах — баухаус.
    const cs = H / 3;
    const cols = Math.ceil(W / cs);
    let out = '';
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < cols; x++) {
        const v = r();
        const cx = x * cs, cy = y * cs;
        const corner = Math.floor(r() * 4);
        const ax = corner % 2 ? cx + cs : cx, ay = corner > 1 ? cy + cs : cy;
        const cls = v > 0.8 ? 'p2' : v > 0.55 ? 'p3' : v > 0.18 ? 'p1' : '';
        if (!cls) continue;
        out += `<path class="${cls}" d="M${f(ax)} ${f(ay)} L${f(corner % 2 ? cx : cx + cs)} ${f(ay)} A${f(cs)} ${f(cs)} 0 0 ${corner === 0 || corner === 3 ? 1 : 0} ${f(ax)} ${f(corner > 1 ? cy : cy + cs)} Z"/>`;
      }
    }
    return out;
  }

  function triangles(r, W, H) {
    const cs = H / 3;
    const cols = Math.ceil(W / cs) + 1;
    let out = '';
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = x * cs, cy = y * cs;
        const up = r() > 0.5;
        [0, 1].forEach((half) => {
          const v = r();
          const cls = v > 0.82 ? 'p2' : v > 0.6 ? 'p3' : v > 0.3 ? 'p1' : '';
          if (!cls) return;
          const pts = up
            ? (half ? `${f(cx)},${f(cy)} ${f(cx + cs)},${f(cy)} ${f(cx + cs)},${f(cy + cs)}` : `${f(cx)},${f(cy)} ${f(cx)},${f(cy + cs)} ${f(cx + cs)},${f(cy + cs)}`)
            : (half ? `${f(cx)},${f(cy + cs)} ${f(cx + cs)},${f(cy)} ${f(cx + cs)},${f(cy + cs)}` : `${f(cx)},${f(cy)} ${f(cx + cs)},${f(cy)} ${f(cx)},${f(cy + cs)}`);
          out += `<polygon class="${cls}" points="${pts}"/>`;
        });
      }
    }
    return out;
  }

  function rings(r, W, H) {
    const cx = W * (0.2 + r() * 0.6), cy = H * (0.3 + r() * 0.5);
    let out = '';
    const n = 9;
    for (let i = n; i > 0; i--) {
      out += `<circle class="${i % 3 === 0 ? 'p2' : i % 2 ? 'p1' : 'p3'}" cx="${f(cx)}" cy="${f(cy)}" r="${f(i * (W / n) * 0.42)}" opacity="${f(0.35 + (n - i) * 0.07)}"/>`;
    }
    return out;
  }

  function dots(r, W, H) {
    // Полутоновая «растровая» заливка с плавным градиентом размера.
    const step = 14;
    const angle = r() * Math.PI * 2;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let out = '';
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const t = ((x / W) * dx + (y / H) * dy + 1) / 2;
        const rad = 1 + t * 4.6;
        out += `<circle class="${t > 0.75 ? 'p2' : 'p1'}" cx="${x}" cy="${y}" r="${f(rad)}"/>`;
      }
    }
    return out;
  }

  const DRAW = { grid, waves, arcs, triangles, rings, dots };

  function hueFromColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }

  function html(seed, { style = 'auto', hue = null, w = 400, h = 160, label = '', cls = '' } = {}) {
    const hs = hash(String(seed || 'nodenote'));
    const r = rng(hs);
    const st = style && style !== 'auto' && DRAW[style] ? style : STYLES[hs % STYLES.length];
    const hh = hue == null ? pick(r, HUES) : hue;
    return `<div class="pat ${cls}" style="--ph:${hh}" aria-hidden="true">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><rect class="pb" width="${w}" height="${h}"/>${DRAW[st](r, w, h)}</svg>
      ${label ? `<span class="pat-label">${label}</span>` : ''}
    </div>`;
  }

  window.Patterns = { html, hueFromColor, STYLES };
})();
