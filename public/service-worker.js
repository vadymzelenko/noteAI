// NodeNote service worker.
// • Оболочка приложения кэшируется при установке — работает без сети.
// • HTML/JS/CSS: сначала сеть (с таймаутом), при отсутствии сети — кэш.
//   Благодаря ETag на сервере это быстро и всегда свежо.
// • /vendor и /icons (версии в именах): сначала кэш.
// • Supabase, /api и прочие внешние запросы — только сеть, не кэшируются.
// • Новая версия ждёт, пока пользователь нажмёт «Обновить» (SKIP_WAITING).

const VERSION = 'nodenote-v24';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/config.js',
  '/css/style.css',
  '/js/theme-boot.js',
  '/js/prefs.js',
  '/js/patterns.js',
  '/js/auth.js',
  '/js/db.js',
  '/js/links.js',
  '/js/app.js',
  '/js/media.js',
  '/js/datepicker.js',
  '/js/workspace.js',
  '/js/projects.js',
  '/js/annotate.js',
  '/js/report.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/vendor/supabase-2.118.0.js',
  '/vendor/prism-1.29.0/prism-tomorrow.min.css',
  '/vendor/prism-1.29.0/prism-core.min.js',
  '/vendor/prism-1.29.0/prism-markup.min.js',
  '/vendor/prism-1.29.0/prism-css.min.js',
  '/vendor/prism-1.29.0/prism-clike.min.js',
  '/vendor/prism-1.29.0/prism-c.min.js',
  '/vendor/prism-1.29.0/prism-javascript.min.js',
  '/vendor/prism-1.29.0/prism-typescript.min.js',
  '/vendor/prism-1.29.0/prism-python.min.js',
  '/vendor/prism-1.29.0/prism-cpp.min.js',
  '/vendor/prism-1.29.0/prism-json.min.js',
  '/vendor/prism-1.29.0/prism-bash.min.js',
];
const FONT_CACHE = 'nodenote-fonts';
const NETWORK_TIMEOUT = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.all(
      SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch((e) => console.warn('[SW] skip', url, e.message)))
    ))
  );
  // Первая установка — активируемся сразу; обновление ждёт команды пользователя.
  if (!self.registration.active) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const res = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT)]);
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
    if (hit) return hit;
    return new Response('Нет соединения', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request, cacheName = VERSION) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Шрифты Google — кэшируем, чтобы офлайн интерфейс выглядел так же.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE).catch(() => fetch(request)));
    return;
  }
  if (url.origin !== self.location.origin) return;        // Supabase, Википедия и т.п. — напрямую
  if (url.pathname.startsWith('/api/')) return;             // API — только сеть

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
