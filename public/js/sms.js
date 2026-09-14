// NodeFlow — SMS-напоминания о срочных задачах.
// Ключей Twilio тут нет и быть не может: клиент только просит СВОЙ сервер
// отправить сообщение (см. /api/sms/send в server.js), сервер уже сам
// дёргает Twilio секретным ключом из .env. Здесь хранится только номер
// телефона пользователя и флаг «включено» — оба в localStorage устройства.
(function () {
    'use strict';

    const PHONE_KEY    = 'nf.sms.phone';
    const ENABLED_KEY  = 'nf.sms.enabled';
    const NOTIFIED_KEY = 'nf.sms.notified'; // id задач, по которым уже отправляли

    const getPhone = () => localStorage.getItem(PHONE_KEY) || '';
    const setPhone = (v) => localStorage.setItem(PHONE_KEY, (v || '').trim());

    const isEnabled = () => localStorage.getItem(ENABLED_KEY) === '1' && !!getPhone();
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

    // Отправляет одно SMS через серверный эндпоинт. Бросает исключение с
    // человекочитаемым текстом ошибки при неудаче (неверный номер, сервер
    // не настроен, превышен лимит и т.п.) — вызывающий код сам решает,
    // как это показать пользователю.
    async function send(body, phone) {
        const to = (phone || getPhone()).trim();
        if (!to) throw new Error('Не указан номер телефона');
        if (!window.Auth || !window.Auth.isSignedIn()) throw new Error('Нужно войти в аккаунт');

        const token = await authToken();
        if (!token) throw new Error('Не удалось получить токен сессии — войди заново');

        const res = await fetch('/api/sms/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ to, body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `SMS HTTP ${res.status}`);
        return data;
    }

    async function testSms() {
        return send('NodeFlow: тестовое SMS-уведомление ✅');
    }

    // Проходит по активным задачам, и для тех, что помечены красной важностью
    // и у которых дедлайн наступает в пределах `withinMs`, шлёт одно
    // напоминание (не больше одного на задачу — см. markNotified).
    // Рассчитано на периодический вызов (см. bindDeadlineWatcher в app.js),
    // пока вкладка открыта — это НЕ push-уведомления и не работает в фоне,
    // когда сайт закрыт; для этого нужен отдельный бэкенд-планировщик.
    async function checkDeadlines(items, { withinMs = 60 * 60 * 1000 } = {}) {
        if (!isEnabled()) return;
        const now = Date.now();
        for (const it of items) {
            if (it.type !== 'task' || it.done || it.deleted) continue;
            if (it.importance !== 'red' || !it.deadline) continue;
            const diff = it.deadline - now;
            if (diff <= 0 || diff > withinMs) continue;
            if (wasNotified(it.id)) continue;
            try {
                const mins = Math.max(1, Math.round(diff / 60000));
                await send(`NodeFlow: «${it.title || 'Задача'}» — дедлайн через ${mins} мин.`);
                markNotified(it.id);
            } catch (e) {
                console.warn('[sms] не удалось отправить напоминание', e);
                // Не помечаем как notified — попробуем снова на следующей проверке.
            }
        }
    }

    window.SMS = { getPhone, setPhone, isEnabled, setEnabled, send, testSms, checkDeadlines };
})();
