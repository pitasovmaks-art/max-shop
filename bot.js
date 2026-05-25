/* ─────────────────────────────────────────────────────────
   Max Messenger Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_BASE   = 'platform-api.max.ru';
const TOKEN      = process.env.MAX_BOT_TOKEN || '';
const SHOP_URL   = process.env.SHOP_URL || 'https://max-shop-production.up.railway.app';
const ADMINS_FILE = path.join(__dirname, 'bot_admins.json');

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
        const urlPath = `/v1/${endpoint}${qs ? '?' + qs : ''}`;
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
    const body = { text };

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
        `Привет, ${userName || 'друг'}! 👋\n\nДобро пожаловать в *Точку Монтажа* 🔨\n\nЗдесь вы найдёте монтажные пистолеты Toua и FengBao, аккумуляторные инструменты и расходники.`,
        [[
            { type: 'link', text: '🛒 Открыть магазин', url: SHOP_URL },
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
        const msg    = update.message;
        const text   = msg?.body?.text || '';
        const chatId = msg?.recipient?.chat_id ?? msg?.sender?.user_id;

        if (!chatId) return;

        if (text === '/start' || text.startsWith('/start ')) {
            const userName = msg?.sender?.name || '';
            await handleStart(chatId, userName);
            return;
        }

        // На любое другое сообщение — показать кнопку магазина
        await sendMessage(
            chatId,
            'Воспользуйтесь кнопкой ниже, чтобы открыть каталог 👇',
            [[{ type: 'link', text: '🛒 Открыть магазин', url: SHOP_URL }]]
        );
    }
}

/* ─── Long polling loop ─────────────────────────────────── */
let marker = undefined;

async function poll() {
    try {
        const res = await request('GET', 'updates', null, {
            marker,
            timeout: 20,
            types:   'bot_started,message_created',
        });

        if (res.marker != null) marker = res.marker;

        if (Array.isArray(res.updates)) {
            for (const update of res.updates) {
                await processUpdate(update).catch(e =>
                    console.error('[bot] Ошибка обработки обновления:', e.message)
                );
            }
        }
    } catch (e) {
        if (e.message !== 'timeout') {
            console.error('[bot] Ошибка polling:', e.message);
        }
        await new Promise(r => setTimeout(r, 5000));
    }

    setImmediate(poll);
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
                { type: 'link', text: '📋 Открыть заказы', url: `${SHOP_URL}/admin/` },
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
    console.log('[bot] Max бот запущен, ждёт обновлений...');
    poll();
}

module.exports = { startBot, notifyAdmin };
