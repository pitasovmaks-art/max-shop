/* Only street/house queries go to DaData; the API key stays on the server.
   These are address suggestions, NOT a directory of verified Ozon points. */
const { requireUser } = require('../middleware/requireUser');
function createRouter({ fetchImpl = (...args) => fetch(...args), token = process.env.DADATA_API_KEY || '' } = {}) {
    const router = require('express').Router();
    const requests = new Map();
    router.get('/', requireUser, async (req, res) => {
        const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!city || city.length > 100 || query.length < 3 || query.length > 200) {
            return res.status(400).json({ error: 'Укажите город и от 3 до 200 символов адреса' });
        }
        if (!token) return res.json({ enabled: false, suggestions: [] });
        const now = Date.now();
        for (const [id, entry] of requests) if (entry.until < now) requests.delete(id);
        const entry = requests.get(req.tgId) || { count: 0, until: now + 60000 };
        if (entry.count >= 30 || (!requests.has(req.tgId) && requests.size >= 10000)) {
            return res.status(429).json({ error: 'Попробуйте через минуту или введите адрес вручную' });
        }
        entry.count++; requests.set(req.tgId, entry);
        try {
            const upstream = await fetchImpl('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address', {
                method: 'POST', signal: AbortSignal.timeout(5000),
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Token ${token}` },
                body: JSON.stringify({ query, count: 7, locations: [{ city }], restrict_value: true }),
            });
            if (!upstream.ok) throw new Error('provider unavailable');
            const data = await upstream.json();
            if (!Array.isArray(data.suggestions)) throw new Error('invalid response');
            // A street can be selected first, followed by a house query.
            const suggestions = data.suggestions.filter(s =>
                typeof s.value === 'string' && s.data &&
                (s.data.city || s.data.settlement || '').toLocaleLowerCase('ru') === city.toLocaleLowerCase('ru')
            ).slice(0, 7).map(s => ({ value: s.value.slice(0, 500), hasHouse: !!s.data.house }));
            res.json({ enabled: true, suggestions });
        } catch {
            res.status(503).json({ error: 'Подсказки недоступны. Введите адрес пункта вручную.' });
        }
    });
    return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
