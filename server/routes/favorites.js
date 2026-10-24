const router          = require('express').Router();
const db              = require('../db');
const { requireUser } = require('../middleware/requireUser');
const usdPrice        = require('../utils/usdPrice');

/* ─── Attach variants to product list ───────────────────── */
async function withVariants(products) {
    if (!products.length) return products;
    const allVars = await db.query(
        'SELECT * FROM product_variants WHERE product_id = ANY($1::int[]) ORDER BY sort_order, id',
        [products.map(p => p.id)]
    );
    // usd-pricing, п.6: та же конвертация $->₽, что и в products.js —
    // избранное получает уже пересчитанные рубли в тех же полях.
    const rate = allVars.some(v => Number(v.is_usd) === 1) ? await usdPrice.getCurrentRate() : null;
    const byProduct = {};
    for (const raw of allVars) {
        const v = usdPrice.applyUsdToVariantRow(raw, rate);
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
            // Раньше здесь не было salePrice вообще — расхождение с
            // products.js normalizeVariant(), скидка не была видна в
            // избранном даже для обычных рублёвых товаров. Добавлено
            // по месту правки usd-pricing (не связано с $ напрямую).
            salePrice:        v.sale_price || 0,
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

/* GET /api/favorites — tg_id из подписанных initData (req.tgId), не из
   query (см. PROGRESS.md, «Открытая уязвимость — tg_id без проверки»). */
router.get('/', requireUser, async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT p.* FROM favorites f
             JOIN products p ON p.id = f.product_id
             WHERE f.tg_id = $1
             ORDER BY f.created_at DESC`,
            [req.tgId]
        );
        const products = await withVariants(rows.map(normalizeProduct));
        res.json(products);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/favorites — tgId из req.tgId, не из тела запроса. */
router.post('/', requireUser, async (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    try {
        await db.execute(
            `INSERT INTO favorites (tg_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [req.tgId, String(productId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/favorites — tgId из req.tgId, не из тела запроса. */
router.delete('/', requireUser, async (req, res) => {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId required' });
    try {
        await db.execute(
            `DELETE FROM favorites WHERE tg_id = $1 AND product_id = $2`,
            [req.tgId, String(productId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
