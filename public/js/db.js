// NodeFlow — слой данных поверх таблицы public.items в Supabase.
// Каждый запрос выполняется от имени вошедшего пользователя (через Auth.client),
// доступ к чужим записям исключён политиками RLS на стороне базы —
// клиент не должен на это полагаться, но и обходить эту защиту тут нечем.
(function () {
    'use strict';

    const TRASH_TTL_MS = 14 * 24 * 60 * 60 * 1000;
    const TABLE = 'items';

    function client() {
        const sb = window.Auth && window.Auth.client;
        if (!sb) throw new Error('Supabase не настроен');
        return sb;
    }

    function currentUserId() {
        const u = window.Auth && window.Auth.user;
        if (!u) throw new Error('Не авторизован');
        return u.id;
    }

    const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);
    const toMs  = (iso) => (iso ? new Date(iso).getTime() : null);

    // camelCase (клиент) → snake_case (таблица items)
    function toRow(item, userId) {
        return {
            id: item.id,
            user_id: userId,
            type: item.type === 'note' ? 'note' : 'task',
            title: item.title || '',
            body: item.body || '',
            category: item.category || '',
            tags: Array.isArray(item.tags) ? item.tags : [],
            references_ids: Array.isArray(item.references) ? item.references : [],
            importance: item.importance || 'green',
            deadline: toIso(item.deadline),
            done: !!item.done,
            deleted: !!item.deleted,
            deleted_at: toIso(item.deletedAt),
            draft: !!item.draft,
            font: item.font === 'mono' ? 'mono' : 'sans',
            created_at: toIso(item.createdAt) || new Date().toISOString(),
            updated_at: toIso(item.updatedAt) || new Date().toISOString(),
        };
    }

    // snake_case (таблица items) → camelCase (клиент)
    function fromRow(row) {
        const item = {
            id: row.id,
            type: row.type,
            title: row.title || '',
            body: row.body || '',
            category: row.category || '',
            tags: row.tags || [],
            references: row.references_ids || [],
            done: !!row.done,
            deleted: !!row.deleted,
            draft: !!row.draft,
            font: row.font === 'mono' ? 'mono' : 'sans',
            createdAt: toMs(row.created_at),
            updatedAt: toMs(row.updated_at),
        };
        if (row.type === 'task') {
            item.importance = row.importance || 'green';
            item.deadline = toMs(row.deadline);
        }
        if (row.deleted_at) item.deletedAt = toMs(row.deleted_at);
        return item;
    }

    async function allItems() {
        const userId = currentUserId();
        const { data, error } = await client()
            .from(TABLE)
            .select('*')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });
        if (error) throw error;
        return (data || []).map(fromRow);
    }

    async function upsertItem(item) {
        const userId = currentUserId();
        const row = toRow(item, userId);
        const { data, error } = await client()
            .from(TABLE)
            .upsert(row, { onConflict: 'id' })
            .select()
            .single();
        if (error) throw error;
        return fromRow(data);
    }

    async function deleteItem(id) {
        const userId = currentUserId();
        const { error } = await client()
            .from(TABLE)
            .delete()
            .eq('id', id)
            .eq('user_id', userId);
        if (error) throw error;
    }

    async function purgeExpired() {
        const userId = currentUserId();
        const cutoff = new Date(Date.now() - TRASH_TTL_MS).toISOString();
        const { error } = await client()
            .from(TABLE)
            .delete()
            .eq('user_id', userId)
            .eq('deleted', true)
            .lt('deleted_at', cutoff);
        if (error) throw error;
    }

    // Черновики (draft=true, ни разу не сохранённые явно кнопкой «Сохранить»)
    // живут те же 14 дней, но с момента СОЗДАНИЯ, а не удаления — у них нет
    // отдельной deleted_at-метки.
    async function purgeExpiredDrafts() {
        const userId = currentUserId();
        const cutoff = new Date(Date.now() - TRASH_TTL_MS).toISOString();
        const { error } = await client()
            .from(TABLE)
            .delete()
            .eq('user_id', userId)
            .eq('draft', true)
            .lt('created_at', cutoff);
        if (error) throw error;
    }

    window.DB = { allItems, upsertItem, deleteItem, purgeExpired, purgeExpiredDrafts };
})();