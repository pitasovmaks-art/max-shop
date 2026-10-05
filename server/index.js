try { process.loadEnvFile(); } catch { /* .env отсутствует — переменные заданы окружением */ }

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const compression = require('compression');

const app = express();

app.use(compression());

/* Применяет schema.sql (только CREATE TABLE IF NOT EXISTS — идемпотентно и
   безопасно) до того, как сервер начнёт принимать запросы. */
async function applySchema() {
    try {
        const schemaPath = path.join(__dirname, '..', 'schema.sql');
        const schemaSql  = fs.readFileSync(schemaPath, 'utf8');
        await require('./db').pool.query(schemaSql);
        console.log('[schema] schema.sql применена успешно');
    } catch (e) {
        console.error('[schema] Ошибка применения schema.sql:', e.message);
        console.error(e.stack);
    }
}

app.use(express.json({ limit: '15mb' }));

app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

/* Кэш статики и API. HTML — всегда свежий (no-cache = обязательная
   ревалидация по ETag, но без запрета хранить тело — в отличие от
   прежнего no-store, это позволяет дешёвый 304 вместо полной
   перекачки). Версионные ?v=... файлы (так уже подключены все
   <script>/<link> в index.html/catalog.html) — кэшируются на год и без
   ревалидации: следующая правка обязана поднять версию, а новую версию
   принесёт свежий (no-cache) HTML. GET /api/* — тоже no-cache: данные
   каталога меняются из админки в любой момент, но ревалидация по ETag
   (уже проставляется Express) экономит трафик на неизменившихся ответах. */
app.use((req, res, next) => {
    const isVersioned = req.url.includes('?v=');
    if (req.path.endsWith('.html') || req.path === '/') {
        res.setHeader('Cache-Control', 'no-cache');
    } else if ((req.path.endsWith('.js') || req.path.endsWith('.css')) && isVersioned) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (req.path.startsWith('/api/') && req.method === 'GET') {
        res.setHeader('Cache-Control', 'no-cache');
    }
    next();
});

/* Block direct desktop-browser access — mini-app is Max-only (mobile WebView).
   /public и /src исключены отдельно от /admin, потому что это статические
   ассеты (логотип, FileUploader.js и т.п.), которые /admin грузит через
   отдельные HTTP-запросы со своим req.path — без этого исключения они
   получали 404 на десктопе, хотя сама страница /admin была разрешена. */
app.use((req, res, next) => {
    const p = req.path;
    if (
        p === '/health'    ||
        p === '/healthz'   ||
        p === '/robots.txt'||
        p.startsWith('/webhook') ||
        p.startsWith('/api/')    ||
        p.startsWith('/admin')   ||
        p.startsWith('/public')  ||
        p.startsWith('/src')
    ) return next();

    const ua = req.headers['user-agent'] || '';
    const isDesktopBrowser =
        /Windows NT|Macintosh; Intel Mac|X11; Linux/.test(ua) &&
        !/Android|iPhone|iPad|iPod/.test(ua);
    if (isDesktopBrowser) {
        return res.status(404).type('text/plain').send('Not Found');
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
    console.log('[support] webhook получил запрос:', JSON.stringify(req.body).slice(0, 200));
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
app.use('/api/banners',       require('./routes/banners'));
app.use('/api/subcategories', require('./routes/subcategories'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/stores',        require('./routes/stores'));
app.use('/api/cdek',          require('./routes/cdek'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/support',       require('./routes/support'));
app.use('/api/favorites',     require('./routes/favorites'));
app.use('/api/stock-notify', require('./routes/stock-notify'));
app.use('/api/promo',             require('./routes/promo'));
app.use('/api/check-subscription', require('./routes/subscription'));
app.use('/api/exports',           require('./routes/exports'));
app.use('/api/uploads',           require('./routes/uploads'));
app.use('/api/sync',              require('./routes/sync'));

/* Reset catalog tables (admin only) — TRUNCATE only, does NOT reseed demo data */
app.post('/api/admin/reset', require('./middleware/auth').requireAdmin, async (req, res) => {
    try {
        await require('./db').truncateAll();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* Seed database with demo data (admin only, explicit call) */
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

(async () => {
    await applySchema();

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
                try {
                    require('../services/ozonSync').start();
                } catch (e) {
                    console.error('[ozonSync] start error:', e.message);
                }
                try {
                    require('../services/agentBot').start();
                } catch (e) {
                    console.error('[agentBot] start error:', e.message);
                }
            })
            .catch((e) => {
                console.error('[STARTUP] Критическая ошибка инициализации БД:', e.message);
                console.error(e.stack);
            });
    });
})();
