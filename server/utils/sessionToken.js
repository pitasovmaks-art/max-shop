const crypto = require('crypto');

const SECRET = process.env.SHOP_TOKEN_SECRET || '';

function sign(userId) {
    return crypto.createHmac('sha256', SECRET).update(String(userId)).digest('hex').slice(0, 32);
}

/* Сессионный токен = base64url(userId.sign(userId)) — выдаётся после успешной проверки initData */
function generateSessionToken(userId) {
    return Buffer.from(`${userId}.${sign(userId)}`).toString('base64url');
}

function verifySessionToken(token) {
    if (!token || !SECRET) return false;
    try {
        const [userId, sig] = Buffer.from(token, 'base64url').toString('utf8').split('.');
        return !!userId && sig === sign(userId);
    } catch {
        return false;
    }
}

module.exports = { generateSessionToken, verifySessionToken };
