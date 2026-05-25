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
router.get('/', async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM stores ORDER BY sort_order ASC, id ASC');
        res.json(rows.map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/stores — admin */
router.post('/', requireAdmin, async (req, res) => {
    const { name, city, address, hours, phone, directions, sortOrder } = req.body;
    if (!name || !city || !address) {
        return res.status(400).json({ error: 'Обязательные поля: name, city, address' });
    }
    try {
        const row = await db.queryOne(
            `INSERT INTO stores (name,city,address,hours,phone,directions,sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [name, city, address, hours || '', phone || '', directions || '', sortOrder || 0]
        );
        const store = normalize(await db.queryOne('SELECT * FROM stores WHERE id=$1', [row.id]));
        res.status(201).json(store);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/stores/:id — admin */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name, city, address, hours, phone, directions, sortOrder } = req.body;
    if (!name || !city || !address) {
        return res.status(400).json({ error: 'Обязательные поля: name, city, address' });
    }
    try {
        const changed = await db.execute(
            `UPDATE stores SET name=$1,city=$2,address=$3,hours=$4,phone=$5,directions=$6,sort_order=$7
             WHERE id=$8`,
            [name, city, address, hours || '', phone || '', directions || '', sortOrder || 0, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const store = normalize(await db.queryOne('SELECT * FROM stores WHERE id=$1', [+req.params.id]));
        res.json(store);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/stores/:id — admin */
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute('DELETE FROM stores WHERE id=$1', [+req.params.id]);
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
