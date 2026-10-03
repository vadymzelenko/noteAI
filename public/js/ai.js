// NodeFlow — обёртка над ИИ-провайдерами.
// Значения по умолчанию берутся из /config.js (переменные .env),
// пользователь может переопределить их в UI — сохраняются в localStorage
// и, если пользователь вошёл в аккаунт, дополнительно синхронизируются
// в Supabase (служебная запись в таблице items — БЕЗ миграции БД: это
// обычная строка в уже существующей таблице items, просто с фиксированным
// служебным id, которая не попадает в обычные списки/фильтры/метрики —
// app.js вылавливает и убирает её из state.items сразу при загрузке),
// чтобы не вводить провайдера/модель/ключ заново на каждом устройстве.
(function () {
    'use strict';

    const KEY = 'ai.config';
    // Фиксированный id служебной записи-контейнера для настроек ИИ.
    // Она хранится в той же таблице items (без миграций БД), но помечена
    // самим id и никогда не участвует в обычных списках/фильтрах/метриках —
    // app.js вылавливает и убирает её из state.items сразу при загрузке.
    const CLOUD_RECORD_ID = '__ai_settings__';

    const config = {
        baseUrl: '',   // OpenAI-совместимый endpoint, напр. https://openrouter.ai/api/v1
        model: '',
        apiKey: '',    // необязателен для локальных серверов без авторизации
        enabled: false,
    };

    function load() {
        // 1. Дефолты из серверного конфига (.env)
        const env = window.NF_CONFIG || {};
        if (env.AI_DEFAULT_MODEL)    config.model    = env.AI_DEFAULT_MODEL;
        if (env.AI_DEFAULT_BASE_URL) config.baseUrl  = env.AI_DEFAULT_BASE_URL;
        if (env.AI_DEFAULT_API_KEY)  config.apiKey   = env.AI_DEFAULT_API_KEY;

        // 2. Перекрываем пользовательскими настройками, сохранёнными локально
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) Object.assign(config, JSON.parse(raw));
        } catch { /* ignore */ }

        config.enabled = !!(config.baseUrl && config.model);
    }

    function save() {
        config.enabled = !!(config.baseUrl && config.model);
        localStorage.setItem(KEY, JSON.stringify(config));
        return { ...config };
    }

    // Читает конфиг ИИ, сохранённый в аккаунте (Supabase), если пользователь
    // вошёл. По явному запросу пользователя ключ теперь тоже сохраняется
    // в этой записи (см. saveToCloud) — это позволяет не вводить его заново
    // на каждом устройстве, но означает, что ключ хранится в БД в теле
    // служебной записи (не в открытом виде на экране, но и не зашифрован
    // отдельным секретом) — при компрометации Supabase-проекта он утечёт
    // вместе с обычными данными, как и любое другое поле в таблице items.
    async function loadFromCloud() {
        if (!window.Auth || !window.Auth.isSignedIn() || !window.DB) return false;
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
            const cloudConfig = JSON.parse(data.body);
            Object.assign(config, cloudConfig);
            config.enabled = !!(config.baseUrl && config.model);
            localStorage.setItem(KEY, JSON.stringify(config));
            return true;
        } catch (e) {
            console.warn('[ai] не удалось загрузить настройки из аккаунта', e);
            return false;
        }
    }

    // Сохраняет конфиг (провайдер/модель/baseUrl/ключ) в аккаунт пользователя,
    // чтобы не настраивать ИИ заново на каждом устройстве. Хранится в той же
    // таблице items, что и обычные записи (служебная строка с фиксированным
    // id) — БЕЗ миграции БД: никаких новых таблиц или колонок не требуется,
    // используется уже существующая колонка body (JSON-строка).
    async function saveToCloud() {
        if (!window.Auth || !window.Auth.isSignedIn()) throw new Error('Нужно войти в аккаунт');
        const sb = window.Auth.client;
        const userId = window.Auth.user.id;
        const now = new Date().toISOString();
        const row = {
            id: CLOUD_RECORD_ID,
            user_id: userId,
            type: 'note',
            title: '__ai_settings__',
            body: JSON.stringify(config),
            category: '',
            tags: [],
            references_ids: [],
            importance: 'green',
            deadline: null,
            done: false,
            deleted: false,
            deleted_at: null,
            font: 'sans',
            created_at: now,
            updated_at: now,
        };
        const { error } = await sb.from('items').upsert(row, { onConflict: 'id' });
        if (error) throw error;
    }

    // Удаляет сохранённый в аккаунте ключ (например, при явном сбросе).
    async function clearCloud() {
        if (!window.Auth || !window.Auth.isSignedIn()) return;
        const sb = window.Auth.client;
        const userId = window.Auth.user.id;
        await sb.from('items').delete().eq('id', CLOUD_RECORD_ID).eq('user_id', userId);
    }

    function endpoint() {
        let base = (config.baseUrl || '').replace(/\/+$/, '');
        // Если пользователь вставил полный endpoint до /chat/completions — не дублируем.
        if (/\/chat\/completions$/.test(base)) base = base.replace(/\/chat\/completions$/, '');
        return base;
    }

    // Универсальный OpenAI-совместимый вызов (OpenRouter, OpenAI, Groq, локальные
    // серверы вроде Ollama/LM Studio). Возвращает строку-ответ. Для настройки
    // достаточно baseUrl + model, apiKey — если провайдер его требует.
    async function complete(prompt, opts = {}) {
        if (!config.enabled) throw new Error('ИИ не подключён — укажи base_url и модель');

        const base = endpoint();
        const model  = opts.model || config.model;
        const system = opts.system || 'Ты — ассистент NodeFlow. Отвечай кратко и по делу.';

        const res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user',   content: prompt },
                ],
                max_tokens: opts.maxTokens || 512,
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                ...(opts.stream ? { stream: true } : {}),
            }),
            ...(opts.signal ? { signal: opts.signal } : {}),
        });

        if (!res.ok) {
            let detail = '';
            try { const j = await res.json(); detail = j?.error?.message || j?.message || ''; } catch {}
            throw new Error(detail || ('AI HTTP ' + res.status));
        }

        if (opts.stream) {
            // Стрим по SSE: собираем delta.content из чанков. Используется редко,
            // но оставлено для совместимости, если вызывающий захочет прогресс.
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let out = '', buf = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const parts = buf.split('\n');
                buf = parts.pop();
                for (const line of parts) {
                    const s = line.trim();
                    if (!s.startsWith('data:')) continue;
                    const payload = s.slice(5).trim();
                    if (payload === '[DONE]') continue;
                    try {
                        const j = JSON.parse(payload);
                        const delta = j.choices?.[0]?.delta?.content;
                        if (delta) out += delta;
                    } catch { /* ignore */ }
                }
            }
            return out;
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    /* --- Точки расширения --- */

    async function suggestTags(text) {
        if (!config.enabled) return [];
        const out = await complete(
            `Предложи до 5 коротких тегов для записи (через запятую, без #):\n\n${text}`,
            { maxTokens: 60 }
        );
        return out.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
    }

    async function summarize(text) {
        if (!config.enabled) return '';
        return complete(`Сделай краткое резюме (1–2 предложения):\n\n${text}`, { maxTokens: 120 });
    }

    async function parseTask(text) {
        if (!config.enabled) return null;
        const raw = await complete(
            `Разбери текст в JSON с полями title, description, importance (red|yellow|green), deadline_hint. Только JSON без пояснений.\n\n${text}`,
            { maxTokens: 200 }
        );
        try { return JSON.parse(raw); } catch { return null; }
    }

    async function suggestDeadline(text) {
        if (!config.enabled) return null;
        return complete(
            `Оцени дедлайн в ISO-8601 (UTC) для задачи: "${text}". Ответь только датой.`,
            { maxTokens: 40 }
        );
    }

    async function test() {
        if (!config.enabled) throw new Error('ИИ не настроен');
        const out = await complete('Ответь одним словом: ok', { maxTokens: 10 });
        return out.trim();
    }

    /* --- Редактирование текста записи --- */

    const QUICK_ACTION_PROMPTS = {
        rewrite: 'Перефразируй этот текст качественнее — сохрани смысл, но сделай формулировки более чёткими и живыми. Сохрани markdown-разметку (заголовки, списки, код, таблицы), если она есть.',
        grammar: 'Исправь орфографию, пунктуацию и грамматику в этом тексте, не меняя смысл и стиль. Сохрани markdown-разметку.',
        expand: 'Дополни и разверни этот текст: добавь недостающие детали, структуру, но не выдумывай факты, которых точно не может быть — если не хватает конкретики, оставь общие формулировки. Сохрани markdown-разметку.',
        shorten: 'Сократи этот текст, оставив только самую суть. Сохрани markdown-разметку, если она есть.',
        title: 'Придумай короткий, ёмкий заголовок (до 6 слов) для этой записи. Ответь только заголовком, без кавычек и пояснений.',
    };

    // Правит/дополняет текст записи (title+body). Возвращает { title?, body }.
    async function editText({ action, customPrompt, title, body }) {
        if (!config.enabled) throw new Error('ИИ не подключён');

        if (action === 'title') {
            const newTitle = await complete(
                `${QUICK_ACTION_PROMPTS.title}\n\nТекущий заголовок: ${title || '(нет)'}\nТекст записи:\n${body || '(пусто)'}`,
                { maxTokens: 30, system: 'Ты помогаешь пользователю вести задачи и заметки в приложении NodeFlow. Отвечай только результатом, без вступлений и пояснений.' }
            );
            return { title: newTitle.trim().replace(/^["'«]|["'»]$/g, '') };
        }

        const instruction = action === 'custom'
            ? customPrompt
            : (QUICK_ACTION_PROMPTS[action] || customPrompt);
        if (!instruction) throw new Error('Не указано действие');

        const system = 'Ты помогаешь пользователю писать качественные задачи и заметки в приложении NodeFlow. ' +
            'Тебе дают текущий текст записи и инструкцию. Верни ТОЛЬКО итоговый текст записи целиком (это заменит текущий текст), ' +
            'без вступлений, пояснений, кавычек вокруг всего ответа и фраз вроде "Вот исправленный текст". ' +
            'Сохраняй markdown-разметку записи (заголовки #, списки, **жирный**, *курсив*, `код`, блоки ```, таблицы |a|b|), если она есть в исходном тексте.';

        const prompt = `Инструкция: ${instruction}\n\nТекущий текст записи${title ? ` (заголовок: "${title}")` : ''}:\n${body || '(пусто)'}`;

        const out = await complete(prompt, { maxTokens: 1200, system });
        return { body: out.trim() };
    }

    /* --- Создание записи из свободного текста --- */

    // Разбирает произвольную фразу пользователя в готовую запись.
    // Возвращает { type, title, body, importance, deadline (ms|null), category, tags }
    async function createFromText(text) {
        if (!config.enabled) throw new Error('ИИ не подключён');

        const now = new Date();
        const nowIso = now.toISOString();

        const system = 'Ты помогаешь превращать короткие фразы пользователя в структурированную запись (задачу или заметку) ' +
            'в приложении NodeFlow. Отвечай СТРОГО валидным JSON без пояснений, без markdown-обрамления ```. ' +
            'Формат: {"type":"task"|"note","title":"строка","body":"строка (markdown, может быть пустой)",' +
            '"importance":"red"|"yellow"|"green" (только если type=task, иначе не включай поле),' +
            '"deadline":"ISO-8601 строка в UTC или null (только если type=task)",' +
            '"category":"строка или пустая","tags":["строка", "..."]}. ' +
            'Если во фразе явно просят "заметку" или "запиши" без действия — используй type=note. ' +
            'Если есть явное действие, срок или похоже на дело — type=task. ' +
            `Текущее время (UTC ISO): ${nowIso}. Считай относительные даты ("завтра", "в пятницу", "через час") от этого момента.`;

        const raw = await complete(text, { maxTokens: 400, system });
        let data;
        try {
            const cleaned = raw.trim().replace(/^```json\s*|^```\s*|```\s*$/g, '');
            data = JSON.parse(cleaned);
        } catch {
            throw new Error('Не удалось разобрать ответ ИИ');
        }

        return {
            type: data.type === 'note' ? 'note' : 'task',
            title: (data.title || '').trim() || text.trim().slice(0, 80),
            body: data.body || '',
            importance: ['red', 'yellow', 'green'].includes(data.importance) ? data.importance : 'green',
            deadline: data.deadline ? (new Date(data.deadline).getTime() || null) : null,
            category: (data.category || '').trim(),
            tags: Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 5) : [],
        };
    }


    /* --- Умная правка при СОЗДАНИИ записи ---
       Один запрос на запись, только при первом сохранении, только если
       включено в настройках. Исправляет орфографию/пунктуацию и заполняет
       ПУСТЫЕ поля (категория, теги, важность) — то, что пользователь уже
       указал сам, ИИ не трогает. Защита от лишних трат и порчи текста:
       пропуск коротких/очень длинных текстов, лимит запросов в час,
       таймаут, проверка, что ИИ не пересказал текст и не сломал код/ссылки. */

    const PREFS_KEY = 'nf.ai.prefs';
    const USAGE_KEY = 'nf.ai.usage';
    const MAX_CALLS_PER_HOUR = 20;
    const MIN_LETTERS = 12;
    const MAX_BODY = 5000;
    const prefs = { auto: true, grammar: true, meta: true };

    function loadPrefs() {
        try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* ignore */ }
    }
    function setPrefs(p) {
        Object.assign(prefs, p);
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        return { ...prefs };
    }
    function recentCalls() {
        const now = Date.now();
        let arr;
        try { arr = JSON.parse(localStorage.getItem(USAGE_KEY) || '[]'); } catch { arr = []; }
        return arr.filter((t) => now - t < 3600000);
    }
    const callsLeft = () => MAX_CALLS_PER_HOUR - recentCalls().length;
    function takeSlot() {
        const arr = recentCalls();
        if (arr.length >= MAX_CALLS_PER_HOUR) return false;
        arr.push(Date.now());
        localStorage.setItem(USAGE_KEY, JSON.stringify(arr));
        return true;
    }

    const urlsOf = (t) => (String(t).match(/https?:\/\/[^\s)]+/g) || []).sort().join('|');
    const fencesOf = (t) => (String(t).match(/```/g) || []).length;

    // Быстрая проверка без сети: стоит ли вообще трогать эту запись.
    function shouldPolish({ title = '', body = '' }) {
        if (!config.enabled || !prefs.auto || !(prefs.grammar || prefs.meta)) return false;
        const letters = ((title + body).match(/\p{L}/gu) || []).length;
        return letters >= MIN_LETTERS && body.length <= MAX_BODY && callsLeft() > 0;
    }

    async function polish({ type, title, body, category, tags, needImportance, categories = [] }) {
        if (!shouldPolish({ title, body })) return null;

        const wantGrammar = prefs.grammar;
        const wantCategory = prefs.meta && !category;
        const wantTags = prefs.meta && !(tags && tags.length);
        const wantImportance = prefs.meta && type === 'task' && !!needImportance;
        if (!wantGrammar && !wantCategory && !wantTags && !wantImportance) return null;
        if (!takeSlot()) return null;

        const fields = [];
        if (wantGrammar) fields.push('"title":"исправленный заголовок","body":"исправленный текст"');
        if (wantCategory) fields.push('"category":"категория: 1–2 слова"');
        if (wantTags) fields.push('"tags":["до 4 коротких тегов в нижнем регистре"]');
        if (wantImportance) fields.push('"importance":"red|yellow|green"');

        const rules = [];
        if (wantGrammar) rules.push(
            'Исправляй ТОЛЬКО орфографию, пунктуацию и грамматику. Не перефразируй, не сокращай, не дополняй, не меняй тон. ' +
            'Markdown-разметку, блоки кода, ссылки, числа, имена и эмодзи оставляй как есть. Если ошибок нет — верни текст без изменений.');
        if (wantCategory && categories.length) rules.push(
            'Для категории по возможности выбери одну из уже существующих: ' + categories.slice(0, 12).join(', ') + '. Новую придумывай, только если ничего не подходит.');
        if (wantImportance) rules.push(
            'importance: red — срочно или горят сроки, yellow — обычное дело, green — можно не спешить.');

        const system = 'Ты аккуратный редактор в приложении задач и заметок. ' +
            'Отвечай СТРОГО одним валидным JSON-объектом без пояснений и без ```. ' +
            'Формат: {' + fields.join(',') + '}. ' + rules.join(' ');

        // Если грамматика не нужна, для категории/тегов хватает начала текста.
        const text = wantGrammar ? body : body.slice(0, 1500);
        const prompt = 'Тип записи: ' + (type === 'task' ? 'задача' : 'заметка') +
            '\nЗаголовок: ' + (title || '(нет)') + '\nТекст:\n' + text;


        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 30000);
        let raw;
        try {
            raw = await complete(prompt, {
                system, signal: ctl.signal,
                maxTokens: Math.min(3000, Math.ceil(body.length / 2) + 1200),
            });
        } finally { clearTimeout(timer); }

        console.log('[ai] polish raw:', raw);

        let data;
        try {
            const cleaned = raw
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/```json|```/g, '');
            const m = cleaned.match(/\{[\s\S]*\}/);
            data = JSON.parse(m ? m[0] : cleaned);
        } catch {
            console.warn('[ai] polish: не JSON', raw);
            return null;
        }

        const out = {};
        if (wantGrammar) {
            if (typeof data.body === 'string' && data.body.trim() && data.body !== body) {
                const ratio = data.body.length / Math.max(1, body.length);
                const sane = (body.length < 40 || (ratio > 0.75 && ratio < 1.3))
                    && fencesOf(data.body) === fencesOf(body)
                    && urlsOf(data.body) === urlsOf(body);
                if (sane) out.body = data.body.trim();
            }
            if (typeof data.title === 'string' && title && data.title.trim() && data.title !== title) {
                const t = data.title.trim();
                if (t.length <= title.length * 1.3 + 5 && t.length >= title.length * 0.7 - 5) out.title = t;
            }
        }
        if (wantCategory && typeof data.category === 'string') {
            const c = data.category.trim().replace(/^["'«#]|["'»]$/g, '');
            if (c && c.length <= 30) out.category = c;
        }
        if (wantTags && Array.isArray(data.tags)) {
            const t = [...new Set(data.tags
                .map((x) => String(x).trim().replace(/^#/, '').toLowerCase())
                .filter((x) => x && x.length <= 24))].slice(0, 4);
            if (t.length) out.tags = t;
        }
        if (wantImportance && ['red', 'yellow', 'green'].includes(data.importance)) out.importance = data.importance;

        return Object.keys(out).length ? out : null;
    }

    loadPrefs();

    load();

    window.AI = {
        get config() { return { ...config }; },
        setConfig(partial) { Object.assign(config, partial); return save(); },
        save, load, complete,
        suggestTags, summarize, parseTask, suggestDeadline, test,
        editText, createFromText,
        get prefs() { return { ...prefs }; }, setPrefs, shouldPolish, polish, callsLeft,
        loadFromCloud, saveToCloud, clearCloud,
    };
})();