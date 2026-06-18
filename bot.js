/* ─────────────────────────────────────────────────────────
   Max Messenger Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { generateToken } = require('./server/utils/shopToken');

const API_BASE     = 'platform-api.max.ru';
const TOKEN        = process.env.MAX_BOT_TOKEN || '';
const SHOP_URL     = process.env.SHOP_URL || 'https://max-shop-production.up.railway.app';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const WEBHOOK_URL  = process.env.WEBHOOK_URL || 'https://pitasovmaks-art-max-shop-c149.twc1.net/webhook';
const ADMINS_FILE  = path.join(__dirname, 'bot_admins.json');

/* ─── Admin chat IDs (persisted between restarts) ──────── */
function loadAdmins() {
    try { return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8')); }
    catch { return []; }
}

function saveAdmins(ids) {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(ids));
}

function addAdmin(chatId) {
    const ids = loadAdmins();
    if (!ids.includes(chatId)) {
        ids.push(chatId);
        saveAdmins(ids);
        console.log(`[bot] Новый администратор: chat_id=${chatId}`);
    }
}

/* ─── HTTP helper ───────────────────────────────────────── */
function request(method, endpoint, body = null, query = {}) {
    return new Promise((resolve, reject) => {
        const qs = new URLSearchParams(
            Object.fromEntries(Object.entries(query).filter(([, v]) => v != null))
        ).toString();
        const urlPath = `/${endpoint}${qs ? '?' + qs : ''}`;
        const data    = body ? JSON.stringify(body) : null;

        const opts = {
            hostname: API_BASE,
            path:     urlPath,
            method,
            headers: {
                'Authorization': TOKEN,
                'Content-Type':  'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        };

        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (res.statusCode >= 400) {
                        reject(new Error(`API ${res.statusCode}: ${JSON.stringify(parsed)}`));
                    } else {
                        resolve(parsed);
                    }
                } catch {
                    if (res.statusCode >= 400) {
                        reject(new Error(`API ${res.statusCode}: ${raw}`));
                    } else {
                        resolve(raw);
                    }
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(25000, () => { req.destroy(); reject(new Error('timeout')); });
        if (data) req.write(data);
        req.end();
    });
}

/* ─── Send message ──────────────────────────────────────── */
function sendMessage(chatId, text, buttons = null) {
    const body = { text, format: 'markdown' };

    if (buttons) {
        body.attachments = [{
            type:    'inline_keyboard',
            payload: { buttons },
        }];
    }

    return request('POST', 'messages', body, { chat_id: chatId });
}

/* ─── /start handler ────────────────────────────────────── */
async function handleStart(chatId, userName) {
    addAdmin(chatId);

    console.log('[bot] handleStart: chatId=', chatId);
    await sendMessage(chatId, `👋 Добро пожаловать в *Точку Монтажа*!\n\nЗдесь вы можете заказать монтажные пистолеты, аккумуляторный инструмент и расходники.\n\n✉️ Вы подписаны на уведомления о статусе заказов.`);

    const token = generateToken(chatId);
    const url   = `${SHOP_URL}/?token=${token}`;
    await sendMessage(chatId, '🛍 Откройте каталог:', [[{ type: 'link', text: 'Открыть магазин', url }]]);
}

/* ─── Process one update ────────────────────────────────── */
async function processUpdate(update) {
    const type = update.update_type;

    // Пользователь нажал "Начать" или написал /start
    if (type === 'bot_started') {
        const chatId   = update.chat_id;
        const userName = update.user?.name || '';
        await handleStart(chatId, userName);
        console.log('[bot] bot_started: chatId=', chatId);
        return;
    }

    // Входящее текстовое сообщение
    if (type === 'message_created') {
        const msg        = update.message;
        const text       = msg?.body?.text || '';
        const chatId     = msg?.recipient?.chat_id ?? msg?.sender?.user_id;
        const userId     = msg?.sender?.user_id;
        const senderName = msg?.sender?.name || 'Пользователь';

        if (!chatId) return;
        if (msg?.sender?.is_bot) return;

        // Сохраняем маппинг userId → chatId
        if (userId && chatId && userId !== chatId) {
            const base = process.env.WEBHOOK_URL
                ? process.env.WEBHOOK_URL.replace('/webhook', '')
                : 'http://localhost:3000';
            fetch(`${base}/api/users/map`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ userId, chatId }),
            }).catch(e => console.error('[bot] user_map save error:', e.message));
        }

        if (text === '/start' || text.startsWith('/start ')) {
            const userName = msg?.sender?.name || '';
            await handleStart(chatId, userName);
            return;
        }

        // /myid — ответить своим chat_id
        if (text.trim().toLowerCase() === '/myid') {
            await sendMessage(chatId, `Ваш ID: ${chatId}`);
            console.log('[BOT] /myid запрошен, chatId:', chatId);
            return;
        }

        // /reply ID текст — отправить ответ пользователю (только для админов)
        if (text.startsWith('/reply ')) {
            const admins = loadAdmins();
            if (!admins.includes(chatId)) return;
            const parts      = text.split(' ');
            const targetId   = Number(parts[1]);
            const replyText  = parts.slice(2).join(' ');
            if (!targetId || !replyText) {
                await sendMessage(chatId, 'Формат: /reply ID текст');
                return;
            }
            await sendMessage(targetId, `💬 *Ответ от поддержки Точки Монтажа:*\n${replyText}`);
            await sendMessage(chatId, '✅ Ответ отправлен');
            return;
        }

        // Отписка от промо-рассылки
        if (text.trim().toLowerCase() === 'стоп акции') {
            try {
                const base = process.env.WEBHOOK_URL
                    ? process.env.WEBHOOK_URL.replace('/webhook', '')
                    : 'http://localhost:3000';
                await fetch(`${base}/api/promo/unsubscribe`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ tgId: userId || chatId }),
                });
                await sendMessage(chatId, 'Вы отписались от уведомлений об акциях.');
            } catch (e) {
                console.error('[bot] promo unsubscribe error:', e.message);
            }
            return;
        }

        // Отвечаем всем текстом
        try {
            await sendMessage(chatId, '👋 Спасибо за сообщение! Вы подписаны на уведомления о статусе ваших заказов.');
        } catch (e) {
            console.error('[bot] fallback reply error:', e.message);
        }

        // Пересылаем сообщение админам если отправитель не администратор
        const admins = loadAdmins();
        const isAdmin = admins.includes(chatId);
        if (!isAdmin) {
            for (const adminId of admins) {
                if (adminId === chatId) continue;
                await sendMessage(
                    adminId,
                    `📩 *Обращение в поддержку*\nОт: ${senderName} (ID: ${chatId})\nСообщение: ${text}\n\nОтветить: /reply ${chatId} ваш текст`
                );
            }
        }
    }
}

/* ─── Register webhook ──────────────────────────────────── */
async function registerWebhook() {
    const data = JSON.stringify({
        url:          WEBHOOK_URL,
        update_types: ['message_created', 'bot_started'],
    });

    return new Promise((resolve) => {
        const opts = {
            hostname: 'platform-api.max.ru',
            path:     '/subscriptions',
            method:   'POST',
            headers: {
                'Authorization':  TOKEN,
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        };

        const req = https.request(opts, res => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                console.log('[bot] Webhook зарегистрирован, статус:', res.statusCode, raw);
                resolve();
            });
        });

        req.on('error', e => {
            console.error('[bot] Ошибка регистрации webhook:', e.message);
            resolve();
        });

        req.write(data);
        req.end();
    });
}

/* ─── Routing tables ────────────────────────────────────── */
// For pickup: route by store name to the specific store manager
const STORE_MANAGERS = {
    'Краснодар, ул. Селезнева, 4/10':       315827109,
    'Краснодар — ул. Селезнева':            315827109,
    'Краснодар, ул. Котлярова, 21':         403249437,
    'Краснодар — ул. Котлярова':            403249437,
    'Москва, Аллея Первой Маевки, 15 стр3': 392912448,
    'Москва — Аллея Первой Маевки':         392912448,
};
// For city/russia delivery: route by city code
const CITY_MANAGERS = {
    krd: 315827109,
    msk: 392912448,
};

const DELIVERY_METHOD_LABELS = {
    pickup:  'Самовывоз',
    city:    'Доставка по городу',
    russia:  'Доставка по России',
};

/* ─── Notify store manager about new order ──────────────── */
async function notifyStore(order) {
    if (!TOKEN) return;

    const lines = order.items.map(i =>
        `• ${i.name} × ${i.qty} — ${(i.price * i.qty).toLocaleString('ru-RU')} ₽`
    );

    const delivery = order.delivery || 'pickup';
    const methodLabel = DELIVERY_METHOD_LABELS[delivery] || delivery;

    const parts = [
        `🛍 Новый заказ!`,
        `👤 Клиент: ${order.name}`,
        `📞 Телефон: ${order.phone}`,
        `🚚 Способ: ${methodLabel}`,
    ];

    if (delivery === 'pickup') {
        parts.push(`🏪 Магазин: ${order.store}`);
    } else {
        parts.push(`📍 Адрес доставки: ${order.address || order.store}`);
    }

    parts.push(
        `📦 Товары:\n${lines.join('\n')}`,
        `💰 Сумма: ${order.total.toLocaleString('ru-RU')} ₽`,
        `💬 Комментарий: ${order.comment || 'нет'}`,
    );

    const text = parts.join('\n');

    let managerId;
    if (delivery === 'pickup') {
        managerId = STORE_MANAGERS[order.store];
    } else {
        managerId = CITY_MANAGERS[order.city];
    }
    const recipients = managerId ? [managerId] : Object.values(CITY_MANAGERS);

    console.log('[bot] notifyStore вызван, city:', order.city, 'delivery:', delivery, 'store:', order.store);
    console.log('[bot] получатели:', recipients);

    for (const chatId of recipients) {
        try {
            const result = await sendMessage(chatId, text);
            console.log('[bot] уведомление отправлено:', chatId);
            console.log('[bot] ответ API:', JSON.stringify(result));
        } catch (e) {
            console.error(`[bot] Не удалось отправить уведомление chat_id=${chatId}:`, e.message);
        }
    }
}

/* ─── Notify customer about order status change ─────────── */
async function notifyCustomer(tgId, orderId, status, extra) {
    if (!TOKEN || !tgId) return;
    let text;
    if (status === 'tracking') {
        text = `📬 Ваш заказ №${orderId} отправлен!\nТрек-номер СДЭК: ${extra}\nОтследить: https://www.cdek.ru/ru/tracking?order_id=${extra}`;
    } else if (extra) {
        text = `📬 Ваш заказ №${orderId} отправлен! Трек-номер СДЭК: ${extra}\nОтследить: https://www.cdek.ru/ru/tracking?order_id=${extra}`;
    } else {
        const msgs = {
            in_progress: `🔧 Ваш заказ №${orderId} принят в работу.`,
            ready:       `✅ Ваш заказ №${orderId} готов к выдаче! Ожидаем вас в магазине.`,
            shipped:     `📦 Ваш заказ №${orderId} отправлен! Ожидайте доставку.`,
            completed:   `✅ Ваш заказ №${orderId} выполнен! Спасибо за покупку в Точке Монтажа.`,
            cancelled:   `❌ Ваш заказ №${orderId} отменён. Свяжитесь с нами для уточнения.`,
        };
        text = msgs[status];
        if (!text) return;
    }
    const trySend = async (id) => {
        const result = await sendMessage(+id, text);
        console.log(`[bot] notifyCustomer OK: tg_id=${tgId} chat=${id} orderId=${orderId} status=${status}`, result);
    };

    try {
        await trySend(tgId);
    } catch (e) {
        console.error(`[bot] notifyCustomer FAIL first try: tg_id=${tgId}`, e.message);
        // Пробуем найти chat_id через user_map
        try {
            const base = process.env.WEBHOOK_URL
                ? process.env.WEBHOOK_URL.replace('/webhook', '')
                : 'http://localhost:3000';
            const r = await fetch(`${base}/api/users/chat?user_id=${tgId}`);
            if (r.ok) {
                const data = await r.json();
                if (data.chatId && data.chatId !== String(tgId)) {
                    console.log(`[bot] notifyCustomer retry with chatId=${data.chatId}`);
                    await trySend(data.chatId);
                    return;
                }
            }
        } catch (e2) {
            console.error(`[bot] notifyCustomer user_map lookup failed:`, e2.message);
        }
        console.error(`[bot] notifyCustomer FAIL final: tg_id=${tgId} orderId=${orderId}`, e.message);
    }
}

/* ─── Notify: back in stock ─────────────────────────────── */
async function notifyStock(tgId, productName) {
    if (!TOKEN || !tgId) return;
    const text = `🔔 Товар «${productName}» снова в наличии! Успейте заказать.`;
    const trySend = async (id) => {
        const result = await sendMessage(+id, text);
        console.log(`[bot] notifyStock OK: tg_id=${tgId} product=${productName}`, result);
    };
    try {
        await trySend(tgId);
    } catch (e) {
        console.error(`[bot] notifyStock FAIL first try: tg_id=${tgId}`, e.message);
        try {
            const base = process.env.WEBHOOK_URL
                ? process.env.WEBHOOK_URL.replace('/webhook', '')
                : 'http://localhost:3000';
            const r = await fetch(`${base}/api/users/chat?user_id=${tgId}`);
            if (r.ok) {
                const data = await r.json();
                if (data.chatId && data.chatId !== String(tgId)) {
                    console.log(`[bot] notifyStock retry with chatId=${data.chatId}`);
                    await trySend(data.chatId);
                    return;
                }
            }
        } catch (e2) {
            console.error(`[bot] notifyStock user_map lookup failed:`, e2.message);
        }
        console.error(`[bot] notifyStock FAIL final: tg_id=${tgId} product=${productName}`, e.message);
    }
}

/* ─── Notify: promo sale ────────────────────────────────── */
async function notifyPromo(tgId, productName) {
    if (!TOKEN || !tgId) return;
    const text = `🔥 Акция в Точке Монтажа!\n\nТовар «${productName}» теперь по специальной цене. Успейте заказать!\n\nЧтобы отписаться от акций, напишите боту: стоп акции`;
    const trySend = async (id) => {
        const result = await sendMessage(+id, text);
        console.log(`[bot] notifyPromo OK: tg_id=${tgId} product=${productName}`, result);
    };
    try {
        await trySend(tgId);
    } catch (e) {
        console.error(`[bot] notifyPromo FAIL first try: tg_id=${tgId}`, e.message);
        try {
            const base = process.env.WEBHOOK_URL
                ? process.env.WEBHOOK_URL.replace('/webhook', '')
                : 'http://localhost:3000';
            const r = await fetch(`${base}/api/users/chat?user_id=${tgId}`);
            if (r.ok) {
                const data = await r.json();
                if (data.chatId && data.chatId !== String(tgId)) {
                    await trySend(data.chatId);
                    return;
                }
            }
        } catch (e2) {
            console.error(`[bot] notifyPromo user_map lookup failed:`, e2.message);
        }
        console.error(`[bot] notifyPromo FAIL final: tg_id=${tgId} product=${productName}`, e.message);
    }
}

/* ─── Start bot ─────────────────────────────────────────── */
function startBot() {
    if (!TOKEN) {
        console.log('[bot] MAX_BOT_TOKEN не задан — бот не запущен');
        return;
    }
    console.log('[bot] Max бот запущен, регистрирует webhook...');
    registerWebhook();
}

module.exports = { startBot, notifyStore, processUpdate, notifyCustomer, notifyStock, notifyPromo };
