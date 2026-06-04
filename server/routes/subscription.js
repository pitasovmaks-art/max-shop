const router = require('express').Router();
const https  = require('https');

const API_BASE = 'platform-api.max.ru';

async function checkChannelMembership(userId) {
    const channelId = process.env.CHANNEL_CHAT_ID;
    const token     = process.env.MAX_BOT_TOKEN || '';

    if (!channelId) {
        console.error('[subscription] CHANNEL_CHAT_ID not set — fail-open');
        return true;
    }
    if (!token) {
        console.error('[subscription] MAX_BOT_TOKEN not set — fail-open');
        return true;
    }

    return new Promise((resolve) => {
        const qs      = `user_ids=${encodeURIComponent(userId)}`;
        const urlPath = `/chats/${channelId}/members?${qs}`;
        const opts    = {
            hostname: API_BASE,
            path:     urlPath,
            method:   'GET',
            headers:  { 'Authorization': token, 'Content-Type': 'application/json' },
        };

        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try {
                    const data    = JSON.parse(raw);
                    const members = data.members || [];
                    const uid     = Number(userId);
                    const found   = members.some(m => Number(m.user_id) === uid);
                    resolve(found);
                } catch (e) {
                    console.error('[subscription] parse error — fail-open:', e.message, raw.slice(0, 200));
                    resolve(true);
                }
            });
        });

        req.on('error', e => {
            console.error('[subscription] network error — fail-open:', e.message);
            resolve(true);
        });
        req.setTimeout(8000, () => {
            req.destroy();
            console.error('[subscription] timeout — fail-open');
            resolve(true);
        });
        req.end();
    });
}

/* GET /api/check-subscription?user_id=... */
router.get('/', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) {
        return res.json({ subscribed: true }); // fail-open: no user_id
    }
    try {
        const subscribed = await checkChannelMembership(userId);
        res.json({ subscribed });
    } catch (e) {
        console.error('[subscription] unexpected error — fail-open:', e.message);
        res.json({ subscribed: true });
    }
});

module.exports = router;
