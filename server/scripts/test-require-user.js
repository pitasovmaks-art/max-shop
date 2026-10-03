/* Проверка requireUser (server/middleware/requireUser.js) — закрытие
   уязвимости «tg_id без проверки» (см. PROGRESS.md).

   Поднимает временный Express-сервер с РЕАЛЬНЫМИ роутами
   orders/favorites/stock-notify/promo на свободном порту (без реального
   сервера index.js и без реальной БД — requireUser отвечает 401 раньше,
   чем код доходит до db.query, так что подключение к Postgres не
   требуется; DB_* ниже — заглушки только чтобы server/db.js не упал при
   require() на отсутствующих переменных окружения).

   Проверяет:
   1. Без заголовка X-Init-Data — 401 на каждом защищённом эндпоинте.
   2. С initData, подписанными ЧУЖИМ (неправильным) токеном — 401.
   3. С initData, где user.id подменён после подписи (хэш не сойдётся) — 401.
   4. С корректно подписанными initData — requireUser пропускает запрос
      и кладёт req.tgId = user.id из подписи (а не из query/body).

   Запуск: node server/scripts/test-require-user.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

const REAL_BOT_TOKEN  = 'real_bot_token_for_test';
const WRONG_BOT_TOKEN = 'attacker_guessed_wrong_token';
process.env.MAX_BOT_TOKEN = REAL_BOT_TOKEN;

const crypto  = require('crypto');
const express = require('express');

const { requireUser } = require('../middleware/requireUser');
const ordersRouter      = require('../routes/orders');
const favoritesRouter   = require('../routes/favorites');
const stockNotifyRouter = require('../routes/stock-notify');
const promoRouter       = require('../routes/promo');

/* Собирает и подписывает initData тем же алгоритмом, что verifyInitData
   (server/utils/initData.js) ожидает на проверке — HMAC(key=HMAC(key="WebAppData",
   botToken), dataCheckString), поля отсортированы, затем всё один раз
   URL-кодируется (имитация слоя кодирования из max-web-app.js). */
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

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const VICTIM_ID   = 555666777; // настоящий покупатель, чей tg_id атакующий подобрал/подсмотрел
    const ATTACKER_ID = 111222333;

    const validInitData = buildSignedInitData({ id: VICTIM_ID, first_name: 'Victim' }, REAL_BOT_TOKEN);
    const wrongTokenInitData = buildSignedInitData({ id: VICTIM_ID, first_name: 'Victim' }, WRONG_BOT_TOKEN);

    // Тампер: берём валидно подписанные данные и меняем id пользователя
    // ПОСЛЕ подписи, не пересчитывая hash — так выглядела бы попытка
    // подставить чужой tg_id, просто отредактировав то, что раньше клиент
    // мог свободно слать в query/body.
    const decodedValid = decodeURIComponent(validInitData);
    const tamperedInitData = encodeURIComponent(
        decodedValid.replace(String(VICTIM_ID), String(ATTACKER_ID))
    );

    /* ── 1) requireUser в изоляции (без реальных роутов/БД) ────────── */
    const probeApp = express();
    probeApp.use(express.json());
    probeApp.get('/probe', requireUser, (req, res) => res.json({ ok: true, tgId: req.tgId }));
    const probeServer = probeApp.listen(0);
    const probePort = probeServer.address().port;
    const probeBase = `http://127.0.0.1:${probePort}`;

    {
        const r = await fetch(`${probeBase}/probe`);
        check('requireUser: без X-Init-Data -> 401', r.status === 401);
    }
    {
        const r = await fetch(`${probeBase}/probe`, { headers: { 'X-Init-Data': wrongTokenInitData } });
        check('requireUser: подпись чужим/неверным токеном -> 401', r.status === 401);
    }
    {
        const r = await fetch(`${probeBase}/probe`, { headers: { 'X-Init-Data': tamperedInitData } });
        check('requireUser: tg_id подменён после подписи (hash не сходится) -> 401', r.status === 401);
    }
    {
        const r = await fetch(`${probeBase}/probe`, { headers: { 'X-Init-Data': validInitData } });
        const body = await r.json().catch(() => ({}));
        check('requireUser: валидная подпись -> 200', r.status === 200);
        check(`requireUser: req.tgId берётся из подписи, не из клиента (ожидали ${VICTIM_ID}, получили ${body.tgId})`,
            body.tgId === String(VICTIM_ID));
    }
    probeServer.close();

    /* ── 2) Реальные защищённые эндпоинты: без подписи -> 401 ──────── */
    const app = express();
    app.use(express.json());
    app.use('/api/orders', ordersRouter);
    app.use('/api/favorites', favoritesRouter);
    app.use('/api/stock-notify', stockNotifyRouter);
    app.use('/api/promo', promoRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const protectedRequests = [
        ['GET',  '/api/orders/my'],
        ['POST', '/api/orders'],
        ['GET',  '/api/favorites'],
        ['POST', '/api/favorites'],
        ['DELETE', '/api/favorites'],
        ['POST', '/api/stock-notify'],
        ['GET',  '/api/stock-notify/check?product_id=1'],
        ['GET',  '/api/stock-notify/list'],
        ['POST', '/api/promo/subscribe'],
        ['GET',  '/api/promo/status'],
    ];

    for (const [method, path] of protectedRequests) {
        const r = await fetch(`${base}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify({ productId: 1 }),
        });
        check(`${method} ${path}: без X-Init-Data -> 401 (не доходит до БД)`, r.status === 401);
    }

    // Намеренно НЕ заданная уязвимость: /api/promo/unsubscribe вызывается
    // сервер-к-серверу из bot.js (см. его комментарий в promo.js), поэтому
    // requireUser на нём нет — проверяем, что он по-прежнему отвечает без
    // X-Init-Data (это ожидаемо, не регрессия).
    {
        const r = await fetch(`${base}/api/promo/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tgId: VICTIM_ID }),
        });
        check('POST /api/promo/unsubscribe: сервер-к-серверу, без requireUser (ожидаемо) — не 401 от requireUser',
            r.status !== 401);
    }

    server.close();

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
