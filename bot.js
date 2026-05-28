/* ─────────────────────────────────────────────────────────
   Max Messenger Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

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
                try { resolve(JSON.parse(raw)); }
                catch { resolve(raw); }
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

    const shopUrl = `${SHOP_URL}?tg_id=${chatId}`;
    console.log('[BOT] ссылка для пользователя:', shopUrl);

    await sendMessage(
        chatId,
        `👋 Добро пожаловать в *Точку Монтажа*!\n\nЗдесь вы можете заказать монтажные пистолеты, аккумуляторный инструмент и расходники.\n\nЧем могу помочь?`,
        [[
            { type: 'open_app', text: '🛒 Открыть магазин', web_app: shopUrl },
        ]]
    );
}

/* ─── Process one update ────────────────────────────────── */
async function processUpdate(update) {
    const type = update.update_type;

    // Пользователь нажал "Начать" или написал /start
    if (type === 'bot_started') {
        const chatId   = update.chat_id;
        const userName = update.user?.name || '';
        await handleStart(chatId, userName);
        return;
    }

    // Входящее текстовое сообщение
    if (type === 'message_created') {
        const msg        = update.message;
        const text       = msg?.body?.text || '';
        const chatId     = msg?.recipient?.chat_id ?? msg?.sender?.user_id;
        console.log('[BOT] update:', JSON.stringify(update, null, 2));
        console.log('[BOT] text:', text, '| chatId:', chatId);
        console.log('[BOT] сырой текст:', JSON.stringify(text), '| chatId:', chatId);
        const senderName = msg?.sender?.name || 'Пользователь';

        if (!chatId) return;

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

        // Fallback — пересылаем сообщение админам, пользователю отвечаем автоматически
        const admins = loadAdmins();
        const isAdmin = admins.includes(chatId);
        if (!isAdmin) {
            await sendMessage(
                chatId,
                'Спасибо за обращение! Я передал ваш вопрос нашим специалистам. В ближайшее время с вами свяжутся. 🙏',
                [[{ type: 'open_app', text: '🛒 Открыть магазин', web_app: SHOP_URL }]]
            );
            for (const adminId of admins) {
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
async function notifyCustomer(tgId, orderId, status, trackingNumber) {
    if (!TOKEN || !tgId) return;
    let text;
    if (trackingNumber) {
        text = `📬 Ваш заказ №${orderId} отправлен! Трек-номер СДЭК: ${trackingNumber}\nОтследить: https://www.cdek.ru/ru/tracking?order_id=${trackingNumber}`;
    } else {
        const msgs = {
            in_progress: `🔧 Ваш заказ №${orderId} принят в работу.`,
            shipped:     `📦 Ваш заказ №${orderId} отправлен! Ожидайте доставку.`,
            completed:   `✅ Ваш заказ №${orderId} выполнен! Спасибо за покупку в Точке Монтажа.`,
            cancelled:   `❌ Ваш заказ №${orderId} отменён. Свяжитесь с нами для уточнения.`,
        };
        text = msgs[status];
        if (!text) return;
    }
    try {
        await sendMessage(+tgId, text);
        console.log(`[bot] notifyCustomer: tg_id=${tgId} orderId=${orderId} status=${status}`);
    } catch (e) {
        console.error('[bot] notifyCustomer error:', e.message);
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

module.exports = { startBot, notifyStore, processUpdate, notifyCustomer };
