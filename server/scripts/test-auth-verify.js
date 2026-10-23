/* Проверка POST /api/auth/verify (server/routes/auth.js) после фикса:
   - checkChannelMembership() обёрнута в try/catch — если бросает (не
     просто резолвится в false, как спроектирована), /verify отвечает
     502 reason=verify_error, а не зависает без ответа необработанным
     rejection'ом (так было бы в Express 4 без этой правки).
   - Каждый отказ логируется (reason + user_id, если уже известен) —
     без initData и прочих данных запроса.

   Причина фикса: сотрудник (не в ADMIN_IDS) видел "404 Not Found" от
   shopGuard.js, а в логах сервера не было вообще ничего — оказалось,
   initData на его стороне была пустой, запрос до сервера не доходил
   вовсе (shopGuard.js теперь показывает код причины вместо текста
   "404 Not Found" — отдельно от этого файла, см. src/shopGuard.js).
   Этот тест — про то, что СЕРВЕРНАЯ часть /verify теперь не зависает
   молча при неожиданной ошибке и объясняет каждый отказ в логе.

   Без реального Postgres/сети — checkChannelMembership подменяется
   прямо в server/routes/subscription.js (require.cache делится между
   этим файлом и auth.js, который требует тот же модуль).

   Запуск: node server/scripts/test-auth-verify.js
*/
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
process.env.MAX_BOT_TOKEN  = process.env.MAX_BOT_TOKEN  || 'test-bot-token';
process.env.ADMIN_IDS      = ''; // пусто — без обхода проверки подписки, все идут через checkChannelMembership

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

const authRouter = require('../routes/auth');

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

    /* ── 1. UA не похож на Max -> 403 not_max, логируется ───────────── */
    logs.length = 0;
    {
        const r = await verify({ initData: validInitData }, 'Mozilla/5.0 (Desktop)');
        check('UA не Max -> 403 reason=not_max', r.status === 403 && r.body.reason === 'not_max');
        check('not_max попал в лог', logs.some(l => l.includes('not_max')));
    }

    /* ── 2. Кривая initData -> 401 invalid_signature, логируется ────── */
    logs.length = 0;
    {
        const r = await verify({ initData: 'garbage-not-signed' });
        check('кривая initData -> 401 reason=invalid_signature', r.status === 401 && r.body.reason === 'invalid_signature');
        check('invalid_signature попал в лог', logs.some(l => l.includes('invalid_signature')));
    }

    /* ── 3. checkChannelMembership бросает -> 502 verify_error, не зависает ── */
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

    /* ── 4. Не подписан -> not_subscribed (не ошибка, штатный отказ) ─── */
    logs.length = 0;
    membershipBehavior = 'false';
    {
        const r = await verify({ initData: validInitData });
        check('не подписан -> 200 ok:false reason=not_subscribed',
            r.status === 200 && r.body.ok === false && r.body.reason === 'not_subscribed');
        check('not_subscribed в логе содержит user_id', logs.some(l => l.includes('not_subscribed') && l.includes(String(USER))));
    }

    /* ── 5. Подписан -> ok:true, без единой строки отказа в логе ─────── */
    logs.length = 0;
    membershipBehavior = 'true';
    {
        const r = await verify({ initData: validInitData });
        check('подписан -> 200 ok:true, userId верный', r.status === 200 && r.body.ok === true && r.body.userId === USER);
        check('успешная проверка не оставляет строк в логе', logs.length === 0);
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
