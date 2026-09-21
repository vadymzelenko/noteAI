// NodeFlow — минимальный статический сервер без внешних зависимостей.
// Читает .env, раздаёт PWA из /public, отдаёт /config.js из переменных окружения.
// Никаких client id — Google-вход реализован целиком через Supabase OAuth.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const tls  = require('tls');
const zlib = require('zlib');

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

/* ---------- Email (Gmail SMTP) ---------- */
// Учётные данные Gmail живут только тут, на сервере (.env) — браузер их
// никогда не видит. Клиент лишь просит сервер отправить письмо своему же
// авторизованному пользователю; сам email-получатель вводится в настройках
// клиента. Зависимостей вроде nodemailer нет — письмо уходит через
// сырой SMTP-диалог поверх TLS-сокета (модуль tls из стандартной библиотеки).

const emailRateLimit = new Map(); // userId -> [timestamps]
const EMAIL_RATE_LIMIT_MAX = 5;
const EMAIL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function checkEmailRateLimit(userId) {
  const now = Date.now();
  const arr = (emailRateLimit.get(userId) || []).filter((t) => now - t < EMAIL_RATE_LIMIT_WINDOW_MS);
  if (arr.length >= EMAIL_RATE_LIMIT_MAX) return false;
  arr.push(now);
  emailRateLimit.set(userId, arr);
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

// Простой SMTP-диалог поверх TLS. Ждём ответ сервера после каждой команды
// и проверяем код (2xx/3xx — успех, иначе бросаем ошибку с текстом ответа).
function smtpRoundTrip(socket, line) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      cleanup();
      resolve(chunk.toString('utf8'));
    };
    const onError = (err) => { cleanup(); reject(err); };
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    socket.once('data', onData);
    socket.once('error', onError);
    if (line !== null) socket.write(line + '\r\n');
  });
}

function assertSmtpOk(response, step) {
  const code = parseInt(response.slice(0, 3), 10);
  if (!(code >= 200 && code < 400)) {
    throw new Error(`SMTP ошибка на шаге "${step}": ${response.trim()}`);
  }
}

async function sendGmailEmail(to, subject, text) {
  const user = env.GMAIL_USER, pass = env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('Email не настроен на сервере (заполни GMAIL_USER, GMAIL_APP_PASSWORD в .env)');

  await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; socket.destroy(); reject(err); } };
    socket.setTimeout(15000, () => fail(new Error('Таймаут соединения со SMTP-сервером')));
    socket.on('error', fail);

    socket.once('connect', async () => {
      try {
        assertSmtpOk(await smtpRoundTrip(socket, null), 'greeting');
        assertSmtpOk(await smtpRoundTrip(socket, 'EHLO nodeflow.local'), 'EHLO');
        assertSmtpOk(await smtpRoundTrip(socket, 'AUTH LOGIN'), 'AUTH LOGIN');
        assertSmtpOk(await smtpRoundTrip(socket, Buffer.from(user, 'utf8').toString('base64')), 'AUTH user');
        assertSmtpOk(await smtpRoundTrip(socket, Buffer.from(pass, 'utf8').toString('base64')), 'AUTH pass');
        assertSmtpOk(await smtpRoundTrip(socket, `MAIL FROM:<${user}>`), 'MAIL FROM');
        assertSmtpOk(await smtpRoundTrip(socket, `RCPT TO:<${to}>`), 'RCPT TO');
        assertSmtpOk(await smtpRoundTrip(socket, 'DATA'), 'DATA');

        const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
        const escapedBody = String(text).replace(/\r?\n\./g, '\n..'); // экранируем строки, начинающиеся с точки
        const message = [
          `From: NodeFlow <${user}>`,
          `To: ${to}`,
          `Subject: ${encodedSubject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: 8bit',
          '',
          escapedBody,
          '.',
        ].join('\r\n');
        assertSmtpOk(await smtpRoundTrip(socket, message), 'send');

        await smtpRoundTrip(socket, 'QUIT');
        settled = true;
        socket.end();
        resolve();
      } catch (e) {
        fail(e);
      }
    });
  });
}

async function handleEmailSend(req, res) {
  const respond = (status, obj) => {
    res.writeHead(status, withSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify(obj));
  };
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const user = await verifySupabaseUser(token);
    if (!user || !user.id) return respond(401, { error: 'Не авторизован' });

    if (!checkEmailRateLimit(user.id)) {
      return respond(429, { error: `Слишком много писем — не больше ${EMAIL_RATE_LIMIT_MAX} в час` });
    }

    let payload;
    try { payload = JSON.parse((await readBody(req)) || '{}'); } catch { payload = {}; }
    const to = String(payload.to || '').trim();
    const subject = String(payload.subject || 'NodeFlow').trim().slice(0, 200);
    const body = String(payload.body || '').trim().slice(0, 2000);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return respond(400, { error: 'Некорректный email-адрес' });
    if (!body) return respond(400, { error: 'Пустое сообщение' });

    await sendGmailEmail(to, subject, body);
    respond(200, { ok: true });
  } catch (e) {
    respond(500, { error: e.message || 'Ошибка отправки письма' });
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
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Включается только на https-соединениях; поверх http браузеры её игнорируют,
    // поэтому локальная разработка не ломается.
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
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

  if (req.method === 'POST' && urlPath === '/api/email/send') {
    handleEmailSend(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, withSecurityHeaders({ 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD, POST' }));
    return res.end('Method Not Allowed');
  }

  // Лёгкий health-check для мониторинга и проверки, что сервер жив.
  if (urlPath === '/api/health') {
    res.writeHead(200, withSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
    return res.end(JSON.stringify({ ok: true, app: 'NodeFlow', time: Date.now() }));
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

    // Кэш-политика: html, service worker и манифест всегда свежие (no-cache);
    // статические ресурсы с «вечным» кэшем — у них имена/версии меняются при
    // обновлении, поэтому не залипаем на устаревших версиях.
    if (urlPath === '/service-worker.js') {
      headers['Cache-Control'] = 'no-cache';
      headers['Service-Worker-Allowed'] = '/';
    } else if (urlPath === '/' || urlPath === '/index.html' || urlPath === '/config.js' || urlPath === '/manifest.json') {
      headers['Cache-Control'] = 'no-cache';
    } else if (/\.(css|js|mjs|svg|png|jpe?g|ico|woff2?)$/.test(urlPath)) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }

    // gzip для сжимаемых текстовых типов — заметно экономит трафик.
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const compressible = /^(text\/|application\/(json|javascript)|image\/svg\+xml)/.test(headers['Content-Type']);
    if (compressible && /\bgzip\b/.test(acceptEncoding) && data.length > 512) {
      zlib.gzip(data, { level: 6 }, (zerr, gz) => {
        if (zerr) {
          res.writeHead(200, withSecurityHeaders(headers));
          return res.end(data);
        }
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(200, withSecurityHeaders(headers));
        res.end(gz);
      });
      return;
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
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    console.warn('  ⚠  Email не настроен. Заполни .env (GMAIL_USER, GMAIL_APP_PASSWORD — пароль приложения Google), если нужны email-напоминания.\n');
  } else {
    console.log('  ✓  Gmail SMTP сконфигурирован. Email-напоминания готовы.\n');
  }
});