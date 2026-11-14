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
            draft: false,
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

    // Файлы проектов (category = '__nf_file') хранят содержимое в body
    // в виде data:-URL. Чтобы не тянуть мегабайты при каждом запуске, для них
    // загружаются только метаданные, а содержимое — по запросу (fileData).
    const FILE_CAT = '__nf_file';
    const META_COLS = 'id,user_id,type,title,category,tags,references_ids,importance,deadline,done,deleted,deleted_at,draft,font,created_at,updated_at';

    async function allItems() {
        const userId = currentUserId();
        const [main, files] = await Promise.all([
            client().from(TABLE).select('*').eq('user_id', userId)
                .or(`category.is.null,category.neq.${FILE_CAT}`)
                .order('updated_at', { ascending: false }),
            client().from(TABLE).select(META_COLS).eq('user_id', userId)
                .eq('category', FILE_CAT),
        ]);
        if (main.error) throw main.error;
        if (files.error) throw files.error;
        return (main.data || []).concat(files.data || []).map(fromRow);
    }

    async function fileData(id) {
        const { data, error } = await client()
            .from(TABLE).select('body').eq('id', id).eq('user_id', currentUserId()).single();
        if (error) throw error;
        return data ? data.body : '';
    }

    // Запись без возврата строки — для больших файлов, чтобы не гонять
    // содержимое туда-обратно.
    async function putItem(item) {
        const row = toRow(item, currentUserId());
        const { error } = await client().from(TABLE).upsert(row, { onConflict: 'id' });
        if (error) throw error;
    }

    async function deleteMany(ids) {
        if (!ids.length) return;
        const userId = currentUserId();
        for (let i = 0; i < ids.length; i += 100) {
            const { error } = await client().from(TABLE).delete().in('id', ids.slice(i, i + 100)).eq('user_id', userId);
            if (error) throw error;
        }
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

    window.DB = { allItems, upsertItem, putItem, fileData, deleteItem, deleteMany, purgeExpired };
})();