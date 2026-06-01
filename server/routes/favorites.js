const router = require('express').Router();
const db     = require('../db');

/* ─── Attach variants to product list ───────────────────── */
async function withVariants(products) {
    if (!products.length) return products;
    const allVars = await db.query(
        'SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) ORDER BY sort_order, id',
        [products.map(p => p.id)]
    );
    const byProduct = {};
    for (const v of allVars) {
        if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
        byProduct[v.product_id].push({
            id:               v.id,
            productId:        v.product_id,
            label:            v.label,
            price:            v.price,
            priceKrd:         v.price_krd          || 0,
            priceMsk:         v.price_msk          || 0,
            priceDelivery:    v.price_delivery     || 0,
            priceKrdPickup:   v.price_krd_pickup   || 0,
            priceMskPickup:   v.price_msk_pickup   || 0,
            priceMskDelivery: v.price_msk_delivery || 0,
            isKrd:            v.is_krd             === 1,
            isDefault:        v.is_default         === 1,
            sortOrder:        v.sort_order,
        });
    }
    for (const p of products) p.variants = byProduct[p.id] || [];
    return products;
}

function normalizeProduct(p) {
    return {
        id:            p.id,
        name:          p.name,
        desc:          p.desc,
        categoryId:    p.category_id,
        subId:         p.sub_id,
        price:         p.price,
        priceKrd:      p.price_krd      || 0,
        priceMsk:      p.price_msk      || 0,
        priceDelivery: p.price_delivery || 0,
        inStock:       p.in_stock       === 1,
        isService:     p.is_service     === 1,
        priceLabel:    p.price_label    || undefined,
        image:         p.image          || undefined,
        product_id:    p.id,   // keep for catalog _favorites Set building
    };
}

/* GET /api/favorites?tg_id= */
router.get('/', async (req, res) => {
    const { tg_id } = req.query;
    if (!tg_id) return res.status(400).json({ error: 'tg_id required' });
    try {
        const rows = await db.query(
            `SELECT p.* FROM favorites f
             JOIN products p ON p.id = f.product_id
             WHERE f.tg_id = $1
             ORDER BY f.created_at DESC`,
            [String(tg_id)]
        );
        const products = await withVariants(rows.map(normalizeProduct));
        res.json(products);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/favorites */
router.post('/', async (req, res) => {
    const { tgId, productId } = req.body;
    if (!tgId || !productId) return res.status(400).json({ error: 'tgId and productId required' });
    try {
        await db.execute(
            `INSERT INTO favorites (tg_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [String(tgId), String(productId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/favorites */
router.delete('/', async (req, res) => {
    const { tgId, productId } = req.body;
    if (!tgId || !productId) return res.status(400).json({ error: 'tgId and productId required' });
    try {
        await db.execute(
            `DELETE FROM favorites WHERE tg_id = $1 AND product_id = $2`,
            [String(tgId), String(productId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
