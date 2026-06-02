const router = require('express').Router();
const db     = require('../db');

/* POST / — subscribe { tgId, productId } */
router.post('/', async (req, res) => {
    const { tgId, productId } = req.body;
    if (!tgId || !productId) return res.status(400).json({ error: 'tgId and productId required' });
    try {
        await db.execute(
            `INSERT INTO stock_subscriptions (tg_id, product_id)
             VALUES ($1, $2)
             ON CONFLICT (tg_id, product_id) DO NOTHING`,
            [+tgId, +productId]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /check?tg_id=...&product_id=... */
router.get('/check', async (req, res) => {
    const { tg_id, product_id } = req.query;
    if (!tg_id || !product_id) return res.status(400).json({ error: 'tg_id and product_id required' });
    try {
        const row = await db.queryOne(
            'SELECT id FROM stock_subscriptions WHERE tg_id=$1 AND product_id=$2',
            [+tg_id, +product_id]
        );
        res.json({ subscribed: !!row });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /list?tg_id=... — all subscribed product_ids for one user */
router.get('/list', async (req, res) => {
    const { tg_id } = req.query;
    if (!tg_id) return res.status(400).json({ error: 'tg_id required' });
    try {
        const rows = await db.query(
            'SELECT product_id FROM stock_subscriptions WHERE tg_id=$1',
            [+tg_id]
        );
        res.json(rows.map(r => Number(r.product_id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
