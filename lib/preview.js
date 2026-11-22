// NodeNote — предпросмотр ссылок (заголовок, описание, картинка og:image).
// Используется и локальным server.js, и функцией Vercel api/preview.js.
'use strict';

const dns = require('dns').promises;
const net = require('net');

/* ---------- Проверка пользователя (вход через Supabase обязателен) ---------- */
const userCache = new Map(); // token → { id, exp }
async function verifyUser(token, env) {
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  const hit = userCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.id;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || !u.id) return null;
    userCache.set(token, { id: u.id, exp: Date.now() + 10 * 60 * 1000 });
    if (userCache.size > 500) userCache.delete(userCache.keys().next().value);
    return u.id;
  } catch { return null; }
}

/* ---------- Предпросмотр ссылок (og:image / title) ----------
   Защита от SSRF: только http/https, стандартные порты, имя хоста резолвится
   и проверяется на приватные/локальные адреса (на каждом редиректе),
   таймаут, лимит размера ответа, кэш в памяти. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('bad port');
  if (u.username || u.password) throw new Error('credentials in url');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}

const previewCache = new Map(); // url → { at, data }
const PREVIEW_TTL = 24 * 60 * 60 * 1000;

function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'";
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  }).trim();
}

function parsePreview(html, baseUrl) {
  const meta = {};
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = (tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && content != null && !(key.toLowerCase() in meta)) meta[key.toLowerCase()] = decodeEntities(content);
  }
  const title = meta['og:title'] || meta['twitter:title'] || decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  let image = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta.image || '';
  let icon = '';
  const iconTag = html.match(/<link\s+[^>]*rel\s*=\s*["'][^"']*(?:apple-touch-icon|icon)[^"']*["'][^>]*>/i);
  if (iconTag) icon = (iconTag[0].match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  const abs = (x) => { try { const r = new URL(decodeEntities(x), baseUrl); return /^https?:$/.test(r.protocol) ? r.toString() : ''; } catch { return ''; } };
  return {
    title: title.slice(0, 300),
    description: (meta['og:description'] || meta['twitter:description'] || meta.description || '').slice(0, 500),
    image: image ? abs(image) : '',
    icon: icon ? abs(icon) : '',
    siteName: (meta['og:site_name'] || '').slice(0, 100),
  };
}

async function fetchPreview(rawUrl) {
  const cached = previewCache.get(rawUrl);
  if (cached && Date.now() - cached.at < PREVIEW_TTL) return cached.data;
  let url = new URL(rawUrl);
  let res;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NodeNotePreview/1.0)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ru,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
  const type = res.headers.get('content-type') || '';
  let data;
  if (/^image\//i.test(type)) {
    data = { title: '', description: '', image: url.toString(), icon: '', siteName: '' };
  } else {
    // Читаем не больше 600 КБ — мета-теги всегда в начале страницы.
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < 600 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    try { reader.cancel(); } catch { /* ignore */ }
    const html = Buffer.concat(chunks).toString('utf8');
    data = parsePreview(html, url.toString());
  }
  previewCache.set(rawUrl, { at: Date.now(), data });
  if (previewCache.size > 1000) previewCache.delete(previewCache.keys().next().value);
  return data;
}

async function handlePreview(req, res, { env = process.env, query, headers = {} } = {}) {
  if (!query) query = new URL(req.url, 'http://localhost').searchParams;
  const send = (status, obj) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const auth = req.headers.authorization || '';
  const userId = await verifyUser(auth.startsWith('Bearer ') ? auth.slice(7) : '', env);
  if (!userId) return send(401, { error: 'unauthorized' });
  const raw = query.get('url') || '';
  if (!raw || raw.length > 2000) return send(400, { error: 'bad url' });
  try { send(200, await fetchPreview(raw)); }
  catch (e) { send(422, { error: 'preview failed' }); }
}

module.exports = { handlePreview, parsePreview, isPrivateIp, fetchPreview };
