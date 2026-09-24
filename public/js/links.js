// NodeFlow — коллекция внешних ссылок (закладки).
// Ссылки автоматически собираются из текста заметок/задач при сохранении,
// хранятся в localStorage и, если пользователь вошёл, синхронизируются в
// Supabase (служебная запись в таблице items с фиксированным id __links__).
(function () {
    'use strict';

    const KEY = 'nf.links';
    const CLOUD_RECORD_ID = '__links__';

    const state = {
        links: [],      // { id, url, domain, title, tags[], group, createdAt }
        groups: [],     // { id, name }
        blocklist: [],  // { type: 'domain'|'url', value }
    };

    const uid = () => (crypto.randomUUID
        ? crypto.randomUUID()
        : 'l_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8));

    function load() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) {
                const d = JSON.parse(raw);
                if (Array.isArray(d.links)) state.links = d.links;
                if (Array.isArray(d.groups)) state.groups = d.groups;
                if (Array.isArray(d.blocklist)) state.blocklist = d.blocklist;
            }
        } catch { /* ignore */ }
    }

    function save() {
        try {
            localStorage.setItem(KEY, JSON.stringify({
                links: state.links, groups: state.groups, blocklist: state.blocklist,
            }));
        } catch { /* ignore */ }
    }

    function normalizeUrl(raw) {
        try {
            let s = String(raw || '').trim();
            if (!s) return null;
            if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
            const url = new URL(s);
            url.hash = '';
            url.hostname = url.hostname.toLowerCase();
            let p = url.pathname.replace(/\/+$/, '');
            url.pathname = p || '/';
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid', 'igshid'].forEach((k) => url.searchParams.delete(k));
            return url.toString();
        } catch { return null; }
    }

    function domainOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
    }

    function isImageUrl(url) {
        return /^data:image\//i.test(url) || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(\?.*)?$/i.test(url);
    }

    function extractLinks(text) {
        if (!text) return [];
        const re = /https?:\/\/[^\s<>"')\]]+/gi;
        const out = [];
        const seen = new Set();
        for (const m of text.match(re) || []) {
            const cleaned = m.replace(/[.,;:!?]+$/, '');
            const url = normalizeUrl(cleaned);
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
            if (b.type === 'url') return normalized === normalizeUrl(b.value) || url === b.value;
            return false;
        });
    }

    function addBlock(entry) {
        entry = String(entry || '').trim();
        if (!entry) return null;
        let type, value;
        if (/^https?:\/\//i.test(entry)) {
            type = 'url';
            value = normalizeUrl(entry);
        } else {
            type = 'domain';
            value = entry.replace(/^www\./, '').toLowerCase().replace(/\/+$/, '');
        }
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

    function addLink(url, extra = {}) {
        const n = normalizeUrl(url);
        if (!n) return null;
        const existing = state.links.find((l) => normalizeUrl(l.url) === n);
        if (existing) {
            if (extra.title) existing.title = extra.title;
            if (extra.group !== undefined) existing.group = extra.group;
            if (Array.isArray(extra.tags)) existing.tags = extra.tags;
            save();
            return existing;
        }
        const link = {
            id: uid(), url: n, domain: domainOf(n),
            title: (extra.title || '').trim(),
            tags: Array.isArray(extra.tags) ? extra.tags.filter(Boolean) : [],
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
        state.links = state.links.filter((x) => x.id !== id);
        save();
    }

    // Автосбор ссылок из текста записи: изображения и заблокированные ссылки
    // пропускаются, повторы не добавляются.
    function ingest(text) {
        if (!text) return 0;
        let added = 0;
        for (const found of extractLinks(text)) {
            if (isBlocked(found.url) || isImageUrl(found.url)) continue;
            if (state.links.some((l) => normalizeUrl(l.url) === found.url)) continue;
            state.links.push({
                id: uid(), url: found.url, domain: found.domain,
                title: '', tags: [], group: '', createdAt: Date.now(),
            });
            added++;
        }
        if (added) save();
        return added;
    }

    function ingestFromItem(item) {
        if (!item) return 0;
        return ingest((item.body || '') + '\n' + (item.title || ''));
    }

    /* --- Группы --- */
    function addGroup(name) {
        name = String(name || '').trim();
        if (!name) return null;
        if (state.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return null;
        const g = { id: uid(), name };
        state.groups.push(g);
        save();
        return g;
    }

    function renameGroup(id, name) {
        name = String(name || '').trim();
        if (!name) return false;
        const g = state.groups.find((x) => x.id === id);
        if (!g) return false;
        g.name = name;
        save();
        return true;
    }

    function removeGroup(id) {
        state.groups = state.groups.filter((g) => g.id !== id);
        state.links.forEach((l) => { if (l.group === id) l.group = ''; });
        save();
    }

    function allTags() {
        const set = new Set();
        state.links.forEach((l) => (l.tags || []).forEach((t) => t && set.add(t)));
        return [...set].sort();
    }

    function allDomains() {
        const set = new Set();
        state.links.forEach((l) => l.domain && set.add(l.domain));
        return [...set].sort();
    }

    /* --- Синхронизация в аккаунт --- */
    async function loadFromCloud() {
        if (!window.Auth || !window.Auth.isSignedIn() || !window.Auth.client) return false;
        try {
            const sb = window.Auth.client;
            const userId = window.Auth.user.id;
            const { data, error } = await sb
                .from('items')
                .select('body')
                .eq('id', CLOUD_RECORD_ID)
                .eq('user_id', userId)
                .maybeSingle();
            if (error || !data || !data.body) return false;
            const d = JSON.parse(data.body);
            if (Array.isArray(d.links)) state.links = d.links;
            if (Array.isArray(d.groups)) state.groups = d.groups;
            if (Array.isArray(d.blocklist)) state.blocklist = d.blocklist;
            save();
            return true;
        } catch (e) {
            console.warn('[links] не удалось загрузить ссылки из аккаунта', e);
            return false;
        }
    }

    async function saveToCloud() {
        if (!window.Auth || !window.Auth.isSignedIn()) throw new Error('Нужно войти в аккаунт');
        const sb = window.Auth.client;
        const userId = window.Auth.user.id;
        const now = new Date().toISOString();
        const row = {
            id: CLOUD_RECORD_ID,
            user_id: userId,
            type: 'note',
            title: '__links__',
            body: JSON.stringify({ links: state.links, groups: state.groups, blocklist: state.blocklist }),
            category: '', tags: [], references_ids: [], importance: 'green',
            deadline: null, done: false, deleted: false, deleted_at: null,
            font: 'sans', created_at: now, updated_at: now,
        };
        const { error } = await sb.from('items').upsert(row, { onConflict: 'id' });
        if (error) throw error;
    }

    load();

    window.Links = {
        get links() { return state.links.slice(); },
        get groups() { return state.groups.slice(); },
        get blocklist() { return state.blocklist.slice(); },
        addLink, updateLink, removeLink,
        addGroup, renameGroup, removeGroup,
        addBlock, removeBlock,
        ingest, ingestFromItem,
        allTags, allDomains,
        domainOf, isImageUrl, extractLinks,
        loadFromCloud, saveToCloud,
        save,
    };
})();
