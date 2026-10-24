/* Проверка цен в долларах с пересчётом по курсу (usd-pricing, см.
   PROGRESS.md) — без реального Postgres и без реальной отправки ботом,
   та же архитектура, что в остальных test-*.js этого проекта (общий
   fakeQuery-диспетчер, как в test-banners.js/test-promo.js).

   Покрывает все пункты, перечисленные в задаче:
   - округление вверх до 50 (кратно/+1₽/дробные центы/$0.29-подобные)
   - целочисленность расчёта (конкретный вектор, где naive float даёт
     другой результат, чем точная целочисленная арифметика)
   - скидка в $, доставка = округлённый самовывоз + рублёвая наценка
   - совпадение цены, отдаваемой API (GET /api/products), с ценой,
     которой реально оформляется заказ (POST /api/orders) — для КРД и МСК
   - 409 при расхождении курса между пред-проверкой и отправкой заказа
   - старый заказ не меняется после смены курса
   - рублёвый товар считается точно как раньше (регрессия)
   - уведомление: не чаще раза в сутки, в обе стороны изменения цены,
     price_seen берётся с сервера (не из тела запроса), смена города не
     дублирует строку cart_sync, пропущенное по лимиту уведомление не
     теряет изменение (придёт на следующий день)

   Запуск: node server/scripts/test-usd-pricing.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;

const crypto  = require('crypto');
const express = require('express');
const db      = require('../db');
const usdPrice = require('../utils/usdPrice');
const { issueAdminToken } = require('../middleware/auth');

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

/* ─── Подмена bot.js (шпионы вместо реальной отправки) ──────────────── */
const botPath = require.resolve('../../bot');
let notifyPriceChangeCalls = [];
const fakeBot = {
    notifyStore:        async () => {},
    notifyCustomer:      async () => {},
    notifyPriceChange:   async (tgId, changes) => { notifyPriceChangeCalls.push({ tgId, changes }); },
};
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot };

/* ─── In-memory «БД» ─────────────────────────────────────────────────── */
let nextProductId  = 1;
let nextVariantId  = 1;
let nextOrderId    = 1;
let nextRateId     = 1;
let nextCartSyncId = 1;
let products        = [];
let variants        = [];
let orders          = [];
let rateHistory     = [];
let cartSync        = [];
let notifyLog       = []; // { tg_id, notified_at }

function resetDb() {
    nextProductId = 1; nextVariantId = 1; nextOrderId = 1; nextRateId = 1; nextCartSyncId = 1;
    products = []; variants = []; orders = []; rateHistory = []; cartSync = []; notifyLog = [];
    notifyPriceChangeCalls = [];
}

function isoNow() { return new Date(); }

/* product/variant helpers — snake_case строки, как из настоящего pg */
function addProduct(p) {
    const row = Object.assign({
        id: nextProductId++, name: '', in_stock: 1, is_service: 0,
        price: 0, price_krd: 0, price_msk: 0, price_delivery: 0,
    }, p);
    products.push(row);
    return row;
}
function addVariant(v) {
    const row = Object.assign({
        id: nextVariantId++, label: '', is_krd: 0, is_default: 0, sort_order: 0,
        price: 0, price_krd: 0, price_msk: 0, price_delivery: 0,
        price_krd_pickup: 0, price_msk_pickup: 0, price_msk_delivery: 0, sale_price: 0,
        is_usd: 0, usd_price_krd_pickup: 0, usd_price_msk_pickup: 0, usd_sale_price: 0, usd_delivery_surcharge_rub: 0,
    }, v);
    variants.push(row);
    return row;
}

/* ─── fakeQuery: один диспетчер для всех SQL-форм, что реально строят
   usdPrice.js/pricing.js/products.js/orders.js/cart-sync.js/usd-rate.js ── */
async function fakeQuery(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ── usd_rate_history ──────────────────────────────────────────────
    if (s.startsWith('SELECT id, rate FROM usd_rate_history')) {
        const last = rateHistory[rateHistory.length - 1];
        return last ? [{ id: last.id, rate: last.rate }] : [];
    }
    if (s.startsWith('SELECT rate, prev_rate, created_at FROM usd_rate_history')) {
        return [...rateHistory].reverse().map(r => ({ rate: r.rate, prev_rate: r.prev_rate, created_at: r.created_at }));
    }
    if (s.startsWith('SELECT rate FROM usd_rate_history')) {
        const last = rateHistory[rateHistory.length - 1];
        return last ? [{ rate: last.rate }] : [];
    }
    if (s.startsWith('INSERT INTO usd_rate_history')) {
        const [rate, prevRate] = params;
        const row = { id: nextRateId++, rate, prev_rate: prevRate, created_at: isoNow() };
        rateHistory.push(row);
        return [row];
    }

    // ── products / product_variants ─────────────────────────────────
    if (s.startsWith('SELECT * FROM products WHERE 1=1')) {
        return [...products];
    }
    if (s.startsWith('SELECT * FROM product_variants ORDER BY sort_order, id')) {
        return [...variants].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    if (s.startsWith('SELECT * FROM products WHERE id IN')) {
        return products.filter(p => params.includes(p.id));
    }
    if (s.startsWith('SELECT * FROM product_variants WHERE product_id IN')) {
        return variants.filter(v => params.includes(v.product_id));
    }
    if (s.startsWith('SELECT * FROM products WHERE id=$1')) {
        const p = products.find(p => p.id === params[0]);
        return p ? [p] : [];
    }

    // ── orders ───────────────────────────────────────────────────────
    if (s.startsWith('INSERT INTO orders')) {
        const [name, phone, store, delivery, address, city, tgId, comment, items, total] = params;
        const row = {
            id: nextOrderId++, name, phone, store, delivery, address, city,
            tg_id: tgId, comment, items, total, status: 'new',
            tracking_number: null, created_at: isoNow().toISOString(),
        };
        orders.push(row);
        return [{ id: row.id }];
    }
    if (s.startsWith('SELECT * FROM orders WHERE id=$1')) {
        return orders.filter(o => o.id === params[0]);
    }

    // ── cart_sync ────────────────────────────────────────────────────
    if (s.startsWith('DELETE FROM cart_sync WHERE tg_id=$1')) {
        const before = cartSync.length;
        cartSync = cartSync.filter(r => r.tg_id !== params[0]);
        return { rowCount: before - cartSync.length };
    }
    if (s.startsWith('INSERT INTO cart_sync')) {
        const [tgId, productId, variantLabel, city, qty, priceSeen] = params;
        const row = { id: nextCartSyncId++, tg_id: tgId, product_id: productId, variant_label: variantLabel, city, qty, price_seen: priceSeen, updated_at: isoNow() };
        cartSync.push(row);
        return [row];
    }
    if (s.startsWith('SELECT * FROM cart_sync')) {
        return [...cartSync];
    }
    if (s.startsWith('UPDATE cart_sync SET price_seen')) {
        const [priceSeen, id] = params;
        const row = cartSync.find(r => r.id === id);
        if (row) { row.price_seen = priceSeen; row.updated_at = isoNow(); }
        return { rowCount: row ? 1 : 0 };
    }

    // ── usd_notify_log ───────────────────────────────────────────────
    if (s.startsWith('SELECT notified_at FROM usd_notify_log WHERE tg_id=$1')) {
        const row = notifyLog.find(r => r.tg_id === params[0]);
        return row ? [{ notified_at: row.notified_at }] : [];
    }
    if (s.startsWith('INSERT INTO usd_notify_log')) {
        const [tgId] = params;
        const existing = notifyLog.find(r => r.tg_id === tgId);
        if (existing) existing.notified_at = isoNow();
        else notifyLog.push({ tg_id: tgId, notified_at: isoNow() });
        return { rowCount: 1 };
    }

    throw new Error('test-usd-pricing: неизвестный запрос к фейковой БД: ' + s);
}

db.query = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    return Array.isArray(r) ? r : [];
};
db.queryOne = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    return Array.isArray(r) ? (r[0] || null) : null;
};
db.execute = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    if (Array.isArray(r)) return r.length;
    return r.rowCount ?? 0;
};
db.inTransaction = async (fn) => {
    const client = { query: (sql, params) => fakeQuery(sql, params) };
    return fn(client);
};

const productsRouter  = require('../routes/products');
const ordersRouter    = require('../routes/orders');
const cartSyncRouter  = require('../routes/cart-sync');
const usdRateRouter   = require('../routes/usd-rate');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/products',  productsRouter);
    app.use('/api/orders',    ordersRouter);
    app.use('/api/cart-sync', cartSyncRouter);
    app.use('/api/usd-rate',  usdRateRouter);
    const server = app.listen(0);
    const base   = `http://127.0.0.1:${server.address().port}`;

    const adminToken = issueAdminToken();
    const adminHeaders = { 'Authorization': `Bearer ${adminToken}` };

    const USER_A = 555222111;
    const initA  = buildSignedInitData({ id: USER_A, first_name: 'A' }, REAL_BOT_TOKEN);

    async function post(path, body, headers = {}) {
        const r = await fetch(`${base}${path}`, {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
            body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }
    async function get(path, headers = {}) {
        const r = await fetch(`${base}${path}`, { headers });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    /* ═══ 1. Округление вверх до 50 ═══════════════════════════════════ */
    {
        // rate=100.0000 (×10000=1000000) ⇒ cents == "сырые рубли" до округления
        check('1201 -> 1250 (округление вверх)', usdPrice.centsAndRateToRub(1201, 1000000) === 1250);
        check('1250 -> 1250 (уже кратно 50, не трогаем)', usdPrice.centsAndRateToRub(1250, 1000000) === 1250);
        check('1251 -> 1300 (округление вверх)', usdPrice.centsAndRateToRub(1251, 1000000) === 1300);

        // $0.29 при курсе 92.4567 -> 26.812443₽ -> 50₽
        check('$0.29 при курсе 92.4567 -> 50₽ (дробные центы)', usdPrice.centsAndRateToRub(29, 924567) === 50);

        // Дробный курс, не кратный ровно ничему удобному
        check('$12.34 при курсе 92.4567 -> ceil(1141.03..→50) = 1150₽',
            usdPrice.centsAndRateToRub(1234, 924567) === 1150);

        check('0 центов -> 0₽', usdPrice.centsAndRateToRub(0, 924567) === 0);
    }

    /* ═══ 2. Целочисленность расчёта (конкретный вектор float-дрейфа) ═ */
    {
        // cents=62500 ($625.00), rate=6.4800 ⇒ точное произведение даёт РОВНО
        // 4050 (кратно 50, округлять не нужно). Наивный путь через float
        // (625 * 6.48, затем /50 и ceil) из-за бинарного округления 6.48
        // получает 4050.000000000001 -> ошибочно округляет ВВЕРХ до 4100.
        const exact = usdPrice.centsAndRateToRub(62500, 64800);
        check('целочисленный путь: 625$ при курсе 6.48 -> ровно 4050₽ (не 4100 от float-дрейфа)', exact === 4050);

        const naiveFloat = Math.ceil((62500 / 100 * (64800 / 10000)) / 50) * 50;
        check('naive float-путь на этом же векторе ошибается (получает 4100, демонстрация регрессии, которую BigInt не допускает)',
            naiveFloat === 4100 && naiveFloat !== exact);
    }

    /* ═══ 3. Скидка в $, доставка = округлённый самовывоз + рублёвая наценка ═ */
    {
        const row = {
            is_usd: 1,
            usd_price_krd_pickup: 0,
            usd_price_msk_pickup: 1000,       // $10.00
            usd_sale_price:        800,        // $8.00
            usd_delivery_surcharge_rub: 300,   // 300₽ наценка (не $, не округляется)
        };
        const rate = 950000; // 95.0000 ₽/$
        const converted = usdPrice.applyUsdToVariantRow(row, rate);
        // 10$ * 95 = 950₽, кратно 50 -> 950. 8$*95=760₽, кратно 50(760/50=15.2) -> ceil -> 800.
        check('pickup $10 при курсе 95 -> 950₽', converted.price_msk_pickup === 950);
        check('скидка $8 при курсе 95 -> 800₽ (округлена вверх до 50 отдельно от pickup)', converted.sale_price === 800);
        check('доставка = округлённый pickup (950) + рублёвая наценка (300) = 1250₽ — наценка НЕ проходит через $-округление',
            converted.price_msk_delivery === 1250);

        // Применяем существующую (неизменную) формулу скидки на доставке:
        // surcharge = delivery - pickup = 300; saleDelivery = sale + surcharge = 1100; min(1100, delivery=1250) = 1100.
        const { effectiveItemPrice } = require('../utils/pricing');
        const price = effectiveItemPrice({
            priceMskPickup: converted.price_msk_pickup, priceMskDelivery: converted.price_msk_delivery,
            priceDelivery: converted.price_msk_delivery, salePriceMsk: converted.sale_price,
        }, 'msk', 'russia');
        check('доставка по России с $-скидкой считается той же неизменённой формулой (1100₽)', price === 1100);
    }

    /* ═══ 4. Совпадение цены из API (GET /api/products) и из заказа (POST /api/orders) ═ */
    resetDb();
    {
        await fakeQuery('INSERT INTO usd_rate_history', [900000, null]); // 90.0000 ₽/$
        const p = addProduct({ name: 'USD-товар', in_stock: 1 });
        addVariant({
            product_id: p.id, label: 'Стандарт', is_krd: 1, is_default: 1,
            is_usd: 1, usd_price_krd_pickup: 1000, usd_sale_price: 0, // $10 -> 900₽
        });
        addVariant({
            product_id: p.id, label: 'Стандарт', is_krd: 0, is_default: 0,
            is_usd: 1, usd_price_msk_pickup: 1200, usd_sale_price: 0, // $12 -> 1080₽, округляется вверх до 1100₽
        });

        const list = await get('/api/products');
        const apiProduct = list.body.find(x => x.id === p.id);
        const krdVariant = apiProduct.variants.find(v => v.isKrd);
        const mskVariant = apiProduct.variants.find(v => !v.isKrd);
        check('GET /api/products: КРД $10 при курсе 90 -> 900₽', krdVariant.priceKrdPickup === 900);
        check('GET /api/products: МСК $12 при курсе 90 -> 1080₽ округляется вверх до 1100₽', mskVariant.priceMskPickup === 1100);

        const orderKrd = await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Краснодар', delivery: 'pickup', city: 'krd',
            items: [{ id: p.id, variantLabel: 'Стандарт', price: 1, qty: 1 }], total: 900,
        }, { 'X-Init-Data': initA });
        check('POST /api/orders (КРД) заряжает ровно ту же цену, что отдал GET /api/products (900₽)',
            orderKrd.status === 201);
        check('сохранённая в заказе цена позиции = 900₽', JSON.parse(orders[orders.length - 1].items)[0].price === 900);

        const orderMsk = await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Москва', delivery: 'pickup', city: 'msk',
            items: [{ id: p.id, variantLabel: 'Стандарт', price: 1, qty: 1 }], total: 1100,
        }, { 'X-Init-Data': initA });
        check('POST /api/orders (МСК) заряжает ровно ту же цену, что отдал GET /api/products (1100₽)',
            orderMsk.status === 201);
        check('сохранённая в заказе цена позиции = 1100₽', JSON.parse(orders[orders.length - 1].items)[0].price === 1100);
        check('в заказе сохранён $ и курс позиции (аудит, п.11)',
            JSON.parse(orders[orders.length - 1].items)[0].rateX10000 === 900000);
    }

    /* ═══ 5. 409 при расхождении курса между пред-проверкой и отправкой ═ */
    resetDb();
    {
        await fakeQuery('INSERT INTO usd_rate_history', [900000, null]); // 90.0000
        const p = addProduct({ name: 'USD-товар-2', in_stock: 1 });
        addVariant({ product_id: p.id, label: '', is_krd: 1, is_default: 1, is_usd: 1, usd_price_krd_pickup: 1000 });

        // Покупатель "увидел" 900₽ (при курсе 90), но пока он оформлял заказ, курс сменился.
        await fakeQuery('INSERT INTO usd_rate_history', [1000000, 900000]); // курс стал 100.0000

        const r = await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Краснодар', delivery: 'pickup', city: 'krd',
            items: [{ id: p.id, variantLabel: '', price: 1, qty: 1 }], total: 900, // старая, уже неактуальная сумма
        }, { 'X-Init-Data': initA });
        check('курс изменился между пред-проверкой и отправкой -> 409 price_changed', r.status === 409 && r.body.error === 'price_changed');
        check('409 содержит актуальную цену по новому курсу (1000₽, не 900₽)', r.body.items[0].price === 1000);
        check('заказ не создан при 409', orders.length === 0);
    }

    /* ═══ 6. Старый заказ не меняется после смены курса ═══════════════ */
    resetDb();
    {
        await fakeQuery('INSERT INTO usd_rate_history', [900000, null]);
        const p = addProduct({ name: 'USD-товар-3', in_stock: 1 });
        addVariant({ product_id: p.id, label: '', is_krd: 1, is_default: 1, is_usd: 1, usd_price_krd_pickup: 1000 });

        await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Краснодар', delivery: 'pickup', city: 'krd',
            items: [{ id: p.id, variantLabel: '', price: 1, qty: 1 }], total: 900,
        }, { 'X-Init-Data': initA });
        const savedBefore = JSON.stringify(orders[orders.length - 1]);

        await usdPrice.setRate(2000000); // курс резко вырос в 20 раз

        const savedAfter = JSON.stringify(orders[orders.length - 1]);
        check('старый заказ не изменился ни на байт после смены курса', savedBefore === savedAfter);
        check('цена позиции в старом заказе осталась 900₽', JSON.parse(orders[orders.length - 1].items)[0].price === 900);
    }

    /* ═══ 7. Рублёвый товар считается точно как раньше (регрессия) ════ */
    resetDb();
    {
        const p = addProduct({ name: 'Рублёвый товар', in_stock: 1 });
        addVariant({ product_id: p.id, label: 'M', is_krd: 1, is_default: 1, price_krd_pickup: 500, sale_price: 0 });
        addVariant({ product_id: p.id, label: 'M', is_krd: 0, is_default: 0, price_msk_pickup: 550, price_msk_delivery: 700, sale_price: 600 });

        const rKrd = await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Краснодар', delivery: 'pickup', city: 'krd',
            items: [{ id: p.id, variantLabel: 'M', price: 1, qty: 1 }], total: 500,
        }, { 'X-Init-Data': initA });
        check('рублёвый товар КРД: 201, цена 500₽ (как и до usd-pricing)', rKrd.status === 201 && JSON.parse(orders[orders.length - 1].items)[0].price === 500);
        check('рублёвый товар: $ и курс в заказе не пишутся (не было $)', JSON.parse(orders[orders.length - 1].items)[0].priceUsdCents === undefined);

        const rMsk = await post('/api/orders', {
            name: 'Т', phone: '+7', store: 'Москва', delivery: 'russia', city: 'msk',
            items: [{ id: p.id, variantLabel: 'M', price: 1, qty: 1 }], total: 700,
        }, { 'X-Init-Data': initA });
        check('рублёвый товар доставка по России: 201, цена 700₽ (формула sale+surcharge не изменилась)',
            rMsk.status === 201 && JSON.parse(orders[orders.length - 1].items)[0].price === 700);
    }

    /* ═══ 8-11. Синхронизация корзины + уведомления ═══════════════════ */
    resetDb();
    {
        await fakeQuery('INSERT INTO usd_rate_history', [900000, null]); // 90.0000
        const p = addProduct({ name: 'Товар в корзине', in_stock: 1 });
        addVariant({ product_id: p.id, label: '', is_krd: 1, is_default: 1, is_usd: 1, usd_price_krd_pickup: 1000 }); // $10 -> 900₽ при курсе 90
        // МСК-вариант нужен только для проверки смены города ниже (не участвует
        // в проверках смены курса — для них используется КРД-строка).
        addVariant({ product_id: p.id, label: '', is_krd: 0, is_default: 0, price_msk_pickup: 950 });

        // ── price_seen берётся с сервера, а не из тела запроса ──────
        const syncRes = await post('/api/cart-sync',
            { items: [{ productId: p.id, variantLabel: '', qty: 2, priceSeen: 1 }], city: 'krd' },
            { 'X-Init-Data': initA }
        );
        check('POST /api/cart-sync -> 200 ok', syncRes.status === 200 && syncRes.body.ok === true);
        check('price_seen в БД — пересчитан сервером (900₽), а не присланная клиентом (1₽)',
            cartSync.find(r => r.tg_id === String(USER_A))?.price_seen === 900);

        // ── смена города не создаёт вторую строку (та же product+variant) ──
        await post('/api/cart-sync',
            { items: [{ productId: p.id, variantLabel: '', qty: 2 }], city: 'msk' },
            { 'X-Init-Data': initA }
        );
        const rowsForUser = cartSync.filter(r => r.tg_id === String(USER_A));
        check('смена города -> не дублирует строку cart_sync (их всё ещё одна)', rowsForUser.length === 1);
        check('город в строке обновился на msk', rowsForUser[0].city === 'msk');

        // Возвращаем город обратно на krd (у тестового товара только КРД-
        // вариант) — иначе цену ниже нечем будет пересчитать.
        await post('/api/cart-sync',
            { items: [{ productId: p.id, variantLabel: '', qty: 2 }], city: 'krd' },
            { 'X-Init-Data': initA }
        );

        // ── смена курса -> цена товара в корзине выросла -> уведомление ──
        const rateRes = await post('/api/usd-rate/admin', { rate: 180 }, adminHeaders); // курс вырос вдвое: 900₽ -> 1800₽
        check('POST /api/usd-rate/admin -> 200, новый курс сохранён', rateRes.status === 200 && rateRes.body.rate === 180);

        await new Promise(r => setTimeout(r, 30)); // setImmediate внутри роута успевает отработать
        check('уведомление отправлено ровно одному человеку', notifyPriceChangeCalls.length === 1);
        check('уведомление содержит рост цены 900₽ -> 1800₽ (изменение в сторону увеличения)',
            notifyPriceChangeCalls[0].changes[0].oldPrice === 900 && notifyPriceChangeCalls[0].changes[0].newPrice === 1800);
        check('price_seen обновлён на новую цену после успешной отправки', cartSync[0].price_seen === 1800);

        // ── повторная смена курса в тот же день -> лимит 1/сутки не даёт отправить повторно ──
        notifyPriceChangeCalls = [];
        const rateRes2 = await post('/api/usd-rate/admin', { rate: 10 }, adminHeaders); // курс резко упал: 1800₽ -> 100₽
        check('второй POST /api/usd-rate/admin в тот же день -> 200', rateRes2.status === 200);
        await new Promise(r => setTimeout(r, 30));
        check('повторное уведомление в тот же день НЕ отправлено (лимит 1/сутки)', notifyPriceChangeCalls.length === 0);
        check('price_seen НЕ обновлён при пропуске по лимиту — изменение не потеряно', cartSync[0].price_seen === 1800);

        // ── имитация прошедших суток -> отложенное изменение доходит ──
        notifyLog[0].notified_at = new Date(Date.now() - 25 * 3600 * 1000);
        const { notifyCartPriceChanges } = require('../routes/usd-rate');
        await notifyCartPriceChanges();
        check('через сутки лимит больше не действует — отложенное изменение цены (1800₽ -> 100₽) доходит',
            notifyPriceChangeCalls.length === 1 &&
            notifyPriceChangeCalls[0].changes[0].oldPrice === 1800 &&
            notifyPriceChangeCalls[0].changes[0].newPrice === 100);
        check('price_seen теперь обновлён на актуальную цену (100₽)', cartSync[0].price_seen === 100);

        // ── уведомление в обе стороны: падение цены тоже триггерит ──
        notifyLog[0].notified_at = new Date(Date.now() - 25 * 3600 * 1000);
        notifyPriceChangeCalls = [];
        await post('/api/usd-rate/admin', { rate: 500 }, adminHeaders); // 100₽ -> 5000₽ (рост)
        await new Promise(r => setTimeout(r, 30));
        check('изменение цены в большую сторону тоже уведомляется', notifyPriceChangeCalls.length === 1 && notifyPriceChangeCalls[0].changes[0].newPrice > notifyPriceChangeCalls[0].changes[0].oldPrice);
    }

    server.close();
    console.log(failures === 0
        ? '\n✅ Все проверки прошли'
        : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
