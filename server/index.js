const express = require('express');
const path    = require('path');

const app = express();

app.use(express.json({ limit: '15mb' }));

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

app.use((req, res, next) => {
    if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

app.get('/health',  (req, res) => res.status(200).send('OK'));
app.get('/healthz', (req, res) => res.status(200).send('OK'));

app.use(express.static(path.join(__dirname, '..')));

app.get('/api/config', (req, res) => {
    res.json({
        botUsername:        process.env.BOT_USERNAME         || '',
        supportBotUsername: process.env.SUPPORT_BOT_USERNAME || 'id635009278943_1_bot',
    });
});

app.post('/webhook', express.json(), (req, res) => {
    res.sendStatus(200);
    require('../bot').processUpdate(req.body).catch(console.error);
});

app.post('/webhook-support', express.json(), (req, res) => {
    res.sendStatus(200);
    try {
        require('../bot-support').processUpdate(req.body).catch(e => console.error('[support] processUpdate:', e.message));
    } catch (e) {
        console.error('[support] webhook error:', e.message);
    }
});

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/subcategories', require('./routes/subcategories'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/stores',        require('./routes/stores'));
app.use('/api/cdek',          require('./routes/cdek'));
app.use('/api/users',         require('./routes/users'));

/* Reset data to defaults (admin only) */
app.post('/api/admin/reset', require('./middleware/auth').requireAdmin, async (req, res) => {
    try {
        await require('./db').resetToDefaults();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* Seed database (admin only) */
app.post('/api/admin/seed', require('./middleware/auth').requireAdmin, async (req, res) => {
    try {
        await require('./db').resetToDefaults();
        res.json({ ok: true, message: 'База данных заполнена начальными данными' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
const db = require('./db');
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Точка Монтажа запущена на порту ${PORT}`);
    db.init()
        .then(() => {
            require('../bot').startBot();
            try {
                require('../bot-support').startSupportBot();
            } catch (e) {
                console.error('[support] startSupportBot error:', e.message);
            }
        })
        .catch((e) => {
            console.error('[STARTUP] Критическая ошибка инициализации БД:', e.message);
            console.error(e.stack);
        });
});
