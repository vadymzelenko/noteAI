// NodeFlow — обёртка над ИИ-провайдерами.
// Значения по умолчанию берутся из /config.js (переменные .env),
// пользователь может переопределить их в UI — они сохраняются в localStorage.
(function () {
    'use strict';

    const KEY = 'ai.config';

    const config = {
        provider: '',   // 'openai' | 'anthropic' | 'local' | ''
        apiKey: '',
        baseUrl: '',
        model: '',
        enabled: false,
    };

    function load() {
        // 1. Дефолты из серверного конфига (.env)
        const env = window.NF_CONFIG || {};
        if (env.AI_DEFAULT_PROVIDER) config.provider = env.AI_DEFAULT_PROVIDER;
        if (env.AI_DEFAULT_MODEL)    config.model    = env.AI_DEFAULT_MODEL;
        if (env.AI_DEFAULT_BASE_URL) config.baseUrl  = env.AI_DEFAULT_BASE_URL;

        // 2. Перекрываем пользовательскими настройками
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) Object.assign(config, JSON.parse(raw));
        } catch { /* ignore */ }

        config.enabled = !!config.provider && (!!config.apiKey || config.provider === 'local');
    }

    function save() {
        config.enabled = !!config.provider && (!!config.apiKey || config.provider === 'local');
        localStorage.setItem(KEY, JSON.stringify(config));
        return { ...config };
    }

    function providerEndpoint() {
        if (config.baseUrl) return config.baseUrl.replace(/\/$/, '');
        if (config.provider === 'openai')    return 'https://api.openai.com/v1';
        if (config.provider === 'anthropic') return 'https://api.anthropic.com/v1';
        if (config.provider === 'groq')      return 'https://api.groq.com/openai/v1';
        if (config.provider === 'local')     return 'http://localhost:11434/v1';
        return '';
    }

    // Универсальный вызов. Возвращает строку-ответ.
    async function complete(prompt, opts = {}) {
        if (!config.enabled) throw new Error('ИИ не подключён');

        const endpoint = providerEndpoint();
        const model    = opts.model || config.model || 'gpt-4o-mini';
        const system   = opts.system || 'Ты — ассистент NodeFlow. Отвечай кратко и по делу.';

        if (config.provider === 'anthropic') {
            const res = await fetch(`${endpoint}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model,
                    max_tokens: opts.maxTokens || 512,
                    system,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!res.ok) throw new Error('AI HTTP ' + res.status);
            const data = await res.json();
            return data.content?.[0]?.text || '';
        }

        // OpenAI-совместимый (openai / local / кастомный baseUrl)
        const res = await fetch(`${endpoint}/chat/completions`, {
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
            }),
        });
        if (!res.ok) throw new Error('AI HTTP ' + res.status);
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

    load();

    window.AI = {
        get config() { return { ...config }; },
        setConfig(partial) { Object.assign(config, partial); return save(); },
        save, load, complete,
        suggestTags, summarize, parseTask, suggestDeadline, test,
        editText, createFromText,
    };
})();