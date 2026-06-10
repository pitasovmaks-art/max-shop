const router = require('express').Router();

/* GET /api/sync/test-stocks — временный endpoint для ручной проверки syncStocks */
router.get('/test-stocks', async (req, res) => {
    const started = Date.now();
    try {
        await require('../../services/ozonSync').syncStocks();
        res.json({ ok: true, duration_ms: Date.now() - started, message: 'syncStocks завершён' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message, duration_ms: Date.now() - started });
    }
});

module.exports = router;
