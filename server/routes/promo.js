const router          = require('express').Router();
const db              = require('../db');
const { requireUser } = require('../middleware/requireUser');

const SOURCES = ['checkout', 'bot', 'toggle'];

/* POST /api/promo/subscribe — tgId из req.tgId (вызывается из checkout.js
   и из переключателя в «Мои заказы», не из тела запроса). source — не из
   списка/отсутствует -> 'checkout' (дефолт, не ошибка — старое поведение
   чекаута не передавало source вообще).

   ON CONFLICT ... DO UPDATE, а не DO NOTHING: раньше повторная подписка
   уже существующего tg_id была no-op, но теперь строка может быть
   "отписана" (unsubscribed_at не NULL) — повторная подписка должна снова
   сделать её активной, а не молча проигнорировать запрос. */
router.post('/subscribe', requireUser, async (req, res) => {
    const source = SOURCES.includes(req.body?.source) ? req.body.source : 'checkout';
    try {
        await db.execute(
            `INSERT INTO promo_subscribers (tg_id, source) VALUES ($1,$2)
             ON CONFLICT (tg_id) DO UPDATE SET unsubscribed_at = NULL, consent_at = NOW(), source = EXCLUDED.source`,
            [BigInt(req.tgId), source]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe — БЕЗ requireUser: вызывается не из браузера,
   а сервер-к-серверу из bot.js, когда пользователь пишет боту «стоп акции»
   (см. bot.js). У бота нет initData для подписи — личность там уже
   подтверждена самим Max через вебхук бота, а не этим HTTP-эндпоинтом.
   Поэтому этот маршрут НЕЛЬЗЯ отдавать в браузер — любой клиент мог бы
   подставить чужой tgId. Для приложения — отдельный /unsubscribe-me ниже.

   Мягкая отписка (UPDATE, не DELETE) — строка и история остаются, просто
   unsubscribed_at перестаёт быть NULL. Если такого tg_id в таблице вообще
   нет (никогда не подписывался) — 0 затронутых строк, без ошибки, без
   создания новой строки. */
router.post('/unsubscribe', async (req, res) => {
    const { tgId } = req.body;
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    try {
        await db.execute(
            `UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'bot' WHERE tg_id=$1`,
            [BigInt(tgId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe-me — для приложения (переключатель в «Мои
   заказы»): requireUser, tg_id только из req.tgId, никогда из тела — в
   отличие от /unsubscribe выше, этот маршрут безопасно вызывать из
   браузера именно поэтому. */
router.post('/unsubscribe-me', requireUser, async (req, res) => {
    try {
        await db.execute(
            `UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'toggle' WHERE tg_id=$1`,
            [BigInt(req.tgId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/promo/status — подписан = строка есть И unsubscribed_at IS NULL
   (раньше просто «строка есть» — до мягкой отписки строка не исчезала
   из таблицы, этого было достаточно). Теперь используется переключателем
   в «Мои заказы» и чекаутом. */
router.get('/status', requireUser, async (req, res) => {
    try {
        const row = await db.queryOne(
            'SELECT 1 FROM promo_subscribers WHERE tg_id=$1 AND unsubscribed_at IS NULL',
            [BigInt(req.tgId)]
        );
        res.json({ subscribed: !!row });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
