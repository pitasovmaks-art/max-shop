const router            = require('express').Router();
const https             = require('https');
const { requireAdmin }  = require('../middleware/auth');

const { requestLimit } = require('../middleware/requestLimit');
const officesCache = new Map();

const CDEK_CLIENT_ID     = process.env.CDEK_CLIENT_ID     || '';
const CDEK_CLIENT_SECRET = process.env.CDEK_CLIENT_SECRET || '';

/* ─── In-memory token cache ─────────────────────────────── */
let _token      = null;
let _tokenExpAt = 0;

function cdekRequest(method, path, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const isForm = typeof body === 'string' && !token;
        const headers = { 'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body)  headers['Content-Length'] = Buffer.byteLength(body);

        const opts = { hostname: 'api.cdek.ru', path, method, headers };
        const req  = https.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); }
                catch { resolve(raw); }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('CDEK timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

async function getToken() {
    if (!CDEK_CLIENT_ID || !CDEK_CLIENT_SECRET) throw new Error('CDEK_CLIENT_ID/CDEK_CLIENT_SECRET не настроены');
    if (_token && Date.now() < _tokenExpAt) return _token;
    const body = new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CDEK_CLIENT_ID,
        client_secret: CDEK_CLIENT_SECRET,
    }).toString();
    const data = await cdekRequest('POST', '/v2/oauth/token', body);
    if (!data.access_token) throw new Error('CDEK token error: ' + JSON.stringify(data));
    _token      = data.access_token;
    _tokenExpAt = Date.now() + (data.expires_in - 60) * 1000;
    return _token;
}

/* POST /api/cdek/token — manual token refresh (для отладки). Не вызывается
   кодом приложения — /api/cdek/offices сам обновляет токен по необходимости
   (см. getToken() выше). Оставлен как ручной инструмент, закрыт тем же
   паролем, что и админка, а не публичен всему интернету. */
router.post('/token', requireAdmin, async (req, res) => {
    try {
        _token = null; _tokenExpAt = 0;
        const token = await getToken();
        res.json({ ok: true, token: token.slice(0, 8) + '...' });
    } catch (e) {
        console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' });
    }
});

/* GET /api/cdek/offices?city=Москва */
router.get('/offices', requestLimit({max:60}), async (req, res) => {
    const cityName = req.query.city;
    if (typeof cityName !== 'string' || !cityName.trim() || cityName.length > 100) return res.status(400).json({ error: 'city required' });

    const cacheKey = cityName.trim().toLocaleLowerCase('ru');
    const cached = officesCache.get(cacheKey);
    if (cached && cached.until > Date.now()) return res.json(cached.result);
    try {
        const token = await getToken();

        /* 1. Получить city_code */
        const cityQuery = encodeURIComponent(cityName);
        const cities = await cdekRequest('GET', `/v2/location/cities?city=${cityQuery}`, null, token);
        if (!Array.isArray(cities) || !cities.length) {
            return res.json([]);
        }
        const matching = cities.find(c => (c.city || '').toLocaleLowerCase('ru') === cityName.trim().toLocaleLowerCase('ru'));
        if (!matching) return res.json([]);
        const cityCode = matching.code;

        /* 2. Получить отделения */
        const points = await cdekRequest('GET', `/v2/deliverypoints?city_code=${cityCode}&type=PVZ&have_cash_less=1`, null, token);
        if (!Array.isArray(points)) return res.json([]);

        const result = points.map(p => ({
            code:      p.code,
            name:      p.name || p.code,
            address:   p.location?.address || '',
            work_time: p.work_time || '',
            phone:     (p.phones?.[0]?.number) || '',
        }));

        if (officesCache.size >= 100) officesCache.delete(officesCache.keys().next().value);
        officesCache.set(cacheKey,{result,until:Date.now()+5*60*1000});
        res.json(result);
    } catch (e) {
        console.error('[CDEK] offices error:', e.message);
        console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' });
    }
});

module.exports = router;
