/* Проверка POST/GET /api/service-requests (server/routes/service-requests.js)
   — без реального Postgres и без реальной отправки сообщений ботом.

   Архитектура — та же, что в остальных test-*.js этого проекта:
   - db.query/queryOne/execute подменены на маленькую in-memory реализацию,
     которая распознаёт ровно те SQL-формы, которые реально строит роут
     (см. его исходник) — настоящий роут, настоящий Express, фейковая
     только БД.
   - bot.js подменён через require.cache ПЕРЕД require('../routes/
     service-requests') — сам роут делает require('../../bot') один раз
     при загрузке модуля, так что подмена должна случиться раньше.
     notifyServiceRequest в подмене — шпион: запоминает, с чем его
     вызвали, и может быть настроен бросать ошибку (для проверки, что
     сбой отправки не ломает сохранение заявки).
   - requireUser — настоящий, initData подписываются тем же алгоритмом,
     что verifyInitData ожидает (скопировано из test-require-user.js).

   Привязка магазин → получатель (SERVICE_REQUEST_MANAGERS) проверяется
   ОТДЕЛЬНО, напрямую на экспорте из настоящего bot.js (до его подмены в
   require.cache выше) — так проверка не зависит от того, подменена сеть
   или нет, и не требует перехватывать https.

   Запуск: node server/scripts/test-service-requests.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;
// service-requests.js импортирует requireAdmin из server/middleware/auth.js,
// который теперь бросает исключение при require(), если ADMIN_PASSWORD не
// задан (аудит безопасности, находка C).
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const crypto  = require('crypto');
const express = require('express');
const path    = require('path');
const db      = require('../db');

function isoNow(offsetMs = 0) {
    return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
}

/* ─── Подпись initData — тот же алгоритм, что в test-require-user.js ─── */
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

/* ─── Привязка магазин → получатель: проверяем НАСТОЯЩИЙ bot.js,
   до того как ниже подменим require.cache для роута. ──────────────── */
const realBot = require('../../bot');
const SERVICE_REQUEST_MANAGERS = realBot.SERVICE_REQUEST_MANAGERS;
const MAKSIM_ID       = 315827109; // chat_id из CITY_MANAGERS.krd — рабочий для ЭТОГО бота (см. bot.js)
const ALEXANDER_ID    = 392912448; // chat_id из CITY_MANAGERS.msk
const KOTLYAROVA_EMPLOYEE_ID = 403249437; // ему заявки на ремонт видеть нельзя

/* ─── Подмена bot.js для самого роута (шпион вместо реальной отправки) ── */
const botPath = require.resolve('../../bot');
let lastNotifyCall = null;
let notifyShouldThrow = false;
const fakeBot = {
    notifyServiceRequest: async (request) => {
        lastNotifyCall = request;
        if (notifyShouldThrow) throw new Error('simulated send failure');
    },
};
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot };

/* ─── In-memory «БД» ─────────────────────────────────────────────── */
let nextId = 1;
let serviceRequests = [];
let serviceRequestItems = [];

function resetDb() {
    nextId = 1;
    serviceRequests = [];
    serviceRequestItems = [];
}

db.queryOne = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT COUNT(*)::int AS c FROM service_requests')) {
        const tgId = params[0];
        const cutoff = Date.now() - 3600 * 1000;
        const c = serviceRequests.filter(r => r.tg_id === tgId && new Date(r.created_at).getTime() > cutoff).length;
        return { c };
    }
    if (s.startsWith('INSERT INTO service_requests')) {
        const [tgId, name, phone, store, deliveryNeeded, address, comment] = params;
        const row = {
            id: nextId++, tg_id: tgId, name, phone, store,
            delivery_needed: deliveryNeeded, address, comment,
            status: 'accepted', cost: null, admin_comment: null,
            created_at: isoNow(), updated_at: isoNow(),
        };
        serviceRequests.push(row);
        return { id: row.id };
    }
    if (s.startsWith('SELECT * FROM service_requests WHERE id=$1 AND tg_id=$2')) {
        const [id, tgId] = params;
        return serviceRequests.find(r => r.id === id && r.tg_id === tgId) || null;
    }
    if (s.startsWith('SELECT * FROM service_requests WHERE id=$1')) {
        const [id] = params;
        return serviceRequests.find(r => r.id === id) || null;
    }
    throw new Error('test-service-requests: неизвестный queryOne: ' + s);
};

db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM service_request_items WHERE request_id IN (')) {
        return serviceRequestItems.filter(i => params.includes(i.request_id));
    }
    if (s.startsWith('SELECT * FROM service_request_items WHERE request_id=$1')) {
        const [requestId] = params;
        return serviceRequestItems.filter(i => i.request_id === requestId);
    }
    if (s.startsWith('SELECT * FROM service_requests WHERE tg_id=$1')) {
        const [tgId] = params;
        return serviceRequests.filter(r => r.tg_id === tgId).sort((a, b) => b.id - a.id);
    }
    throw new Error('test-service-requests: неизвестный query: ' + s);
};

db.execute = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO service_request_items')) {
        const [requestId, toolName, problem] = params;
        serviceRequestItems.push({ id: serviceRequestItems.length + 1, request_id: requestId, tool_name: toolName, problem });
        return 1;
    }
    if (s.startsWith('INSERT INTO service_request_events')) {
        return 1; // история статусов — не нужна проверкам ниже, просто не должна падать
    }
    throw new Error('test-service-requests: неизвестный execute: ' + s);
};

const serviceRequestsRouter = require('../routes/service-requests');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    /* ── Привязка магазин → получатель (на настоящем bot.js) ───────── */
    check('SERVICE_REQUEST_MANAGERS.krd_selezneva -> Максим (315827109, тот же chat_id, что у CITY_MANAGERS.krd)',
        SERVICE_REQUEST_MANAGERS.krd_selezneva === MAKSIM_ID);
    check('SERVICE_REQUEST_MANAGERS.krd_kotlyarova -> Максим (315827109), НЕ сотрудник Котлярова',
        SERVICE_REQUEST_MANAGERS.krd_kotlyarova === MAKSIM_ID);
    check('SERVICE_REQUEST_MANAGERS.msk_maevka -> Александр (392912448, тот же chat_id, что у CITY_MANAGERS.msk)',
        SERVICE_REQUEST_MANAGERS.msk_maevka === ALEXANDER_ID);
    check('ID сотрудника магазина на Котлярова нигде не встречается среди получателей заявок на ремонт',
        !Object.values(SERVICE_REQUEST_MANAGERS).includes(KOTLYAROVA_EMPLOYEE_ID));

    const app = express();
    app.use(express.json());
    app.use('/api/service-requests', serviceRequestsRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const USER_A = 777111222;
    const USER_B = 777333444;
    const initA = buildSignedInitData({ id: USER_A, first_name: 'A' }, REAL_BOT_TOKEN);
    const initB = buildSignedInitData({ id: USER_B, first_name: 'B' }, REAL_BOT_TOKEN);

    function validBody(overrides) {
        return Object.assign({
            name: 'Иван Иванов',
            phone: '+7 (900) 123-45-67',
            store: 'krd_selezneva',
            items: [{ toolName: 'Пистолет Toua NTC57', problem: 'не поджигает' }],
            deliveryNeeded: false,
            consent: true,
        }, overrides);
    }

    async function post(body, initData) {
        const r = await fetch(`${base}/api/service-requests`, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, initData ? { 'X-Init-Data': initData } : {}),
            body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    /* ── requireUser: без подписи -> 401, не доходит до БД ──────────── */
    resetDb();
    {
        const r = await post(validBody(), null);
        check('POST без X-Init-Data -> 401', r.status === 401);
        check('POST без X-Init-Data -> заявка не сохранена', serviceRequests.length === 0);
    }

    /* ── Валидация ────────────────────────────────────────────────── */
    resetDb();
    {
        const noName = await post(validBody({ name: '' }), initA);
        check('пустое имя -> 400', noName.status === 400);

        const badPhone = await post(validBody({ phone: '12345' }), initA);
        check('некорректный телефон -> 400', badPhone.status === 400);

        const badStore = await post(validBody({ store: 'spb_nevsky' }), initA);
        check('недопустимый код магазина -> 400', badStore.status === 400);

        const noConsent = await post(validBody({ consent: false }), initA);
        check('без согласия на обработку ПДн -> 400', noConsent.status === 400);

        const noItems = await post(validBody({ items: [] }), initA);
        check('пустой список инструментов -> 400', noItems.status === 400);

        const tooManyItems = await post(validBody({
            items: Array.from({ length: 11 }, (_, i) => ({ toolName: `Инструмент ${i}` })),
        }), initA);
        check('11 инструментов (>10) -> 400', tooManyItems.status === 400);

        const exactlyMax = await post(validBody({
            items: Array.from({ length: 10 }, (_, i) => ({ toolName: `Инструмент ${i}` })),
        }), initA);
        check('ровно 10 инструментов -> 201 (граница, не отклоняется)', exactlyMax.status === 201);

        const emptyToolName = await post(validBody({ items: [{ toolName: '  ' }] }), initA);
        check('пустое (из пробелов) название инструмента -> 400', emptyToolName.status === 400);

        const deliveryNoAddress = await post(validBody({ deliveryNeeded: true, address: '' }), initA);
        check('нужна доставка без адреса -> 400', deliveryNoAddress.status === 400);

        const deliveryWithAddress = await post(validBody({ deliveryNeeded: true, address: 'Краснодар, ул. Тестовая, 1' }), initA);
        check('нужна доставка с адресом -> 201', deliveryWithAddress.status === 201);
    }

    /* ── Успешное создание: форма ответа, что реально сохранилось ──── */
    resetDb();
    {
        const r = await post(validBody({ store: 'krd_kotlyarova', comment: 'Позвоните после 18:00' }), initA);
        check('создание заявки -> 201', r.status === 201);
        check('ответ содержит id', typeof r.body.id === 'number');
        check('ответ содержит номер вида «Р-<id>»', r.body.number === `Р-${r.body.id}`);
        check('tg_id в БД берётся из подписанных initData, не из тела запроса',
            serviceRequests[serviceRequests.length - 1].tg_id === String(USER_A));
        check('инструмент сохранён в service_request_items',
            serviceRequestItems.some(i => i.request_id === r.body.id && i.tool_name === 'Пистолет Toua NTC57'));
    }

    /* ── Владелец: нельзя прочитать чужую заявку ─────────────────────── */
    resetDb();
    {
        const created = await post(validBody(), initA);
        const id = created.body.id;

        const ownRead = await fetch(`${base}/api/service-requests/${id}`, { headers: { 'X-Init-Data': initA } });
        check('владелец читает свою заявку -> 200', ownRead.status === 200);

        const strangerRead = await fetch(`${base}/api/service-requests/${id}`, { headers: { 'X-Init-Data': initB } });
        check('чужой пользователь читает чужую заявку -> 404 (не 403 — не палим существование)', strangerRead.status === 404);

        const noAuthRead = await fetch(`${base}/api/service-requests/${id}`);
        check('чтение заявки без X-Init-Data -> 401', noAuthRead.status === 401);

        const myListA = await fetch(`${base}/api/service-requests/my`, { headers: { 'X-Init-Data': initA } });
        const myListABody = await myListA.json();
        const myListB = await fetch(`${base}/api/service-requests/my`, { headers: { 'X-Init-Data': initB } });
        const myListBBody = await myListB.json();
        check('GET /my у владельца содержит заявку', myListABody.some(x => x.id === id));
        check('GET /my у чужого пользователя НЕ содержит чужую заявку', !myListBBody.some(x => x.id === id));
    }

    /* ── Лимит: не больше 5 заявок в час на пользователя ─────────────── */
    resetDb();
    {
        const results = [];
        for (let i = 0; i < 6; i++) {
            results.push(await post(validBody({ name: `Заявитель ${i}` }), initA));
        }
        const okCount = results.filter(r => r.status === 201).length;
        const limitedCount = results.filter(r => r.status === 429).length;
        check('из 6 заявок за час одного пользователя — ровно 5 приняты', okCount === 5);
        check('6-я заявка за тот же час -> 429', limitedCount === 1 && results[5].status === 429);

        // Старые (>1ч назад) заявки не должны учитываться в лимите.
        resetDb();
        for (let i = 0; i < 10; i++) {
            serviceRequests.push({
                id: nextId++, tg_id: String(USER_A), name: 'Старая', phone: '+7 900 000 00 00',
                store: 'krd_selezneva', delivery_needed: 0, address: null, comment: null,
                status: 'accepted', cost: null, admin_comment: null,
                created_at: isoNow(-2 * 3600 * 1000), updated_at: isoNow(-2 * 3600 * 1000),
            });
        }
        const afterOld = await post(validBody(), initA);
        check('10 заявок старше часа не блокируют новую (лимит — скользящее окно, не общий счётчик)', afterOld.status === 201);
    }

    /* ── Другой пользователь — свой отдельный лимит ──────────────────── */
    resetDb();
    {
        for (let i = 0; i < 5; i++) await post(validBody(), initA);
        const blocked = await post(validBody(), initA);
        check('пользователь A упёрся в лимит', blocked.status === 429);
        const userB = await post(validBody(), initB);
        check('лимит персональный — пользователь B не задет лимитом A', userB.status === 201);
    }

    /* ── Уведомление: не ломает сохранение при сбое отправки ─────────── */
    resetDb();
    {
        notifyShouldThrow = true;
        lastNotifyCall = null;
        const r = await post(validBody({ store: 'msk_maevka' }), initA);
        check('заявка сохраняется (201), даже если notifyServiceRequest бросает ошибку', r.status === 201);
        await new Promise(resolve => setTimeout(resolve, 20)); // дать катчу отработать
        check('notifyServiceRequest всё равно был вызван (ошибка — только в сторону лога)', lastNotifyCall !== null);
        notifyShouldThrow = false;
    }

    /* ── Уведомление: вызывается с нормализованными данными заявки ──── */
    resetDb();
    {
        lastNotifyCall = null;
        const r = await post(validBody({
            store: 'msk_maevka',
            items: [{ toolName: 'Шуруповёрт', problem: 'не крутит' }, { toolName: 'Степлер' }],
        }), initA);
        await new Promise(resolve => setTimeout(resolve, 20));
        check('notifyServiceRequest вызван с тем же store, что в заявке',
            lastNotifyCall && lastNotifyCall.store === 'msk_maevka');
        check('notifyServiceRequest вызван с номером заявки',
            lastNotifyCall && lastNotifyCall.number === `Р-${r.body.id}`);
        check('notifyServiceRequest получил оба инструмента',
            lastNotifyCall && lastNotifyCall.items.length === 2 && lastNotifyCall.items[0].toolName === 'Шуруповёрт');
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
