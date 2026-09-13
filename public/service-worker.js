// NodeFlow service worker — офлайн-кэш оболочки.

const CACHE_VERSION = 'nodeflow-v8';
const SHELL_FILES = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/style.css',
    '/js/auth.js',
    '/js/ai.js',
    '/js/db.js',
    '/js/app.js',
    '/icons/icon.svg',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-clike.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-c.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-typescript.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-cpp.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js',
    'https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => Promise.all(
                SHELL_FILES.map((url) =>
                    cache.add(url).catch((e) => console.warn('[SW] skip', url, e.message))
                )
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    // Не трогаем chrome-extension://, moz-extension://, data:, blob: и т.п.
    let url;
    try { url = new URL(request.url); } catch { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    // Google auth-эндпоинты и Drive API — всегда сеть, без кэша.
    if (url.hostname === 'accounts.google.com' ||
        url.hostname.endsWith('googleapis.com') ||
        url.hostname === 'script.google.com') {
        return; // браузер сам сходит в сеть, не мешаем
    }

    event.respondWith(
        // Сеть в приоритете: пока проект активно меняется, важнее не залипать
        // на старой закэшированной версии, чем сэкономить один сетевой запрос.
        // Кэш используется только как офлайн-фолбэк, если сети совсем нет.
        fetch(request)
            .then((response) => {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    caches.open(CACHE_VERSION)
                        .then((cache) => cache.put(request, copy))
                        .catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(request))
    );
});

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') self.skipWaiting();
});