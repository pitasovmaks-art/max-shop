/* Общая логика цены позиции корзины — раньше effectiveItemPrice() была
   продублирована в src/cart/checkout.js И src/cart/cart.js (две байт-в-
   байт идентичные копии), а пересборка цены по свежим данным товара
   (_checkCartItem) была только в checkout.js. fix-cart-prices-city
   (см. PROGRESS.md) добавляет тот же пересчёт и в cart.js — без этого
   файла получилась бы третья копия effectiveItemPrice и вторая копия
   _checkCartItem. Обе функции отсюда используют и checkout.js, и
   cart.js (подключается отдельным <script> перед обоими).

   Серверная копия (server/utils/pricing.js:effectiveItemPrice) этот
   файл НЕ использует и останется отдельной — страница на клиенте не
   должна зависеть от Node-кода сервера, формулу там поддерживают
   руками, синхронно с этой (см. комментарий в server/utils/pricing.js
   и server/scripts/test-pricing-match.js, который их сверяет). */

function cartServicePrice(service, city) {
    return Number(city === 'krd' ? service?.priceKrd : service?.priceMsk) || 0;
}

function effectiveItemPrice(item, city, deliveryMethod) {
    // Delivery changes fulfilment, never the city's product price.
    const krd = city === 'krd';
    const base = krd ? item.priceKrdPickup || item.priceKrd : item.priceMskPickup || item.priceMsk;
    const sale = krd ? item.salePriceKrd : item.salePriceMsk;
    const extra = cartServicePrice(item.extraService, city);
    if (!base || (item.extraService && extra <= 0)) return null;
    return (sale > 0 ? sale : base) + extra;
}

/* Пересобирает цену ОДНОЙ позиции корзины по свежим данным товара
   (вариант/наличие/скидка) — порт _checkCartItem() из checkout.js,
   теперь параметризован city/deliveryMethod явно (раньше city читался
   из localStorage прямо внутри функции, а deliveryMethod — из
   модульной переменной checkout.js; оба способа работали только в
   checkout.js). item: { id, name, variantLabel, qty }. freshProducts —
   массив из GET /api/products. Возвращает:
   - { ok:false, price:0, reason } — товара нет / не в наличии /
     недоступен в городе / цена не определена;
   - { ok:true, price, fields } — fields — пересобранные price-поля
     позиции (priceKrdPickup/priceMskPickup/.../salePriceKrd/salePriceMsk),
     чтобы вызывающий код мог сохранить их обратно в объект позиции
     корзины (так cart.js держит у себя актуальные данные для
     отображения скидки/варианта, не только итоговую цену). */
function resolveFreshCartItem(item, freshProducts, city, deliveryMethod) {
    const p = freshProducts.find(pr => pr.id === item.id);
    if (!p) return { ok: false, price: 0, reason: `«${item.name}» больше не существует` };
    if (!p.inStock && !p.isService) return { ok: false, price: 0, reason: `«${item.name}» нет в наличии` };

    const label  = item.variantLabel ?? '';
    const isKrd  = city === 'krd';
    const hasVariants = (p.variants || []).length > 0;

    let fields;
    if (hasVariants) {
        const krdVar = p.variants.find(v => v.isKrd  && v.label === label) || null;
        const mskVar = p.variants.find(v => !v.isKrd && v.label === label) || null;

        if (isKrd && !krdVar) return { ok: false, price: 0, reason: `«${item.name}» недоступен в выбранном городе` };
        if (!isKrd && !mskVar) return { ok: false, price: 0, reason: `«${item.name}» недоступен в выбранном городе` };

        fields = {
            priceKrdPickup:   krdVar?.priceKrdPickup   || 0,
            priceMskPickup:   mskVar?.priceMskPickup   || 0,
            priceMskDelivery: mskVar?.priceMskDelivery || 0,
            priceDelivery:    mskVar?.priceMskDelivery || 0,
            salePriceKrd:     krdVar?.salePrice        || 0,
            salePriceMsk:     mskVar?.salePrice        || 0,
        };
    } else {
        fields = {
            priceKrdPickup:   p.priceKrdPickup   || p.priceKrd      || p.price || 0,
            priceMskPickup:   p.priceMskPickup   || p.priceMsk      || p.price || 0,
            priceMskDelivery: p.priceMskDelivery || p.priceDelivery || 0,
            priceDelivery:    p.priceMskDelivery || p.priceDelivery || 0,
            salePriceKrd: 0, salePriceMsk: 0,
        };
    }

    if (item.extraService) {
        const service = p.warranty?.service;
        if (!cartServicePrice(service, city)) {
            return { ok: false, price: 0, reason: `Сервис для «${item.name}» недоступен. Уберите его в корзине.` };
        }
        fields.extraService = service;
    }
    const price = effectiveItemPrice(fields, city, deliveryMethod);
    if (!price || price <= 0) return { ok: false, price: 0, reason: `Цена «${item.name}» не определена` };
    return { ok: true, price, fields };
}
