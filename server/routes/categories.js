const router       = require('express').Router();
const db           = require('../db');
const { requireAdmin } = require('../middleware/auth');

/* GET /api/categories */
router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM categories ORDER BY id').all());
});

/* POST /api/categories */
router.post('/', requireAdmin, (req, res) => {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const id = (db.prepare('SELECT MAX(id) as m FROM categories').get().m || 0) + 1;
    db.prepare('INSERT INTO categories (id,name,icon,color) VALUES (?,?,?,?)').run(id, name, icon||'📦', color||1);
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id=?').get(id));
});

/* PUT /api/categories/:id */
router.put('/:id', requireAdmin, (req, res) => {
    const { name, icon, color } = req.body;
    const r = db.prepare('UPDATE categories SET name=?,icon=?,color=? WHERE id=?')
        .run(name, icon||'📦', color||1, +req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM categories WHERE id=?').get(+req.params.id));
});

/* DELETE /api/categories/:id */
router.delete('/:id', requireAdmin, (req, res) => {
    const id = +req.params.id;
    db.inTransaction(() => {
        db.prepare('UPDATE products SET sub_id=NULL WHERE sub_id IN (SELECT id FROM subcategories WHERE category_id=?)').run(id);
        db.prepare('UPDATE products SET category_id=NULL WHERE category_id=?').run(id);
        db.prepare('DELETE FROM subcategories WHERE category_id=?').run(id);
        db.prepare('DELETE FROM categories WHERE id=?').run(id);
    });
    res.json({ ok: true });
});

module.exports = router;
