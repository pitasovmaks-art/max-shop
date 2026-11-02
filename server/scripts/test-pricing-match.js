/* Прямая проверка требования из ревизии слияния (security/merge-
   reconciled): «оформи тестовый заказ со скидкой и покажи, что сервер
   посчитал ту же сумму, что видит покупатель».

   В проекте нет промокодов/купонов — скидка это sale_price на варианте
   товара (см. admin.js/product.js, переключатель «Скидка»). Это тот
   механизм, который здесь проверяется.

   Два независимых способа показать совпадение:
   1. Прямое сравнение формул: effectiveItemPrice() из src/cart/
      checkout.js (что видит покупатель на чекауте) и effectiveItemPrice()
      из server/utils/pricing.js (чем сервер пересчитывает цену) — на
      одних и тех же входных данных, для всех веток формулы (КРД,
      МСК-самовывоз, доставка по России со скидкой и наценкой).
   2. Настоящий заказ через POST /api/orders (server/routes/orders.js) —
      клиент присылает заведомо неверную цену (1₽), сервер её
      игнорирует; сверяем сохранённую сумму с тем, что посчитала бы
      ТА ЖЕ клиентская формула для того же товара/города/доставки.

   Архитектура — как в test-orders.js: db.query/queryOne/execute
   подменены на in-memory заглушку, requireUser настоящий.

   Запуск: node server/scripts/test-pricing-match.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
// orders.js импортирует requireAdmin из server/middleware/auth.js, который
// теперь бросает исключение при require(), если ADMIN_PASSWORD не задан
// (аудит безопасности, находка C).
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const vm      = require('vm');
const db      = require('../db');

function buildSignedInitData(user, botToken, authDate) {
    const sp = new URLSearchParams();
    sp.set('auth_date', String(authDate || Math.floor(Date.now() / 1000)));
    sp.set('user', JSON.stringify(user));
    const pairs = [];
    for (const [k, v] of sp.entries()) pairs.push(`${k}=${v}`);
    pairs.sort();
    const dataCheckString = pairs.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    sp.set('hash', hash);
    return encodeURIComponent(sp.toString());
}

/* ─── Подмена bot.js (шпион вместо реальной отправки) ───────────────── */
const botPath = require.resolve('../../bot');
require.cache[botPath] = {
    id: botPath, filename: botPath, loaded: true,
    exports: { notifyStore: async () => {}, notifyCustomer: async () => {} },
};

/* ─── Клиентская формула effectiveItemPrice() — РЕАЛЬНЫЙ файл в
   песочнице (node:vm): сама функция не трогает DOM, но checkout.js
   целиком регистрирует document.addEventListener в самом низу —
   минимальная заглушка document достаточна, чтобы его загрузить и
   достать функцию. С fix-cart-prices-city effectiveItemPrice() вынесена
   из checkout.js в src/shared/cartPricing.js (общий файл с cart.js, см.
   PROGRESS.md) — грузим оба файла в один контекст, в том же порядке,
   что реальный checkout.html (cartPricing.js раньше checkout.js). */
function loadClientEffectiveItemPrice() {
    const sharedCode   = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'cartPricing.js'), 'utf8');
    const checkoutCode = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'cart', 'checkout.js'), 'utf8');
    const ctx = vm.createContext({ console, document: { addEventListener() {} }, window: {} });
    vm.runInContext(sharedCode,   ctx, { filename: 'cartPricing.js' });
    vm.runInContext(checkoutCode, ctx, { filename: 'checkout.js' });
    return (item, city, deliveryMethod) => vm.runInContext(
        `effectiveItemPrice(${JSON.stringify(item)}, ${JSON.stringify(city)}, ${JSON.stringify(deliveryMethod)})`,
        ctx
    );
}

/* ─── Серверная формула — обычный require, тот же файл, что использует
   server/routes/orders.js. ───────────────────────────────────────── */
const { effectiveItemPrice: serverEffectiveItemPrice, resolveOrderItem } = require('../utils/pricing');

/* ─── Товар со скидкой на варианте: обычная цена 1000₽, цена со скидкой
   (sale_price) 800₽ — во всех городах/способах доставки, просто чтобы
   сравнение формул ниже было одинаково однозначным везде. ──────────── */
const FRESH_SALE_ITEM = {
    priceKrdPickup: 1000, salePriceKrd: 800,
    priceMskPickup: 1000, salePriceMsk: 800,
    priceMskDelivery: 1200, priceDelivery: 1200,
};

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const clientEffectiveItemPrice = loadClientEffectiveItemPrice();

    /* ── 1. Формулы совпадают на всех ветках (КРД / МСК / Россия) ──── */
    const scenarios = [
        { label: 'КРД, самовывоз, со скидкой',            city: 'krd', delivery: 'pickup' },
        { label: 'МСК, самовывоз, со скидкой',             city: 'msk', delivery: 'pickup' },
        { label: 'МСК, доставка по России, со скидкой',    city: 'msk', delivery: 'russia' },
    ];
    for (const sc of scenarios) {
        const clientPrice = clientEffectiveItemPrice(FRESH_SALE_ITEM, sc.city, sc.delivery);
        const serverPrice = serverEffectiveItemPrice(FRESH_SALE_ITEM, sc.city, sc.delivery);
        check(`${sc.label}: клиентская и серверная формулы дают одну и ту же цену (${serverPrice}₽)`,
            clientPrice === serverPrice && clientPrice != null);
    }

    // Regression: Krasnodar warranty choice must not become Moscow pricing.
    const prices = {priceKrdPickup:19990,salePriceKrd:18990,priceMskPickup:18000,salePriceMsk:17550,priceMskDelivery:18000};
    for (const [city,expected] of [['krd',18990],['msk',17550]]) {
        for (const method of ['pickup','city','russia']) {
            check(`${city}/${method}: client preserves selected city's price`,clientEffectiveItemPrice(prices,city,method)===expected);
            check(`${city}/${method}: server preserves selected city's price`,serverEffectiveItemPrice(prices,city,method)===expected);
        }
    }
    const product={id:9,name:'Инструмент',in_stock:1,variants:[
        {label:'Гарантия 14 дней',is_krd:1,price_krd_pickup:19990,sale_price:18990},
        {label:'Гарантия 14 дней',is_krd:0,price_msk_pickup:18000,price_msk_delivery:18000,sale_price:17550},
        {label:'Гарантия 12 месяцев',is_krd:1,price_krd_pickup:25000,sale_price:0},
    ]};
    const map=new Map([[9,product]]);
    let resolved=resolveOrderItem({id:9,variantLabel:'Гарантия 14 дней'},map,'krd','russia');
    check('Krasnodar Russia order uses 18990, not Moscow 17550',resolved.ok && resolved.price===18990);
    resolved=resolveOrderItem({id:9,variantLabel:'Гарантия 12 месяцев'},map,'krd','russia');
    check('Krasnodar-only warranty stays available without Moscow counterpart/delivery field',resolved.ok && resolved.price===25000 && resolved.name.includes('12 месяцев'));
    resolved=resolveOrderItem({id:9,variantLabel:'Гарантия 12 месяцев'},map,'msk','russia');
    check('Russia delivery cannot substitute another city or warranty when selected one is unavailable',!resolved.ok);

    /* ── 2. Настоящий заказ: сервер игнорирует цену от клиента, но
       сохранённая сумма совпадает с тем, что увидел бы покупатель на
       чекауте по той же формуле. ─────────────────────────────────── */
    const PRODUCT_ID = 42;
    const PRODUCT = { id: PRODUCT_ID, name: 'Перфоратор со скидкой', in_stock: 1, is_service: 0, price: 0, price_krd: 0, price_msk: 0, price_delivery: 0 };
    const VARIANT  = {
        id: 421, product_id: PRODUCT_ID, label: 'Стандарт', is_krd: 0,
        price_krd_pickup: 0, price_msk_pickup: 1000, price_msk_delivery: 1200, sale_price: 800,
    };

    let orders = [];
    let nextOrderId = 1;
    db.query = async (sql, params = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('SELECT * FROM products WHERE id IN'))         return params.includes(PRODUCT_ID) ? [PRODUCT] : [];
        if (s.startsWith('SELECT * FROM product_variants WHERE product_id IN')) return params.includes(PRODUCT_ID) ? [VARIANT] : [];
        throw new Error('test-pricing-match: неизвестный query: ' + s);
    };
    db.queryOne = async (sql, params = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s.startsWith('INSERT INTO orders')) {
            const [name, phone, store, delivery, address, city, tgId, comment, items, total] = params;
            const row = { id: nextOrderId++, name, phone, store, delivery, address, city, tg_id: tgId, comment, items, total };
            orders.push(row);
            return { id: row.id };
        }
        if (s.startsWith('SELECT * FROM orders WHERE id=$1')) {
            return orders.find(o => o.id === params[0]) || null;
        }
        throw new Error('test-pricing-match: неизвестный queryOne: ' + s);
    };
    db.execute = async () => { throw new Error('test-pricing-match: execute() не ожидался'); };

    require('./helpers/transactionStub')(db);
    const ordersRouter = require('../routes/orders');
    const app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const USER = 777333111;
    const initUser = buildSignedInitData({ id: USER, first_name: 'Покупатель' }, REAL_BOT_TOKEN);

    // То, что ПОКУПАТЕЛЬ увидел бы на чекауте для МСК, самовывоз —
    // той же клиентской формулой, что рисует итог на странице.
    const whatCustomerSees = clientEffectiveItemPrice(
        { priceMskPickup: VARIANT.price_msk_pickup, salePriceMsk: VARIANT.sale_price,
          priceMskDelivery: VARIANT.price_msk_delivery, priceDelivery: VARIANT.price_msk_delivery },
        'msk', 'pickup'
    );
    check('что видит покупатель на чекауте (МСК, самовывоз, со скидкой) = 800₽', whatCustomerSees === 800);

    // usd-pricing: заведомо неверная total теперь не тихо перезаписывается —
    // сервер отвечает 409 с реальной ценой, заказ не создаётся (см. PROGRESS.md).
    const rBad = await fetch(`${base}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Init-Data': initUser },
        body: JSON.stringify({
            name: 'Покупатель', phone: '+79990001122', store: 'Москва, Тестовая, 1',
            delivery: 'pickup', city: 'msk', items: [{ id: PRODUCT_ID, variantLabel: 'Стандарт', price: 1, qty: 1 }],
            total: 1, // клиент присылает заведомо неверную цену
        }),
    });
    const rBadBody = await rBad.json();
    check('POST /api/orders с неверной total -> 409 price_changed (заказ не создаётся)',
        rBad.status === 409 && rBadBody.error === 'price_changed');
    check('409 содержит реальную цену позиции (800₽), не присланную клиентом (1₽)', rBadBody.items[0].price === 800);
    check('заказ не создан при 409', orders.length === 0);

    const r = await fetch(`${base}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Init-Data': initUser },
        body: JSON.stringify({
            name: 'Покупатель', phone: '+79990001122', store: 'Москва, Тестовая, 1',
            delivery: 'pickup', city: 'msk', items: [{ id: PRODUCT_ID, variantLabel: 'Стандарт', price: 1, qty: 1 }],
            total: 800, // правильная total (как из тела 409 выше)
        }),
    });
    check('POST /api/orders (заказ со скидкой, правильная total) -> 201', r.status === 201);

    const saved = orders[orders.length - 1];
    const savedItemPrice = JSON.parse(saved.items)[0].price;
    check(`сервер сохранил реальную цену позиции (${savedItemPrice}₽), не присланную клиентом (1₽)`, savedItemPrice === 800);
    check('сохранённая цена позиции = та же сумма, что видел покупатель на чекауте',
        savedItemPrice === whatCustomerSees);
    check('итог заказа = цена × количество = 800₽', saved.total === 800);

    server.close();

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
