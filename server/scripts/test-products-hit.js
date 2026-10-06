/* Проверка поля isHit в server/routes/products.js — без реального Postgres.

   По образцу test-banners.js: поднимает временный Express-сервер с РЕАЛЬНЫМ
   роутом products.js, db.query/queryOne/execute подменены прямо на объекте
   модуля server/db на маленький in-memory массив товаров (поддерживает
   только те формы запросов, которые реально выпускает products.js для
   POST/PUT одного товара — не универсальный SQL).

   Проверяет:
   (а) POST без isHit создаёт товар с is_hit=0 → API отдаёт isHit:false;
   (б) PUT с isHit:true сохраняет is_hit=1 → API отдаёт isHit:true;
   (в) PUT с isHit:false (назад) → isHit:false;
   (д) PUT БЕЗ поля isHit вообще у товара с is_hit=1 → is_hit не меняется,
       остаётся 1 (COALESCE на существующее значение — см. комментарий у
       PUT /api/products/:id в server/routes/products.js);
   (е) PUT с явным isHit:true на уже хитовом товаре → остаётся 1;
   (г) POST/PUT без пароля и с неверным паролем -> 401.

   Запуск: node server/scripts/test-products-hit.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const express = require('express');
const db      = require('../db');

let products = [];
let nextId   = 1;

function resetProducts(rows) {
    products = rows.map(r => ({ ...r }));
    nextId   = (products.reduce((m, p) => Math.max(m, p.id), 0)) + 1;
}

async function fakeQuery(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s === 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM products') {
        const m = products.length ? Math.max(...products.map(p => p.sort_order || 0)) : 0;
        return [{ m }];
    }
    if (s.startsWith('SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=')) {
        const [categoryId] = params;
        const inCat = products.filter(p => p.category_id === categoryId);
        const m = inCat.length ? Math.max(...inCat.map(p => p.sort_order_in_category || 0)) : 0;
        return [{ m }];
    }
    if (s.startsWith('SELECT in_stock, category_id FROM products WHERE id=')) {
        const row = products.find(p => p.id === params[0]);
        return row ? [{ in_stock: row.in_stock, category_id: row.category_id }] : [];
    }
    if (s.startsWith('SELECT * FROM products WHERE id=')) {
        const row = products.find(p => p.id === params[0]);
        return row ? [row] : [];
    }
    if (s.startsWith('INSERT INTO products')) {
        const [name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery,
               inStock, isService, isHit, priceLabel, image, sortOrder, sortOrderInCategory] = params;
        const id = nextId++;
        products.push({
            id, name, desc, category_id: categoryId, sub_id: subId, price,
            price_krd: priceKrd, price_msk: priceMsk, price_delivery: priceDelivery,
            in_stock: inStock, is_service: isService, is_hit: isHit,
            price_label: priceLabel, image, sort_order: sortOrder,
            sort_order_in_category: sortOrderInCategory, sale_notified: 0,
        });
        return [{ id }];
    }
    if (s.startsWith('UPDATE products SET name=')) {
        const hasCatOrder = s.includes('sort_order_in_category=');
        const [name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery,
               inStock, isService, isHit, priceLabel, image, id, newCatOrder] = params;
        const p = products.find(x => x.id === id);
        if (!p) return { rowCount: 0 };
        Object.assign(p, {
            name, desc, category_id: categoryId, sub_id: subId, price,
            price_krd: priceKrd, price_msk: priceMsk, price_delivery: priceDelivery,
            in_stock: inStock, is_service: isService,
            is_hit: isHit === null ? p.is_hit : isHit, // имитация is_hit=COALESCE($N,is_hit)
            price_label: priceLabel, image,
        });
        if (hasCatOrder) p.sort_order_in_category = newCatOrder;
        return { rowCount: 1 };
    }
    if (s === 'SELECT * FROM product_variants ORDER BY sort_order, id') {
        return [];
    }

    throw new Error('test-products-hit: неизвестный запрос к фейковой БД: ' + s);
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

const productsRouter = require('../routes/products');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/products', productsRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const AUTH = { Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` };
    const WRONG_AUTH = { Authorization: 'Bearer not-the-password' };

    /* ── (а) POST без isHit -> is_hit=0 / isHit:false ───────────── */
    resetProducts([]);
    let productId;
    {
        const r = await fetch(`${base}/api/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true }),
        });
        const body = await r.json();
        check('POST /api/products: 201', r.status === 201);
        check('POST /api/products: isHit по умолчанию false', body.isHit === false);
        productId = body.id;
    }

    /* ── (б) PUT с isHit:true -> isHit:true ─────────────────────── */
    {
        const r = await fetch(`${base}/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true, isHit: true }),
        });
        const body = await r.json();
        check('PUT /api/products/:id: 200', r.status === 200);
        check('PUT /api/products/:id: isHit:true сохраняется', body.isHit === true);
    }

    /* ── (в) PUT с isHit:false -> isHit:false ───────────────────── */
    {
        const r = await fetch(`${base}/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true, isHit: false }),
        });
        const body = await r.json();
        check('PUT /api/products/:id: isHit:false сбрасывается обратно', body.isHit === false);
    }

    /* ── (д) PUT без isHit в теле у товара с is_hit=1 -> не трогает ── */
    {
        // Сначала ставим хит явно, затем шлём PUT вовсе без поля isHit
        // (как делал бы вызов, который ещё не знает про это поле) —
        // значение в БД должно остаться прежним, а не сброситься в 0.
        await fetch(`${base}/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true, isHit: true }),
        });
        const r = await fetch(`${base}/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true }), // isHit нет вообще
        });
        const body = await r.json();
        check('PUT /api/products/:id: без isHit в теле — is_hit=1 не трогается, остаётся true', body.isHit === true);
    }

    /* ── (е) снова явный isHit:true на уже хитовом товаре -> остаётся true ── */
    {
        const r = await fetch(`${base}/api/products/${productId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ name: 'Тестовый товар', categoryId: 1, inStock: true, isHit: true }),
        });
        const body = await r.json();
        check('PUT /api/products/:id: явный isHit:true ставит is_hit=1', body.isHit === true);
    }

    /* ── (г) без пароля / с неверным паролем -> 401 ─────────────── */
    const protectedRequests = [
        ['POST', '/api/products',            { name: 'x', categoryId: 1 }],
        ['PUT',  `/api/products/${productId}`, { name: 'x', categoryId: 1, isHit: true }],
    ];
    for (const [method, path, body] of protectedRequests) {
        const r1 = await fetch(`${base}${path}`, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        check(`${method} ${path}: без Authorization -> 401`, r1.status === 401);

        const r2 = await fetch(`${base}${path}`, {
            method, headers: { 'Content-Type': 'application/json', ...WRONG_AUTH }, body: JSON.stringify(body),
        });
        check(`${method} ${path}: с неверным паролем -> 401`, r2.status === 401);
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
