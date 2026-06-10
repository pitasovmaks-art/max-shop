const router = require('express').Router();
const db     = require('../db');
const ozon   = require('../../services/ozonSync');

/* GET /api/sync/run-now — временный endpoint */
router.get('/run-now', async (req, res) => {
    const started  = Date.now();
    const captured = [];
    const origLog   = console.log;
    const origError = console.error;
    const cap = (...a) => captured.push(a.map(String).join(' '));
    console.log   = (...a) => { origLog(...a);   cap(...a); };
    console.error = (...a) => { origError(...a); cap(...a); };

    let syncError = null;
    try {
        await ozon.syncStocks();
    } catch (e) {
        syncError = e.message;
    } finally {
        console.log   = origLog;
        console.error = origError;
    }

    let db_logs = [];
    try {
        db_logs = await db.query(
            `SELECT account, data_type, status, records_count, error_message, created_at
             FROM sync_log ORDER BY created_at DESC LIMIT 6`
        );
    } catch {}

    res.json({ ok: !syncError, duration_ms: Date.now() - started, error: syncError || undefined, console: captured, db_logs });
});

module.exports = router;
