// NodeFlow — коллекция ссылок (закладки).
// Ссылки добавляются вручную или автоматически собираются из текста заметок
// и задач. Хранятся в localStorage и, если пользователь вошёл, сами
// синхронизируются в Supabase (служебная запись в таблице items).
(function () {
    'use strict';

    const KEY = 'nf.links';
    const AUTO_KEY = 'nf.links.auto';
    const CLOUD_RECORD_ID = '00000000-0000-0000-0000-0000000b2b2b';
    const CLOUD_DEBOUNCE_MS = 1200;

    const state = {
        links: [],      // { id, url, domain, title, group, createdAt }
        groups: [],     // { id, name }
        blocklist: [],  // { type: 'domain'|'url', value }
    };

    const listeners = new Set();
    const emit = () => listeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } });

    const uid = () => (crypto.randomUUID
        ? crypto.randomUUID()
        : 'l_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));

    function applyData(d) {
        if (!d || typeof d !== 'object') return;
        if (Array.isArray(d.links)) state.links = d.links;
        if (Array.isArray(d.groups)) state.groups = d.groups;
        if (Array.isArray(d.blocklist)) state.blocklist = d.blocklist;
    }

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) applyData(JSON.parse(raw));
        } catch { /* ignore */ }
    }

    const serialize = () => JSON.stringify({ links: state.links, groups: state.groups, blocklist: state.blocklist });

    let cloudTimer = null;
    function save() {
        try { localStorage.setItem(KEY, serialize()); } catch { /* ignore */ }
        emit();
        // Автосинхронизация: без кнопки «Синхр.» — изменения сами уходят в аккаунт.
        clearTimeout(cloudTimer);
        cloudTimer = setTimeout(() => { saveToCloud().catch((e) => console.warn('[links] cloud', e)); }, CLOUD_DEBOUNCE_MS);
    }

    function normalizeUrl(raw) {
        try {
            let s = String(raw || '').trim();
            if (!s) return null;
            if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
            const url = new URL(s);
            if (!url.hostname.includes('.')) return null;
            url.hash = '';
            url.hostname = url.hostname.toLowerCase();
            url.pathname = url.pathname.replace(/\/+$/, '') || '/';
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid', 'igshid', 'si']
                .forEach((k) => url.searchParams.delete(k));
            return url.toString();
        } catch { return null; }
    }

    function domainOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    const isImageUrl = (url) => /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(url);

    function extractLinks(text) {
        if (!text) return [];
        const out = [];
        const seen = new Set();
        for (const m of text.match(/https?:\/\/[^\s<>"')\]]+/gi) || []) {
            const url = normalizeUrl(m.replace(/[.,;:!?]+$/, ''));
            if (!url || seen.has(url)) continue;
            seen.add(url);
            out.push({ url, domain: domainOf(url) });
        }
        return out;
    }

    function isBlocked(url) {
        const dom = domainOf(url);
        const normalized = normalizeUrl(url);
        return state.blocklist.some((b) => {
            if (b.type === 'domain') return dom === b.value || dom.endsWith('.' + b.value);
            if (b.type === 'url') return normalized === b.value;
            return false;
        });
    }

    const findByUrl = (n) => state.links.find((l) => normalizeUrl(l.url) === n);

    /* --- Ссылки --- */
    function addLink(url, extra = {}) {
        const n = normalizeUrl(url);
        if (!n) return null;
        const existing = findByUrl(n);
        if (existing) {
            if (extra.title) existing.title = extra.title;
            if (extra.group !== undefined) existing.group = extra.group;
            existing.createdAt = Date.now(); // поднимаем наверх списка
            save();
            return existing;
        }
        const link = {
            id: uid(), url: n, domain: domainOf(n),
            title: String(extra.title || '').trim(),
            group: extra.group || '', createdAt: Date.now(),
        };
        state.links.push(link);
        save();
        return link;
    }

    function updateLink(id, patch) {
        const l = state.links.find((x) => x.id === id);
        if (!l) return;
        Object.assign(l, patch);
        save();
    }

    function removeLink(id) {
        const l = state.links.find((x) => x.id === id);
        state.links = state.links.filter((x) => x.id !== id);
        save();
        return l || null;
    }

    function restoreLink(link) {
        if (!link || state.links.some((x) => x.id === link.id)) return;
        state.links.push(link);
        save();
    }

    /* --- Автосбор из записей --- */
    const isAutoCollect = () => { try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; } };
    const setAutoCollect = (v) => { try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* ignore */ } emit(); };

    function ingest(text) {
        if (!text || !isAutoCollect()) return 0;
        let added = 0;
        for (const found of extractLinks(text)) {
            if (isBlocked(found.url) || isImageUrl(found.url)) continue;
            if (findByUrl(found.url)) continue;
            state.links.push({ id: uid(), url: found.url, domain: found.domain, title: '', group: '', createdAt: Date.now() });
            added++;
        }
        if (added) save();
        return added;
    }

    const ingestFromItem = (item) => (item ? ingest((item.body || '') + '\n' + (item.title || '')) : 0);

    /* --- Блок-лист («не собирать с домена») --- */
    function addBlock(entry) {
        entry = String(entry || '').trim();
        if (!entry) return null;
        let type, value;
        if (/^https?:\/\//i.test(entry)) { type = 'url'; value = normalizeUrl(entry); }
        else { type = 'domain'; value = entry.replace(/^www\./, '').toLowerCase().replace(/\/.*$/, ''); }
        if (!value) return null;
        if (state.blocklist.some((b) => b.type === type && b.value === value)) return null;
        state.blocklist.push({ type, value });
        save();
        return { type, value };
    }

    function removeBlock(value) {
        state.blocklist = state.blocklist.filter((b) => b.value !== value);
        save();
    }

    /* --- Группы --- */
    function addGroup(name) {
        name = String(name || '').trim();
        if (!name) return null;
        const same = state.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
        if (same) return same;
        const g = { id: uid(), name };
        state.groups.push(g);
        save();
        return g;
    }

    function renameGroup(id, name) {
        name = String(name || '').trim();
        const g = state.groups.find((x) => x.id === id);
        if (!name || !g) return false;
        g.name = name;
        save();
        return true;
    }

    function removeGroup(id) {
        state.groups = state.groups.filter((g) => g.id !== id);
        state.links.forEach((l) => { if (l.group === id) l.group = ''; });
        save();
    }

    /* --- Синхронизация с аккаунтом --- */
    async function loadFromCloud() {
        if (!window.Auth || !window.Auth.isSignedIn() || !window.Auth.client) return false;
        try {
            const { data, error } = await window.Auth.client
                .from('items')
                .select('body')
                .eq('id', CLOUD_RECORD_ID)
                .eq('user_id', window.Auth.user.id)
                .maybeSingle();
            if (error || !data || !data.body) {
                // В облаке ещё пусто — отправим туда локальную коллекцию.
                if (!error && state.links.length) saveToCloud().catch(() => {});
                return false;
            }
            applyData(JSON.parse(data.body));
            try { localStorage.setItem(KEY, serialize()); } catch { /* ignore */ }
            emit();
            return true;
        } catch (e) {
            console.warn('[links] не удалось загрузить ссылки из аккаунта', e);
            return false;
        }
    }

    async function saveToCloud() {
        if (!window.Auth || !window.Auth.isSignedIn() || !window.Auth.client) return;
        const now = new Date().toISOString();
        const row = {
            id: CLOUD_RECORD_ID,
            user_id: window.Auth.user.id,
            type: 'note',
            title: '__links__',
            body: serialize(),
            category: '', tags: [], references_ids: [], importance: 'green',
            deadline: null, done: false, deleted: false, deleted_at: null, draft: false,
            font: 'sans', created_at: now, updated_at: now,
        };
        const { error } = await window.Auth.client.from('items').upsert(row, { onConflict: 'id' });
        if (error) throw error;
    }

    load();

    window.Links = {
        get links() { return state.links.slice(); },
        get groups() { return state.groups.slice(); },
        get blocklist() { return state.blocklist.slice(); },
        addLink, updateLink, removeLink, restoreLink,
        addGroup, renameGroup, removeGroup,
        addBlock, removeBlock,
        ingest, ingestFromItem, isAutoCollect, setAutoCollect,
        normalizeUrl, domainOf, isImageUrl, extractLinks,
        loadFromCloud, saveToCloud,
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    };
})();
