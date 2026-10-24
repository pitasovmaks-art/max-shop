const router           = require('express').Router();
const db                = require('../db');
const { requireUser }   = require('../middleware/requireUser');
const { loadProductsForPricing, effectiveItemPrice } = require('../utils/pricing');

const MAX_ITEMS = 100;

/* Общая логика цены для строки корзины — та же модель, что показывает
   сама страница корзины (cart.js): effectiveItemPrice(fresh, city, null),
   без метода доставки (он выбирается только на чекауте). Используется и
   здесь (POST), и в server/routes/usd-rate.js (пересчёт после смены
   курса) — одна функция вместо двух копий. Возвращает число (рубли) или
   null, если позицию в этом городе/с этим вариантом сейчас нечем ценить. */
function computeCartItemPrice(productsById, productId, variantLabel, city) {
    const p = productsById.get(productId);
    if (!p) return null;

    let fresh;
    if (p.variants.length > 0) {
        const krdVar = p.variants.find(v => v.is_krd === 1 && v.label === variantLabel) || null;
        const mskVar = p.variants.find(v => v.is_krd !== 1 && v.label === variantLabel) || null;
        fresh = {
            priceKrdPickup: krdVar ? krdVar.price_krd_pickup || 0 : 0,
            priceMskPickup: mskVar ? mskVar.price_msk_pickup || 0 : 0,
            salePriceKrd:   krdVar ? krdVar.sale_price || 0 : 0,
            salePriceMsk:   mskVar ? mskVar.sale_price || 0 : 0,
        };
    } else {
        fresh = {
            priceKrdPickup: p.price_krd || p.price || 0,
            priceMskPickup: p.price_msk || p.price || 0,
            salePriceKrd: 0, salePriceMsk: 0,
        };
    }
    return effectiveItemPrice(fresh, city, null);
}

/* POST /api/cart-sync — зеркалит состав корзины на сервер (usd-pricing,
   см. PROGRESS.md): только для уведомлений о смене цены при смене курса,
   сама корзина остаётся localStorage-only и НЕ пересчитывается здесь.

   Полная замена, не upsert: при каждой синхронизации все строки tg_id
   удаляются и вставляются заново в одной транзакции — так клиенту не
   нужно отдельно сообщать об удалении позиций, достаточно прислать
   текущий полный список (пустой items = корзина пуста/очищена).

   price_seen считает СЕРВЕР (та же effectiveItemPrice, что и для
   заказа) — цена, присланная клиентом, нигде не читается и не
   используется, по аналогии с POST /api/orders. */
router.post('/', requireUser, async (req, res) => {
    const tgId = req.tgId;
    const { items, city } = req.body || {};
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });
    if (items.length > MAX_ITEMS) {
        return res.status(400).json({ error: `Слишком много позиций в корзине (максимум ${MAX_ITEMS})` });
    }
    const cityVal = typeof city === 'string' ? city.slice(0, 20) : '';

    try {
        const validIds = [...new Set(
            items.map(it => (it && Number.isInteger(it.productId) && it.productId > 0) ? it.productId : null)
                 .filter(id => id !== null)
        )];
        const productsById = await loadProductsForPricing(validIds);

        const rows = [];
        for (const it of items) {
            if (!it || !Number.isInteger(it.productId) || it.productId <= 0) continue;
            if (!Number.isInteger(it.qty) || it.qty < 1) continue;
            const variantLabel = typeof it.variantLabel === 'string' ? it.variantLabel.slice(0, 200) : '';

            const price = computeCartItemPrice(productsById, it.productId, variantLabel, cityVal);
            if (!price || price <= 0) continue; // нечем ценить (нет в этом городе/нет цены) — просто не синхронизируем строку

            rows.push({ productId: it.productId, variantLabel, qty: it.qty, priceSeen: price });
        }

        await db.inTransaction(async (client) => {
            await client.query('DELETE FROM cart_sync WHERE tg_id=$1', [tgId]);
            for (const r of rows) {
                await client.query(
                    `INSERT INTO cart_sync (tg_id, product_id, variant_label, city, qty, price_seen)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [tgId, r.productId, r.variantLabel, cityVal, r.qty, r.priceSeen]
                );
            }
        });

        res.json({ ok: true, count: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.computeCartItemPrice = computeCartItemPrice;
