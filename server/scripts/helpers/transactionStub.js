// Adapter for the pre-existing route test fixtures. Separate hardening tests
// verify actual transaction rollback, concurrency and outbox retry behavior.
module.exports = function transactionStub(db, onJob = () => {}) {
    db.inTransaction = async fn => fn({ query: async (sql, params = []) => {
        const s = sql.replace(/\s+/g,' ').trim();
        if (s.startsWith('SELECT pg_advisory_xact_lock')) return { rows:[] };
        if (s.startsWith('SELECT COUNT(*)::int AS c FROM orders')) return { rows:[{c:0}] };
        if (s.startsWith('SELECT id,city,address FROM stores')) {
            const label=String(params[0]),split=label.indexOf(', ');
            return {rows:[{id:1,city:split>=0?label.slice(0,split):label,address:split>=0?label.slice(split+2):'Тестовая, 1'}]};
        }
        if (s.startsWith('INSERT INTO notification_outbox')) { await onJob(params); return { rows:[] }; }
        if (s.startsWith('SELECT ') || /^INSERT INTO (orders|service_requests)\s/.test(s)) {
            const row = await db.queryOne(sql,params);
            return { rows: row ? [row] : [] };
        }
        await db.execute(sql,params); return { rows:[] };
    }});
};
