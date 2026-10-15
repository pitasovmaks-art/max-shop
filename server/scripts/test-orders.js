/* Проверка POST/GET /api/orders (server/routes/orders.js) и пересчёта
   цены на сервере (server/utils/pricing.js) — без реального Postgres и
   без реальной отправки сообщений ботом.

   Архитектура — та же, что в test-service-requests.js: db.query/queryOne/
   execute подменены на маленькую in-memory реализацию, которая распознаёт
   ровно те SQL-формы, которые реально строят orders.js и pricing.js;
   bot.js подменён через require.cache ПЕРЕД require('../routes/orders')
   (notifyStore/notifyCustomer — шпионы); requireUser — настоящий, initData
   подписываются тем же алгоритмом, что verifyInitData ожидает.

   Главная цель: доказать, что сервер больше не доверяет price/total от
   клиента — а всегда пересчитывает их по данным из products/product_variants,
   той же формулой, что effectiveItemPrice()/_checkCartItem() в
   src/cart/checkout.js.

   Запуск: node server/scripts/test-orders.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;

const crypto  = require('crypto');
const express = require('express');
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
let lastNotifyStoreCall = null;
const fakeBot = {
    notifyStore:    async (order) => { lastNotifyStoreCall = order; },
    notifyCustomer: async () => {},
};
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot };

/* ─── In-memory «БД»: products / product_variants / orders ─────────── */
let nextOrderId = 1;
let orders = [];

/* Товар без вариантов — price=1000, price_krd=900, price_msk=1000,
   price_delivery=1200, скидок нет (скидка возможна только у вариантов). */
const PRODUCT_NO_VARIANTS = {
    id: 1, name: 'Пистолет Toua NTC57', in_stock: 1, is_service: 0,
    price: 1000, price_krd: 900, price_msk: 1000, price_delivery: 1200,
};

/* Товар с вариантами — лейбл "M": КРД-вариант 500₽, МСК-вариант 550₽
   (самовывоз) / 700₽ (доставка по России), со скидкой 600₽. */
const PRODUCT_WITH_VARIANTS = {
    id: 2, name: 'Аккумуляторный шуруповёрт', in_stock: 1, is_service: 0,
    price: 0, price_krd: 0, price_msk: 0, price_delivery: 0,
};
const VARIANTS_PRODUCT_2 = [
    { id: 21, product_id: 2, label: 'M', is_krd: 1, price_krd_pickup: 500, price_msk_pickup: 0,   price_msk_delivery: 0,   sale_price: 0 },
    { id: 22, product_id: 2, label: 'M', is_krd: 0, price_krd_pickup: 0,   price_msk_pickup: 550, price_msk_delivery: 700, sale_price: 600 },
];

/* Нет в наличии (и не услуга) — должен блокироваться независимо от цены. */
const PRODUCT_OUT_OF_STOCK = {
    id: 3, name: 'Расходники (нет на складе)', in_stock: 0, is_service: 0,
    price: 300, price_krd: 300, price_msk: 300, price_delivery: 350,
};

/* Услуга — in_stock=0, но заказывается (ремонт и т.п. не требуют склада). */
const PRODUCT_SERVICE = {
    id: 4, name: 'Диагностика инструмента', in_stock: 0, is_service: 1,
    price: 500, price_krd: 500, price_msk: 500, price_delivery: 0,
};

/* Цена не определена вообще (все поля 0) — должен блокироваться. */
const PRODUCT_NO_PRICE = {
    id: 5, name: 'Товар без цены', in_stock: 1, is_service: 0,
    price: 0, price_krd: 0, price_msk: 0, price_delivery: 0,
};

const ALL_PRODUCTS = [PRODUCT_NO_VARIANTS, PRODUCT_WITH_VARIANTS, PRODUCT_OUT_OF_STOCK, PRODUCT_SERVICE, PRODUCT_NO_PRICE];
const ALL_VARIANTS = [...VARIANTS_PRODUCT_2];

function resetDb() {
    nextOrderId = 1;
    orders = [];
}

function isoNow() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }

db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM products WHERE id IN')) {
        return ALL_PRODUCTS.filter(p => params.includes(p.id));
    }
    if (s.startsWith('SELECT * FROM product_variants WHERE product_id IN')) {
        return ALL_VARIANTS.filter(v => params.includes(v.product_id));
    }
    if (s.startsWith('SELECT * FROM orders WHERE tg_id=$1')) {
        const [tgId] = params;
        return orders.filter(o => o.tg_id === tgId).sort((a, b) => b.id - a.id);
    }
    if (s.startsWith('SELECT * FROM orders ORDER BY id DESC')) {
        return [...orders].sort((a, b) => b.id - a.id);
    }
    throw new Error('test-orders: неизвестный query: ' + s);
};

db.queryOne = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO orders')) {
        const [name, phone, store, delivery, address, city, tgId, comment, items, total] = params;
        const row = {
            id: nextOrderId++, name, phone, store, delivery, address, city,
            tg_id: tgId, comment, items, total, status: 'new',
            tracking_number: null, created_at: isoNow(),
        };
        orders.push(row);
        return { id: row.id };
    }
    if (s.startsWith('SELECT * FROM orders WHERE id=$1')) {
        const [id] = params;
        return orders.find(o => o.id === id) || null;
    }
    throw new Error('test-orders: неизвестный queryOne: ' + s);
};

db.execute = async () => { throw new Error('test-orders: execute() не ожидался в этих проверках'); };

const ordersRouter = require('../routes/orders');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const USER_A = 888111222;
    const initA = buildSignedInitData({ id: USER_A, first_name: 'A' }, REAL_BOT_TOKEN);

    async function post(body, initData) {
        const r = await fetch(`${base}/api/orders`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, initData ? { 'X-Init-Data': initData } : {}),
            body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    function baseBody(overrides) {
        return Object.assign({
            name: 'Иван Иванов',
            phone: '+7 (900) 123-45-67',
            store: 'Краснодар, ул. Селезнева, 4/10',
            delivery: 'pickup',
            city: 'krd',
            items: [{ id: 1, name: 'Подделанное название', price: 1, qty: 1 }],
            total: 1,
        }, overrides);
    }

    /* ── requireUser: без подписи -> 401 ─────────────────────────────── */
    resetDb();
    {
        const r = await post(baseBody(), null);
        check('POST без X-Init-Data -> 401', r.status === 401);
        check('заявка не сохранена', orders.length === 0);
    }

    /* ── Главное: клиент присылает заниженную цену — сервер игнорирует её
       и считает реальную ─────────────────────────────────────────────── */
    resetDb();
    {
        const r = await post(baseBody({
            city: 'krd', delivery: 'pickup',
            items: [{ id: 1, name: 'ЛОЖЬ', price: 1, qty: 3 }],
            total: 3,
        }), initA);
        check('заказ с заниженной ценой всё равно создаётся (товар реальный) -> 201', r.status === 201);
        const saved = orders[orders.length - 1];
        const items = JSON.parse(saved.items);
        check('цена позиции взята из БД (900₽ КРД), а не присланная (1₽)', items[0].price === 900);
        check('название позиции взято из БД ("Пистолет Toua NTC57"), а не из тела запроса', items[0].name === 'Пистолет Toua NTC57');
        check('итог пересчитан (900*3=2700), а не присланный (3)', saved.total === 2700);
        check('notifyStore получил реальную сумму', lastNotifyStoreCall && lastNotifyStoreCall.total === 2700);
    }

    /* ── Нулевая/произвольная цена — тоже не проходит ────────────────── */
    resetDb();
    {
        const r = await post(baseBody({
            city: 'msk', delivery: 'pickup',
            items: [{ id: 1, name: 'x', price: 0, qty: 1 }],
            total: 0,
        }), initA);
        check('нулевая цена от клиента игнорируется, заказ всё равно по реальной цене (1000₽ МСК)', r.status === 201);
        const saved = orders[orders.length - 1];
        check('сохранённая сумма — реальная, не 0', saved.total === 1000);
    }

    /* ── Товар с вариантами: КРД / МСК / Россия (со скидкой) ─────────── */
    resetDb();
    {
        const rKrd = await post(baseBody({
            city: 'krd', delivery: 'pickup',
            items: [{ id: 2, variantLabel: 'M', price: 1, qty: 1 }],
            total: 1,
        }), initA);
        check('вариант КРД -> 201, цена 500₽ (price_krd_pickup)', rKrd.status === 201 && JSON.parse(orders[orders.length - 1].items)[0].price === 500);

        const rMsk = await post(baseBody({
            city: 'msk', delivery: 'pickup',
            items: [{ id: 2, variantLabel: 'M', price: 1, qty: 1 }],
            total: 1,
        }), initA);
        check('вариант МСК -> 201, цена 600₽ (sale_price варианта)', rMsk.status === 201 && JSON.parse(orders[orders.length - 1].items)[0].price === 600);

        const rRussia = await post(baseBody({
            city: 'msk', delivery: 'russia',
            items: [{ id: 2, variantLabel: 'M', price: 1, qty: 2 }],
            total: 2,
        }), initA);
        check('доставка по России -> 201, цена 700₽ (формула sale+surcharge, не больше полной доставки)',
            rRussia.status === 201 && JSON.parse(orders[orders.length - 1].items)[0].price === 700);
        check('итог по России = 700*2 = 1400', orders[orders.length - 1].total === 1400);
    }

    /* ── Недопустимые позиции — 400, ничего не сохраняется ───────────── */
    resetDb();
    {
        const notFound = await post(baseBody({ items: [{ id: 999, price: 1, qty: 1 }], total: 1 }), initA);
        check('несуществующий товар -> 400', notFound.status === 400);

        const outOfStock = await post(baseBody({ items: [{ id: 3, price: 1, qty: 1 }], total: 1 }), initA);
        check('товар не в наличии (не услуга) -> 400', outOfStock.status === 400);

        const service = await post(baseBody({
            city: 'krd', items: [{ id: 4, price: 1, qty: 1 }], total: 1,
        }), initA);
        check('услуга (не в наличии, но is_service) -> 201, цена из БД (500₽)', service.status === 201);

        const noPrice = await post(baseBody({ items: [{ id: 5, price: 1, qty: 1 }], total: 1 }), initA);
        check('товар без цены в БД -> 400', noPrice.status === 400);

        const wrongVariant = await post(baseBody({
            city: 'krd', items: [{ id: 2, variantLabel: 'не существует', price: 1, qty: 1 }], total: 1,
        }), initA);
        check('вариант с несуществующим лейблом для города -> 400', wrongVariant.status === 400);

        check('ни одна из отклонённых заявок не сохранилась', orders.length === 1); // только «услуга» выше
    }

    /* ── Некорректные qty/id — 400 ────────────────────────────────────── */
    resetDb();
    {
        const badQty = await post(baseBody({ items: [{ id: 1, price: 1, qty: 0 }], total: 0 }), initA);
        check('qty=0 -> 400', badQty.status === 400);

        const hugeQty = await post(baseBody({ items: [{ id: 1, price: 1, qty: 100000 }], total: 1 }), initA);
        check('аномально большое qty -> 400', hugeQty.status === 400);

        const badId = await post(baseBody({ items: [{ id: 'drop table orders', price: 1, qty: 1 }], total: 1 }), initA);
        check('нечисловой id позиции -> 400', badId.status === 400);
    }

    /* ── Несколько позиций в одном заказе ─────────────────────────────── */
    resetDb();
    {
        const r = await post(baseBody({
            city: 'krd', delivery: 'pickup',
            items: [
                { id: 1, price: 1, qty: 2 },               // 900 * 2 = 1800
                { id: 2, variantLabel: 'M', price: 1, qty: 1 }, // 500
            ],
            total: 1,
        }), initA);
        check('заказ из 2 позиций -> 201', r.status === 201);
        check('итог = 1800 + 500 = 2300 (не то, что прислал клиент)', orders[orders.length - 1].total === 2300);
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
