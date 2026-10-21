const router = require('express').Router();
const { issueAdminToken, verifyAdminPassword } = require('../middleware/auth');
const { verifyInitData }                    = require('../utils/initData');
const { checkChannelMembership, ADMIN_IDS } = require('./subscription');

/* Лимит на подбор пароля админки — тот же приём, что у лимита заявок на
   ремонт в server/routes/service-requests.js (in-memory счётчик вместо
   нового npm-пакета), только по IP, а не по tg_id — на /login нет
   авторизованного пользователя. Требует app.set('trust proxy', 1) в
   server/index.js, иначе req.ip — это адрес балансировщика Timeweb, один
   и тот же для всех, и лимит бил бы по всем сразу. */
const LOGIN_RATE_LIMIT        = 10;
const LOGIN_RATE_WINDOW_MS    = 15 * 60 * 1000;
const _loginAttempts          = new Map(); // ip -> { count, windowStart }

function isLoginRateLimited(ip) {
    const now   = Date.now();
    const entry = _loginAttempts.get(ip);
    if (!entry || now - entry.windowStart > LOGIN_RATE_WINDOW_MS) {
        _loginAttempts.set(ip, { count: 0, windowStart: now });
        return false;
    }
    return entry.count >= LOGIN_RATE_LIMIT;
}

function recordFailedLogin(ip) {
    const entry = _loginAttempts.get(ip);
    if (entry) entry.count += 1;
}

// /api/auth/verify вызывается на каждой загрузке каждой страницы (см. её
// комментарий ниже и src/shopGuard.js) — лог UA на каждый запрос засоряет
// продакшен-логи. Включается явно через AUTH_DEBUG=true при отладке
// проблем с определением MAX-клиента по User-Agent.
const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';

router.post('/login', (req, res) => {
    const ip = req.ip;
    if (isLoginRateLimited(ip)) {
        return res.status(429).json({ ok: false, error: 'Слишком много попыток входа, попробуйте позже' });
    }

    const { password } = req.body || {};
    // Токен — случайное значение от issueAdminToken() (server/middleware/
    // auth.js), не сам пароль: requireAdmin сравнивает Bearer-токен с
    // реестром выданных токенов (TTL 12ч, отзывается перезапуском
    // процесса), а не с ADMIN_PASSWORD напрямую.
    if (verifyAdminPassword(password)) {
        res.json({ ok: true, token: issueAdminToken() });
    } else {
        recordFailedLogin(ip);
        res.status(401).json({ ok: false, error: 'Неверный пароль' });
    }
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
