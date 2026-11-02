const router            = require('express').Router();
const db                = require('../db');
const { requireAdmin }  = require('../middleware/auth');
const { requireUser }   = require('../middleware/requireUser');
const { notifyCustomer } = require('../../bot');
const { loadProductsForPricing, resolveOrderItem } = require('../utils/pricing');

const { validateOrder } = require('../utils/orderValidation');
const { enqueue } = require('../utils/notificationOutbox');

const MAX_ITEMS_PER_ORDER = 50;
const MAX_QTY_PER_ITEM    = 999;

function normalize(o) {
    return {
        id:             o.id,
        name:           o.name,
        phone:          o.phone,
        store:          o.store,
        delivery:       o.delivery       || 'pickup',
        deliveryCarrier: o.delivery === 'russia' ? (o.delivery_carrier || 'cdek') : undefined,
        address:        o.address        || undefined,
        city:           o.city           || undefined,
        tgId:           o.tg_id          || undefined,
        trackingNumber: o.tracking_number|| undefined,
        comment:        o.comment        || undefined,
        items:          typeof o.items === 'string' ? JSON.parse(o.items) : o.items,
        total:          o.total,
        status:         o.status,
        createdAt:      o.created_at,
    };
}

/* POST /api/orders — публичный (создание), но tg_id заказа берётся из
   подписанных initData (req.tgId), а не из тела запроса — клиент больше
   не может подставить чужой id в поле tgId.

   items[].price/name и total, присланные клиентом, НЕ сохраняются —
   раньше сервер доверял им полностью, и прямым запросом (не через сайт)
   можно было оформить заказ по любой, в том числе нулевой, цене. Вместо
   этого цена и название каждой позиции пересчитываются по актуальным
   данным из БД (server/utils/pricing.js — порт той же формулы, что
   effectiveItemPrice()/_checkCartItem() в src/cart/checkout.js), и именно
   эти пересчитанные значения идут в БД и в уведомление менеджеру. Для
   обычного покупателя (прошёл через настоящий чекаут) цена совпадёт 1:1 —
   он уже проверил её свежими данными перед отправкой. */
router.post('/', requireUser, async (req, res) => {
    const inputError = validateOrder(req.body);
    if (inputError) return res.status(400).json({ error: inputError });
    const { name, phone, store, delivery, address, city, comment, items, total, deliveryCarrier, requestId } = req.body;
    const tgId = req.tgId;
    if (!name || !phone || !store || !items || total == null) {
        return res.status(400).json({ error: 'Обязательные поля: name, phone, store, items, total' });
    }
    if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS_PER_ORDER) {
        return res.status(400).json({ error: `В заказе должно быть от 1 до ${MAX_ITEMS_PER_ORDER} позиций` });
    }
    for (const it of items) {
        if (!it || !Number.isInteger(it.id) || it.id <= 0) {
            return res.status(400).json({ error: 'Некорректная позиция заказа' });
        }
        if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > MAX_QTY_PER_ITEM) {
            return res.status(400).json({ error: 'Некорректное количество товара' });
        }
    }

    const deliveryMethod = delivery || 'pickup';
    if (!['pickup', 'city', 'russia'].includes(deliveryMethod)) return res.status(400).json({ error: 'Некорректный способ доставки' });
    const carrier = deliveryMethod === 'russia' ? (deliveryCarrier ?? 'cdek') : null;
    if (carrier !== null && !['cdek', 'ozon'].includes(carrier)) return res.status(400).json({ error: 'Некорректный перевозчик' });
    if (deliveryMethod !== 'russia' && deliveryCarrier != null) return res.status(400).json({ error: 'Перевозчик доступен только для доставки по России' });
    if (deliveryMethod === 'russia' && (typeof address !== 'string' || address.trim().length < 5 || address.length > 500)) {
        return res.status(400).json({ error: 'Укажите адрес пункта выдачи (до 500 символов)' });
    }

    try {
        if (requestId) {
            const previous = await db.queryOne('SELECT id FROM orders WHERE tg_id=$1 AND client_request_id=$2',[tgId,requestId]);
            if (previous) return res.status(201).json({ok:true,id:previous.id});
        }
        const productsById = await loadProductsForPricing(items.map(it => it.id));
        const resolved = items.map(it => resolveOrderItem(
            { id: it.id, variantLabel: typeof it.variantLabel === 'string' ? it.variantLabel.slice(0, 200) : '' },
            productsById, city, deliveryMethod
        ));
        const failed = resolved.filter(r => !r.ok);
        if (failed.length) {
            return res.status(400).json({ error: failed.map(f => f.reason).join('\n') });
        }

        const realItems = resolved.map((r, idx) => ({
            id: items[idx].id, name: r.name, price: r.price, qty: items[idx].qty,
            // usd-pricing, п.11: $ и курс на момент заказа — только для
            // аудита, в сумму/формулу не участвуют и не влияют на realTotal.
            ...(r.priceUsdCents != null ? { priceUsdCents: r.priceUsdCents, rateX10000: r.rateX10000 } : {}),
        }));
        const realTotal = realItems.reduce((sum, it) => sum + it.price * it.qty, 0);

        // usd-pricing, п.9: раньше присланная клиентом total читалась, но
        // никогда не сравнивалась с пересчитанной — заказ создавался по
        // realTotal молча. Теперь при расхождении (курс/цена поменялись
        // между показом чекаута и отправкой) отвечаем 409 с актуальными
        // ценами вместо тихого создания заказа по другой сумме, чем видел
        // покупатель — чекаут показывает тот же "Цена изменилась"-баннер.
        if (Number(total) !== realTotal) {
            return res.status(409).json({ error: 'price_changed', items: realItems, total: realTotal });
        }

        let orderId;
        await db.inTransaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['order:' + tgId]);
            if (requestId) {
                const previous = await client.query('SELECT id FROM orders WHERE tg_id=$1 AND client_request_id=$2', [tgId, requestId]);
                if (previous.rows[0]) { orderId = previous.rows[0].id; return; }
            }
            const count = await client.query("SELECT COUNT(*)::int AS c FROM orders WHERE tg_id=$1 AND created_at > TO_CHAR((NOW() AT TIME ZONE 'UTC')-INTERVAL '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')", [tgId]);
            if (count.rows[0].c >= 30) { const e = new Error('Слишком много заказов, попробуйте позже'); e.status = 429; throw e; }
            if (deliveryMethod === 'pickup') {
                const storeResult = req.body.storeId != null
                    ? await client.query('SELECT id,city,address FROM stores WHERE id=$1', [req.body.storeId])
                    : await client.query("SELECT id,city,address FROM stores WHERE (city || ', ' || address)=$1", [store]);
                const selected = storeResult.rows[0];
                const correctCity = city === 'krd' ? 'Краснодар' : 'Москва';
                if (!selected || selected.city !== correctCity || `${selected.city}, ${selected.address}` !== store) {
                    const e = new Error('Магазин изменился, выберите его заново'); e.status = 400; throw e;
                }
            }
            const row = await client.query(
                `INSERT INTO orders (name,phone,store,delivery,address,city,tg_id,comment,items,total,delivery_carrier,client_request_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
                [name.trim(), phone.trim(), store.trim(), deliveryMethod, address || null, city,
                 tgId, comment || null, JSON.stringify(realItems), realTotal, carrier, requestId || null]
            );
            orderId = row.rows[0].id;
            await enqueue(client, 'order', orderId);
        });
        require('../utils/notificationOutbox').wake();
        res.status(201).json({ ok: true, id: orderId });
    } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Не удалось сохранить заказ' }); }
});

/* GET /api/orders/my — tg_id берётся из подписанных initData (req.tgId),
   не из query, иначе любой мог запросить чужие заказы, подобрав чужой
   tg_id (см. PROGRESS.md, «Открытая уязвимость — tg_id без проверки»). */
router.get('/my', requireUser, async (req, res) => {
    try {
        const rows = await db.query(
            'SELECT * FROM orders WHERE tg_id=$1 ORDER BY id DESC',
            [req.tgId]
        );
        res.json(rows.map(normalize));
    } catch (e) { console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' }); }
});

/* GET /api/orders — admin only */
router.get('/', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM orders ORDER BY id DESC');
        res.json(rows.map(normalize));
    } catch (e) { console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' }); }
});

/* GET /api/orders/:id — admin only */
router.get('/:id', requireAdmin, async (req, res) => {
    try {
        const o = await db.queryOne('SELECT * FROM orders WHERE id=$1', [+req.params.id]);
        if (!o) return res.status(404).json({ error: 'Not found' });
        res.json(normalize(o));
    } catch (e) { console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' }); }
});

/* PUT /api/orders/:id/status — admin only */
router.put('/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body;
    const allowed = ['new', 'in_progress', 'ready', 'shipped', 'completed', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
        const changed = await db.execute(
            'UPDATE orders SET status=$1 WHERE id=$2',
            [status, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        // Notify customer
        const o = await db.queryOne('SELECT tg_id, id, delivery_carrier FROM orders WHERE id=$1', [+req.params.id]);
        if (o?.tg_id) {
            notifyCustomer(o.tg_id, o.id, status).catch(e => console.error('[bot] notify:', e.message));
        }
        res.json({ ok: true });
    } catch (e) { console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' }); }
});

/* PUT /api/orders/:id/tracking — admin only */
router.put('/:id/tracking', requireAdmin, async (req, res) => {
    const { tracking_number } = req.body;
    if (!tracking_number) return res.status(400).json({ error: 'tracking_number required' });
    try {
        const changed = await db.execute(
            'UPDATE orders SET tracking_number=$1, status=\'shipped\' WHERE id=$2',
            [tracking_number, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const o = await db.queryOne('SELECT tg_id, id, delivery_carrier FROM orders WHERE id=$1', [+req.params.id]);
        if (o?.tg_id) {
            notifyCustomer(o.tg_id, o.id, 'tracking', tracking_number, o.delivery_carrier || 'cdek')
                .catch(e => console.error('[bot] notify tracking:', e.message));
        }
        res.json({ ok: true });
    } catch (e) { console.error('[api] request_failed', req.method, req.path); res.status(500).json({ error: 'Не удалось выполнить запрос' }); }
});

module.exports = router;
