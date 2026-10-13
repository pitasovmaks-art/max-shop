const router          = require('express').Router();
const db              = require('../db');
const { requireUser } = require('../middleware/requireUser');
const { PROMO_CONSENT_VERSIONS } = require('../config');

const SOURCES = ['checkout', 'bot', 'toggle'];

/* Версия текста согласия — присылает браузер (он точно знает, какой текст
   показал человеку в момент согласия, см. src/shared/sellerConfig.js), не
   сервер: если взять версию из server/config.js "как есть", при деплое с
   изменённым текстом можно задним числом приписать человеку версию,
   которую он на самом деле не видел (она могла измениться между тем, как
   отрисовалась страница, и тем, как сервер обработал запрос).

   Принимаем ТОЛЬКО значение из PROMO_CONSENT_VERSIONS (все версии текста,
   которые когда-либо реально существовали, см. server/config.js) — любая
   версия не из этого списка (опечатка, подделанный запрос, версия из
   будущего/прошлого, которой на самом деле не было) расценивается как
   отсутствие версии (null), а не ошибка — отсутствие версии не должно
   ронять саму подписку. */
function readConsentVersion(body) {
    const v = body?.consentTextVersion;
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (!PROMO_CONSENT_VERSIONS.includes(trimmed)) return null;
    return trimmed;
}

/* Журнал действий (promo_consent_log) — ПОЛНАЯ история, в отличие от
   promo_subscribers (текущий снимок, перезаписывается при повторном
   согласии). Пишем только когда promo_subscribers реально что-то сохранила
   (changed>0) — это и есть защита от бессмысленных записей (например,
   отписка от того, кто никогда не был подписан). */
async function logConsent(tgId, action, source, consentTextVersion) {
    await db.execute(
        `INSERT INTO promo_consent_log (tg_id, action, source, consent_text_version) VALUES ($1,$2,$3,$4)`,
        [BigInt(tgId), action, source, consentTextVersion]
    );
}

/* POST /api/promo/subscribe — tgId из req.tgId (вызывается из checkout.js
   и из переключателя в «Мои заказы», не из тела запроса). source — не из
   списка/отсутствует -> 'checkout' (дефолт, не ошибка — старое поведение
   чекаута не передавало source вообще).

   ON CONFLICT ... DO UPDATE, а не DO NOTHING: раньше повторная подписка
   уже существующего tg_id была no-op, но теперь строка может быть
   "отписана" (unsubscribed_at не NULL) — повторная подписка должна снова
   сделать её активной, а не молча проигнорировать запрос.

   promo_subscribers.consent_text_version — "текущий снимок", перезаписан
   этим же запросом; promo_consent_log — отдельная строка на КАЖДЫЙ вызов,
   никогда не перезаписывается (повторное согласие — новая запись в
   истории, не замена старой). */
router.post('/subscribe', requireUser, async (req, res) => {
    const source = SOURCES.includes(req.body?.source) ? req.body.source : 'checkout';
    const consentTextVersion = readConsentVersion(req.body);
    try {
        await db.execute(
            `INSERT INTO promo_subscribers (tg_id, source, consent_text_version) VALUES ($1,$2,$3)
             ON CONFLICT (tg_id) DO UPDATE SET
                unsubscribed_at = NULL, consent_at = NOW(),
                source = EXCLUDED.source, consent_text_version = EXCLUDED.consent_text_version`,
            [BigInt(req.tgId), source, consentTextVersion]
        );
        await logConsent(req.tgId, 'subscribe', source, consentTextVersion);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe — БЕЗ requireUser: вызывается не из браузера,
   а сервер-к-серверу из bot.js, когда пользователь пишет боту одну из фраз
   отписки (см. bot.js). У бота нет initData для подписи — личность там уже
   подтверждена самим Max через вебхук бота, а не этим HTTP-эндпоинтом.
   Поэтому этот маршрут НЕЛЬЗЯ отдавать в браузер — любой клиент мог бы
   подставить чужой tgId. Для приложения — отдельный /unsubscribe-me ниже.

   Мягкая отписка (UPDATE, не DELETE) — строка и история остаются, просто
   unsubscribed_at перестаёт быть NULL. Если такого tg_id в таблице вообще
   нет (никогда не подписывался) — 0 затронутых строк, без ошибки, без
   создания новой строки И без записи в promo_consent_log (нет смысла
   логировать отписку того, кто никогда не был подписан — команда "стоп"
   от случайного человека не несёт юридического смысла). */
router.post('/unsubscribe', async (req, res) => {
    const { tgId } = req.body;
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    try {
        const changed = await db.execute(
            `UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'bot' WHERE tg_id=$1`,
            [BigInt(tgId)]
        );
        if (changed > 0) await logConsent(tgId, 'unsubscribe', 'bot', null);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/promo/unsubscribe-me — для приложения (переключатель в «Мои
   заказы»): requireUser, tg_id только из req.tgId, никогда из тела — в
   отличие от /unsubscribe выше, этот маршрут безопасно вызывать из
   браузера именно поэтому. */
router.post('/unsubscribe-me', requireUser, async (req, res) => {
    try {
        const changed = await db.execute(
            `UPDATE promo_subscribers SET unsubscribed_at = NOW(), source = 'toggle' WHERE tg_id=$1`,
            [BigInt(req.tgId)]
        );
        if (changed > 0) await logConsent(req.tgId, 'unsubscribe', 'toggle', null);
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
