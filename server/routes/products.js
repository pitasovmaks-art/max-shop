const router       = require('express').Router();
const db           = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(p) {
    return {
        id:         p.id,
        name:       p.name,
        desc:       p.desc,
        categoryId: p.category_id,
        subId:      p.sub_id,
        price:      p.price,
        inStock:    p.in_stock  === 1,
        isService:  p.is_service === 1,
        priceLabel: p.price_label || undefined,
        image:      p.image       || undefined,
    };
}

/* GET /api/products?categoryId=&subId=&q= */
router.get('/', (req, res) => {
    let sql    = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (req.query.categoryId) { sql += ' AND category_id=?'; params.push(+req.query.categoryId); }
    if (req.query.subId)      { sql += ' AND sub_id=?';      params.push(+req.query.subId); }
    if (req.query.q) {
        const q = `%${req.query.q}%`;
        sql += ' AND (name LIKE ? OR desc LIKE ?)';
        params.push(q, q);
    }
    sql += ' ORDER BY id';

    res.json(db.prepare(sql).all(...params).map(normalize));
});

/* GET /api/products/:id */
router.get('/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(+req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(normalize(p));
});

/* POST /api/products */
router.post('/', requireAdmin, (req, res) => {
    const { name, desc, categoryId, subId, price, inStock, isService, priceLabel, image } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const r = db.prepare(`
        INSERT INTO products (name,desc,category_id,sub_id,price,in_stock,is_service,price_label,image)
        VALUES (?,?,?,?,?,?,?,?,?)
    `).run(name, desc||null, categoryId||null, subId||null, price||0,
           inStock?1:0, isService?1:0, priceLabel||null, image||null);

    res.status(201).json(normalize(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid)));
});

/* PUT /api/products/:id */
router.put('/:id', requireAdmin, (req, res) => {
    const { name, desc, categoryId, subId, price, inStock, isService, priceLabel, image } = req.body;

    const r = db.prepare(`
        UPDATE products
        SET name=?,desc=?,category_id=?,sub_id=?,price=?,in_stock=?,is_service=?,price_label=?,image=?
        WHERE id=?
    `).run(name, desc||null, categoryId||null, subId||null, price||0,
           inStock?1:0, isService?1:0, priceLabel||null, image||null, +req.params.id);

    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(normalize(db.prepare('SELECT * FROM products WHERE id=?').get(+req.params.id)));
});

/* DELETE /api/products/:id */
router.delete('/:id', requireAdmin, (req, res) => {
    const r = db.prepare('DELETE FROM products WHERE id=?').run(+req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
});

module.exports = router;
