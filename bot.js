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

    await sendMessage(
        chatId,
        `👋 Добро пожаловать в *Точку Монтажа*!\n\nЗдесь вы можете заказать монтажные пистолеты, аккумуляторный инструмент и расходники.\n\nЧем могу помочь?`,
        [[
            { type: 'open_app', text: '🛒 Открыть магазин', web_app: SHOP_URL },
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

/* ─── Notify admins about new order ────────────────────── */
async function notifyAdmin(order) {
    if (!TOKEN) return;

    const admins = loadAdmins();
    if (!admins.length) return;

    const lines = order.items.map(i =>
        `• ${i.name} × ${i.qty} — ${(i.price * i.qty).toLocaleString('ru-RU')} ₽`
    );

    const text = [
        `🛒 *Новый заказ #${order.id}*`,
        '',
        lines.join('\n'),
        '',
        `💰 Итого: ${order.total.toLocaleString('ru-RU')} ₽`,
        `👤 ${order.name}`,
        `📞 ${order.phone}`,
        `📍 ${order.store}`,
        order.comment ? `💬 ${order.comment}` : null,
    ].filter(Boolean).join('\n');

    for (const chatId of admins) {
        try {
            await sendMessage(chatId, text, [[
                { type: 'open_app', text: '📋 Открыть заказы', web_app: `${SHOP_URL}/admin/` },
            ]]);
        } catch (e) {
            console.error(`[bot] Не удалось отправить уведомление chat_id=${chatId}:`, e.message);
        }
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

module.exports = { startBot, notifyAdmin, processUpdate };
