/* Проверка поиска GET /api/products?q= — без реального Postgres.

   Поднимает временный Express-сервер с РЕАЛЬНЫМ роутом products.js,
   db.query подменён на маленькую in-memory реализацию, которая
   воспроизводит ровно ту форму SQL, которую реально строит обработчик
   (см. его исходник) — включая разбор сгенерированного ILIKE-паттерна
   как настоящий Postgres (% и _ — wildcard, \% \_ \\ — экранированные
   литералы), чтобы проверка экранирования была содержательной, а не
   проверяла сам тестовый стенд.

   Проверяет:
   (а) регистронезависимый поиск по подстроке в name/brand/article;
   (б) экранирование % — литеральный "%" в данных находится по запросу
       "%", но запрос "%" не превращается в "найти всё";
   (в) экранирование _ — литеральный "_" в данных находится по запросу
       "_", но запрос "_" не ведёт себя как wildcard "любой символ";
   (г) пустой/из пробелов запрос -> ведёт себя как отсутствие q (без
       фильтра и без LIMIT) — ничего не ломает;
   (д) слишком длинный запрос (>100 символов) обрезается до 100, а не
       отклоняется и не ищет по полной строке;
   (е) число результатов ограничено (не больше MAX_SEARCH_RESULTS).

   Запуск: node server/scripts/test-products-search.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const express = require('express');
const db      = require('../db');

let products = [];

function resetProducts(rows) {
    products = rows.map((r, i) => ({
        id: i + 1, category_id: null, sub_id: null, desc: null, price: 0,
        price_krd: 0, price_msk: 0, price_delivery: 0, in_stock: 1, is_service: 0,
        is_hit: 0, price_label: null, image: null, sort_order: i, sort_order_in_category: i,
        brand: null, article: null,
        ...r,
    }));
}

/* ─── Воссоздаёт настоящий Postgres ILIKE-паттерн как RegExp ────────
   Паттерн всегда вида %...% (см. products.js), внутри: \%, \_, \\ —
   экранированные литералы, % и _ без экранирования — wildcard'ы. */
function escapeRegexChar(c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function likePatternToRegex(pattern) {
    let body = pattern;
    if (body.startsWith('%')) body = body.slice(1);
    if (body.endsWith('%'))   body = body.slice(0, -1);
    let re = '';
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '\\' && i + 1 < body.length) { re += escapeRegexChar(body[i + 1]); i++; }
        else if (c === '%') re += '.*';
        else if (c === '_') re += '.';
        else re += escapeRegexChar(c);
    }
    return new RegExp(re, 'i');
}

async function fakeQuery(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'SELECT * FROM product_variants ORDER BY sort_order, id') return [];
    if (!s.startsWith('SELECT * FROM products WHERE 1=1')) {
        throw new Error('test-products-search: неизвестный запрос к фейковой БД: ' + s);
    }
    let idx = 0;
    let list = products.slice();
    if (s.includes('category_id=$')) { const v = params[idx++]; list = list.filter(p => p.category_id === v); }
    if (s.includes('sub_id=$'))      { const v = params[idx++]; list = list.filter(p => p.sub_id === v); }
    if (s.includes('name ILIKE')) {
        const pattern = params[idx]; idx += 3; // name/brand/article делят один и тот же паттерн
        const re = likePatternToRegex(pattern);
        list = list.filter(p => re.test(p.name || '') || re.test(p.brand || '') || re.test(p.article || ''));
    }
    if (s.includes('LIMIT $')) { const limit = params[idx++]; list = list.slice(0, limit); }
    return list;
}

db.query = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    return Array.isArray(r) ? r : [];
};
db.queryOne = async () => null; // не нужен этому роуту для GET
db.execute  = async () => 0;

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

    async function search(q) {
        const r = await fetch(`${base}/api/products?q=${encodeURIComponent(q)}`);
        return { status: r.status, body: await r.json() };
    }

    /* ── (а) регистронезависимый поиск по name/brand/article ──────── */
    resetProducts([
        { name: 'Дрель аккумуляторная', brand: 'Bosch', article: 'DR-100' },
        { name: 'Перфоратор',           brand: 'Makita', article: 'PF-200' },
        { name: 'Шуруповёрт',           brand: 'Dewalt', article: 'SH-300' },
    ]);
    {
        const byName   = await search('дрель');
        check('поиск по подстроке в name, регистр не важен', byName.body.length === 1 && byName.body[0].article === 'DR-100');

        const byBrand  = await search('BOSCH');
        check('поиск по подстроке в brand, регистр не важен', byBrand.body.length === 1 && byBrand.body[0].brand === 'Bosch');

        const byArticle = await search('pf-200');
        check('поиск по подстроке в article, регистр не важен', byArticle.body.length === 1 && byArticle.body[0].article === 'PF-200');

        const none = await search('несуществующий-товар-xyz');
        check('поиск без совпадений -> пустой массив', Array.isArray(none.body) && none.body.length === 0);
    }

    /* ── (б) экранирование % ───────────────────────────────────────── */
    resetProducts([
        { name: 'Комплект COMBO%SET', brand: null, article: null },
        { name: 'Обычный товар 1',    brand: 'Bosch',  article: 'X1' },
        { name: 'Обычный товар 2',    brand: 'Makita', article: 'X2' },
    ]);
    {
        const r = await search('%');
        check('запрос "%" находит только товар с литеральным % в данных (не все)', r.body.length === 1 && r.body[0].name.includes('COMBO%SET'));
    }

    /* ── (в) экранирование _ ───────────────────────────────────────── */
    resetProducts([
        { name: 'Крепёж AB_CD', brand: null, article: null },
        { name: 'Обычный товар 1', brand: 'Bosch',  article: 'X1' },
        { name: 'Обычный товар 2', brand: 'Makita', article: 'X2' },
    ]);
    {
        const r = await search('_');
        check('запрос "_" находит только товар с литеральным _ в данных (не все)', r.body.length === 1 && r.body[0].name.includes('AB_CD'));
    }

    /* ── (г) пустой / из пробелов запрос -> как отсутствие q ────────── */
    resetProducts([
        { name: 'Товар 1', brand: null, article: null },
        { name: 'Товар 2', brand: null, article: null },
    ]);
    {
        const empty = await search('');
        check('пустой q -> все товары без фильтра', empty.body.length === 2);

        const spaces = await search('   ');
        check('q из одних пробелов -> все товары без фильтра (как пустой)', spaces.body.length === 2);
    }

    /* ── (д) слишком длинный запрос обрезается до 100 символов ──────── */
    {
        const longName = 'A'.repeat(100); // ровно MAX_SEARCH_QUERY_LEN
        resetProducts([{ name: longName, brand: null, article: null }]);
        const padded = longName + 'B'.repeat(50); // 150 символов на входе
        const r = await search(padded);
        check('запрос длиннее 100 символов обрезается до 100, а не ищется целиком', r.body.length === 1);
    }

    /* ── (е) число результатов ограничено ────────────────────────────── */
    {
        const many = Array.from({ length: 150 }, (_, i) => ({ name: `Повторяющийся товар ${i}`, brand: null, article: null }));
        resetProducts(many);
        const r = await search('повторяющийся');
        check('результатов не больше 100 (MAX_SEARCH_RESULTS)', r.body.length <= 100 && r.body.length > 0);
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
