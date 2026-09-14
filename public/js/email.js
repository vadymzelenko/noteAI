// NodeFlow — email-напоминания о срочных задачах.
// Секретов тут нет и быть не может: клиент только просит СВОЙ сервер
// отправить письмо (см. /api/email/send в server.js), сервер уже сам
// уходит на Gmail SMTP учётными данными из .env. Здесь хранится только
// email-адрес получателя и флаг «включено» — оба в localStorage устройства.
(function () {
    'use strict';

    const EMAIL_KEY    = 'nf.email.recipient';
    const ENABLED_KEY   = 'nf.email.enabled';
    const NOTIFIED_KEY  = 'nf.email.notified'; // id задач, по которым уже отправляли

    const getRecipient = () => localStorage.getItem(EMAIL_KEY) || '';
    const setRecipient = (v) => localStorage.setItem(EMAIL_KEY, (v || '').trim());

    const isEnabled = () => localStorage.getItem(ENABLED_KEY) === '1' && !!getRecipient();
    const setEnabled = (v) => localStorage.setItem(ENABLED_KEY, v ? '1' : '0');

    function loadNotified() {
        try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); }
        catch { return new Set(); }
    }
    function markNotified(id) {
        const set = loadNotified();
        set.add(id);
        // Храним не больше 500 id, чтобы не разрастаться бесконечно.
        localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set].slice(-500)));
    }
    function wasNotified(id) { return loadNotified().has(id); }

    async function authToken() {
        if (!window.Auth || !window.Auth.client) return '';
        const { data } = await window.Auth.client.auth.getSession();
        return data?.session?.access_token || '';
    }

    // Отправляет одно письмо через серверный эндпоинт. Бросает исключение с
    // человекочитаемым текстом ошибки при неудаче (неверный адрес, сервер
    // не настроен, превышен лимит и т.п.) — вызывающий код сам решает,
    // как это показать пользователю.
    async function send(subject, body, to) {
        const recipient = (to || getRecipient()).trim();
        if (!recipient) throw new Error('Не указан email для напоминаний');
        if (!window.Auth || !window.Auth.isSignedIn()) throw new Error('Нужно войти в аккаунт');

        const token = await authToken();
        if (!token) throw new Error('Не удалось получить токен сессии — войди заново');

        const res = await fetch('/api/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ to: recipient, subject, body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Email HTTP ${res.status}`);
        return data;
    }

    async function testEmail() {
        return send('NodeFlow: тестовое уведомление', 'Это тестовое письмо от NodeFlow ✅. Если оно дошло — email-напоминания настроены верно.');
    }

    // Проходит по активным задачам, и для тех, что помечены красной важностью
    // и у которых дедлайн наступает в пределах `withinMs`, шлёт одно
    // напоминание (не больше одного на задачу — см. markNotified).
    // Рассчитано на периодический вызов (см. startDeadlineWatcher в app.js),
    // пока вкладка открыта — это НЕ push-уведомления и не работает в фоне,
    // когда сайт закрыт; для этого нужен отдельный бэкенд-планировщик.
    async function checkDeadlines(items, { withinMs = 60 * 60 * 1000 } = {}) {
        if (!isEnabled()) return;
        const now = Date.now();
        for (const it of items) {
            if (it.type !== 'task' || it.done || it.deleted || it.draft) continue;
            if (it.importance !== 'red' || !it.deadline) continue;
            const diff = it.deadline - now;
            if (diff <= 0 || diff > withinMs) continue;
            if (wasNotified(it.id)) continue;
            try {
                const mins = Math.max(1, Math.round(diff / 60000));
                await send(
                    `NodeFlow: «${it.title || 'Задача'}» — дедлайн через ${mins} мин.`,
                    `Задача «${it.title || 'без названия'}» подходит к дедлайну через ${mins} мин.`
                );
                markNotified(it.id);
            } catch (e) {
                console.warn('[email] не удалось отправить напоминание', e);
                // Не помечаем как notified — попробуем снова на следующей проверке.
            }
        }
    }

    window.Email = { getRecipient, setRecipient, isEnabled, setEnabled, send, testEmail, checkDeadlines };
})();
