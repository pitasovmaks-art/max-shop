const router  = require('express').Router();
const db      = require('../db');
const ozon    = require('../../services/ozonSync');

/* GET /api/sync/test-stocks — временный endpoint для ручной проверки syncStocks */
router.get('/test-stocks', async (req, res) => {
    const started  = Date.now();
    const captured = [];

    const origLog   = console.log;
    const origError = console.error;
    const capture   = (...args) => captured.push(args.map(String).join(' '));
    console.log   = (...a) => { origLog(...a);   capture(...a); };
    console.error = (...a) => { origError(...a); capture(...a); };

    let syncError = null;
    try {
        await ozon.syncStocks();
    } catch (e) {
        syncError = e.message;
    } finally {
        console.log   = origLog;
        console.error = origError;
    }
    const duration_ms = Date.now() - started;

    let db_logs = [];
    try {
        db_logs = await db.query(
            `SELECT account, data_type, status, records_count, error_message, created_at
             FROM sync_log ORDER BY created_at DESC LIMIT 6`
        );
    } catch {}

    res.json({ ok: !syncError, duration_ms, error: syncError || undefined, console: captured, db_logs });
});

module.exports = router;
