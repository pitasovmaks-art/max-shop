const router = require('express').Router();
const { issueAdminToken, verifyAdminPassword } = require('../middleware/auth');
const { verifyInitData }                    = require('../utils/initData');
const { checkChannelMembership, ADMIN_IDS } = require('./subscription');

// /api/auth/verify вызывается на каждой загрузке каждой страницы (см. её
// комментарий ниже и src/shopGuard.js) — лог UA на каждый запрос засоряет
// продакшен-логи. Включается явно через AUTH_DEBUG=true при отладке
// проблем с определением MAX-клиента по User-Agent.
const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';

/* ─── Ограничение попыток входа (аудит безопасности, находка C) ───────
   ЖЁСТКИЙ лимит — только на IP (LOGIN_MAX_PER_IP, 429 при превышении).
   Раньше здесь был ВТОРОЙ, тоже жёсткий, общий счётчик на все IP сразу
   (LOGIN_MAX_TOTAL) — при req.ip, определяемом НЕПРАВИЛЬНО (см. ниже),
   он фактически совпадал с лимитом на IP и ничего не менял; а при
   req.ip, определяемом правильно, он всё равно мог заблокировать вход
   самому админу, если много попыток пришло с разных настоящих IP
   (распределённый подбор) — именно та ситуация, которую легитимный
   админ не контролирует и от которой не должен страдать.

   Теперь общий счётчик (LOGIN_ALERT_TOTAL) — МЯГКИЙ: сам по себе никого
   не блокирует, только пишет предупреждение в лог (видно в Timeweb) —
   это сигнал "похоже на распределённый подбор", а не блокировка входа.

   ВАЖНО: req.ip должен быть реальным IP клиента, а не адресом прокси
   Timeweb — иначе лимит на IP сам по себе бесполезен (все клиенты
   делят один IP, посторонний блокирует вход всем 5 запросами). См.
   TRUST_PROXY_HOPS в server/index.js — без него этот риск остаётся.

   Считаем ЛЮБОЙ вызов /login (не только неудачный) — проще и не
   оставляет лазейки через "удачные" попытки. В памяти процесса — для
   одного Node-процесса этого приложения достаточно. */
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;
const LOGIN_MAX_PER_IP   = 5;
const LOGIN_ALERT_TOTAL  = 30;

const loginAttemptsByIp = new Map(); // ip -> timestamps[]
let loginAttemptsTotal  = [];        // timestamps[] — только для алерта, не для блокировки

function pruneOld(arr, now) {
    while (arr.length && now - arr[0] > LOGIN_WINDOW_MS) arr.shift();
}

function isLoginRateLimited(ip) {
    const now = Date.now();
    const ipAttempts = loginAttemptsByIp.get(ip) || [];
    pruneOld(ipAttempts, now);
    loginAttemptsByIp.set(ip, ipAttempts);
    return ipAttempts.length >= LOGIN_MAX_PER_IP;
}

function recordLoginAttempt(ip) {
    const now = Date.now();
    const ipAttempts = loginAttemptsByIp.get(ip) || [];
    ipAttempts.push(now);
    loginAttemptsByIp.set(ip, ipAttempts);

    pruneOld(loginAttemptsTotal, now);
    loginAttemptsTotal.push(now);
    if (loginAttemptsTotal.length === LOGIN_ALERT_TOTAL) {
        console.warn(`[auth] ${LOGIN_ALERT_TOTAL}+ попыток входа в админку за 15 минут суммарно по всем IP — похоже на распределённый подбор пароля (не блокирует вход, только лог)`);
    }
}

/* Токен теперь — случайное значение, выданное issueAdminToken()
   (server/middleware/auth.js), а не сам пароль: requireAdmin сравнивает
   Bearer-токен не с ADMIN_PASSWORD, а с реестром выданных токенов. */
router.post('/login', (req, res) => {
    const ip = req.ip;
    if (isLoginRateLimited(ip)) {
        return res.status(429).json({ ok: false, error: 'Слишком много попыток входа, попробуйте позже' });
    }
    recordLoginAttempt(ip);

    const { password } = req.body || {};
    if (verifyAdminPassword(password)) {
        return res.json({ ok: true, token: issueAdminToken() });
    }
    // Без самого пароля в логе — только IP, по которому видно, что был
    // подбор, но без риска случайно залогировать верный пароль рядом
    // с неверным при копипасте строки лога.
    console.warn(`[auth] неудачная попытка входа в админку, ip=${ip}`);
    res.status(401).json({ ok: false, error: 'Неверный пароль' });
});

/* POST /api/auth/verify — проверяет подпись initData Max Mini Apps и подписку на канал.
   Без cookie/сессии: вызывается заново при каждой загрузке каждой страницы. */
router.post('/verify', async (req, res) => {
    const ua = req.headers['user-agent'] || '';

    /* Подтверждено реальным UA Max-клиента: "...Mobile/15E148 MAX/26.17.3" */
    const isMax = /MAX\//.test(ua);
    if (AUTH_DEBUG) console.log(`[auth/verify] UA=${isMax ? 'MAX' : 'NOT_MAX'} "${ua}"`);

    if (!isMax) {
        return res.status(403).json({ ok: false, reason: 'not_max' });
    }

    const { initData } = req.body || {};
    const result = verifyInitData(initData, process.env.MAX_BOT_TOKEN || '');

    if (!result || !result.user?.id) {
        return res.status(401).json({ ok: false, reason: 'invalid_signature' });
    }

    const userId = result.user.id;
    const subscribed = ADMIN_IDS.has(Number(userId)) || await checkChannelMembership(userId);

    if (!subscribed) {
        return res.json({ ok: false, reason: 'not_subscribed' });
    }

    res.json({ ok: true, userId });
});

module.exports = router;
