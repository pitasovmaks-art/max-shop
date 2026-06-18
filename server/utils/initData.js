const crypto = require('crypto');

/* Проверка подписи initData Max Mini Apps (тот же алгоритм, что в Telegram WebApp:
   secret = HMAC_SHA256(key="WebAppData", msg=botToken); hash = HMAC_SHA256(key=secret, msg=dataCheckString)).
   window.WebApp.initData у Max-SDK — это значение, уже однократно декодированное из URL,
   поэтому перед разбором на пары его нужно декодировать ещё раз (см. parseInitData в max-web-app.js). */
function verifyInitData(rawInitData, botToken) {
    if (!rawInitData || !botToken) return null;

    let decoded;
    try {
        decoded = decodeURIComponent(rawInitData);
    } catch {
        return null;
    }

    const params = new URLSearchParams(decoded);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const pairs = [];
    for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (computedHash !== hash) return null;

    let user = null;
    try {
        user = params.get('user') ? JSON.parse(params.get('user')) : null;
    } catch {
        user = null;
    }

    return {
        user,
        authDate: Number(params.get('auth_date') || 0),
    };
}

module.exports = { verifyInitData };
