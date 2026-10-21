const crypto = require('crypto');

/* Защищает роуты, которые публично никому не нужны — их вызывает только
   сам bot.js (тот же процесс, но по HTTP на свой же сервер, см. его
   комментарии про WEBHOOK_URL/localhost). Раньше эти роуты были открыты
   всему интернету без какой-либо проверки.

   Сравнение — через хэш + timingSafeEqual: напрямую timingSafeEqual
   бросает исключение, если строки разной длины (а секрет и присланный
   заголовок почти всегда разной длины), хэш той же длины убирает это и
   не даёт утечки через длину строки.

   Fail closed: если INTERNAL_API_SECRET не задан на сервере — доступ
   всегда отказан (как и у requireAdmin без ADMIN_PASSWORD), а не открыт
   через пустое сравнение. */
function requireInternal(req, res, next) {
    const secret = process.env.INTERNAL_API_SECRET || '';
    const header = req.headers['x-internal-secret'] || '';
    if (!secret) {
        // Отдельная причина в логе — иначе отличить "секрет не задан" от
        // "секрет неверный" можно только гадая; ни то, ни другое значение
        // секрета в лог не попадает. Код ответа (401) — тот же, что
        // проверяет bot.js (internalFetch) при логировании своей стороны,
        // см. его комментарии — иначе логи бота врали бы при реальном 401.
        console.warn(`[requireInternal] ${req.method} ${req.path}: отклонён, INTERNAL_API_SECRET не задан в env — все внутренние маршруты временно недоступны (ip=${req.ip})`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const secretHash = crypto.createHash('sha256').update(secret).digest();
    const headerHash = crypto.createHash('sha256').update(String(header)).digest();
    if (!crypto.timingSafeEqual(secretHash, headerHash)) {
        console.warn(`[requireInternal] ${req.method} ${req.path}: отклонён, X-Internal-Secret неверный или отсутствует (ip=${req.ip})`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { requireInternal };
