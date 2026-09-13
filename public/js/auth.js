// NodeFlow — аутентификация через Supabase OAuth (Google).
// Никаких client id: браузер уходит на Google и возвращается на redirectTo,
// сессию подхватывает Supabase SDK.
(function () {
    'use strict';

    const listeners = new Set();
    let sb = null;
    let user = null;
    let readyResolve;
    const readyPromise = new Promise((r) => (readyResolve = r));

    const emit = () => listeners.forEach((cb) => cb(user));

    function init() {
        const cfg = window.NF_CONFIG || {};
        const { SUPABASE_URL, SUPABASE_ANON_KEY } = cfg;

        if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase?.createClient) {
            console.warn('[auth] Supabase не сконфигурирован. Проверь .env и /config.js');
            readyResolve(false);
            return;
        }

        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                flowType: 'pkce',
            },
        });

        sb.auth.onAuthStateChange((_event, session) => {
            user = session?.user || null;
            emit();
        });

        sb.auth
            .getSession()
            .then(({ data }) => {
                user = data?.session?.user || null;
                emit();
                readyResolve(true);
            })
            .catch((err) => {
                console.error('[auth] getSession', err);
                readyResolve(false);
            });
    }

    async function signInWithGoogle() {
        if (!sb) throw new Error('Supabase не настроен — проверь .env');
        const redirectTo = window.location.origin + window.location.pathname;
        const { error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo,
                queryParams: { access_type: 'offline', prompt: 'consent' },
            },
        });
        if (error) throw error;
        // Дальше браузер сам уйдёт на Google и вернётся на redirectTo.
    }

    async function signOut() {
        if (!sb) return;
        await sb.auth.signOut();
        user = null;
        emit();
    }

    window.Auth = {
        get client() { return sb; },
        get user() { return user; },
        get ready() { return readyPromise; },
        isConfigured: () => !!sb,
        isSignedIn:   () => !!user,
        signInWithGoogle,
        signOut,
        onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    };

    init();
})();