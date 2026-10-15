/* Проверка GET/PUT /api/service-requests/admin* (этап 2, server/routes/
   service-requests.js) — без реального Postgres и без реальной отправки
   сообщений ботом. Та же архитектура, что в test-service-requests.js:
   db.query/queryOne/execute — маленькая in-memory реализация, bot.js —
   подмена через require.cache (ДО require('../routes/service-requests'),
   которую делает сам роут один раз при загрузке модуля), requireAdmin —
   настоящий (server/middleware/auth.js), просто передаём верный пароль
   в Authorization: Bearer.

   Запуск: node server/scripts/test-service-requests-admin.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

const REAL_BOT_TOKEN = 'real_bot_token_for_test';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db');
const { ADMIN_PASSWORD } = require('../middleware/auth');

function isoNow(offsetMs = 0) {
    return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
}

/* ─── Подмена bot.js: шпионы на обоих уведомлениях ──────────────────── */
const botPath = require.resolve('../../bot');
let lastStatusNotify = null;
const fakeBot = {
    notifyServiceRequest: async () => {},
    notifyServiceRequestStatus: async (tgId, request, changes) => {
        lastStatusNotify = { tgId, request, changes };
    },
};
require.cache[botPath] = { id: botPath, filename: botPath, loaded: true, exports: fakeBot };

/* ─── In-memory «БД» ─────────────────────────────────────────────── */
let nextId = 1;
let serviceRequests = [];
let serviceRequestItems = [];
let serviceRequestEvents = [];

function resetDb() {
    nextId = 1;
    serviceRequests = [
        {
            id: 1, tg_id: '555000111', name: 'Пётр Петров', phone: '+7 900 111 22 33',
            store: 'krd_selezneva', delivery_needed: 0, address: null, comment: 'Срочно',
            status: 'accepted', cost: null, admin_comment: null,
            created_at: isoNow(-3600_000), updated_at: isoNow(-3600_000),
        },
    ];
    serviceRequestItems = [
        { id: 1, request_id: 1, tool_name: 'Пистолет Toua NTC57', problem: 'не поджигает' },
    ];
    serviceRequestEvents = [
        { request_id: 1, status: 'accepted', changed_by: 'system', created_at: isoNow(-3600_000) },
    ];
    nextId = 2;
}

db.queryOne = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    // Копия ({...row}), не живая ссылка на объект в serviceRequests — иначе
    // "before"-снимок в самом роуте (PUT /admin/:id) мутировал бы на
    // месте следующим же db.execute(UPDATE...), и сравнение before/after
    // для changes всегда видело бы «ничего не изменилось». Настоящий
    // Postgres этой проблемы не имел бы в принципе (SELECT — это снимок),
    // это особенность только фейковой БД в этом тесте.
    if (s.startsWith('SELECT * FROM service_requests WHERE id=$1 AND tg_id=$2')) {
        const [id, tgId] = params;
        const row = serviceRequests.find(r => r.id === id && r.tg_id === tgId);
        return row ? { ...row } : null;
    }
    if (s.startsWith('SELECT * FROM service_requests WHERE id=$1')) {
        const [id] = params;
        const row = serviceRequests.find(r => r.id === id);
        return row ? { ...row } : null;
    }
    throw new Error('test-service-requests-admin: неизвестный queryOne: ' + s);
};

db.query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM service_requests ORDER BY id DESC')) {
        return [...serviceRequests].sort((a, b) => b.id - a.id);
    }
    if (s.startsWith('SELECT * FROM service_request_items WHERE request_id IN (')) {
        return serviceRequestItems.filter(i => params.includes(i.request_id));
    }
    if (s.startsWith('SELECT * FROM service_request_items WHERE request_id=$1')) {
        const [requestId] = params;
        return serviceRequestItems.filter(i => i.request_id === requestId);
    }
    if (s.startsWith('SELECT status, changed_by, created_at FROM service_request_events WHERE request_id=$1')) {
        const [requestId] = params;
        return serviceRequestEvents.filter(e => e.request_id === requestId);
    }
    // Своя (пустая) in-memory таблица orders — только чтобы проверить, что
    // GET /api/orders не видит заявки на ремонт (они физически в другой
    // таблице); сами заказы в этом файле не тестируются.
    if (s.startsWith('SELECT * FROM orders ORDER BY id DESC')) {
        return [];
    }
    throw new Error('test-service-requests-admin: неизвестный query: ' + s);
};

db.execute = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('UPDATE service_requests SET')) {
        const idMatch = s.match(/WHERE id=\$(\d+)/);
        const id = params[+idMatch[1] - 1];
        const row = serviceRequests.find(r => r.id === id);
        if (row) {
            const setClause = s.slice('UPDATE service_requests SET'.length, s.indexOf(' WHERE'));
            const fieldRe = /(\w+)=\$(\d+)/g;
            let m;
            while ((m = fieldRe.exec(setClause))) {
                row[m[1]] = params[+m[2] - 1];
            }
            row.updated_at = isoNow();
        }
        return row ? 1 : 0;
    }
    if (s.startsWith('INSERT INTO service_request_events')) {
        const [requestId, status] = params;
        serviceRequestEvents.push({ request_id: requestId, status, changed_by: 'admin', created_at: isoNow() });
        return 1;
    }
    throw new Error('test-service-requests-admin: неизвестный execute: ' + s);
};

const serviceRequestsRouter = require('../routes/service-requests');
const ordersRouter          = require('../routes/orders');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/service-requests', serviceRequestsRouter);
    app.use('/api/orders', ordersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const adminHeaders = { Authorization: `Bearer ${ADMIN_PASSWORD}` };
    const wrongHeaders  = { Authorization: 'Bearer wrong-password' };

    async function getAdmin(path, headers = adminHeaders) {
        const r = await fetch(`${base}${path}`, { headers });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }
    async function putAdmin(path, body, headers = adminHeaders) {
        const r = await fetch(`${base}${path}`, {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
            body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    /* ── requireAdmin на всех трёх admin-роутах ─────────────────────── */
    resetDb();
    {
        const noAuthList   = await fetch(`${base}/api/service-requests/admin`);
        check('GET /admin без Authorization -> 401', noAuthList.status === 401);

        const wrongList = await getAdmin('/api/service-requests/admin', wrongHeaders);
        check('GET /admin с неверным паролем -> 401', wrongList.status === 401);

        const wrongDetail = await getAdmin('/api/service-requests/admin/1', wrongHeaders);
        check('GET /admin/:id с неверным паролем -> 401', wrongDetail.status === 401);

        const wrongPut = await putAdmin('/api/service-requests/admin/1', { status: 'ready' }, wrongHeaders);
        check('PUT /admin/:id с неверным паролем -> 401', wrongPut.status === 401);

        const ok = await getAdmin('/api/service-requests/admin');
        check('GET /admin с верным паролем -> 200', ok.status === 200);
    }

    /* ── GET /admin — список, новые сверху; GET /admin/:id — с историей ── */
    resetDb();
    {
        serviceRequests.push({
            id: 2, tg_id: '555000222', name: 'Анна', phone: '+7 900 000 00 00',
            store: 'msk_maevka', delivery_needed: 1, address: 'Москва, ул. Тестовая, 2', comment: null,
            status: 'in_progress', cost: 1500, admin_comment: 'Заменили ролик',
            created_at: isoNow(-60_000), updated_at: isoNow(-60_000),
        });
        serviceRequestEvents.push({ request_id: 2, status: 'in_progress', changed_by: 'admin', created_at: isoNow(-60_000) });

        const list = await getAdmin('/api/service-requests/admin');
        check('GET /admin содержит обе заявки', list.body.length === 2);
        check('GET /admin отдаёт новые сверху (id=2 раньше id=1)', list.body[0].id === 2);
        check('GET /admin отдаёт items у каждой заявки', list.body.find(r => r.id === 1).items.length === 1);

        const detail = await getAdmin('/api/service-requests/admin/1');
        check('GET /admin/:id -> 200', detail.status === 200);
        check('GET /admin/:id отдаёт историю статусов (events)', Array.isArray(detail.body.events) && detail.body.events.length === 1);
        check('GET /admin/:id на несуществующей заявке -> 404', (await getAdmin('/api/service-requests/admin/999')).status === 404);
    }

    /* ── PUT /admin/:id: статус, запись в историю, уведомление ───────── */
    resetDb();
    {
        lastStatusNotify = null;
        const r = await putAdmin('/api/service-requests/admin/1', { status: 'in_progress' });
        check('PUT статус accepted -> in_progress -> 200', r.status === 200);
        check('статус реально обновился в БД', serviceRequests[0].status === 'in_progress');
        check('в историю добавлена запись с changed_by=admin',
            serviceRequestEvents.some(e => e.request_id === 1 && e.status === 'in_progress' && e.changed_by === 'admin'));
        check('уведомление клиенту вызвано с правильным tg_id', lastStatusNotify && lastStatusNotify.tgId === '555000111');
        check('уведомление содержит изменение статуса', lastStatusNotify && lastStatusNotify.changes.status === 'in_progress');

        const badStatus = await putAdmin('/api/service-requests/admin/1', { status: 'done' });
        check('недопустимый статус -> 400', badStatus.status === 400);

        const notFound = await putAdmin('/api/service-requests/admin/999', { status: 'ready' });
        check('PUT на несуществующей заявке -> 404', notFound.status === 404);
    }

    /* ── PUT /admin/:id: стоимость и комментарий мастера ─────────────── */
    resetDb();
    {
        lastStatusNotify = null;
        const r = await putAdmin('/api/service-requests/admin/1', { cost: 1200, adminComment: 'Заменили ролик подачи' });
        check('PUT со стоимостью -> 200', r.status === 200);
        check('стоимость сохранена', serviceRequests[0].cost === 1200);
        check('комментарий мастера сохранён', serviceRequests[0].admin_comment === 'Заменили ролик подачи');
        check('статус НЕ менялся — в историю ничего не добавилось',
            serviceRequestEvents.filter(e => e.request_id === 1).length === 1);
        check('уведомление содержит и стоимость, и комментарий',
            lastStatusNotify && lastStatusNotify.changes.cost === 1200 && lastStatusNotify.changes.adminComment === 'Заменили ролик подачи');

        const badCost = await putAdmin('/api/service-requests/admin/1', { cost: -5 });
        check('отрицательная стоимость -> 400', badCost.status === 400);

        const clearCost = await putAdmin('/api/service-requests/admin/1', { cost: null });
        check('явный null очищает стоимость -> 200', clearCost.status === 200 && serviceRequests[0].cost === null);
    }

    /* ── Без дублей: повторный PUT с теми же значениями не уведомляет ── */
    resetDb();
    {
        await putAdmin('/api/service-requests/admin/1', { status: 'ready', cost: 1000 });
        lastStatusNotify = null;
        const eventsBefore = serviceRequestEvents.filter(e => e.request_id === 1).length;

        const repeat = await putAdmin('/api/service-requests/admin/1', { status: 'ready', cost: 1000 });
        check('повторный PUT с тем же статусом/стоимостью -> 200 (не ошибка)', repeat.status === 200);
        check('повторный PUT НЕ добавляет новую запись в историю (значение не изменилось)',
            serviceRequestEvents.filter(e => e.request_id === 1).length === eventsBefore);
        check('повторный PUT без реальных изменений НЕ вызывает уведомление', lastStatusNotify === null);
    }

    /* ── «Готова»: уведомление содержит адрес доставки или магазин ───── */
    resetDb();
    {
        lastStatusNotify = null;
        await putAdmin('/api/service-requests/admin/1', { status: 'ready' });
        check('на статусе ready без доставки у заявки с историческим store нормализован storeLabel (для админки, в сам текст уведомления больше не попадает)',
            lastStatusNotify && lastStatusNotify.request.storeLabel && !lastStatusNotify.request.deliveryNeeded);

        serviceRequests.push({
            id: 2, tg_id: '555000222', name: 'Анна', phone: '+7 900 000 00 00',
            store: 'msk_maevka', delivery_needed: 1, address: 'Москва, ул. Тестовая, 2', comment: null,
            status: 'accepted', cost: null, admin_comment: null,
            created_at: isoNow(), updated_at: isoNow(),
        });
        lastStatusNotify = null;
        await putAdmin('/api/service-requests/admin/2', { status: 'ready' });
        check('на статусе ready с доставкой запрос нормализован с deliveryNeeded=true и адресом',
            lastStatusNotify && lastStatusNotify.request.deliveryNeeded === true && lastStatusNotify.request.address === 'Москва, ул. Тестовая, 2');
    }

    /* ── «Готова»: точный текст уведомления (статическая проверка шаблона
       в bot.js, без реальной отправки — тот же приём, что test-promo.js
       использует для notifyPromo) ─────────────────────────────────────── */
    {
        const botSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'bot.js'), 'utf8');
        const m = botSrc.match(/async function notifyServiceRequestStatus\s*\([^)]*\)\s*\{([\s\S]*?)\n\}\n/);
        const body = m ? m[1] : null;
        check('notifyServiceRequestStatus() найдена в bot.js', !!body);

        check('уведомление "Готова" НЕ содержит старую фразу "Доставим по адресу"',
            body && !body.includes('Доставим по адресу'));

        check('уведомление "Готова" С доставкой: предлагает согласовать доставку или забрать самостоятельно, без адреса конкретного магазина (выбор магазина убран из формы)',
            body && /Свяжемся с вами, чтобы согласовать доставку, или забрать инструмент самостоятельно/.test(body)
                && !body.includes('${request.storeLabel}'));

        check('уведомление "Готова" БЕЗ доставки: свяжемся и договоримся, где забрать — без привязки к магазину',
            body && /Свяжемся с вами, чтобы договориться, где забрать инструмент/.test(body));
    }

    /* ── Разделение разделов: заявки не попадают в /api/orders ───────── */
    resetDb();
    {
        const orders = await getAdmin('/api/orders');
        check('GET /api/orders (admin) не содержит заявки на ремонт (пуст, т.к. orders-таблица отдельная)',
            orders.status === 200 && Array.isArray(orders.body) && orders.body.length === 0);
    }

    server.close();
    console.log(failures === 0 ? '\n✅ Все проверки прошли' : `\n❌ ${failures} проверка(и) провалены`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
