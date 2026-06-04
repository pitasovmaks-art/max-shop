const router = require('express').Router();
const https  = require('https');

const API_BASE = 'platform-api.max.ru';

function maxGet(endpoint, query = {}) {
    const TOKEN = process.env.MAX_BOT_TOKEN || '';
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams(
            Object.fromEntries(Object.entries(query).filter(([, v]) => v != null))
        ).toString();
        const urlPath = `/${endpoint}${qs ? '?' + qs : ''}`;
        const opts = {
            hostname: API_BASE,
            path:     urlPath,
            method:   'GET',
            headers:  { 'Authorization': TOKEN, 'Content-Type': 'application/json' },
        };
        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve(raw); }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

/* GET /api/debug/bot-chats — list all chats the bot is member of */
router.get('/bot-chats', async (req, res) => {
    try {
        const data = await maxGet('chats', { count: 50 });
        const chats = (data.chats || []).map(c => ({
            chat_id:   c.chat_id,
            type:      c.type,
            title:     c.title || c.username || '(без названия)',
            is_public: c.is_public,
            link:      c.link,
        }));
        console.log('[debug] bot-chats:', JSON.stringify(chats, null, 2));
        res.json({ ok: true, count: chats.length, chats });
    } catch (e) {
        console.error('[debug] bot-chats error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
