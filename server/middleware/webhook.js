const crypto = require('crypto');

// Stable, distinct secrets avoid a mandatory new Timeweb setting. Never log them.
function webhookSecret(kind) {
    const support = kind === 'support';
    const override = process.env[support ? 'SUPPORT_WEBHOOK_SECRET' : 'WEBHOOK_SECRET'];
    if (override) {
        if (!/^[A-Za-z0-9_-]{16,256}$/.test(override)) throw new Error('Webhook secret must contain 16–256 letters, digits, _ or -');
        return override;
    }
    const token = process.env[support ? 'SUPPORT_BOT_TOKEN' : 'MAX_BOT_TOKEN'];
    return token ? crypto.createHmac('sha256', token).update(`max-shop:webhook:${kind}:v1`).digest('hex') : '';
}
function requireWebhook(kind) {
    return (req, res, next) => {
        const expected = webhookSecret(kind);
        const provided = req.headers['x-max-bot-api-secret'];
        if (!expected || typeof provided !== 'string' || provided.length > 256) return res.sendStatus(401);
        const hash = v => crypto.createHash('sha256').update(v).digest();
        if (!crypto.timingSafeEqual(hash(expected), hash(provided))) return res.sendStatus(401);
        if (!req.body || !['message_created', 'bot_started'].includes(req.body.update_type)) return res.sendStatus(400);
        next();
    };
}
module.exports = { webhookSecret, requireWebhook };
