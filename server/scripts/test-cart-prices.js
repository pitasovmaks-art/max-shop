/* Проверка пересборки цен корзины по свежим данным (fix-cart-prices-city,
   см. PROGRESS.md): src/shared/cartPricing.js:resolveFreshCartItem() —
   общая функция, которой cart.js теперь пересчитывает позиции корзины
   при открытии страницы (раньше так делал только checkout.js перед
   отправкой заказа). Грузим РЕАЛЬНЫЙ файл в node:vm (как test-pricing-
   match.js грузит checkout.js) и гоняем его прямо на fresh-данных в
   форме ответа GET /api/products (camelCase, variants[]), без HTTP и
   без БД — это чистая функция.

   Сценарии: рублёвый товар без вариантов, товар с $-вариантом (цена уже
   конвертирована сервером в ₽ — клиентский код не отличает $ от ₽,
   просто проверяем, что пересборка работает и на таких данных так же),
   товар со скидкой (срабатывает/перестаёт срабатывать), смена города
   (был доступен в одном, недоступен в другом, и наоборот).

   Запуск: node server/scripts/test-cart-prices.js
*/
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

function loadCartPricing() {
    const code = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'cartPricing.js'), 'utf8');
    const ctx = vm.createContext({ console });
    vm.runInContext(code, ctx, { filename: 'cartPricing.js' });
    return {
        effectiveItemPrice: (item, city, deliveryMethod) => vm.runInContext(
            `effectiveItemPrice(${JSON.stringify(item)}, ${JSON.stringify(city)}, ${JSON.stringify(deliveryMethod)})`,
            ctx
        ),
        resolveFreshCartItem: (item, freshProducts, city, deliveryMethod) => vm.runInContext(
            `resolveFreshCartItem(${JSON.stringify(item)}, ${JSON.stringify(freshProducts)}, ${JSON.stringify(city)}, ${JSON.stringify(deliveryMethod)})`,
            ctx
        ),
    };
}

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const { resolveFreshCartItem } = loadCartPricing();

    /* ═══ 1. Рублёвый товар без вариантов — цена выросла ═══════════════ */
    {
        const cartItem = { id: 1, name: 'Шуруповёрт', qty: 1, price: 1000 };
        const freshProducts = [{
            id: 1, inStock: true, variants: [],
            priceKrd: 1200, priceMsk: 1300, priceDelivery: 1500,
        }];
        const r = resolveFreshCartItem(cartItem, freshProducts, 'krd', null);
        check('рублёвый товар: цена пересобрана по свежим данным (1200₽)', r.ok && r.price === 1200);
        check('рублёвый товар: fields.priceKrdPickup отражает новую цену', r.fields.priceKrdPickup === 1200);
    }

    /* ═══ 2. $-вариант (сервер уже отдал конвертированные ₽) — скидка ══ */
    {
        // $10 при курсе 90 -> 900₽ (round-up до 50 уже применён сервером,
        // клиентский код про $ ничего не знает — ему всё равно ₽).
        const cartItem = { id: 2, name: 'USD-товар', variantLabel: 'Стандарт', qty: 2, price: 900 };
        const freshProducts = [{
            id: 2, inStock: true,
            variants: [
                { label: 'Стандарт', isKrd: true,  priceKrdPickup: 1800, salePrice: 0 }, // курс выше -> $10 -> 1800₽
                { label: 'Стандарт', isKrd: false, priceMskPickup: 1850, priceMskDelivery: 2000, salePrice: 0 },
            ],
        }];
        const r = resolveFreshCartItem(cartItem, freshProducts, 'krd', null);
        check('$-вариант: новая цена после смены курса подхватывается (1800₽)', r.ok && r.price === 1800);
    }

    /* ═══ 3. Скидка появилась/исчезла ═══════════════════════════════════ */
    {
        const cartItem = { id: 3, name: 'Перфоратор', variantLabel: 'M', qty: 1, price: 5000 };
        const withSale = [{
            id: 3, inStock: true,
            variants: [{ label: 'M', isKrd: true, priceKrdPickup: 5000, salePrice: 4000 }],
        }];
        const rSale = resolveFreshCartItem(cartItem, withSale, 'krd', null);
        check('скидка появилась: цена = sale_price (4000₽), не полная (5000₽)', rSale.ok && rSale.price === 4000);

        const withoutSale = [{
            id: 3, inStock: true,
            variants: [{ label: 'M', isKrd: true, priceKrdPickup: 5000, salePrice: 0 }],
        }];
        const rNoSale = resolveFreshCartItem(cartItem, withoutSale, 'krd', null);
        check('скидка закончилась: цена вернулась к полной (5000₽)', rNoSale.ok && rNoSale.price === 5000);
    }

    /* ═══ 4. Смена города: доступен/недоступен ═══════════════════════ */
    {
        const cartItem = { id: 4, name: 'Товар только для МСК', variantLabel: '', qty: 1, price: 700 };
        const freshProducts = [{
            id: 4, inStock: true,
            variants: [{ label: '', isKrd: false, priceMskPickup: 700, priceMskDelivery: 900 }], // нет КРД-строки
        }];
        const rKrd = resolveFreshCartItem(cartItem, freshProducts, 'krd', null);
        check('нет КРД-варианта: при городе krd товар недоступен (ok:false)', rKrd.ok === false);
        check('недоступен: понятная причина содержит "недоступен в выбранном городе"', /недоступен/.test(rKrd.reason));

        const rMsk = resolveFreshCartItem(cartItem, freshProducts, 'msk', null);
        check('тот же товар доступен в msk (ok:true, 700₽)', rMsk.ok && rMsk.price === 700);
    }

    /* ═══ 5. Товар пропал/не в наличии — отдельные причины ═══════════ */
    {
        const cartItem = { id: 5, name: 'Удалённый товар', qty: 1, price: 100 };
        const r = resolveFreshCartItem(cartItem, [], 'krd', null);
        check('товара больше нет в каталоге -> ok:false, "больше не существует"', !r.ok && /больше не существует/.test(r.reason));

        const cartItem2 = { id: 6, name: 'Товар не в наличии', qty: 1, price: 100 };
        const fresh2 = [{ id: 6, inStock: false, isService: false, variants: [], priceKrd: 100, priceMsk: 100 }];
        const r2 = resolveFreshCartItem(cartItem2, fresh2, 'krd', null);
        check('товар не в наличии -> ok:false, "нет в наличии"', !r2.ok && /нет в наличии/.test(r2.reason));
    }

    // Exercise the actual asynchronous cart refresh, not only the price helper.
    const storage = new Map([['city', 'krd']]);
    let pending = [];
    const context = vm.createContext({
        console, window: {}, document: { addEventListener() {} },
        localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) },
        fetch: () => new Promise(resolve => pending.push(resolve)),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/shared/cartPricing.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src/cart/cart.js'), 'utf8'), context);
    vm.runInContext('render = function() {};', context);
    const item = { id: 1, key: '1', qty: 1, price: 100, priceKrd: 100, priceMsk: 100 };
    const response = price => ({ ok: true, json: async () => [{id:1, inStock:true, priceKrd:price, priceMsk:price}] });
    storage.set('cart', JSON.stringify([item]));
    let refresh = vm.runInContext('refreshCartPrices()', context);
    storage.set('cart', '[]');
    pending.shift()(response(200)); await refresh;
    check('refresh does not restore a removed item', JSON.parse(storage.get('cart')).length === 0);
    storage.set('cart', JSON.stringify([item]));
    refresh = vm.runInContext('refreshCartPrices()', context);
    storage.set('cart', JSON.stringify([{...item, qty: 3}]));
    pending.shift()(response(200)); await refresh;
    check('refresh preserves current quantity', JSON.parse(storage.get('cart'))[0].qty === 3);
    refresh = vm.runInContext('refreshCartPrices()', context);
    pending.shift()({ok:true, json:async () => []}); await refresh;
    check('unavailable item cannot fall back to legacy prices', vm.runInContext("effectiveItemPrice(getCart()[0], 'krd', null)", context) === null);
    storage.set('cart', JSON.stringify([item]));
    const first = vm.runInContext('refreshCartPrices()', context);
    const second = vm.runInContext('refreshCartPrices()', context);
    const oldResponse = pending.shift(), newResponse = pending.shift();
    newResponse(response(300)); await second;
    oldResponse(response(200)); await first;
    check('older response cannot overwrite newer prices', JSON.parse(storage.get('cart'))[0].price === 300);
    refresh = vm.runInContext('refreshCartPrices()', context);
    pending.shift()({ok:false}); await refresh;
    check('HTTP error preserves previous prices', JSON.parse(storage.get('cart'))[0].price === 300);
    refresh = vm.runInContext('refreshCartPrices()', context);
    pending.shift()({ok:true,json:async()=>({error:'bad response'})}); await refresh;
    check('invalid API payload preserves previous prices', JSON.parse(storage.get('cart'))[0].price === 300);

    console.log(failures === 0
        ? '\n✅ Все проверки прошли'
        : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
