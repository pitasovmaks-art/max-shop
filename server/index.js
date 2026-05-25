const express = require('express');
const path    = require('path');

const app = express();

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..')));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/subcategories', require('./routes/subcategories'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/stores',        require('./routes/stores'));

/* Reset data to defaults (admin only) */
app.post('/api/admin/reset', require('./middleware/auth').requireAdmin, async (req, res) => {
    try {
        await require('./db').resetToDefaults();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Точка Монтажа запущена: http://0.0.0.0:${PORT}`);
    require('./db').init().then(() => {
        require('../bot').startBot();
    }).catch(err => {
        console.error('Ошибка инициализации БД:', err.message);
        process.exit(1);
    });
});
