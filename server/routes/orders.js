const router       = require('express').Router();
const db           = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(o) {
    return {
        id:        o.id,
        name:      o.name,
        phone:     o.phone,
        store:     o.store,
        comment:   o.comment || undefined,
        items:     JSON.parse(o.items),
        total:     o.total,
        status:    o.status,
        createdAt: o.created_at,
    };
}

/* POST /api/orders — public, customers submit */
router.post('/', (req, res) => {
    const { name, phone, store, comment, items, total } = req.body;
    if (!name || !phone || !store || !items || total == null) {
        return res.status(400).json({ error: 'Обязательные поля: name, phone, store, items, total' });
    }
    const r = db.prepare(`
        INSERT INTO orders (name,phone,store,comment,items,total)
        VALUES (?,?,?,?,?,?)
    `).run(name, phone, store, comment||null, JSON.stringify(items), total);

    res.status(201).json({ ok: true, id: r.lastInsertRowid });
});

/* GET /api/orders — admin only */
router.get('/', requireAdmin, (req, res) => {
    res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC').all().map(normalize));
});

/* GET /api/orders/:id — admin only */
router.get('/:id', requireAdmin, (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id=?').get(+req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    res.json(normalize(o));
});

/* PUT /api/orders/:id/status — admin only */
router.put('/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body;
    const allowed = ['new', 'processing', 'done', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const r = db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, +req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
});

module.exports = router;
