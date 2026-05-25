const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(s) {
    return {
        id:         s.id,
        name:       s.name,
        city:       s.city,
        address:    s.address,
        hours:      s.hours,
        phone:      s.phone,
        directions: s.directions,
        sortOrder:  s.sort_order,
    };
}

/* GET /api/stores — public */
router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM stores ORDER BY sort_order ASC, id ASC').all().map(normalize));
});

/* POST /api/stores — admin */
router.post('/', requireAdmin, (req, res) => {
    const { name, city, address, hours, phone, directions, sortOrder } = req.body;
    if (!name || !city || !address) {
        return res.status(400).json({ error: 'Обязательные поля: name, city, address' });
    }
    const r = db.prepare(`
        INSERT INTO stores (name,city,address,hours,phone,directions,sort_order)
        VALUES (?,?,?,?,?,?,?)
    `).run(name, city, address, hours||'', phone||'', directions||'', sortOrder||0);
    const store = normalize(db.prepare('SELECT * FROM stores WHERE id=?').get(r.lastInsertRowid));
    res.status(201).json(store);
});

/* PUT /api/stores/:id — admin */
router.put('/:id', requireAdmin, (req, res) => {
    const { name, city, address, hours, phone, directions, sortOrder } = req.body;
    if (!name || !city || !address) {
        return res.status(400).json({ error: 'Обязательные поля: name, city, address' });
    }
    const r = db.prepare(`
        UPDATE stores SET name=?,city=?,address=?,hours=?,phone=?,directions=?,sort_order=? WHERE id=?
    `).run(name, city, address, hours||'', phone||'', directions||'', sortOrder||0, +req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(normalize(db.prepare('SELECT * FROM stores WHERE id=?').get(+req.params.id)));
});

/* DELETE /api/stores/:id — admin */
router.delete('/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM stores WHERE id=?').run(+req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
});

module.exports = router;
