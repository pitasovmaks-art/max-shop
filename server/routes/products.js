const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin } = require('../middleware/auth');

function normalize(p) {
    return {
        id:                   p.id,
        name:                 p.name,
        desc:                 p.desc,
        categoryId:           p.category_id,
        subId:                p.sub_id,
        price:                p.price,
        priceKrd:             p.price_krd               || 0,
        priceMsk:             p.price_msk               || 0,
        priceDelivery:        p.price_delivery          || 0,
        inStock:              p.in_stock                === 1,
        isService:            p.is_service              === 1,
        priceLabel:           p.price_label             || undefined,
        image:                p.image                   || undefined,
        sortOrder:            p.sort_order              || 0,
        sortOrderInCategory:  p.sort_order_in_category  || 0,
    };
}

function normalizeVariant(v) {
    return {
        id:              v.id,
        productId:       v.product_id,
        label:           v.label,
        price:           v.price,
        priceKrd:        v.price_krd          || 0,
        priceMsk:        v.price_msk          || 0,
        priceDelivery:   v.price_delivery     || 0,
        priceKrdPickup:  v.price_krd_pickup   || 0,
        priceMskPickup:  v.price_msk_pickup   || 0,
        priceMskDelivery:v.price_msk_delivery || 0,
        isKrd:           v.is_krd             === 1,
        isDefault:       v.is_default         === 1,
        sortOrder:       v.sort_order,
        salePrice:       v.sale_price         || 0,
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
    products.forEach(p => {
        p.variants = byProduct[p.id] || [];
        p.isSale   = p.variants.some(v => v.salePrice > 0);
    });
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
        sql += req.query.categoryId ? ' ORDER BY sort_order_in_category, id' : ' ORDER BY sort_order, id';
        const products = (await db.query(sql, params)).map(normalize);
        res.json(await attachVariants(products));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products/import */
router.post('/import', requireAdmin, async (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Expected array of rows' });

    const categories   = await db.query('SELECT id, name FROM categories');
    const subcategories = await db.query('SELECT id, name, category_id FROM subcategories');
    const catByName    = Object.fromEntries(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
    const subByName    = {};
    subcategories.forEach(s => {
        subByName[`${s.category_id}::${s.name.trim().toLowerCase()}`] = s.id;
    });

    // Group rows by (name + category) preserving insertion order
    const groups = [];
    const groupMap = {};
    rows.forEach((row, idx) => {
        const key = `${String(row.name || '').trim()}::${String(row.category || '').trim().toLowerCase()}`;
        if (!groupMap[key]) { groupMap[key] = []; groups.push({ key, rows: groupMap[key] }); }
        groupMap[key].push({ ...row, _idx: idx + 2 }); // +2: header row + 1-based
    });

    let created = 0;
    let skipped = 0;
    const errors = [];

    const globalMaxRow = await db.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products');
    let globalOrder = (globalMaxRow?.m ?? 0);

    for (const { rows: grp } of groups) {
        const first   = grp[0];
        const name    = String(first.name || '').trim();
        const catName = String(first.category || '').trim().toLowerCase();

        if (!name) {
            grp.forEach(r => errors.push({ row: r._idx, reason: 'Пустое название товара' }));
            skipped++; continue;
        }
        const categoryId = catByName[catName];
        if (!categoryId) {
            grp.forEach(r => errors.push({ row: r._idx, reason: `Категория не найдена: "${first.category}"` }));
            skipped++; continue;
        }

        const hasPrice = grp.some(r =>
            (+r.priceKrdPickup || 0) > 0 || (+r.priceMskPickup || 0) > 0 || (+r.priceMskDelivery || 0) > 0
        );
        if (!hasPrice) {
            grp.forEach(r => errors.push({ row: r._idx, reason: `Нет ни одной цены у товара "${name}"` }));
            skipped++; continue;
        }

        const subName = String(first.subcategory || '').trim().toLowerCase();
        const subId   = subName ? (subByName[`${categoryId}::${subName}`] ?? null) : null;
        const inStock = first.inStock === undefined || first.inStock === '' ? true : !!+first.inStock;
        const desc    = String(first.desc || '').trim() || null;

        try {
            await db.inTransaction(async (client) => {
                globalOrder++;
                const catMaxRes = await client.query(
                    'SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1',
                    [categoryId]
                );
                const catOrder = (catMaxRes.rows[0]?.m ?? 0) + 1;

                const prodRes = await client.query(
                    `INSERT INTO products
                     (name,"desc",category_id,sub_id,price,price_krd,price_msk,price_delivery,
                      in_stock,is_service,sort_order,sort_order_in_category)
                     VALUES ($1,$2,$3,$4,0,0,0,0,$5,0,$6,$7) RETURNING id`,
                    [name, desc, categoryId, subId, inStock ? 1 : 0, globalOrder, catOrder]
                );
                const productId = prodRes.rows[0].id;

                // Each Excel row may produce up to two variants (KRD + MSK),
                // matching _collectVariants() in admin.js: KRD and MSK groups each
                // have their own isDefault, tracked independently — because
                // _effectiveVariant filters by city first, then looks for isDefault
                // within that city's subset.
                const hasExplicitDefault = grp.some(r => +r.isDefault === 1);
                let defaultKrdSet = false;
                let defaultMskSet = false;
                let sortIdx = 0;
                for (let i = 0; i < grp.length; i++) {
                    const r        = grp[i];
                    const label    = String(r.variantLabel || '').trim();
                    const krdPrice = +r.priceKrdPickup   || 0;
                    const mskPrice = +r.priceMskPickup   || 0;
                    const delPrice = +r.priceMskDelivery || 0;
                    const rowWantsDefault = hasExplicitDefault ? +r.isDefault === 1 : i === 0;

                    if (krdPrice > 0) {
                        const def = rowWantsDefault && !defaultKrdSet;
                        if (def) defaultKrdSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order)
                             VALUES ($1,$2,0,0,0,0,$3,0,0,1,$4,$5)`,
                            [productId, label, krdPrice, def ? 1 : 0, sortIdx++]
                        );
                    }
                    if (mskPrice > 0 || delPrice > 0) {
                        const def = rowWantsDefault && !defaultMskSet;
                        if (def) defaultMskSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order)
                             VALUES ($1,$2,0,0,0,0,0,$3,$4,0,$5,$6)`,
                            [productId, label, mskPrice, delPrice, def ? 1 : 0, sortIdx++]
                        );
                    }
                }
            });
            created++;
        } catch (e) {
            grp.forEach(r => errors.push({ row: r._idx, reason: `Ошибка БД: ${e.message}` }));
            skipped++;
        }
    }

    res.json({ created, skipped, errors });
});

/* PUT /api/products/reorder */
router.put('/reorder', requireAdmin, async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Expected { order: [...ids] }' });
    try {
        await db.inTransaction(async (client) => {
            for (let i = 0; i < order.length; i++) {
                await client.query('UPDATE products SET sort_order=$1 WHERE id=$2', [i, order[i]]);
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/reorder-category */
router.put('/reorder-category', requireAdmin, async (req, res) => {
    const { categoryId, order } = req.body;
    if (!Array.isArray(order) || !categoryId) return res.status(400).json({ error: 'Expected { categoryId, order: [...ids] }' });
    try {
        await db.inTransaction(async (client) => {
            for (let i = 0; i < order.length; i++) {
                await client.query(
                    'UPDATE products SET sort_order_in_category=$1 WHERE id=$2 AND category_id=$3',
                    [i, order[i], categoryId]
                );
            }
        });
        res.json({ ok: true });
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
        // Check current sale state before replacing
        const hadSaleRow = await db.queryOne(
            'SELECT 1 FROM product_variants WHERE product_id=$1 AND sale_price>0', [productId]
        );
        const hadSale = !!hadSaleRow;

        await db.inTransaction(async (client) => {
            await client.query('DELETE FROM product_variants WHERE product_id=$1', [productId]);
            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                await client.query(
                    `INSERT INTO product_variants
                     (product_id,label,price,price_krd,price_msk,price_delivery,
                      price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order,sale_price)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                    [productId, String(v.label).trim(),
                     v.price || 0, v.priceKrd || 0, v.priceMsk || 0, v.priceDelivery || 0,
                     v.priceKrdPickup || 0, v.priceMskPickup || 0, v.priceMskDelivery || 0,
                     v.isKrd ? 1 : 0, v.isDefault ? 1 : 0, v.sortOrder ?? i, v.salePrice || 0]
                );
            }
        });

        const saved = await db.query(
            'SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id',
            [productId]
        );
        res.json(saved.map(normalizeVariant));

        // Async sale notification after response
        const hasSale = variants.some(v => (v.salePrice || 0) > 0);
        if (hasSale && !hadSale) {
            // New sale started — notify subscribers if not already notified
            setImmediate(async () => {
                try {
                    const product = await db.queryOne('SELECT name, sale_notified FROM products WHERE id=$1', [productId]);
                    if (!product || product.sale_notified === 1) return;
                    const subscribers = await db.query('SELECT tg_id FROM promo_subscribers');
                    if (!subscribers.length) return;
                    const { notifyPromo } = require('../../bot');
                    for (const s of subscribers) {
                        await notifyPromo(s.tg_id, product.name);
                        await new Promise(r => setTimeout(r, 250));
                    }
                    await db.execute('UPDATE products SET sale_notified=1 WHERE id=$1', [productId]);
                    console.log(`[promo] Notified ${subscribers.length} subscriber(s) for product ${productId}`);
                } catch (e) {
                    console.error('[promo] Notify error:', e.message);
                }
            });
        } else if (!hasSale && hadSale) {
            // Sale removed — reset flag so next sale triggers notification again
            db.execute('UPDATE products SET sale_notified=0 WHERE id=$1', [productId])
              .catch(e => console.error('[promo] Reset sale_notified error:', e.message));
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products */
router.post('/', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery, inStock, isService, priceLabel, image } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (typeof image === 'string' && image.startsWith('data:')) {
        return res.status(400).json({ error: 'image must be S3 URL, not base64' });
    }
    try {
        const [globalMax, catMax] = await Promise.all([
            db.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products'),
            categoryId
                ? db.queryOne('SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1', [categoryId])
                : Promise.resolve({ m: 0 }),
        ]);
        const nextOrder    = (globalMax?.m ?? 0) + 1;
        const nextCatOrder = (catMax?.m ?? 0) + 1;
        const row = await db.queryOne(
            `INSERT INTO products (name,"desc",category_id,sub_id,price,price_krd,price_msk,price_delivery,in_stock,is_service,price_label,image,sort_order,sort_order_in_category)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [name, desc || null, categoryId || null, subId || null, price || 0,
             priceKrd || 0, priceMsk || 0, priceDelivery || 0,
             inStock ? 1 : 0, isService ? 1 : 0, priceLabel || null, image || null, nextOrder, nextCatOrder]
        );
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [row.id]));
        await attachVariants([product]);
        res.status(201).json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/:id */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery, inStock, isService, priceLabel, image } = req.body;
    if (typeof image === 'string' && image.startsWith('data:')) {
        return res.status(400).json({ error: 'image must be S3 URL, not base64' });
    }
    try {
        const current = await db.queryOne('SELECT in_stock, category_id FROM products WHERE id=$1', [+req.params.id]);
        if (!current) return res.status(404).json({ error: 'Not found' });
        const wasInStock  = current.in_stock    === 1;
        const nowInStock  = !!inStock;
        const catChanged  = String(current.category_id) !== String(categoryId || null);

        let newCatOrder = undefined;
        if (catChanged && categoryId) {
            const catMax = await db.queryOne(
                'SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1',
                [categoryId]
            );
            newCatOrder = (catMax?.m ?? 0) + 1;
        }

        const changed = await db.execute(
            `UPDATE products
             SET name=$1,"desc"=$2,category_id=$3,sub_id=$4,price=$5,
                 price_krd=$6,price_msk=$7,price_delivery=$8,
                 in_stock=$9,is_service=$10,price_label=$11,image=$12
                 ${newCatOrder !== undefined ? ',sort_order_in_category=$14' : ''}
             WHERE id=$13`,
            newCatOrder !== undefined
                ? [name, desc || null, categoryId || null, subId || null, price || 0,
                   priceKrd || 0, priceMsk || 0, priceDelivery || 0,
                   inStock ? 1 : 0, isService ? 1 : 0, priceLabel || null, image || null, +req.params.id, newCatOrder]
                : [name, desc || null, categoryId || null, subId || null, price || 0,
                   priceKrd || 0, priceMsk || 0, priceDelivery || 0,
                   inStock ? 1 : 0, isService ? 1 : 0, priceLabel || null, image || null, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [+req.params.id]));
        await attachVariants([product]);
        res.json(product);

        // false → true: notify subscribers asynchronously after response
        if (!wasInStock && nowInStock) {
            setImmediate(async () => {
                try {
                    const subs = await db.query(
                        'SELECT tg_id FROM stock_subscriptions WHERE product_id=$1 AND notified=FALSE',
                        [+req.params.id]
                    );
                    if (!subs.length) return;
                    const { notifyStock } = require('../../bot');
                    for (const s of subs) {
                        await notifyStock(s.tg_id, product.name);
                        await new Promise(r => setTimeout(r, 250));
                    }
                    await db.execute(
                        'UPDATE stock_subscriptions SET notified=TRUE WHERE product_id=$1 AND notified=FALSE',
                        [+req.params.id]
                    );
                    console.log(`[stock-notify] Notified ${subs.length} subscriber(s) for product ${req.params.id}`);
                } catch (e) {
                    console.error('[stock-notify] Notify error:', e.message);
                }
            });
        }

        // true → false: delete already-notified rows so users must re-subscribe for next cycle
        if (wasInStock && !nowInStock) {
            db.execute(
                'DELETE FROM stock_subscriptions WHERE product_id=$1 AND notified=TRUE',
                [+req.params.id]
            ).catch(e => console.error('[stock-notify] Cleanup error:', e.message));
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id/images */
router.get('/:id/images', async (req, res) => {
    try {
        const rows = await db.query(
            'SELECT * FROM product_images WHERE product_id=$1 ORDER BY sort_order, id',
            [+req.params.id]
        );
        res.json(rows.map(r => ({ id: r.id, productId: r.product_id, url: r.url, sortOrder: r.sort_order })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products/:id/images */
router.post('/:id/images', requireAdmin, async (req, res) => {
    const { url, sort_order } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
        const row = await db.queryOne(
            'INSERT INTO product_images (product_id,url,sort_order) VALUES ($1,$2,$3) RETURNING *',
            [+req.params.id, url, sort_order ?? 0]
        );
        res.status(201).json({ id: row.id, productId: row.product_id, url: row.url, sortOrder: row.sort_order });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/products/:id/images/:imageId */
router.delete('/:id/images/:imageId', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute(
            'DELETE FROM product_images WHERE id=$1 AND product_id=$2',
            [+req.params.imageId, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
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
