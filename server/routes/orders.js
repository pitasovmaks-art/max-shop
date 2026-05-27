const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { notifyStore }  = require('../../bot');

function normalize(o) {
    return {
        id:        o.id,
        name:      o.name,
        phone:     o.phone,
        store:     o.store,
        comment:   o.comment || undefined,
        items:     typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        total:     o.total,
        status:    o.status,
        createdAt: o.created_at,
    };
}

/* POST /api/orders — public, customers submit */
router.post('/', async (req, res) => {
    const { name, phone, store, comment, items, total } = req.body;
    if (!name || !phone || !store || !items || total == null) {
        return res.status(400).json({ error: 'Обязательные поля: name, phone, store, items, total' });
    }
    try {
        const row = await db.queryOne(
            `INSERT INTO orders (name,phone,store,comment,items,total)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [name, phone, store, comment || null, JSON.stringify(items), total]
        );
        const order = normalize(await db.queryOne('SELECT * FROM orders WHERE id=$1', [row.id]));
        notifyStore(order).catch(e => console.error('[bot] notifyStore:', e.message));
        res.status(201).json({ ok: true, id: order.id });
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
    const allowed = ['new', 'processing', 'done', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
        const changed = await db.execute(
            'UPDATE orders SET status=$1 WHERE id=$2',
            [status, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
