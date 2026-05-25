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

function normalizeVariant(v) {
    return {
        id:        v.id,
        productId: v.product_id,
        label:     v.label,
        price:     v.price,
        isDefault: v.is_default === 1,
        sortOrder: v.sort_order,
    };
}

function attachVariants(products) {
    const allVars = db.prepare(
        'SELECT * FROM product_variants ORDER BY sort_order, id'
    ).all();
    const byProduct = {};
    allVars.forEach(v => {
        if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
        byProduct[v.product_id].push(normalizeVariant(v));
    });
    products.forEach(p => { p.variants = byProduct[p.id] || []; });
    return products;
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

    res.json(attachVariants(db.prepare(sql).all(...params).map(normalize)));
});

/* GET /api/products/:id */
router.get('/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id=?').get(+req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const product = normalize(p);
    attachVariants([product]);
    res.json(product);
});

/* GET /api/products/:id/variants */
router.get('/:id/variants', (req, res) => {
    const vars = db.prepare(
        'SELECT * FROM product_variants WHERE product_id=? ORDER BY sort_order, id'
    ).all(+req.params.id);
    res.json(vars.map(normalizeVariant));
});

/* PUT /api/products/:id/variants — replace all variants for a product */
router.put('/:id/variants', requireAdmin, (req, res) => {
    const productId = +req.params.id;
    const variants  = req.body;
    if (!Array.isArray(variants)) return res.status(400).json({ error: 'Expected array' });

    const ins = db.prepare(`
        INSERT INTO product_variants (product_id,label,price,is_default,sort_order)
        VALUES (?,?,?,?,?)`);

    db.inTransaction(() => {
        db.prepare('DELETE FROM product_variants WHERE product_id=?').run(productId);
        variants.forEach((v, i) => {
            ins.run(productId, String(v.label).trim(), v.price || 0, v.isDefault ? 1 : 0, v.sortOrder ?? i);
        });
    });

    const saved = db.prepare(
        'SELECT * FROM product_variants WHERE product_id=? ORDER BY sort_order, id'
    ).all(productId);
    res.json(saved.map(normalizeVariant));
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
