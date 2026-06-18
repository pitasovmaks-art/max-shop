const router = require('express').Router();
const { ADMIN_PASSWORD }                           = require('../middleware/auth');
const { verifyInitData }                           = require('../utils/initData');
const { generateSessionToken }                     = require('../utils/sessionToken');
const { checkChannelMembership, ADMIN_IDS }        = require('./subscription');

router.post('/login', (req, res) => {
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
        res.json({ ok: true, token: ADMIN_PASSWORD });
    } else {
        res.status(401).json({ ok: false, error: 'Неверный пароль' });
    }
});

/* POST /api/auth/verify — проверяет подпись initData Max Mini Apps и подписку на канал,
   при успехе выдаёт cookie-сессию для доступа к остальному API */
router.post('/verify', async (req, res) => {
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

    const session = generateSessionToken(userId);
    res.setHeader('Set-Cookie', `shop_session=${session}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
    res.json({ ok: true, userId });
});

module.exports = router;
