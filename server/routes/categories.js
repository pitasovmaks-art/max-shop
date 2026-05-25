const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');

/* GET /api/categories */
router.get('/', async (req, res) => {
    try {
        res.json(await db.query('SELECT * FROM categories ORDER BY id'));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/categories */
router.post('/', requireAdmin, async (req, res) => {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const maxRow = await db.queryOne('SELECT COALESCE(MAX(id),0) AS m FROM categories');
        const id = maxRow.m + 1;
        await db.execute(
            'INSERT INTO categories (id,name,icon,color) VALUES ($1,$2,$3,$4)',
            [id, name, icon || '📦', color || 1]
        );
        res.status(201).json(await db.queryOne('SELECT * FROM categories WHERE id=$1', [id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/categories/:id */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name, icon, color } = req.body;
    try {
        const changed = await db.execute(
            'UPDATE categories SET name=$1,icon=$2,color=$3 WHERE id=$4',
            [name, icon || '📦', color || 1, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json(await db.queryOne('SELECT * FROM categories WHERE id=$1', [+req.params.id]));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/categories/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
    const id = +req.params.id;
    try {
        await db.inTransaction(async (client) => {
            await client.query(
                'UPDATE products SET sub_id=NULL WHERE sub_id IN (SELECT id FROM subcategories WHERE category_id=$1)', [id]);
            await client.query('UPDATE products SET category_id=NULL WHERE category_id=$1', [id]);
            await client.query('DELETE FROM subcategories WHERE category_id=$1', [id]);
            await client.query('DELETE FROM categories WHERE id=$1', [id]);
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
