const router       = require('express').Router();
const db           = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(s) {
    return { id: s.id, categoryId: s.category_id, name: s.name };
}

/* GET /api/subcategories?categoryId= */
router.get('/', (req, res) => {
    let sql = 'SELECT * FROM subcategories';
    const params = [];
    if (req.query.categoryId) { sql += ' WHERE category_id=?'; params.push(+req.query.categoryId); }
    sql += ' ORDER BY id';
    res.json(db.prepare(sql).all(...params).map(normalize));
});

/* POST /api/subcategories */
router.post('/', requireAdmin, (req, res) => {
    const { categoryId, name } = req.body;
    if (!name || !categoryId) return res.status(400).json({ error: 'categoryId and name required' });
    const id = (db.prepare('SELECT MAX(id) as m FROM subcategories').get().m || 0) + 1;
    db.prepare('INSERT INTO subcategories (id,category_id,name) VALUES (?,?,?)').run(id, +categoryId, name);
    res.status(201).json(normalize(db.prepare('SELECT * FROM subcategories WHERE id=?').get(id)));
});

/* PUT /api/subcategories/:id */
router.put('/:id', requireAdmin, (req, res) => {
    const { name } = req.body;
    const r = db.prepare('UPDATE subcategories SET name=? WHERE id=?').run(name, +req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(normalize(db.prepare('SELECT * FROM subcategories WHERE id=?').get(+req.params.id)));
});

/* DELETE /api/subcategories/:id */
router.delete('/:id', requireAdmin, (req, res) => {
    const id = +req.params.id;
    db.inTransaction(() => {
        db.prepare('UPDATE products SET sub_id=NULL WHERE sub_id=?').run(id);
        db.prepare('DELETE FROM subcategories WHERE id=?').run(id);
    });
    res.json({ ok: true });
});

module.exports = router;
