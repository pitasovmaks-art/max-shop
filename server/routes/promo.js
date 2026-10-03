const router          = require('express').Router();
const db              = require('../db');
const { requireUser } = require('../middleware/requireUser');

/* POST /api/promo/subscribe — tgId из req.tgId (вызывается из checkout.js
   с подписанными initData, не из тела запроса). */
router.post('/subscribe', requireUser, async (req, res) => {
    try {
        await db.execute(
            'INSERT INTO promo_subscribers (tg_id) VALUES ($1) ON CONFLICT DO NOTHING',
            [BigInt(req.tgId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe — БЕЗ requireUser: вызывается не из браузера,
   а сервер-к-серверу из bot.js, когда пользователь пишет боту «стоп акции»
   (см. bot.js). У бота нет initData для подписи — личность там уже
   подтверждена самим Max через вебхук бота, а не этим HTTP-эндпоинтом. */
router.post('/unsubscribe', async (req, res) => {
    const { tgId } = req.body;
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    try {
        await db.execute('DELETE FROM promo_subscribers WHERE tg_id=$1', [BigInt(tgId)]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/promo/status — tgId из req.tgId (сейчас не вызывается ни с одной
   страницы — защищаем на случай добавления такого вызова в будущем). */
router.get('/status', requireUser, async (req, res) => {
    try {
        const row = await db.queryOne('SELECT 1 FROM promo_subscribers WHERE tg_id=$1', [BigInt(req.tgId)]);
        res.json({ subscribed: !!row });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
