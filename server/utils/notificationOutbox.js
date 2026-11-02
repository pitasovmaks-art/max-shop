const db = require('../db');
const OUTBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (kind, entity_id)
);
CREATE INDEX IF NOT EXISTS notification_outbox_pending ON notification_outbox (available_at) WHERE delivered_at IS NULL;
`;
async function enqueue(client, kind, id) {
    await client.query('INSERT INTO notification_outbox (kind,entity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [kind, id]);
}
let running = false;
let workerTimer = null;
async function drain() {
    if (running) return;
    running = true;
    try {
        // One atomic claim supports restarts and more than one process. Expired
        // leases are retried; delivery is at least once, not exactly once.
        const jobs = await db.query(`UPDATE notification_outbox SET locked_until=NOW()+INTERVAL '5 minutes', attempts=attempts+1
            WHERE id IN (SELECT id FROM notification_outbox WHERE delivered_at IS NULL AND attempts < 12
                AND available_at <= NOW() AND (locked_until IS NULL OR locked_until < NOW())
                ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`);
        for (const job of jobs) {
            try {
                const bot = require('../../bot');
                if (!process.env.MAX_BOT_TOKEN) throw new Error('bot_not_configured');
                if (job.kind === 'order') {
                    const row = await db.queryOne('SELECT * FROM orders WHERE id=$1', [job.entity_id]);
                    if (row) await bot.notifyStore({ ...row, items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items, deliveryCarrier: row.delivery_carrier, total: Number(row.total) });
                } else if (job.kind === 'service') {
                    const row = await db.queryOne('SELECT * FROM service_requests WHERE id=$1', [job.entity_id]);
                    if (row) {
                        const items = await db.query('SELECT tool_name,problem FROM service_request_items WHERE request_id=$1 ORDER BY id', [row.id]);
                        await bot.notifyServiceRequest({ ...row, number: 'Р-' + row.id, deliveryNeeded: row.delivery_needed === 1, items: items.map(i => ({ toolName: i.tool_name, problem: i.problem })) });
                    }
                } else throw new Error('unknown_notification_kind');
                await db.execute('UPDATE notification_outbox SET delivered_at=NOW(),locked_until=NULL WHERE id=$1', [job.id]);
            } catch {
                const delay = Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7));
                await db.execute("UPDATE notification_outbox SET locked_until=NULL,available_at=NOW()+$2*INTERVAL '1 second' WHERE id=$1", [job.id, delay]);
                console.error('[notifications] delivery_failed job=' + job.id + ' attempt=' + job.attempts);
            }
        }
        await db.execute("DELETE FROM notification_outbox WHERE delivered_at < NOW()-INTERVAL '30 days'");
    } catch {
        console.error('[notifications] worker_failed');
    } finally { running = false; }
}
function start() {
    drain();
    if (!workerTimer) { workerTimer = setInterval(drain, 30000); workerTimer.unref(); }
    return workerTimer;
}
function wake() { if (workerTimer) setImmediate(drain); }
module.exports = { OUTBOX_SCHEMA, enqueue, drain, start, wake };
