const router = require('express').Router();
const db     = require('../db');

/* POST /api/users/map — save userId→chatId mapping */
router.post('/map', async (req, res) => {
    const { userId, chatId } = req.body;
    if (!userId || !chatId) return res.status(400).json({ error: 'userId and chatId required' });
    try {
        await db.execute(
            `INSERT INTO user_map (user_id, chat_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET chat_id = $2`,
            [BigInt(userId).toString(), BigInt(chatId).toString()]
        );
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/users/chat?user_id=... — resolve userId to chatId */
router.get('/chat', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    try {
        const row = await db.queryOne(
            'SELECT chat_id FROM user_map WHERE user_id=$1',
            [String(user_id)]
        );
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json({ chatId: row.chat_id.toString() });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/users/map/:userId — remove mapping (admin only) */
router.delete('/map/:userId', require('../middleware/auth').requireAdmin, async (req, res) => {
    try {
        await db.execute('DELETE FROM user_map WHERE user_id=$1', [+req.params.userId]);
        res.json({ ok: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
