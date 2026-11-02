// Old database mappings predate authenticated webhooks. Verify the recipient
// against Max before sending a customer's support message to an old mapping.
async function verifiedManagerMap(rows, allowedIds, lookupChat, cache = new Map()) {
    const result = {};
    for (const [key,until] of cache) if (until <= Date.now()) cache.delete(key);
    for (const row of rows) {
        const userId = Number(row.user_id);
        if (!allowedIds.includes(userId)) continue;
        const key = userId + ':' + row.chat_id;
        if ((cache.get(key) || 0) > Date.now()) { result[row.user_id] = row.chat_id; continue; }
        try {
            const chat = await lookupChat(String(row.chat_id));
            if (chat.type === 'dialog' && Number(chat.dialog_with_user?.user_id) === userId) {
                cache.set(key, Date.now() + 10 * 60 * 1000);
                result[row.user_id] = row.chat_id;
            } else console.error('[support] manager_mapping_unverified');
        } catch { console.error('[support] manager_mapping_check_failed'); }
    }
    return result;
}
module.exports = { verifiedManagerMap };
