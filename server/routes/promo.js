const router = require('express').Router();
const db     = require('../db');

/* POST /api/promo/subscribe */
router.post('/subscribe', async (req, res) => {
    const { tgId } = req.body;
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    try {
        await db.execute(
            'INSERT INTO promo_subscribers (tg_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [BigInt(tgId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe */
router.post('/unsubscribe', async (req, res) => {
    const { tgId } = req.body;
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    try {
        await db.execute('DELETE FROM promo_subscribers WHERE tg_id=$1', [BigInt(tgId)]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/promo/status?tg_id= */
router.get('/status', async (req, res) => {
    const tgId = req.query.tg_id;
    if (!tgId) return res.status(400).json({ error: 'tg_id required' });
    try {
        const row = await db.queryOne('SELECT 1 FROM promo_subscribers WHERE tg_id=$1', [BigInt(tgId)]);
        res.json({ subscribed: !!row });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
