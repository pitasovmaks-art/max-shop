const router           = require('express').Router();
const db                = require('../db');
const { requireAdmin } = require('../middleware/auth');
const usdPrice          = require('../utils/usdPrice');
const { loadProductsForPricing } = require('../utils/pricing');
const { computeCartItemPrice }   = require('./cart-sync');

/* GET /api/usd-rate — публичный, только версия курса (для сверки кэша
   каталога/опроса на чекауте, п.8/п.9 задачи). Сам курс клиенту не нужен
   для расчётов (сервер уже отдаёт пересчитанные рубли), отдаём его
   только для наглядности/отладки. */
router.get('/', async (req, res) => {
    try {
        const row = await db.queryOne(
            `SELECT id, rate FROM usd_rate_history ORDER BY created_at DESC, id DESC LIMIT 1`
        );
        res.json({ rate: row ? row.rate : null, rateVersion: row ? row.id : null });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/usd-rate/admin/history — admin-only, п.7: "курс, прошлый
   курс, время — больше ничего". Отдаём в человекочитаемых долларах
   (как и везде на границе API — целые единицы валюты, не ×10000). */
router.get('/admin/history', requireAdmin, async (req, res) => {
    try {
        const rows = await usdPrice.getRateHistory();
        res.json(rows.map(r => ({
            rate:     r.rate / 10000,
            prevRate: r.prev_rate != null ? r.prev_rate / 10000 : null,
            createdAt: r.created_at,
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/usd-rate/admin — admin-only: задать новый курс. После ответа
   (не блокируя его) запускает пересчёт cart_sync и уведомления тем, у
   кого реально изменилась цена — п.10 задачи. */
router.post('/admin', requireAdmin, async (req, res) => {
    const { rate } = req.body || {};
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ error: 'rate должен быть положительным числом (курс $, напр. 92.4567)' });
    }
    try {
        const result = await usdPrice.setRate(Math.round(n * 10000));
        res.json({
            rate:        result.rate / 10000,
            prevRate:    result.prevRate != null ? result.prevRate / 10000 : null,
            rateVersion: result.rateVersion,
        });
        setImmediate(() => {
            notifyCartPriceChanges().catch(e => console.error('[usd-rate] notifyCartPriceChanges error:', e.message));
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/* Проходит по всем строкам cart_sync, группирует по tg_id, пересчитывает
   текущую цену и сравнивает с price_seen. При расхождении — одно
   сообщение на человека (не чаще раза в сутки, usd_notify_log) со
   списком позиций, у которых цена изменилась (в любую сторону).

   price_seen обновляется ТОЛЬКО если сообщение реально отправлено —
   если отправка пропущена из-за суточного лимита, строки остаются со
   старой ценой, чтобы изменение не потерялось и попало в завтрашнюю
   проверку (правка от 2026, см. PROGRESS.md). */
async function notifyCartPriceChanges() {
    const allRows = await db.query('SELECT * FROM cart_sync');
    if (!allRows.length) return;

    const byTgId = new Map();
    allRows.forEach(r => {
        if (!byTgId.has(r.tg_id)) byTgId.set(r.tg_id, []);
        byTgId.get(r.tg_id).push(r);
    });

    const productsById = await loadProductsForPricing([...new Set(allRows.map(r => Number(r.product_id)))]);
    const { notifyPriceChange } = require('../../bot');

    for (const [tgId, rows] of byTgId) {
        const changes = []; // { name, oldPrice, newPrice }
        const changedRowIds = [];
        for (const row of rows) {
            const p = productsById.get(Number(row.product_id));
            if (!p) continue;
            const newPrice = computeCartItemPrice(productsById, Number(row.product_id), row.variant_label, row.city);
            if (!newPrice || newPrice === row.price_seen) continue;
            changes.push({ name: p.name, oldPrice: row.price_seen, newPrice });
            changedRowIds.push(row.id);
        }
        if (!changes.length) continue;

        const logRow = await db.queryOne('SELECT notified_at FROM usd_notify_log WHERE tg_id=$1', [tgId]);
        const limited = logRow && (Date.now() - new Date(logRow.notified_at).getTime() < NOTIFY_COOLDOWN_MS);
        if (limited) continue; // пропускаем отправку И обновление price_seen — изменение придёт завтра

        try {
            await notifyPriceChange(tgId, changes);
            await db.execute(
                `INSERT INTO usd_notify_log (tg_id, notified_at) VALUES ($1, NOW())
                 ON CONFLICT (tg_id) DO UPDATE SET notified_at = NOW()`,
                [tgId]
            );
            for (let i = 0; i < changedRowIds.length; i++) {
                await db.execute('UPDATE cart_sync SET price_seen=$1, updated_at=NOW() WHERE id=$2',
                    [changes[i].newPrice, changedRowIds[i]]);
            }
        } catch (e) {
            console.error(`[usd-rate] notify/update failed for tg_id=${tgId}:`, e.message);
        }
    }
}

module.exports = router;
module.exports.notifyCartPriceChanges = notifyCartPriceChanges;
