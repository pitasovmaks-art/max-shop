const router = require('express').Router();
const { ADMIN_PASSWORD }                    = require('../middleware/auth');
const { verifyInitData }                    = require('../utils/initData');
const { checkChannelMembership, ADMIN_IDS } = require('./subscription');

router.post('/login', (req, res) => {
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
        res.json({ ok: true, token: ADMIN_PASSWORD });
    } else {
        res.status(401).json({ ok: false, error: 'Неверный пароль' });
    }
});

/* POST /api/auth/verify — проверяет подпись initData Max Mini Apps и подписку на канал.
   Без cookie/сессии: вызывается заново при каждой загрузке каждой страницы. */
router.post('/verify', async (req, res) => {
    const ua = req.headers['user-agent'] || '';
    console.log('[auth/verify] User-Agent:', ua);

    /* TODO: эвристика не подтверждена реальным UA Max — смотрим в логи Timeweb и уточняем паттерн */
    const isMax = /max/i.test(ua);
    if (!isMax) {
        console.log('[auth/verify] отклонён как не-Max клиент, UA:', ua);
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
