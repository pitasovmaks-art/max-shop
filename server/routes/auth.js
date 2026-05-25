const router = require('express').Router();
const { ADMIN_PASSWORD } = require('../middleware/auth');

router.post('/login', (req, res) => {
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
        res.json({ ok: true, token: ADMIN_PASSWORD });
    } else {
        res.status(401).json({ ok: false, error: 'Неверный пароль' });
    }
});

module.exports = router;
