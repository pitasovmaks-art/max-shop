const router          = require('express').Router();
const db              = require('../db');
const { requireUser } = require('../middleware/requireUser');

/* POST / — subscribe { productId }, tg_id из req.tgId (подписанные initData) */
router.post('/', requireUser, async (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    try {
        await db.execute(
            `INSERT INTO stock_subscriptions (tg_id, product_id)
             VALUES ($1, $2)
             ON CONFLICT (tg_id, product_id) DO NOTHING`,
            [+req.tgId, +productId]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /check?product_id=... — tg_id из req.tgId */
router.get('/check', requireUser, async (req, res) => {
    const { product_id } = req.query;
    if (!product_id) return res.status(400).json({ error: 'product_id required' });
    try {
        const row = await db.queryOne(
            'SELECT id FROM stock_subscriptions WHERE tg_id=$1 AND product_id=$2 AND notified=FALSE',
            [+req.tgId, +product_id]
        );
        res.json({ subscribed: !!row });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /list — active (unnotified) subscriptions for the signed-in user */
router.get('/list', requireUser, async (req, res) => {
    try {
        const rows = await db.query(
            'SELECT product_id FROM stock_subscriptions WHERE tg_id=$1 AND notified=FALSE',
            [+req.tgId]
        );
        res.json(rows.map(r => Number(r.product_id)));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
