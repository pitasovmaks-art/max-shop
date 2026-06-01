/* ─────────────────────────────────────────────────────────
   Max Messenger Support Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const path  = require('path');

const API_BASE               = 'platform-api.max.ru';
const TOKEN                  = process.env.SUPPORT_BOT_TOKEN || '';
const WEBHOOK_BASE           = (process.env.WEBHOOK_URL || 'https://pitasovmaks-art-max-shop-c149.twc1.net/webhook').replace('/webhook', '');
const SUPPORT_WEBHOOK_URL    = WEBHOOK_BASE + '/webhook-support';
const SUPPORT_ADMIN_USER_IDS = [5149723, 100067838];   // user_id одинаков у обоих ботов

/* ─── DB helpers (прямой доступ, тот же процесс) ────────── */
function getDb() {
    try { return require('./server/db'); } catch (e) { return null; }
}

async function dbSaveAdminMap(userId, chatId) {
    try {
        const db = getDb();
        if (!db) return;
        await db.execute(
            `INSERT INTO support_admins (user_id, chat_id, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (user_id) DO UPDATE SET chat_id = $2, updated_at = NOW()`,
            [String(userId), String(chatId)]
        );
    } catch (e) {
        console.error('[support] dbSaveAdminMap ошибка:', e.message);
    }
}

async function dbLoadAdminMap() {
    try {
        const db = getDb();
        if (!db) return {};
        const rows = await db.query('SELECT user_id, chat_id FROM support_admins');
        const map = {};
        for (const row of rows) map[row.user_id] = row.chat_id;
        return map;
    } catch (e) {
        console.error('[support] dbLoadAdminMap ошибка:', e.message);
        return {};
    }
}

async function dbMarkKnown(chatId) {
    try {
        const db = getDb();
        if (!db) return;
        await db.execute(
            `INSERT INTO support_known (chat_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [String(chatId)]
        );
    } catch (e) {
        console.error('[support] dbMarkKnown ошибка:', e.message);
    }
}

/* ─── HTTP helper (Max API) ─────────────────────────────── */
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
function sendMessage(chatId, text) {
    return request('POST', 'messages', { text, format: 'markdown' }, { chat_id: chatId })
        .catch(e => {
            console.error(`[support] sendMessage(${chatId}) ошибка:`, e.message);
        });
}

/* ─── Webhook registration ──────────────────────────────── */
function registerWebhook() {
    const data = JSON.stringify({
        url:          SUPPORT_WEBHOOK_URL,
        update_types: ['message_created', 'bot_started'],
    });

    return new Promise((resolve) => {
        const opts = {
            hostname: API_BASE,
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
                console.log('[support] Webhook зарегистрирован, статус:', res.statusCode, raw);
                resolve();
            });
        });

        req.on('error', e => {
            console.error('[support] Ошибка регистрации webhook:', e.message);
            resolve();
        });

        req.write(data);
        req.end();
    });
}

/* ─── Update handler ────────────────────────────────────── */
async function processUpdate(update) {
    try {
        const type = update.update_type;

        /* ── bot_started ── */
        if (type === 'bot_started') {
            const chatId = update.chat_id;
            const userId = update.user?.user_id;
            if (!chatId) return;

            if (userId && SUPPORT_ADMIN_USER_IDS.includes(userId)) {
                await dbSaveAdminMap(userId, chatId);
                console.log(`[support] Менеджер зарегистрирован: userId=${userId} chatId=${chatId}`);
                await sendMessage(chatId, '✅ Вы зарегистрированы как менеджер поддержки. Клиентские обращения будут приходить сюда.');
                return;
            }

            await sendMessage(chatId,
                '👋 Здравствуйте! Это служба поддержки магазина Точка Монтажа. ' +
                'Опишите ваш вопрос или проблему, и мы свяжемся с вами в ближайшее время.'
            );
            return;
        }

        if (type !== 'message_created') return;

        const msg = update.message;
        if (!msg) return;

        const chatId     = msg.recipient?.chat_id;
        const userId     = msg.sender?.user_id;
        const text       = msg.body?.text || '';
        const senderName = msg.sender?.name || msg.sender?.username || String(userId);

        if (!chatId) return;
        console.log('[support] message: userId=' + userId + ' chatId=' + chatId + ' isManager=' + SUPPORT_ADMIN_USER_IDS.includes(userId) + ' text=' + text);
        if (msg.sender?.is_bot) return;

        /* ── Сообщение от менеджера ── */
        if (userId && SUPPORT_ADMIN_USER_IDS.includes(userId)) {
            await dbSaveAdminMap(userId, chatId);

            /* Способ 1: свайп-reply на пересланное сообщение клиента */
            const replyLink = msg.link;
            if (replyLink && replyLink.type === 'reply' && replyLink.message?.text) {
                const idMatch = replyLink.message.text.match(/ID:\s*(\d+)/);
                if (idMatch) {
                    const clientChatId = Number(idMatch[1]);
                    await sendMessage(clientChatId, `💬 Ответ от поддержки Точки Монтажа:\n\n${text}`);
                    await sendMessage(chatId, '✅ Ответ отправлен клиенту');
                    return;
                }
            }

            /* Способ 2: /reply <chat_id> <текст> */
            if (text.startsWith('/reply')) {
                const match = text.match(/^\/reply\s+(\d+)\s+([\s\S]+)$/);
                if (!match) {
                    await sendMessage(chatId, '⚠️ Формат: /reply <chat_id> <текст ответа>');
                    return;
                }
                const targetId  = Number(match[1]);
                const replyText = match[2].trim();
                await sendMessage(targetId, `💬 Ответ от поддержки:\n\n${replyText}`);
                await sendMessage(chatId, `✅ Ответ отправлен клиенту (${targetId})`);
            }
            return;
        }

        /* ── Сообщение от клиента ── */
        await dbMarkKnown(chatId);

        await sendMessage(chatId,
            '✅ Спасибо за обращение! Мы получили ваше сообщение и передали его менеджерам. Скоро вернёмся с ответом.'
        );

        /* ── Переслать менеджерам из БД ── */
        const adminMap    = await dbLoadAdminMap();
        const knownAdmins = Object.values(adminMap);

        if (knownAdmins.length === 0) {
            console.warn('[support] Нет зарегистрированных менеджеров для пересылки');
            return;
        }

        const forwardText =
            `💬 Поддержка\n` +
            `👤 От: ${senderName}\n` +
            `🆔 ID: ${chatId}\n` +
            `📝 ${text}\n\n` +
            `Ответить: /reply ${chatId} ваш ответ`;

        for (const adminChatId of knownAdmins) {
            if (adminChatId === chatId) continue;
            await sendMessage(adminChatId, forwardText);
        }

    } catch (e) {
        console.error('[support] processUpdate ошибка:', e.message);
    }
}

/* ─── Startup ───────────────────────────────────────────── */
function startSupportBot() {
    if (!TOKEN) {
        console.log('[support] SUPPORT_BOT_TOKEN не задан — бот поддержки не запущен');
        return;
    }
    console.log('[support] Бот поддержки запущен, регистрирует webhook...');
    registerWebhook();
}

module.exports = { startSupportBot, processUpdate };
