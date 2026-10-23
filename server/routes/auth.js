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
// продакшен-логи, UA больше не влияет на допуск (см. комментарий ниже),
// это чисто диагностика. Включается явно через AUTH_DEBUG=true.
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
   Без cookie/сессии: вызывается заново при каждой загрузке каждой страницы.

   Раньше здесь был отказ по User-Agent (/MAX\// — считалось, что так
   отсекается браузер по прямой ссылке). Убрано (находка 23.10.2026):
   UA легко подделать — это не защита, а шум, и он отсекал настоящих
   пользователей Max на Android (UA Android-приложения Max не содержит
   "MAX/" — пример из прода: "...Realme RMX3771... Chrome/155.0.8059.43
   Mobile Safari/537.36"). Единственный реальный барьер — подпись
   initData (verifyInitData ниже): у браузера по прямой ссылке initData
   просто нет и взять её неоткуда (не публикуется на странице), подпись
   не подделать без MAX_BOT_TOKEN. UA всё ещё логируется (под AUTH_DEBUG)
   — просто не используется для допуска/отказа.

   Логируем КАЖДЫЙ отказ (reason + user_id, если он уже известен на этот
   момент) — без initData и прочих данных запроса. Раньше при ошибке
   checkChannelMembership() не было ни лога, ни try/catch — она сама
   спроектирована fail-open (всегда resolve, никогда throw), но без
   защиты здесь неожиданный throw завис бы необработанным rejection'ом
   в async-хендлере Express 4 (ответ так и не ушёл бы), и клиент увидел
   бы просто обрыв соединения без единой причины в логах. */
router.post('/verify', async (req, res) => {
    const ua = req.headers['user-agent'] || '';
    if (AUTH_DEBUG) console.log(`[auth/verify] UA="${ua}"`);

    const { initData } = req.body || {};
    const result = verifyInitData(initData, process.env.MAX_BOT_TOKEN || '');

    if (!result || !result.user?.id) {
        console.warn('[auth/verify] отказ: invalid_signature');
        return res.status(401).json({ ok: false, reason: 'invalid_signature' });
    }

    const userId = result.user.id;

    let subscribed;
    try {
        subscribed = ADMIN_IDS.has(Number(userId)) || await checkChannelMembership(userId);
    } catch (e) {
        console.error(`[auth/verify] отказ: verify_error user_id=${userId} — ${e.message}`);
        return res.status(502).json({ ok: false, reason: 'verify_error' });
    }

    if (!subscribed) {
        console.warn(`[auth/verify] отказ: not_subscribed user_id=${userId}`);
        return res.json({ ok: false, reason: 'not_subscribed' });
    }

    res.json({ ok: true, userId });
});

module.exports = router;
