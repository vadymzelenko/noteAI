// NodeFlow — минимальный статический сервер без внешних зависимостей.
// Читает .env, раздаёт PWA из /public, отдаёт /config.js из переменных окружения.
// Никаких client id — Google-вход реализован целиком через Supabase OAuth.

const http = require('http');
const fs   = require('fs');
const path = require('path');

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
    APP_NAME:            env.APP_NAME || 'NodeFlow',
    SUPABASE_URL:        env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY:   env.SUPABASE_ANON_KEY || '',
    AI_DEFAULT_PROVIDER: env.AI_DEFAULT_PROVIDER || '',
    AI_DEFAULT_MODEL:    env.AI_DEFAULT_MODEL || '',
    AI_DEFAULT_BASE_URL: env.AI_DEFAULT_BASE_URL || '',
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
};

/* ---------- Общие заголовки безопасности ---------- */
function withSecurityHeaders(headers) {
  return {
    ...headers,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/* ---------- HTTP-сервер ---------- */
const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad Request');
  }
  if (urlPath === '/') urlPath = '/index.html';

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

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('404 — файл не найден: ' + urlPath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };

    if (urlPath === '/service-worker.js') {
      headers['Cache-Control'] = 'no-cache';
      headers['Service-Worker-Allowed'] = '/';
    }

    res.writeHead(200, withSecurityHeaders(headers));
    res.end(data);
  });
});

server.listen(PORT, () => {
  const cfg = runtimeConfig();
  console.log(`\n  NodeFlow запущен → http://localhost:${PORT}\n`);
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.warn('  ⚠  Supabase не настроен. Заполни .env (SUPABASE_URL, SUPABASE_ANON_KEY).\n');
  } else {
    console.log('  ✓  Supabase сконфигурирован. Вход через Google готов.\n');
  }
});