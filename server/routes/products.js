const router           = require('express').Router();
const db               = require('../db');
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

async function attachVariants(products) {
    if (!products.length) return products;
    const allVars = await db.query(
        'SELECT * FROM product_variants ORDER BY sort_order, id'
    );
    const byProduct = {};
    allVars.forEach(v => {
        if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
        byProduct[v.product_id].push(normalizeVariant(v));
    });
    products.forEach(p => { p.variants = byProduct[p.id] || []; });
    return products;
}

/* GET /api/products?categoryId=&subId=&q= */
router.get('/', async (req, res) => {
    try {
        let sql = 'SELECT * FROM products WHERE 1=1';
        const params = [];
        let i = 1;
        if (req.query.categoryId) { sql += ` AND category_id=$${i++}`; params.push(+req.query.categoryId); }
        if (req.query.subId)      { sql += ` AND sub_id=$${i++}`;      params.push(+req.query.subId); }
        if (req.query.q) {
            const q = `%${req.query.q}%`;
            sql += ` AND (name ILIKE $${i} OR "desc" ILIKE $${i+1})`;
            params.push(q, q); i += 2;
        }
        sql += ' ORDER BY id';
        const products = (await db.query(sql, params)).map(normalize);
        res.json(await attachVariants(products));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id */
router.get('/:id', async (req, res) => {
    try {
        const p = await db.queryOne('SELECT * FROM products WHERE id=$1', [+req.params.id]);
        if (!p) return res.status(404).json({ error: 'Not found' });
        const product = normalize(p);
        await attachVariants([product]);
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id/variants */
router.get('/:id/variants', async (req, res) => {
    try {
        const vars = await db.query(
            'SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id',
            [+req.params.id]
        );
        res.json(vars.map(normalizeVariant));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/:id/variants — replace all variants */
router.put('/:id/variants', requireAdmin, async (req, res) => {
    const productId = +req.params.id;
    const variants  = req.body;
    if (!Array.isArray(variants)) return res.status(400).json({ error: 'Expected array' });
    try {
        await db.inTransaction(async (client) => {
            await client.query('DELETE FROM product_variants WHERE product_id=$1', [productId]);
            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                await client.query(
                    `INSERT INTO product_variants (product_id,label,price,is_default,sort_order)
                     VALUES ($1,$2,$3,$4,$5)`,
                    [productId, String(v.label).trim(), v.price || 0, v.isDefault ? 1 : 0, v.sortOrder ?? i]
                );
            }
        });
        const saved = await db.query(
            'SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id',
            [productId]
        );
        res.json(saved.map(normalizeVariant));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products */
router.post('/', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, inStock, isService, priceLabel, image } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const row = await db.queryOne(
            `INSERT INTO products (name,"desc",category_id,sub_id,price,in_stock,is_service,price_label,image)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [name, desc || null, categoryId || null, subId || null, price || 0,
             inStock ? 1 : 0, isService ? 1 : 0, priceLabel || null, image || null]
        );
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [row.id]));
        await attachVariants([product]);
        res.status(201).json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/:id */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, inStock, isService, priceLabel, image } = req.body;
    try {
        const changed = await db.execute(
            `UPDATE products
             SET name=$1,"desc"=$2,category_id=$3,sub_id=$4,price=$5,
                 in_stock=$6,is_service=$7,price_label=$8,image=$9
             WHERE id=$10`,
            [name, desc || null, categoryId || null, subId || null, price || 0,
             inStock ? 1 : 0, isService ? 1 : 0, priceLabel || null, image || null, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [+req.params.id]));
        await attachVariants([product]);
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/products/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute('DELETE FROM products WHERE id=$1', [+req.params.id]);
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
