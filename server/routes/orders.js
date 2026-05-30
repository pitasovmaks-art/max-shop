const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyStore, notifyCustomer } = require('../../bot');

function normalize(o) {
    return {
        id:             o.id,
        name:           o.name,
        phone:          o.phone,
        store:          o.store,
        delivery:       o.delivery       || 'pickup',
        address:        o.address        || undefined,
        city:           o.city           || undefined,
        tgId:           o.tg_id          || undefined,
        trackingNumber: o.tracking_number|| undefined,
        comment:        o.comment        || undefined,
        items:          typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        total:          o.total,
        status:         o.status,
        createdAt:      o.created_at,
    };
}

/* POST /api/orders — public, customers submit */
router.post('/', async (req, res) => {
    const { name, phone, store, delivery, address, city, tgId, comment, items, total } = req.body;
    console.log('[orders] новый заказ: name=', name, 'tgId=', tgId, 'city=', city);
    if (!name || !phone || !store || !items || total == null) {
        return res.status(400).json({ error: 'Обязательные поля: name, phone, store, items, total' });
    }
    try {
        const row = await db.queryOne(
            `INSERT INTO orders (name,phone,store,delivery,address,city,tg_id,comment,items,total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [name, phone, store, delivery || 'pickup', address || null, city || null,
             tgId || null, comment || null, JSON.stringify(items), total]
        );
        const order = normalize(await db.queryOne('SELECT * FROM orders WHERE id=$1', [row.id]));
        notifyStore(order).catch(e => console.error('[bot] notifyStore:', e.message));
        res.status(201).json({ ok: true, id: order.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/orders/my?tg_id=... — public, customer orders */
router.get('/my', async (req, res) => {
    const { tg_id } = req.query;
    if (!tg_id) return res.status(400).json({ error: 'tg_id required' });
    try {
        const rows = await db.query(
            'SELECT * FROM orders WHERE tg_id=$1 ORDER BY id DESC',
            [String(tg_id)]
        );
        res.json(rows.map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/orders — admin only */
router.get('/', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM orders ORDER BY id DESC');
        res.json(rows.map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/orders/:id — admin only */
router.get('/:id', requireAdmin, async (req, res) => {
    try {
        const o = await db.queryOne('SELECT * FROM orders WHERE id=$1', [+req.params.id]);
        if (!o) return res.status(404).json({ error: 'Not found' });
        res.json(normalize(o));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/orders/:id/status — admin only */
router.put('/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const allowed = ['new', 'in_progress', 'ready', 'shipped', 'completed', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
        const changed = await db.execute(
            'UPDATE orders SET status=$1 WHERE id=$2',
            [status, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        // Notify customer
        const o = await db.queryOne('SELECT tg_id, id FROM orders WHERE id=$1', [+req.params.id]);
        if (o?.tg_id) {
            notifyCustomer(o.tg_id, o.id, status).catch(e => console.error('[bot] notify:', e.message));
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/orders/:id/tracking — admin only */
router.put('/:id/tracking', requireAdmin, async (req, res) => {
    const { tracking_number } = req.body;
    if (!tracking_number) return res.status(400).json({ error: 'tracking_number required' });
    try {
        const changed = await db.execute(
            'UPDATE orders SET tracking_number=$1, status=\'shipped\' WHERE id=$2',
            [tracking_number, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const o = await db.queryOne('SELECT tg_id, id FROM orders WHERE id=$1', [+req.params.id]);
        if (o?.tg_id) {
            notifyCustomer(o.tg_id, o.id, 'tracking', tracking_number)
                .catch(e => console.error('[bot] notify tracking:', e.message));
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
