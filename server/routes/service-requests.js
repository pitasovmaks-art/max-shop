const router           = require('express').Router();
const db               = require('../db');
const { requireUser }  = require('../middleware/requireUser');
const { requireAdmin } = require('../middleware/auth');
const { notifyServiceRequest, notifyServiceRequestStatus } = require('../../bot');

/* ─── Магазины, куда можно сдать инструмент на ремонт ───────────────────
   Единственное место, где перечислены допустимые коды (валидация ниже) и
   их подписи (ответ API/уведомление). Коды из того же набора использует
   bot.js (SERVICE_REQUEST_MANAGERS) для маршрутизации уведомления
   менеджеру — при добавлении магазина обновить оба места. */
const SERVICE_STORES = {
    krd_selezneva:  'Краснодар — ул. Селезнева, 4/10',
    krd_kotlyarova: 'Краснодар — ул. Котлярова, 21',
    msk_maevka:     'Москва — Аллея Первой Маевки, 15',
};

const STATUS_LABELS = {
    accepted:    'Принята',
    in_progress: 'В работе',
    ready:       'Готова к выдаче',
    issued:      'Выдана',
};
const ADMIN_STATUSES = Object.keys(STATUS_LABELS); // порядок для UI: accepted -> in_progress -> ready -> issued
const MAX_COST        = 10000000; // разумный верхний предел, только чтобы отсечь мусорный ввод

const MAX_ITEMS        = 10;
const MAX_NAME_LEN     = 100;
const MAX_TOOL_LEN     = 120;
const MAX_PROBLEM_LEN  = 500;
const MAX_ADDRESS_LEN  = 300;
const MAX_COMMENT_LEN  = 1000;
const RATE_LIMIT_PER_HOUR = 5;

function isValidPhone(phone) {
    if (typeof phone !== 'string') return false;
    const digits = phone.replace(/\D/g, '');
    // +7XXXXXXXXXX — 11 цифр, начинается с 7 (та же маска, что в чекауте,
    // см. formatPhoneDigits() в src/cart/checkout.js)
    return digits.length === 11 && digits.startsWith('7');
}

function normalizeRequest(row, items) {
    return {
        id:             row.id,
        number:         'Р-' + row.id,
        name:           row.name,
        phone:          row.phone,
        store:          row.store,
        storeLabel:     SERVICE_STORES[row.store] || row.store,
        deliveryNeeded: row.delivery_needed === 1,
        address:        row.address      || undefined,
        comment:        row.comment      || undefined,
        status:         row.status,
        statusLabel:    STATUS_LABELS[row.status] || row.status,
        cost:           row.cost ?? undefined,
        adminComment:   row.admin_comment || undefined,
        items:          (items || []).map(i => ({ toolName: i.tool_name, problem: i.problem || undefined })),
        createdAt:      row.created_at,
        updatedAt:       row.updated_at,
    };
}

async function loadItems(requestIds) {
    if (!requestIds.length) return {};
    // IN ($1,$2,...) вместо = ANY($1::int[]) — тот же результат, но без
    // массивного типа параметра: везде в проекте уже используется именно
    // такой параметризованный SQL (см. остальные роуты), ANY()::int[]
    // прецедента в кодовой базе не было.
    const placeholders = requestIds.map((_, i) => `$${i + 1}`).join(',');
    const rows = await db.query(
        `SELECT * FROM service_request_items WHERE request_id IN (${placeholders}) ORDER BY id`,
        requestIds
    );
    const byRequest = {};
    for (const r of rows) {
        (byRequest[r.request_id] ||= []).push(r);
    }
    return byRequest;
}

/* Валидирует тело заявки. Возвращает { error } при первой найденной
   проблеме или { data } с уже нормализованными полями. Общая функция для
   POST — чтобы правила не разъехались по двум копиям. */
function validateRequestBody(body) {
    const name    = typeof body.name  === 'string' ? body.name.trim()  : '';
    const phone   = typeof body.phone === 'string' ? body.phone.trim() : '';
    const store   = body.store;
    const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
    const deliveryNeeded = body.deliveryNeeded === true;
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const consent = body.consent === true;
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    if (!name || name.length > MAX_NAME_LEN) {
        return { error: `Имя обязательно, не длиннее ${MAX_NAME_LEN} символов` };
    }
    if (!isValidPhone(phone)) {
        return { error: 'Укажите корректный номер телефона' };
    }
    if (!Object.prototype.hasOwnProperty.call(SERVICE_STORES, store)) {
        return { error: 'Выберите магазин из списка' };
    }
    if (!consent) {
        return { error: 'Нужно согласие на обработку персональных данных' };
    }
    if (!itemsIn.length || itemsIn.length > MAX_ITEMS) {
        return { error: `Укажите от 1 до ${MAX_ITEMS} инструментов` };
    }
    const items = [];
    for (const raw of itemsIn) {
        const toolName = typeof raw?.toolName === 'string' ? raw.toolName.trim() : '';
        const problem   = typeof raw?.problem  === 'string' ? raw.problem.trim()  : '';
        if (!toolName || toolName.length > MAX_TOOL_LEN) {
            return { error: `Название инструмента обязательно, не длиннее ${MAX_TOOL_LEN} символов` };
        }
        if (problem.length > MAX_PROBLEM_LEN) {
            return { error: `Описание проблемы не длиннее ${MAX_PROBLEM_LEN} символов` };
        }
        items.push({ toolName, problem: problem || null });
    }
    if (deliveryNeeded && (!address || address.length > MAX_ADDRESS_LEN)) {
        return { error: `При доставке укажите адрес (до ${MAX_ADDRESS_LEN} символов)` };
    }
    if (comment.length > MAX_COMMENT_LEN) {
        return { error: `Комментарий не длиннее ${MAX_COMMENT_LEN} символов` };
    }

    return {
        data: {
            name, phone, store,
            deliveryNeeded,
            address: deliveryNeeded ? address : null,
            comment: comment || null,
            items,
        },
    };
}

/* POST /api/service-requests — requireUser: tg_id берётся из подписанных
   initData (req.tgId), как у заказов, не из тела запроса. */
router.post('/', requireUser, async (req, res) => {
    const { error, data } = validateRequestBody(req.body || {});
    if (error) return res.status(400).json({ error });

    try {
        const countRow = await db.queryOne(
            `SELECT COUNT(*)::int AS c FROM service_requests
             WHERE tg_id = $1
               AND created_at > TO_CHAR((NOW() AT TIME ZONE 'UTC') - INTERVAL '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
            [req.tgId]
        );
        if ((countRow?.c || 0) >= RATE_LIMIT_PER_HOUR) {
            return res.status(429).json({ error: 'Слишком много заявок за последний час, попробуйте позже' });
        }

        const row = await db.queryOne(
            `INSERT INTO service_requests (tg_id, name, phone, store, delivery_needed, address, comment)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [req.tgId, data.name, data.phone, data.store, data.deliveryNeeded ? 1 : 0, data.address, data.comment]
        );
        const requestId = row.id;

        for (const item of data.items) {
            await db.execute(
                `INSERT INTO service_request_items (request_id, tool_name, problem) VALUES ($1,$2,$3)`,
                [requestId, item.toolName, item.problem]
            );
        }
        await db.execute(
            `INSERT INTO service_request_events (request_id, status, changed_by) VALUES ($1,'accepted','system')`,
            [requestId]
        );

        const full  = await db.queryOne('SELECT * FROM service_requests WHERE id=$1', [requestId]);
        const items = await db.query('SELECT * FROM service_request_items WHERE request_id=$1 ORDER BY id', [requestId]);
        const normalized = normalizeRequest(full, items);

        // Не блокируем ответ покупателю отправкой уведомления; ошибка
        // отправки не должна «отменять» уже сохранённую заявку.
        notifyServiceRequest(normalized).catch(e => console.error('[bot] notifyServiceRequest:', e.message));

        res.status(201).json({ ok: true, id: requestId, number: normalized.number });
    } catch (e) {
        console.error('[service-requests] create error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

/* GET /api/service-requests/my — только свои, tg_id из req.tgId. */
router.get('/my', requireUser, async (req, res) => {
    try {
        const rows = await db.query(
            'SELECT * FROM service_requests WHERE tg_id=$1 ORDER BY id DESC',
            [req.tgId]
        );
        const itemsByRequest = await loadItems(rows.map(r => r.id));
        res.json(rows.map(r => normalizeRequest(r, itemsByRequest[r.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/service-requests/admin — admin only, все заявки, новые сверху.
   Регистрируется ДО /:id — иначе Express принял бы "admin" за значение
   :id и отдал бы его requireUser-роуту (у неё ниже ровно этот же риск
   устранён для /my, тем же порядком регистрации). Фильтры по статусу/
   магазину и поиск по номеру/телефону — на клиенте (как и у /api/orders —
   список не настолько большой, чтобы делать это на сервере). */
router.get('/admin', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM service_requests ORDER BY id DESC');
        const itemsByRequest = await loadItems(rows.map(r => r.id));
        res.json(rows.map(r => normalizeRequest(r, itemsByRequest[r.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/service-requests/admin/:id — admin only, с полной историей
   статусов (которую покупателю в /api/service-requests/:id не отдаём —
   там этой потребности нет, и changed_by='admin' там было бы лишним
   раскрытием внутренней механики). */
router.get('/admin/:id', requireAdmin, async (req, res) => {
    const id = +req.params.id;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const row = await db.queryOne('SELECT * FROM service_requests WHERE id=$1', [id]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        const items  = await db.query('SELECT * FROM service_request_items WHERE request_id=$1 ORDER BY id', [id]);
        const events = await db.query(
            'SELECT status, changed_by, created_at FROM service_request_events WHERE request_id=$1 ORDER BY id',
            [id]
        );
        res.json({ ...normalizeRequest(row, items), events });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/service-requests/admin/:id — admin only: статус, стоимость,
   комментарий мастера. Любое подмножество полей — только переданные
   реально пишутся (динамический SET, без COALESCE: для cost/adminComment
   COALESCE не отличил бы "не передано" от "явно очистить в NULL", а
   очистка — законный сценарий, не только у title/subtitle баннеров).
   Уведомление клиенту — одно сообщение на вызов, собирается только из
   полей, которые РЕАЛЬНО изменились по сравнению с БД (before/after) —
   это и даёт «без дублей, если значение не изменилось» без отдельного
   флага: если всё совпало с тем, что уже было, changes останется пустым
   и notifyServiceRequestStatus вообще не вызовется. */
router.put('/admin/:id', requireAdmin, async (req, res) => {
    const id = +req.params.id;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });

    const body = req.body || {};
    const sets = [];
    const params = [];
    let touchesStatus = false, touchesCost = false, touchesComment = false;
    let nextStatus, nextCost, nextAdminComment;

    if (body.status !== undefined) {
        if (!ADMIN_STATUSES.includes(body.status)) return res.status(400).json({ error: 'Некорректный статус' });
        touchesStatus = true;
        nextStatus = body.status;
        params.push(nextStatus);
        sets.push(`status=$${params.length}`);
    }
    if (body.cost !== undefined) {
        if (body.cost === null || body.cost === '') {
            nextCost = null;
        } else {
            const n = Number(body.cost);
            if (!Number.isFinite(n) || n < 0 || n > MAX_COST) return res.status(400).json({ error: 'Некорректная стоимость' });
            nextCost = Math.round(n);
        }
        touchesCost = true;
        params.push(nextCost);
        sets.push(`cost=$${params.length}`);
    }
    if (body.adminComment !== undefined) {
        const c = typeof body.adminComment === 'string' ? body.adminComment.trim() : '';
        if (c.length > MAX_COMMENT_LEN) return res.status(400).json({ error: `Комментарий мастера не длиннее ${MAX_COMMENT_LEN} символов` });
        nextAdminComment = c || null;
        touchesComment = true;
        params.push(nextAdminComment);
        sets.push(`admin_comment=$${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Нечего сохранять' });

    sets.push(`updated_at=TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
    params.push(id);

    try {
        const before = await db.queryOne('SELECT * FROM service_requests WHERE id=$1', [id]);
        if (!before) return res.status(404).json({ error: 'Not found' });

        await db.execute(`UPDATE service_requests SET ${sets.join(',')} WHERE id=$${params.length}`, params);

        const changes = {};
        if (touchesStatus && nextStatus !== before.status) changes.status = nextStatus;
        if (touchesCost && nextCost !== (before.cost ?? null)) changes.cost = nextCost;
        if (touchesComment && nextAdminComment !== (before.admin_comment ?? null)) changes.adminComment = nextAdminComment;

        if (changes.status) {
            await db.execute(
                `INSERT INTO service_request_events (request_id, status, changed_by) VALUES ($1,$2,'admin')`,
                [id, changes.status]
            );
        }

        const after  = await db.queryOne('SELECT * FROM service_requests WHERE id=$1', [id]);
        const items  = await db.query('SELECT * FROM service_request_items WHERE request_id=$1 ORDER BY id', [id]);
        const normalized = normalizeRequest(after, items);

        if (Object.keys(changes).length && after.tg_id) {
            // Не блокируем ответ админу отправкой уведомления — тот же
            // приём, что у notifyServiceRequest при создании заявки.
            notifyServiceRequestStatus(after.tg_id, normalized, changes)
                .catch(e => console.error('[bot] notifyServiceRequestStatus:', e.message));
        }

        res.json(normalized);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/service-requests/:id — своя заявка. tg_id проверяется прямо в
   WHERE (не отдельной проверкой после выборки) — чужая заявка и
   несуществующая заявка неотличимы снаружи (404 в обоих случаях), не
   раскрывают, существует ли чей-то чужой id. Регистрируется ПОСЛЕ
   /admin и /admin/:id (см. комментарий там) — иначе этот роут перехватил
   бы "admin" как значение :id. */
router.get('/:id', requireUser, async (req, res) => {
    const id = +req.params.id;
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    try {
        const row = await db.queryOne(
            'SELECT * FROM service_requests WHERE id=$1 AND tg_id=$2',
            [id, req.tgId]
        );
        if (!row) return res.status(404).json({ error: 'Not found' });
        const items = await db.query('SELECT * FROM service_request_items WHERE request_id=$1 ORDER BY id', [id]);
        res.json(normalizeRequest(row, items));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.SERVICE_STORES = SERVICE_STORES;
