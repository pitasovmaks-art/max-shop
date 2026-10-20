/* Проверка рекламной подписки — POST /api/promo/subscribe,
   POST /api/promo/unsubscribe (бот), POST /api/promo/unsubscribe-me
   (приложение), GET /api/promo/status (server/routes/promo.js), и что
   рассылка о скидке (server/routes/products.js, PUT /:id/variants) не
   уходит отписавшимся. Без реального Postgres и без реальной отправки
   ботом — та же архитектура, что в остальных test-*.js этого проекта.

   Запуск: node server/scripts/test-promo.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { issueAdminToken } = require('../middleware/auth');
const { SELLER_NAME, SELLER_INN } = require('../config');

function isoNow(offsetMs = 0) { return new Date(Date.now() + offsetMs); }

/* ─── Подпись initData — тот же алгоритм, что в остальных test-*.js ──── */
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

/* ─── Распознавание фраз отписки — проверяем НАСТОЯЩИЙ bot.js (как
   SERVICE_REQUEST_MANAGERS в test-service-requests.js), до подмены
   require.cache ниже. ──────────────────────────────────────────── */
const realBot = require('../../bot');
const { normalizeText, UNSUBSCRIBE_PHRASES } = realBot;

/* ─── Подмена bot.js: шпион на notifyPromo (рассылка о скидке) ──────── */
const botPath = require.resolve('../../bot');
let promoNotifyCalls = [];
const fakeBot = {
    notifyPromo: async (tgId) => { promoNotifyCalls.push(String(tgId)); },
};
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot };

/* ─── In-memory «БД» ─────────────────────────────────────────────── */
let subscribers = [];   // { tg_id, consent_at, unsubscribed_at, source, consent_text_version }
let products    = [];   // { id, name, sale_notified }
let variants    = [];   // { product_id, sale_price, ... }
let consentLog  = [];   // { tg_id, action, source, consent_text_version, created_at } — append-only

function resetDb() {
    subscribers = [];
    products = [{ id: 1, name: 'Шуруповёрт Deталькин', sale_notified: 0 }];
    variants = [];
    consentLog = [];
    promoNotifyCalls = [];
}

function norm(sql) { return sql.replace(/\s+/g, ' ').trim(); }

db.queryOne = async (sql, params = []) => {
    const s = norm(sql);
    if (s.startsWith('SELECT 1 FROM promo_subscribers WHERE tg_id=$1 AND unsubscribed_at IS NULL')) {
        const row = subscribers.find(x => x.tg_id === String(params[0]) && !x.unsubscribed_at);
        return row ? { '1': 1 } : null;
    }
    if (s.startsWith('SELECT 1 FROM product_variants WHERE product_id=$1 AND sale_price>0')) {
        const has = variants.some(v => v.product_id === params[0] && v.sale_price > 0);
        return has ? { '1': 1 } : null;
    }
    if (s.startsWith('SELECT name, sale_notified FROM products WHERE id=$1')) {
        const p = products.find(p => p.id === params[0]);
        return p ? { ...p } : null;
    }
    throw new Error('test-promo: неизвестный queryOne: ' + s);
};

db.query = async (sql, params = []) => {
    const s = norm(sql);
    if (s.startsWith('SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id')) {
        return variants.filter(v => v.product_id === params[0]);
    }
    if (s.startsWith('SELECT tg_id FROM promo_subscribers WHERE unsubscribed_at IS NULL')) {
        return subscribers.filter(x => !x.unsubscribed_at).map(x => ({ tg_id: x.tg_id }));
    }
    throw new Error('test-promo: неизвестный query: ' + s);
};

db.execute = async (sql, params = []) => {
    const s = norm(sql);
    if (s.startsWith('INSERT INTO promo_subscribers (tg_id, source, consent_text_version) VALUES ($1,$2,$3) ON CONFLICT (tg_id) DO UPDATE')) {
        // params[0] — BigInt(req.tgId) в настоящем роуте (pg сам привёл бы
        // его к строке для BIGINT-параметра); здесь сравниваем как строки,
        // чтобы совпадало с тем, как tg_id хранится и сравнивается везде
        // ниже в этом тесте.
        const tgId = String(params[0]);
        const [, source, consentTextVersion] = params;
        const existing = subscribers.find(x => x.tg_id === tgId);
        if (existing) {
            existing.unsubscribed_at = null;
            existing.consent_at = isoNow();
            existing.source = source;
            existing.consent_text_version = consentTextVersion;
        } else {
            subscribers.push({ tg_id: tgId, consent_at: isoNow(), unsubscribed_at: null, source, consent_text_version: consentTextVersion });
        }
        return 1;
    }
    if (s.startsWith('INSERT INTO promo_consent_log (tg_id, action, source, consent_text_version) VALUES ($1,$2,$3,$4)')) {
        const [tgId, action, source, consentTextVersion] = params;
        consentLog.push({ tg_id: String(tgId), action, source, consent_text_version: consentTextVersion, created_at: isoNow() });
        return 1;
    }
    if (s.startsWith("UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'bot' WHERE tg_id=$1")) {
        const row = subscribers.find(x => x.tg_id === String(params[0]));
        if (!row) return 0;
        row.unsubscribed_at = isoNow();
        row.source = 'bot';
        return 1;
    }
    if (s.startsWith("UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'toggle' WHERE tg_id=$1")) {
        const row = subscribers.find(x => x.tg_id === String(params[0]));
        if (!row) return 0;
        row.unsubscribed_at = isoNow();
        row.source = 'toggle';
        return 1;
    }
    if (s.startsWith('UPDATE products SET sale_notified=1 WHERE id=$1')) {
        const p = products.find(p => p.id === params[0]);
        if (p) p.sale_notified = 1;
        return p ? 1 : 0;
    }
    if (s.startsWith('UPDATE products SET sale_notified=0 WHERE id=$1')) {
        const p = products.find(p => p.id === params[0]);
        if (p) p.sale_notified = 0;
        return p ? 1 : 0;
    }
    throw new Error('test-promo: неизвестный execute: ' + s);
};

db.inTransaction = async (fn) => {
    const client = {
        query: async (sql, params = []) => {
            const s = norm(sql);
            if (s.startsWith('DELETE FROM product_variants WHERE product_id=$1')) {
                variants = variants.filter(v => v.product_id !== params[0]);
                return;
            }
            if (s.startsWith('INSERT INTO product_variants')) {
                const [productId, label, price, priceKrd, priceMsk, priceDelivery,
                    priceKrdPickup, priceMskPickup, priceMskDelivery, isKrd, isDefault, sortOrder, salePrice] = params;
                variants.push({ product_id: productId, label, price, sale_price: salePrice, sort_order: sortOrder });
                return;
            }
            throw new Error('test-promo: неизвестный client.query в транзакции: ' + s);
        },
    };
    await fn(client);
};

const promoRouter    = require('../routes/promo');
const productsRouter = require('../routes/products');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }
    async function wait(ms) { await new Promise(r => setTimeout(r, ms)); }

    const app = express();
    app.use(express.json());
    app.use('/api/promo', promoRouter);
    app.use('/api/products', productsRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const USER_A = 111111;
    const USER_B = 222222;
    const USER_C = 333333;
    const initA = buildSignedInitData({ id: USER_A, first_name: 'A' }, REAL_BOT_TOKEN);
    const initB = buildSignedInitData({ id: USER_B, first_name: 'B' }, REAL_BOT_TOKEN);
    const initC = buildSignedInitData({ id: USER_C, first_name: 'C' }, REAL_BOT_TOKEN);

    async function postPromo(path, body, initData) {
        const r = await fetch(`${base}/api/promo${path}`, {
            method:  'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, initData ? { 'X-Init-Data': initData } : {}),
            body:    JSON.stringify(body || {}),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }
    async function getPromo(path, initData) {
        const r = await fetch(`${base}/api/promo${path}`, {
            headers: initData ? { 'X-Init-Data': initData } : {},
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    /* ── 1. Подписка (новая) ─────────────────────────────────────────── */
    resetDb();
    {
        const r = await postPromo('/subscribe', { consentTextVersion: '1' }, initA);
        check('POST /subscribe без source в теле -> 200', r.status === 200);
        const row = subscribers.find(x => x.tg_id === String(USER_A));
        check('создана строка в promo_subscribers', !!row);
        check('source по умолчанию — checkout', row.source === 'checkout');
        check('unsubscribed_at у новой подписки — NULL', row.unsubscribed_at === null);
        check('consent_text_version сохранён как пришёл от клиента', row.consent_text_version === '1');

        const noVersion = await postPromo('/subscribe', {}, initB);
        check('POST /subscribe без consentTextVersion -> 200 (не обязателен)', noVersion.status === 200);
        check('consent_text_version — NULL, если клиент не передал', subscribers.find(x => x.tg_id === String(USER_B)).consent_text_version === null);

        // Версия не из PROMO_CONSENT_VERSIONS (опечатка/подделанный запрос/
        // версия, которой никогда не было) — расценивается как отсутствие
        // версии: заказ/подписка не падает, но "9999" НИКУДА не попадает —
        // ни в promo_subscribers, ни в журнал.
        const unknownVersion = await postPromo('/subscribe', { consentTextVersion: '9999' }, initC);
        check('POST /subscribe с версией не из списка -> 200 (не падает)', unknownVersion.status === 200);
        check('неизвестная версия НЕ сохранена в promo_subscribers (consent_text_version = NULL, не "9999")',
            subscribers.find(x => x.tg_id === String(USER_C)).consent_text_version === null);
        const logC = consentLog.find(e => e.tg_id === String(USER_C));
        check('неизвестная версия НЕ попала в promo_consent_log (consent_text_version = NULL, не "9999")',
            !!logC && logC.consent_text_version === null);

        const status = await getPromo('/status', initA);
        check('GET /status после подписки -> subscribed:true', status.body.subscribed === true);

        const withSource = await postPromo('/subscribe', { source: 'toggle' }, initB);
        const rowB = subscribers.find(x => x.tg_id === String(USER_B));
        check('POST /subscribe с source=toggle сохраняет именно его', rowB.source === 'toggle');

        const badSource = await postPromo('/subscribe', { source: 'hacked' }, initA);
        check('POST /subscribe с source не из списка -> 200, источник не меняется на мусорный',
            badSource.status === 200 && subscribers.find(x => x.tg_id === String(USER_A)).source === 'checkout');
    }

    /* ── 2. Повторная подписка после отписки ─────────────────────────── */
    resetDb();
    {
        await postPromo('/subscribe', {}, initA);
        await postPromo('/unsubscribe-me', {}, initA);
        let row = subscribers.find(x => x.tg_id === String(USER_A));
        check('после unsubscribe-me unsubscribed_at не NULL', row.unsubscribed_at !== null);

        const r = await postPromo('/subscribe', { source: 'checkout' }, initA);
        check('повторная подписка -> 200 (не ошибка на существующий tg_id)', r.status === 200);
        row = subscribers.find(x => x.tg_id === String(USER_A));
        check('повторная подписка снова снимает unsubscribed_at (NULL)', row.unsubscribed_at === null);
        check('повторная подписка обновляет source', row.source === 'checkout');

        const status = await getPromo('/status', initA);
        check('GET /status после повторной подписки -> subscribed:true', status.body.subscribed === true);
    }

    /* ── 3. Отписка из приложения — requireUser, только своя ─────────── */
    resetDb();
    {
        await postPromo('/subscribe', {}, initA);
        await postPromo('/subscribe', {}, initB);

        const noAuth = await fetch(`${base}/api/promo/unsubscribe-me`, { method: 'POST' });
        check('POST /unsubscribe-me без X-Init-Data -> 401', noAuth.status === 401);
        check('без авторизации подписка A не тронута', subscribers.find(x => x.tg_id === String(USER_A)).unsubscribed_at === null);

        const r = await postPromo('/unsubscribe-me', {}, initA);
        check('POST /unsubscribe-me с подписью A -> 200', r.status === 200);
        check('отписан именно A', subscribers.find(x => x.tg_id === String(USER_A)).unsubscribed_at !== null);
        check('B не затронут отпиской A', subscribers.find(x => x.tg_id === String(USER_B)).unsubscribed_at === null);

        // Нельзя отписать чужого, подсунув его tgId в теле — маршрут
        // читает tg_id только из req.tgId (подписанных initData), тело
        // полностью игнорируется.
        await postPromo('/subscribe', {}, initA); // A подписан снова
        const tryStranger = await postPromo('/unsubscribe-me', { tgId: String(USER_A) }, initB);
        check('POST /unsubscribe-me с tgId чужого в теле -> отписывает только отправителя (B), не A',
            tryStranger.status === 200
            && subscribers.find(x => x.tg_id === String(USER_B)).unsubscribed_at !== null
            && subscribers.find(x => x.tg_id === String(USER_A)).unsubscribed_at === null);
    }

    /* ── 4. Отписка из бота — без requireUser, tgId из тела ──────────── */
    resetDb();
    {
        await postPromo('/subscribe', {}, initA);
        const r = await postPromo('/unsubscribe', { tgId: String(USER_A) }, null);
        check('POST /unsubscribe (бот, без X-Init-Data) -> 200', r.status === 200);
        const row = subscribers.find(x => x.tg_id === String(USER_A));
        check('отписка мягкая — строка осталась, unsubscribed_at заполнен', !!row && row.unsubscribed_at !== null);
        check('source отмечен как bot', row.source === 'bot');

        const noTgId = await postPromo('/unsubscribe', {}, null);
        check('POST /unsubscribe без tgId в теле -> 400', noTgId.status === 400);

        const unknown = await postPromo('/unsubscribe', { tgId: '999999999' }, null);
        check('POST /unsubscribe на несуществующий tg_id -> 200, без ошибки (0 затронутых строк)', unknown.status === 200);
    }

    /* ── 5. GET /status ───────────────────────────────────────────────── */
    resetDb();
    {
        const neverSubscribed = await getPromo('/status', initA);
        check('GET /status для tg_id без подписки -> subscribed:false', neverSubscribed.body.subscribed === false);

        const noAuth = await fetch(`${base}/api/promo/status`);
        check('GET /status без X-Init-Data -> 401', noAuth.status === 401);

        await postPromo('/subscribe', {}, initA);
        await postPromo('/unsubscribe-me', {}, initA);
        const afterUnsub = await getPromo('/status', initA);
        check('GET /status после отписки -> subscribed:false (не просто «строки нет»)', afterUnsub.body.subscribed === false);
    }

    /* ── 6. Рассылка о скидке не уходит отписавшимся ─────────────────── */
    resetDb();
    {
        subscribers = [
            { tg_id: '111', consent_at: isoNow(), unsubscribed_at: null, source: 'checkout' },      // подписан
            { tg_id: '222', consent_at: isoNow(), unsubscribed_at: isoNow(-86400000), source: 'bot' }, // отписался
        ];

        const r = await fetch(`${base}/api/products/1/variants`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issueAdminToken()}` },
            body: JSON.stringify([
                { label: 'Стандарт', price: 1000, salePrice: 800, sortOrder: 0, isDefault: true },
            ]),
        });
        check('PUT /api/products/1/variants со скидкой -> 200', r.status === 200);

        await wait(700); // цикл рассылки — пауза 250мс на подписчика, двое в списке subscribers (включая отписавшегося)

        check('notifyPromo вызван ровно для подписанного (111)', promoNotifyCalls.includes('111'));
        check('notifyPromo НЕ вызван для отписавшегося (222)', !promoNotifyCalls.includes('222'));
        check('notifyPromo вызван ровно один раз (не для обоих, не дублируется)', promoNotifyCalls.length === 1);
        check('products.sale_notified выставлен в 1 после рассылки', products.find(p => p.id === 1).sale_notified === 1);
    }

    /* ── 7. PUT /variants не ждёт рассылку (ответ раньше, чем письма) ── */
    resetDb();
    {
        subscribers = [{ tg_id: '111', consent_at: isoNow(), unsubscribed_at: null, source: 'checkout' }];
        const startedAt = Date.now();
        const r = await fetch(`${base}/api/products/1/variants`, {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issueAdminToken()}` },
            body: JSON.stringify([
                { label: 'Стандарт', price: 1000, salePrice: 800, sortOrder: 0, isDefault: true },
            ]),
        });
        const elapsed = Date.now() - startedAt;
        check('PUT /variants отвечает быстро (< 200мс), не ждёт паузу рассылки (250мс+)', r.status === 200 && elapsed < 200);
        await wait(400); // дать фоновой рассылке отработать перед следующим тестом/закрытием сервера
    }

    /* ── 8. Распознавание вариантов отписки боту (нормализация текста) ── */
    {
        const shouldMatch = [
            'стоп акции', 'Стоп Акции', 'СТОП', 'стоп.', 'стоп!!!',
            'отписаться', 'Отпишите меня', 'не хочу акции', 'отписка',
            '  стоп  ', 'стоп, акции',
        ];
        for (const phrase of shouldMatch) {
            check(`фраза отписки распознаётся: "${phrase}"`, UNSUBSCRIBE_PHRASES.has(normalizeText(phrase)));
        }
        const shouldNotMatch = ['привет', 'стоп акции пожалуйста', 'хочу акции', 'подписаться'];
        for (const phrase of shouldNotMatch) {
            check(`фраза НЕ является командой отписки: "${phrase}"`, !UNSUBSCRIBE_PHRASES.has(normalizeText(phrase)));
        }
    }

    /* ── 9. Журнал согласий (promo_consent_log) — полная история, не
       перезаписывается при повторном действии ─────────────────────── */
    resetDb();
    {
        await postPromo('/subscribe', { source: 'checkout', consentTextVersion: '1' }, initA);
        await postPromo('/unsubscribe-me', {}, initA);
        await postPromo('/subscribe', { source: 'toggle', consentTextVersion: '1' }, initA);

        const logA = consentLog.filter(e => e.tg_id === String(USER_A));
        check('3 действия -> 3 отдельные записи в журнале (ничего не перезаписано)', logA.length === 3);
        check('1-я запись: subscribe, source=checkout', logA[0].action === 'subscribe' && logA[0].source === 'checkout' && logA[0].consent_text_version === '1');
        check('2-я запись: unsubscribe, source=toggle, версия пустая', logA[1].action === 'unsubscribe' && logA[1].source === 'toggle' && logA[1].consent_text_version == null);
        check('3-я запись: subscribe, source=toggle (новая запись, не слита с 1-й)', logA[2].action === 'subscribe' && logA[2].source === 'toggle' && logA[2].consent_text_version === '1');
        check('promo_subscribers при этом хранит только ТЕКУЩИЙ снимок (source=toggle, не всю историю)',
            subscribers.find(x => x.tg_id === String(USER_A)).source === 'toggle');

        // Отписка от бота того, кто никогда не подписывался — не создаёт
        // запись в журнале (нет смысла логировать "отписку" несуществующей
        // подписки).
        const before = consentLog.length;
        await postPromo('/unsubscribe', { tgId: '000000' }, null);
        check('отписка несуществующего tg_id не создаёт запись в журнале', consentLog.length === before);
    }

    /* ── 10. Сервисные уведомления не содержат рекламы и не зависят от
       promo_subscribers (статическая проверка исходников) ───────────── */
    {
        const botSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'bot.js'), 'utf8');
        const ordersSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
        const serviceReqSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'service-requests.js'), 'utf8');

        check('bot.js вообще не ссылается на promo_subscribers (только server/routes/promo.js и products.js это делают)',
            !botSrc.includes('promo_subscribers'));
        check('server/routes/orders.js не читает promo_subscribers', !ordersSrc.includes('promo_subscribers'));
        check('server/routes/service-requests.js не читает promo_subscribers', !serviceReqSrc.includes('promo_subscribers'));

        function fnBody(src, name) {
            const m = src.match(new RegExp('async function ' + name + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n'));
            return m ? m[1] : null;
        }
        const notifyCustomerBody = fnBody(botSrc, 'notifyCustomer');
        const notifyStockBody = fnBody(botSrc, 'notifyStock');
        const notifyServiceRequestStatusBody = fnBody(botSrc, 'notifyServiceRequestStatus');
        check('notifyCustomer() найден в bot.js', !!notifyCustomerBody);
        check('notifyStock() найден в bot.js', !!notifyStockBody);
        check('notifyServiceRequestStatus() найден в bot.js', !!notifyServiceRequestStatusBody);
        check('notifyCustomer() не содержит слово "Реклама"', notifyCustomerBody && !notifyCustomerBody.includes('Реклама'));
        check('notifyStock() не содержит слово "Реклама"', notifyStockBody && !notifyStockBody.includes('Реклама'));
        check('notifyServiceRequestStatus() не содержит слово "Реклама"', notifyServiceRequestStatusBody && !notifyServiceRequestStatusBody.includes('Реклама'));

        /* ── 11. Текст рекламного уведомления notifyPromo() — первая строка,
           реквизиты и подсказка об отписке на месте (статическая проверка
           шаблона, без реальной отправки) ──────────────────────────────── */
        const notifyPromoBody = fnBody(botSrc, 'notifyPromo');
        check('notifyPromo() найден в bot.js', !!notifyPromoBody);
        const textMatch = notifyPromoBody && notifyPromoBody.match(/const text = `([\s\S]*?)`;/);
        const promoTemplate = textMatch ? textMatch[1] : null;
        check('notifyPromo() шаблон текста найден', !!promoTemplate);
        const renderedPromo = promoTemplate
            ? promoTemplate
                .replace('${productName}', 'Тестовый товар')
                .replace('${SELLER_NAME}', SELLER_NAME)
                .replace('${SELLER_INN}', SELLER_INN)
                .replace(/\\n/g, '\n')
            : '';
        check('notifyPromo(): первая строка ровно "Акция в «Точка Монтажа». Реклама"',
            renderedPromo.startsWith('Акция в «Точка Монтажа». Реклама\n'));
        check('notifyPromo(): реквизиты продавца присутствуют', renderedPromo.includes(SELLER_NAME) && renderedPromo.includes(SELLER_INN));
        check('notifyPromo(): подсказка про отписку "стоп" присутствует', renderedPromo.includes('напишите: стоп'));
        check('notifyPromo(): реквизиты расположены перед подсказкой об отписке',
            renderedPromo.indexOf(SELLER_NAME) < renderedPromo.indexOf('напишите: стоп'));
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
