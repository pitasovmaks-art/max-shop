const crypto = require('crypto');

/* Максимальный возраст initData. Официальная документация Max
   (dev.max.ru/docs/webapps/bridge, описание поля auth_date — «Время
   выдачи данных. Позволяет определить момент инвалидации данных»)
   рекомендует интервал в 1 час. Здесь — сутки: это сознательно мягче
   рекомендации, чтобы не обрывать сессию покупателя, который держит
   магазин открытым дольше часа (см. комментарий у verifyInitData ниже
   про то, как это соотносится с повторной проверкой initData на каждой
   странице). Если понадобится следовать рекомендации Max дословно —
   поменять на 3600. */
const MAX_INIT_DATA_AGE_SECONDS = 24 * 60 * 60;

/* Проверка подписи initData Max Mini Apps — алгоритм задокументирован
   на dev.max.ru/docs/webapps/validation: secret_key = HMAC_SHA256(key=
   "WebAppData", msg=botToken); hash = HMAC_SHA256(key=secret_key,
   msg=dataCheckString) — та же схема, что в Telegram WebApp.
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

    const authDate = Number(params.get('auth_date') || 0);
    if (!authDate || Date.now() / 1000 - authDate > MAX_INIT_DATA_AGE_SECONDS) return null;

    let user = null;
    try {
        user = params.get('user') ? JSON.parse(params.get('user')) : null;
    } catch {
        user = null;
    }

    return { user, authDate };
}

module.exports = { verifyInitData };
