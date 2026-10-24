const crypto = require('crypto');

/* Аудит безопасности, находка C: раньше был дефолт ADMIN_PASSWORD='1608'
   (слабый пароль "по умолчанию" на случай ошибки конфигурации). Другая
   параллельная сессия (main) заменила дефолт на тихий fail-closed —
   ADMIN_PASSWORD='' и всегда 401, без единого предупреждения, почему
   админка не работает. Здесь — явный отказ ПРИ СТАРТЕ (throw при
   require()): лучше сразу увидеть ошибку в логах деплоя, чем гадать
   неделю, почему вход в админку не работает. ПЕРЕД ДЕПЛОЕМ УБЕДИСЬ, ЧТО
   ADMIN_PASSWORD ЗАДАН В TIMEWEB — иначе процесс не запустится вовсе. */
if (!process.env.ADMIN_PASSWORD) {
    throw new Error(
        'ADMIN_PASSWORD не задан. Приложение не может безопасно запуститься ' +
        'без пароля администратора — задайте переменную окружения ADMIN_PASSWORD ' +
        '(в Timeweb: настройки приложения -> переменные окружения) и перезапустите.'
    );
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/* timing-safe сравнение строк разной длины — crypto.timingSafeEqual()
   требует буферы ОДИНАКОВОЙ длины и иначе бросает исключение. Хэш той
   же длины (SHA-256) решает это без веток разной длины выполнения —
   тот же приём, что был в safeEqual() у параллельной сессии. */
function timingSafeEqualStr(a, b) {
    const ah = crypto.createHash('sha256').update(String(a ?? '')).digest();
    const bh = crypto.createHash('sha256').update(String(b ?? '')).digest();
    return crypto.timingSafeEqual(ah, bh);
}

function verifyAdminPassword(password) {
    return typeof password === 'string' && timingSafeEqualStr(password, ADMIN_PASSWORD);
}

/* ─── Токены админки — выдаются login'ом, не равны самому паролю ───────
   Параллельная сессия (main) оставила token = ADMIN_PASSWORD — токен
   нельзя было отозвать отдельно от смены пароля, и сам пароль гулял по
   всем последующим запросам без срока действия. Здесь /api/auth/login
   выдаёт случайный токен (32 байта) со сроком жизни ADMIN_TOKEN_TTL_MS,
   хранящийся только в памяти процесса (однопроцессное приложение —
   Redis/БД не нужны для десятка активных сессий администратора).
   Перезапуск процесса разлогинивает всех — это ожидаемо. */
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов
const activeTokens = new Map(); // token -> expiresAt (мс)

function issueAdminToken() {
    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
    return token;
}

function isValidAdminToken(token) {
    if (!token) return false;
    const expiresAt = activeTokens.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        activeTokens.delete(token);
        return false;
    }
    return true;
}

// Редкая фоновая чистка просроченных токенов — чтобы Map не росла вечно
// на долгоживущем процессе. unref(), чтобы таймер не мешал тестовым
// скриптам (test-*.js) завершиться/process.exit().
setInterval(() => {
    const now = Date.now();
    for (const [token, expiresAt] of activeTokens) {
        if (now > expiresAt) activeTokens.delete(token);
    }
}, 60 * 60 * 1000).unref();

function requireAdmin(req, res, next) {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!isValidAdminToken(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// usd-pricing: нужна НЕОБЯЗАТЕЛЬНАЯ проверка (не блокирующая запрос), чтобы
// публичный GET /api/products мог по желанию отдать админке доп. $-поля —
// admin.js уже шлёт Authorization на этот роут (см. admin/admin.js), хотя
// requireAdmin там не стоит.
function isValidAdminAuthHeader(authHeader) {
    const auth  = authHeader || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return isValidAdminToken(token);
}

module.exports = { requireAdmin, issueAdminToken, verifyAdminPassword, timingSafeEqualStr, isValidAdminAuthHeader };
