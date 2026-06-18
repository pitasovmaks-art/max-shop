const { verifySessionToken } = require('../utils/sessionToken');
const { ADMIN_PASSWORD }     = require('./auth');

/* API-пути, доступные без сессии мини-аппа (логин/проверка initData — отдельная авторизация) */
const OPEN_API_PREFIXES = ['/api/auth', '/api/config'];

function getCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    const found = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

/* Страницы отдаются всегда — заглушку при отсутствии валидного initData показывает клиентский
   скрипт (src/shopGuard.js). Здесь закрывается только API. */
function shopGate(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    if (OPEN_API_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();

    /* Запросы из админ-панели идут с паролем администратора — сессия мини-аппа им не нужна */
    const authHeader = req.headers.authorization || '';
    const adminToken  = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (adminToken && adminToken === ADMIN_PASSWORD) return next();

    const session = getCookie(req, 'shop_session');
    if (verifySessionToken(session)) return next();

    return res.status(401).json({ error: 'Доступ только через бота Max' });
}

module.exports = shopGate;
