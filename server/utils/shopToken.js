const crypto = require('crypto');

const SECRET = process.env.SHOP_TOKEN_SECRET || '';

function sign(chatId) {
    return crypto.createHmac('sha256', SECRET).update(String(chatId)).digest('hex').slice(0, 32);
}

/* Токен = base64url(chatId.sign(chatId)) — выдаётся ботом конкретному пользователю */
function generateToken(chatId) {
    return Buffer.from(`${chatId}.${sign(chatId)}`).toString('base64url');
}

function verifyToken(token) {
    if (!token || !SECRET) return false;
    try {
        const [chatId, sig] = Buffer.from(token, 'base64url').toString('utf8').split('.');
        return !!chatId && sig === sign(chatId);
    } catch {
        return false;
    }
}

module.exports = { generateToken, verifyToken };
