const router  = require('express').Router();
const db      = require('../db');
const ozon    = require('../../services/ozonSync');

/* GET /api/sync/test-stocks — временный endpoint для ручной проверки syncStocks */
router.get('/test-stocks', async (req, res) => {
    const started = Date.now();
    let syncError = null;
    try {
        await ozon.syncStocks();
    } catch (e) {
        syncError = e.message;
    }
    const duration_ms = Date.now() - started;

    let logs = [];
    try {
        const result = await db.execute(
            `SELECT account, data_type, status, records_count, error_message, created_at
             FROM sync_log ORDER BY created_at DESC LIMIT 10`
        );
        logs = result.rows || result;
    } catch {}

    res.json({ ok: !syncError, duration_ms, error: syncError || undefined, recent_logs: logs });
});

module.exports = router;
