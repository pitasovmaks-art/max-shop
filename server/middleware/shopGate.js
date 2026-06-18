const { verifyToken }  = require('../utils/shopToken');
const { ADMIN_PASSWORD } = require('./auth');

/* Пути, доступные без токена мини-приложения (админка — отдельная авторизация по паролю) */
const OPEN_PREFIXES = ['/admin', '/api/auth', '/webhook', '/webhook-support', '/health', '/healthz', '/robots.txt'];

function isOpenPath(p) {
    return OPEN_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '/'));
}

function getCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    const found = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function shopGate(req, res, next) {
    if (isOpenPath(req.path)) return next();

    /* Запросы из админ-панели идут с паролем администратора — токен мини-аппа им не нужен */
    const authHeader = req.headers.authorization || '';
    const adminToken  = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (adminToken && adminToken === ADMIN_PASSWORD) return next();

    const token = req.query.token || getCookie(req, 'shop_token');
    if (verifyToken(token)) return next();

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Доступ только через бота Max' });
    }
    return res
        .status(403)
        .type('text/html')
        .send('<!DOCTYPE html><html lang="ru"><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">Доступ запрещён.<br>Откройте магазин через кнопку в боте Max.</body></html>');
}

module.exports = shopGate;
