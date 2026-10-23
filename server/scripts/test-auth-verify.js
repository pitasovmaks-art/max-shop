/* Проверка POST /api/auth/verify (server/routes/auth.js):
   - Находка 23.10.2026: отказ по User-Agent (/MAX\//) отсекал настоящих
     пользователей Max на Android (их UA не содержит "MAX/") и не был
     реальной защитой (UA легко подделать) — убран. Единственный барьер
     для допуска в магазин теперь — подпись initData, одинаково для
     всех, включая ADMIN_IDS (обход там есть только для подписки на
     канал, не для подписи).
   - auth_date (срок initData) проверяется в server/utils/initData.js
     (MAX_INIT_DATA_AGE_SECONDS = 24ч) — здесь просто подтверждаем, что
     /verify действительно его соблюдает.
   - checkChannelMembership() обёрнута в try/catch — если бросает (не
     просто резолвится в false, как спроектирована), /verify отвечает
     502 reason=verify_error, а не зависает без ответа необработанным
     rejection'ом (так было бы в Express 4 без этой правки).
   - Каждый отказ логируется (reason + user_id, если уже известен) —
     без initData и прочих данных запроса.

   Без реального Postgres/сети — checkChannelMembership подменяется
   прямо в server/routes/subscription.js (require.cache делится между
   этим файлом и auth.js, который требует тот же модуль).

   Запуск: node server/scripts/test-auth-verify.js
*/
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
process.env.MAX_BOT_TOKEN  = process.env.MAX_BOT_TOKEN  || 'test-bot-token';

const crypto  = require('crypto');
const express = require('express');

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

/* ─── Подмена checkChannelMembership — требуем subscription.js ДО auth.js
   и правим свойство на уже закэшированном объекте exports: auth.js
   делает require('./subscription') того же файла и получит тот же
   объект с уже подменённым свойством. ─────────────────────────────── */
const subscriptionModule = require('../routes/subscription');
let membershipBehavior = 'true'; // 'true' | 'false' | 'throw'
subscriptionModule.checkChannelMembership = async () => {
    if (membershipBehavior === 'throw') throw new Error('симулированный сбой Max API');
    return membershipBehavior === 'true';
};
// ADMIN_IDS читается subscription.js из env на момент require() ниже —
// пусто по умолчанию, отдельный тест (№6) задаёт настоящего админа.
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '';

const authRouter = require('../routes/auth');

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; RMX3771 Build/AP3A.240617.008; wv) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36';

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const logs = [];
    const origWarn  = console.warn;
    const origError = console.error;
    console.warn  = (...a) => { logs.push(a.join(' ')); };
    console.error = (...a) => { logs.push(a.join(' ')); };

    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;

    const USER = 123456;
    const validInitData = buildSignedInitData({ id: USER }, process.env.MAX_BOT_TOKEN);

    async function verify(body, ua) {
        const r = await fetch(`${base}/api/auth/verify`, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent':   ua !== undefined ? ua : 'Mozilla/5.0 Mobile/15E148 MAX/26.17.3',
            },
            body: JSON.stringify(body || {}),
        });
        return { status: r.status, body: await r.json().catch(() => ({})) };
    }

    /* ── 1. Android UA без "MAX/" + валидная initData -> доступ разрешён ── */
    logs.length = 0;
    membershipBehavior = 'true';
    {
        const r = await verify({ initData: validInitData }, ANDROID_UA);
        check('Android UA без "MAX/" + валидная initData -> 200 ok:true (UA больше не блокирует)',
            r.status === 200 && r.body.ok === true && r.body.userId === USER);
        check('реальный Android UA из находки не даёт reason=not_max (такой причины больше нет)',
            !logs.some(l => l.includes('not_max')));
    }

    /* ── 2. Обычный браузер, initData вообще нет -> отказ ────────────── */
    logs.length = 0;
    {
        const r = await verify({}, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36');
        check('браузер без initData -> 401 reason=invalid_signature', r.status === 401 && r.body.reason === 'invalid_signature');
        check('invalid_signature (нет initData) попал в лог', logs.some(l => l.includes('invalid_signature')));
    }

    /* ── 3. Невалидная подпись -> отказ, логируется ──────────────────── */
    logs.length = 0;
    {
        const r = await verify({ initData: 'garbage-not-signed' });
        check('кривая initData -> 401 reason=invalid_signature', r.status === 401 && r.body.reason === 'invalid_signature');
        check('invalid_signature попал в лог', logs.some(l => l.includes('invalid_signature')));
    }

    /* ── 4. Просроченная initData (старше 24ч) -> отказ ──────────────── */
    logs.length = 0;
    {
        const now = Math.floor(Date.now() / 1000);
        const expiredInitData = buildSignedInitData({ id: USER }, process.env.MAX_BOT_TOKEN, now - 25 * 3600);
        const r = await verify({ initData: expiredInitData });
        check('initData старше 24ч -> 401 reason=invalid_signature (MAX_INIT_DATA_AGE_SECONDS в server/utils/initData.js)',
            r.status === 401 && r.body.reason === 'invalid_signature');

        const freshInitData = buildSignedInitData({ id: USER }, process.env.MAX_BOT_TOKEN, now - 23 * 3600);
        const rFresh = await verify({ initData: freshInitData });
        check('initData младше 24ч (23ч) -> подпись принимается (не отклонена по сроку)',
            rFresh.status !== 401 || rFresh.body.reason !== 'invalid_signature');
    }

    /* ── 5. checkChannelMembership бросает -> 502 verify_error, не зависает ── */
    logs.length = 0;
    membershipBehavior = 'throw';
    {
        const r = await verify({ initData: validInitData });
        check('checkChannelMembership бросает -> 502 reason=verify_error (ответ пришёл, не зависло)',
            r.status === 502 && r.body.reason === 'verify_error');
        check('verify_error в логе содержит user_id и НЕ содержит initData',
            logs.some(l => l.includes('verify_error') && l.includes(String(USER))) &&
            !logs.some(l => l.includes(validInitData)));
    }

    /* ── 6. Не подписан -> not_subscribed (не ошибка, штатный отказ) ─── */
    logs.length = 0;
    membershipBehavior = 'false';
    {
        const r = await verify({ initData: validInitData });
        check('не подписан -> 200 ok:false reason=not_subscribed',
            r.status === 200 && r.body.ok === false && r.body.reason === 'not_subscribed');
        check('not_subscribed в логе содержит user_id', logs.some(l => l.includes('not_subscribed') && l.includes(String(USER))));
    }

    /* ── 7. Подписан -> ok:true, без единой строки отказа в логе ─────── */
    logs.length = 0;
    membershipBehavior = 'true';
    {
        const r = await verify({ initData: validInitData });
        check('подписан -> 200 ok:true, userId верный', r.status === 200 && r.body.ok === true && r.body.userId === USER);
        check('успешная проверка не оставляет строк в логе', logs.length === 0);
    }

    /* ── 8. ADMIN_IDS не обходит проверку ПОДПИСИ — только подписку ──── */
    {
        delete require.cache[require.resolve('../routes/subscription')];
        delete require.cache[require.resolve('../routes/auth')];
        process.env.ADMIN_IDS = String(USER); // USER теперь "админ"
        const adminSubscriptionModule = require('../routes/subscription');
        adminSubscriptionModule.checkChannelMembership = async () => {
            throw new Error('не должен был вызваться — ADMIN_IDS обходит именно эту проверку');
        };
        const adminAuthRouter = require('../routes/auth');

        const adminApp = express();
        adminApp.use(express.json());
        adminApp.use('/api/auth', adminAuthRouter);
        const adminServer = adminApp.listen(0);
        const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

        async function verifyAdmin(body) {
            const r = await fetch(`${adminBase}/api/auth/verify`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
                body:    JSON.stringify(body || {}),
            });
            return { status: r.status, body: await r.json().catch(() => ({})) };
        }

        const badSig = await verifyAdmin({ initData: 'garbage-not-signed' });
        check('ADMIN_IDS НЕ обходит проверку подписи: невалидная initData от админа -> 401 invalid_signature',
            badSig.status === 401 && badSig.body.reason === 'invalid_signature');

        const goodSig = await verifyAdmin({ initData: validInitData });
        check('ADMIN_IDS обходит только подписку на канал: валидная initData от админа -> 200 ok:true (checkChannelMembership не вызывался)',
            goodSig.status === 200 && goodSig.body.ok === true && goodSig.body.userId === USER);

        adminServer.close();
    }

    console.warn  = origWarn;
    console.error = origError;
    server.close();

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
