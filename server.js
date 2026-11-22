// NodeNote — минимальный сервер без внешних зависимостей.
// Читает .env, раздаёт PWA из /public, отдаёт /config.js из переменных окружения,
// умеет делать предпросмотр ссылок (/api/preview: заголовок и картинка страницы).
// Никаких client id — Google-вход реализован целиком через Supabase OAuth.

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const crypto = require('crypto');

const ROOT     = path.join(__dirname, 'public');
const ENV_PATH = path.join(__dirname, '.env');

/* ---------- Простой парсер .env (без зависимостей) ---------- */
function loadEnv(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch { /* .env отсутствует — используем только process.env */ }
  return { ...out, ...process.env };
}

const env  = loadEnv(ENV_PATH);
const PORT = Number(env.PORT) || 5173;

/* ---------- Runtime-конфиг для фронтенда ---------- */
function runtimeConfig() {
  return {
    APP_NAME:            env.APP_NAME || 'NodeNote',
    SUPABASE_URL:        env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY:   env.SUPABASE_ANON_KEY || '',
  };
}

/* ---------- MIME-таблица ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.webp': 'image/webp',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
};

/* ---------- Кэш файлов + ETag ----------
   Раньше JS/CSS отдавались с «вечным» кэшем (immutable на год), а имена
   файлов не менялись — после обновления браузер мог годами держать старый
   код. Теперь всё, кроме версионированных библиотек в /vendor, отдаётся с
   no-cache + ETag: браузер каждый раз сверяется с сервером и получает 304,
   если файл не изменился (быстро и всегда свежо). */
const fileCache = new Map(); // filePath → { mtime, data, gz, etag }

function loadFile(filePath, cb) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) return cb(err || new Error('not a file'));
    const hit = fileCache.get(filePath);
    if (hit && hit.mtime === st.mtimeMs) return cb(null, hit);
    fs.readFile(filePath, (rerr, data) => {
      if (rerr) return cb(rerr);
      const entry = { mtime: st.mtimeMs, data, gz: null, etag: '"' + crypto.createHash('sha1').update(data).digest('base64url').slice(0, 20) + '"' };
      if (data.length < 4 * 1024 * 1024) fileCache.set(filePath, entry);
      cb(null, entry);
    });
  });
}

/* ---------- Предпросмотр ссылок (логика в lib/preview.js) ---------- */
const { handlePreview } = require('./lib/preview');

/* ---------- Общие заголовки безопасности ---------- */
function withSecurityHeaders(headers) {
  return {
    ...headers,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Включается только на https-соединениях; поверх http браузеры её игнорируют,
    // поэтому локальная разработка не ломается.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

/* ---------- HTTP-сервер ---------- */
const server = http.createServer((req, res) => {
  let urlPath, query;
  try {
    const q = req.url.indexOf('?');
    urlPath = decodeURIComponent(q === -1 ? req.url : req.url.slice(0, q));
    query = new URLSearchParams(q === -1 ? '' : req.url.slice(q + 1));
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }
  if (urlPath === '/') urlPath = '/index.html';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' }));
    return res.end('Method Not Allowed');
  }

  // Лёгкий health-check для мониторинга и проверки, что сервер жив.
  if (urlPath === '/api/health') {
    res.writeHead(200, withSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
    return res.end(JSON.stringify({ ok: true, app: 'NodeNote', time: Date.now() }));
  }

  if (urlPath === '/api/preview') { handlePreview(req, res, { env, query, headers: withSecurityHeaders({}) }); return; }

  // Динамический конфиг из .env — не кэшируется, отдаётся на каждый запрос.
  // SUPABASE_ANON_KEY — публичный ключ по дизайну Supabase (доступ к данным
  // ограничивается политиками RLS в базе, а не секретностью этого ключа).
  // SERVICE_ROLE-ключи сюда никогда не должны попадать.
  if (urlPath === '/config.js') {
    const body = `window.NF_CONFIG = ${JSON.stringify(runtimeConfig(), null, 2)};\n`;
    res.writeHead(200, withSecurityHeaders({
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    }));
    return res.end(body);
  }

  // Нормализуем путь и не даём выйти за пределы ROOT (защита от ../ traversal).
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  loadFile(filePath, (err, entry) => {
    if (err) {
      res.writeHead(404, withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('404 — файл не найден: ' + urlPath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: entry.etag };

    // Кэш-политика:
    //  • /vendor/* — в имени файла версия, можно кэшировать навсегда;
    //  • иконки — сутки;
    //  • всё остальное (html, js, css, манифест, service worker) — no-cache + ETag.
    if (urlPath.startsWith('/vendor/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    else if (urlPath.startsWith('/icons/')) headers['Cache-Control'] = 'public, max-age=86400';
    else headers['Cache-Control'] = 'no-cache';
    if (urlPath === '/service-worker.js') headers['Service-Worker-Allowed'] = '/';
    if (ext === '.json' && urlPath === '/manifest.json') headers['Content-Type'] = 'application/manifest+json; charset=utf-8';

    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, withSecurityHeaders(headers));
      return res.end();
    }

    const data = entry.data;
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const compressible = /^(text\/|application\/(json|javascript|manifest)|image\/svg\+xml)/.test(headers['Content-Type']);
    if (compressible && /\bgzip\b/.test(acceptEncoding) && data.length > 512) {
      headers['Vary'] = 'Accept-Encoding';
      const sendGz = (gz) => {
        headers['Content-Encoding'] = 'gzip';
        res.writeHead(200, withSecurityHeaders(headers));
        res.end(req.method === 'HEAD' ? undefined : gz);
      };
      if (entry.gz) return sendGz(entry.gz);
      zlib.gzip(data, { level: 6 }, (zerr, gz) => {
        if (zerr) { res.writeHead(200, withSecurityHeaders(headers)); return res.end(data); }
        entry.gz = gz;
        sendGz(gz);
      });
      return;
    }

    res.writeHead(200, withSecurityHeaders(headers));
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, () => {
  const cfg = runtimeConfig();
  console.log(`\n  NodeNote запущен → http://localhost:${PORT}\n`);
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.warn('  ⚠  Supabase не настроен. Заполни .env (SUPABASE_URL, SUPABASE_ANON_KEY).\n');
  } else {
    console.log('  ✓  Supabase сконфигурирован. Вход через Google готов.\n');
  }
});