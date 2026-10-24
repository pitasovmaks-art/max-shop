const db = require('../db');
const usdPrice = require('./usdPrice');

/* Пересчёт цены позиции заказа на сервере по реальным данным из БД — та же
   формула, что effectiveItemPrice()/_checkCartItem() в src/cart/checkout.js,
   построчный порт. Если меняете алгоритм в checkout.js — меняйте и здесь,
   иначе сервер начнёт отклонять легитимные заказы или (хуже) считать иначе,
   чем показано покупателю на чекауте. */
function effectiveItemPrice(item, city, deliveryMethod) {
    if (deliveryMethod === 'russia') {
        const delivery = item.priceMskDelivery || item.priceDelivery || 0;
        if (!delivery) return null;
        const sale   = item.salePriceMsk || 0;
        const pickup = item.priceMskPickup || item.priceMsk || 0;
        if (sale > 0 && pickup > 0) {
            const surcharge     = delivery - pickup;
            const saleDelivery  = sale + (surcharge > 0 ? surcharge : 0);
            return Math.min(saleDelivery, delivery);
        }
        return delivery;
    }
    if (city === 'krd') {
        const base = item.priceKrdPickup || item.priceKrd || 0;
        const sale = item.salePriceKrd || 0;
        return base ? (sale > 0 ? sale : base) : null;
    }
    const base = item.priceMskPickup || item.priceMsk || 0;
    const sale = item.salePriceMsk || 0;
    return base ? (sale > 0 ? sale : base) : null;
}

/* Грузит товары + их варианты из БД по списку id, в Map<id, product> с
   полем .variants (как attachVariants() в server/routes/products.js, но
   без normalize() наружу — тут нужны сырые колонки price_krd_pickup и т.п.,
   не camelCase-ответ API). */
async function loadProductsForPricing(ids) {
    const map = new Map();
    if (!ids.length) return map;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const products = await db.query(`SELECT * FROM products WHERE id IN (${placeholders})`, ids);
    let variants = await db.query(`SELECT * FROM product_variants WHERE product_id IN (${placeholders})`, ids);

    // usd-pricing: пересчёт $->₽ один раз на вызов, только если среди
    // загруженных вариантов реально есть $-строки (лишний запрос курса
    // не нужен для чисто рублёвых заказов). Курс кладём на сам Map
    // (map.usdRateX10000), чтобы resolveOrderItem() мог прочитать его
    // синхронно, не делая отдельный запрос в БД на каждую позицию.
    let rate = null;
    if (variants.some(v => Number(v.is_usd) === 1)) {
        rate = await usdPrice.getCurrentRate();
        variants = variants.map(v => usdPrice.applyUsdToVariantRow(v, rate));
    }
    map.usdRateX10000 = rate;

    const byProduct = new Map();
    variants.forEach(v => {
        if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
        byProduct.get(v.product_id).push(v);
    });
    products.forEach(p => map.set(p.id, Object.assign({}, p, { variants: byProduct.get(p.id) || [] })));
    return map;
}

/* Пересчитывает реальную цену и название одной позиции заказа — порт
   _checkCartItem() из checkout.js. cartItem: { id, variantLabel, qty }.
   Возвращает { ok:true, price, name } либо { ok:false, reason }. */
function resolveOrderItem(cartItem, productsById, city, deliveryMethod) {
    const p = productsById.get(cartItem.id);
    if (!p) return { ok: false, reason: `Товар #${cartItem.id} не найден` };
    if (p.in_stock !== 1 && p.is_service !== 1) {
        return { ok: false, reason: `«${p.name}» нет в наличии` };
    }

    const label = cartItem.variantLabel || '';
    const isKrd = city === 'krd';
    const hasVariants = p.variants.length > 0;
    const krdVar = hasVariants ? (p.variants.find(v => v.is_krd === 1 && v.label === label) || null) : null;
    const mskVar = hasVariants ? (p.variants.find(v => v.is_krd !== 1 && v.label === label) || null) : null;

    let fresh;
    let name = p.name;

    if (hasVariants) {
        if (isKrd && !krdVar) return { ok: false, reason: `«${p.name}» недоступен в выбранном городе` };
        if (!isKrd && deliveryMethod !== 'russia' && !mskVar) {
            return { ok: false, reason: `«${p.name}» недоступен в выбранном городе` };
        }

        fresh = {
            priceKrdPickup:   krdVar ? krdVar.price_krd_pickup   || 0 : 0,
            priceMskPickup:   mskVar ? mskVar.price_msk_pickup   || 0 : 0,
            priceMskDelivery: mskVar ? mskVar.price_msk_delivery || 0 : 0,
            priceDelivery:    mskVar ? mskVar.price_msk_delivery || 0 : 0,
            salePriceKrd:     krdVar ? krdVar.sale_price || 0 : 0,
            salePriceMsk:     mskVar ? mskVar.sale_price || 0 : 0,
        };
        if (label) name = `${p.name} (${label})`;
    } else {
        fresh = {
            priceKrdPickup:   p.price_krd      || p.price || 0,
            priceMskPickup:   p.price_msk      || p.price || 0,
            priceMskDelivery: p.price_delivery || 0,
            priceDelivery:    p.price_delivery || 0,
            salePriceKrd: 0, salePriceMsk: 0,
        };
    }

    const price = effectiveItemPrice(fresh, city, deliveryMethod);
    if (!price || price <= 0) return { ok: false, reason: `Цена «${p.name}» не определена` };

    // usd-pricing, п.11: для аудита сохраняем $ и курс, которым позиция
    // была посчитана на момент заказа (старые заказы это не трогает —
    // пишется только при создании). Берём usd-вариант, который реально
    // определял цену в этом городе (krdVar для КРД, иначе mskVar); сам
    // rub-пересчёт (скидка/наценка доставки) НЕ переигрывается — это
    // только для справки, не часть формулы effectiveItemPrice.
    let usdInfo = null;
    const usedVariant = isKrd ? krdVar : mskVar;
    if (usedVariant && Number(usedVariant.is_usd) === 1) {
        const usdCents = isKrd ? usedVariant.usd_price_krd_pickup : usedVariant.usd_price_msk_pickup;
        usdInfo = { priceUsdCents: usdCents, rateX10000: productsById.usdRateX10000 };
    }

    return usdInfo ? { ok: true, price, name, ...usdInfo } : { ok: true, price, name };
}

module.exports = { effectiveItemPrice, loadProductsForPricing, resolveOrderItem };
