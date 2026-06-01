const router = require('express').Router();
const db     = require('../db');

/* POST /api/support/admin-map — upsert userId→chatId */
router.post('/admin-map', async (req, res) => {
    const { userId, chatId } = req.body;
    if (!userId || !chatId) return res.status(400).json({ error: 'userId and chatId required' });
    try {
        await db.execute(
            `INSERT INTO support_admins (user_id, chat_id, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, updated_at = NOW()`,
            [String(userId), String(chatId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/support/admins — return all [{user_id, chat_id}] */
router.get('/admins', async (req, res) => {
    try {
        const rows = await db.query('SELECT user_id, chat_id FROM support_admins');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/support/known — mark client chat_id as known */
router.post('/known', async (req, res) => {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'chatId required' });
    try {
        await db.execute(
            `INSERT INTO support_known (chat_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [String(chatId)]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
