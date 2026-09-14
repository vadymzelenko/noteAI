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

/* ---------- SMS (Twilio) ---------- */
// Секреты Twilio живут только тут, на сервере (.env) — браузер их никогда
// не видит. Клиент лишь просит сервер отправить сообщение своему же
// авторизованному пользователю; сам номер SMS вводится в настройках клиента.

const smsRateLimit = new Map(); // userId -> [timestamps]
const SMS_RATE_LIMIT_MAX = 5;
const SMS_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkSmsRateLimit(userId) {
  const now = Date.now();
  const arr = (smsRateLimit.get(userId) || []).filter((t) => now - t < SMS_RATE_LIMIT_WINDOW_MS);
  if (arr.length >= SMS_RATE_LIMIT_MAX) return false;
  arr.push(now);
  smsRateLimit.set(userId, arr);
  return true;
}

// Проверяет access_token через Supabase Auth API — так серверу не нужно
// самому парсить/валидировать JWT и держать отдельный секрет для этого.
async function verifySupabaseUser(token) {
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Тело запроса слишком большое')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function sendTwilioSms(to, body) {
  const sid = env.TWILIO_ACCOUNT_SID, authToken = env.TWILIO_AUTH_TOKEN, from = env.TWILIO_FROM_NUMBER;
  if (!sid || !authToken || !from) throw new Error('SMS не настроен на сервере (заполни TWILIO_* в .env)');
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64'),
    },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Twilio HTTP ${res.status}`);
  return data;
}

async function handleSmsSend(req, res) {
  const respond = (status, obj) => {
    res.writeHead(status, withSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify(obj));
  };
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const user = await verifySupabaseUser(token);
    if (!user || !user.id) return respond(401, { error: 'Не авторизован' });

    if (!checkSmsRateLimit(user.id)) {
      return respond(429, { error: `Слишком много SMS — не больше ${SMS_RATE_LIMIT_MAX} в час` });
    }

    let payload;
    try { payload = JSON.parse((await readBody(req)) || '{}'); } catch { payload = {}; }
    const to = String(payload.to || '').trim();
    const body = String(payload.body || '').trim().slice(0, 500);

    if (!/^\+?[0-9]{7,15}$/.test(to)) return respond(400, { error: 'Некорректный номер телефона' });
    if (!body) return respond(400, { error: 'Пустое сообщение' });

    const result = await sendTwilioSms(to, body);
    respond(200, { ok: true, sid: result.sid || null });
  } catch (e) {
    respond(500, { error: e.message || 'Ошибка отправки SMS' });
  }
}

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

  if (req.method === 'POST' && urlPath === '/api/sms/send') {
    handleSmsSend(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD, POST' }));
    return res.end('Method Not Allowed');
  }

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
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    console.warn('  ⚠  SMS не настроен. Заполни .env (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER), если нужны SMS-напоминания.\n');
  } else {
    console.log('  ✓  Twilio сконфигурирован. SMS-напоминания готовы.\n');
  }
});