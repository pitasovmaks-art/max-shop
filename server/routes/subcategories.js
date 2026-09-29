const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(s) {
    return { id: s.id, categoryId: s.category_id, name: s.name };
}

/* GET /api/subcategories?categoryId= */
router.get('/', async (req, res) => {
    try {
        let sql = 'SELECT * FROM subcategories';
        const params = [];
        if (req.query.categoryId) { sql += ' WHERE category_id=$1'; params.push(+req.query.categoryId); }
        sql += ' ORDER BY id';
        res.json((await db.query(sql, params)).map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/subcategories */
router.post('/', requireAdmin, async (req, res) => {
    const { categoryId, name } = req.body;
    if (!name || !categoryId) return res.status(400).json({ error: 'categoryId and name required' });
    try {
        let id;
        await db.inTransaction(async (client) => {
            // Блокируем таблицу на время SELECT MAX(id) + INSERT, иначе два
            // параллельных POST-запроса могут посчитать один и тот же
            // следующий id и столкнуться на PRIMARY KEY.
            await client.query('LOCK TABLE subcategories IN SHARE ROW EXCLUSIVE MODE');
            const maxRes = await client.query('SELECT COALESCE(MAX(id),0) AS m FROM subcategories');
            id = maxRes.rows[0].m + 1;
            await client.query(
                'INSERT INTO subcategories (id,category_id,name) VALUES ($1,$2,$3)',
                [id, +categoryId, name]
            );
        });
        res.status(201).json(normalize(await db.queryOne('SELECT * FROM subcategories WHERE id=$1', [id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/subcategories/:id */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name } = req.body;
    try {
        const changed = await db.execute(
            'UPDATE subcategories SET name=$1 WHERE id=$2',
            [name, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json(normalize(await db.queryOne('SELECT * FROM subcategories WHERE id=$1', [+req.params.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/subcategories/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
    const id = +req.params.id;
    try {
        await db.inTransaction(async (client) => {
            await client.query('UPDATE products SET sub_id=NULL WHERE sub_id=$1', [id]);
            await client.query('DELETE FROM subcategories WHERE id=$1', [id]);
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
