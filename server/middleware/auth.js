const crypto = require('crypto');

/* Без дефолта: раньше тут был хардкодный пароль '1608', который работал,
   если переменная окружения не задана — слабый пароль "по умолчанию"
   на случай ошибки конфигурации. Теперь при отсутствующем ADMIN_PASSWORD
   доступ в админку всегда отказан (fail closed), а не открыт через
   дефолт. */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* Сравнение через хэш + timingSafeEqual — не раскрывает пароль через
   время ответа и не бросает исключение на разной длине строк (сам
   timingSafeEqual требует одинаковой длины буферов). */
function safeEqual(a, b) {
    const ah = crypto.createHash('sha256').update(String(a)).digest();
    const bh = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ah, bh);
}

function requireAdmin(req, res, next) {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!ADMIN_PASSWORD || !safeEqual(token, ADMIN_PASSWORD)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { requireAdmin, ADMIN_PASSWORD, safeEqual };
