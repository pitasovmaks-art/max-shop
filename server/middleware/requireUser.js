const { verifyInitData } = require('../utils/initData');

/* Достаёт личность пользователя ТОЛЬКО из подписанных initData Max —
   никогда из query/body/cookie, которые клиент может подделать
   произвольным tg_id чужого покупателя. Raw initData передаётся
   клиентом в заголовке X-Init-Data (см. src/utils/authFetch.js) —
   то же значение window.WebApp.initData, которое shopGuard.js уже
   проверяет при каждой загрузке страницы, просто переданное и сюда.
   При успехе — req.tgId (строка, Max user.id), тот же идентификатор,
   что раньше присылал клиент в tg_id/tgId. */
function requireUser(req, res, next) {
    const raw = req.headers['x-init-data'];
    const result = verifyInitData(raw, process.env.MAX_BOT_TOKEN || '');
    if (!result || !result.user?.id) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.tgId = String(result.user.id);
    next();
}

module.exports = { requireUser };
