const crypto = require('crypto');

/* Аудит безопасности (находка C, ~/security-audit.md): раньше был дефолт
   '1608', если ADMIN_PASSWORD не задан — 4-значный пароль без ограничения
   попыток подбирается за секунды. Теперь без ADMIN_PASSWORD в env
   приложение не запускается вовсе — лучше явный отказ при деплое, чем
   тихая работа с заведомо слабым паролем. ПЕРЕД ДЕПЛОЕМ УБЕДИСЬ, ЧТО
   ADMIN_PASSWORD ЗАДАН В TIMEWEB — иначе процесс упадёт при старте. */
if (!process.env.ADMIN_PASSWORD) {
    throw new Error(
        'ADMIN_PASSWORD не задан. Приложение не может безопасно запуститься ' +
        'без пароля администратора — задайте переменную окружения ADMIN_PASSWORD ' +
        '(в Timeweb: настройки приложения -> переменные окружения) и перезапустите.'
    );
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/* timing-safe сравнение строк разной длины — crypto.timingSafeEqual()
   требует буферы ОДИНАКОВОЙ длины и иначе бросает исключение, поэтому
   напрямую его использовать для пароля произвольной длины от клиента
   нельзя. При несовпадении длины всё равно выполняем "пустое" сравнение
   той же формы, чтобы не обнулять задержку сразу на первой проверке —
   остаточная утечка через длину пароля намного меньше, чем через
   посимвольное сравнение, которое было раньше (token !== ADMIN_PASSWORD). */
function timingSafeEqualStr(a, b) {
    const bufA = Buffer.from(String(a ?? ''), 'utf8');
    const bufB = Buffer.from(String(b ?? ''), 'utf8');
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifyAdminPassword(password) {
    return typeof password === 'string' && timingSafeEqualStr(password, ADMIN_PASSWORD);
}

/* ─── Токены админки — выдаются login'ом, не равны самому паролю ───────
   Раньше requireAdmin сравнивал Bearer-токен прямо с ADMIN_PASSWORD
   (token === пароль) — токен было невозможно отозвать отдельно от
   смены пароля, и сам пароль гулял по всем последующим запросам. Теперь
   /api/auth/login выдаёт случайный токен (32 байта) со сроком жизни
   ADMIN_TOKEN_TTL_MS, хранящийся только в памяти процесса (это
   однопроцессное приложение, Redis/БД не нужны для десятка активных
   сессий администратора). */
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

module.exports = { requireAdmin, issueAdminToken, verifyAdminPassword, timingSafeEqualStr };
