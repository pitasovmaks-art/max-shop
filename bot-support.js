/* ─────────────────────────────────────────────────────────
   Max Messenger Support Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_BASE       = 'platform-api.max.ru';
const TOKEN          = process.env.SUPPORT_BOT_TOKEN || '';
const WEBHOOK_BASE   = (process.env.WEBHOOK_URL || 'https://pitasovmaks-art-max-shop-c149.twc1.net/webhook').replace('/webhook', '');
const WEBHOOK_URL    = `${WEBHOOK_BASE}/webhook-support`;
const KNOWN_FILE     = path.join(__dirname, 'bot_support_known_users.json');

const SUPPORT_ADMINS = [315827109, 392912448];

/* ─── Known users (first-message detection) ─────────────── */
function loadKnown() {
    try { return JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')); }
    catch { return []; }
}

function isKnown(chatId) {
    return loadKnown().includes(chatId);
}

function markKnown(chatId) {
    const ids = loadKnown();
    if (!ids.includes(chatId)) {
        ids.push(chatId);
        fs.writeFileSync(KNOWN_FILE, JSON.stringify(ids));
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
function sendMessage(chatId, text) {
    return request('POST', 'messages', { text, format: 'markdown' }, { chat_id: chatId });
}

/* ─── Save userId → chatId mapping ─────────────────────── */
function saveUserMap(userId, chatId) {
    const base = WEBHOOK_BASE || 'http://localhost:3000';
    fetch(`${base}/api/users/support-map`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, chatId }),
    }).catch(e => console.error('[support] user_map save error:', e.message));
}

/* ─── Process one update ────────────────────────────────── */
async function processUpdate(update) {
    const type = update.update_type;

    if (type === 'bot_started') {
        const chatId = update.chat_id;
        console.log('[support] bot_started: chatId=', chatId);
        const firstTime = !isKnown(chatId);
        markKnown(chatId);
        if (firstTime) {
            await sendMessage(chatId, '👋 Здравствуйте! Это бот поддержки магазина Точка Монтажа.\n\nОпишите вашу проблему или вопрос, и наши менеджеры свяжутся с вами в ближайшее время.');
        }
        return;
    }

    if (type === 'message_created') {
        const msg        = update.message;
        const text       = msg?.body?.text || '';
        const chatId     = msg?.recipient?.chat_id ?? msg?.sender?.user_id;
        const userId     = msg?.sender?.user_id;
        const senderName = msg?.sender?.name || 'Пользователь';

        if (!chatId) return;
        if (msg?.sender?.is_bot) return;

        // Сохраняем маппинг
        if (userId && chatId && userId !== chatId) {
            saveUserMap(userId, chatId);
        }

        const isAdmin = SUPPORT_ADMINS.includes(chatId);

        // /reply ID текст — только для админов
        if (text.startsWith('/reply ')) {
            if (!isAdmin) return;
            const parts     = text.split(' ');
            const targetId  = Number(parts[1]);
            const replyText = parts.slice(2).join(' ');
            if (!targetId || !replyText) {
                await sendMessage(chatId, 'Формат: /reply ID текст');
                return;
            }
            try {
                await sendMessage(targetId, `💬 *Ответ от поддержки Точки Монтажа:*\n${replyText}`);
                await sendMessage(chatId, '✅ Ответ отправлен');
            } catch (e) {
                console.error('[support] reply error:', e.message);
                await sendMessage(chatId, `❌ Не удалось отправить: ${e.message}`);
            }
            return;
        }

        // /myid
        if (text.trim().toLowerCase() === '/myid') {
            await sendMessage(chatId, `Ваш ID: ${chatId}`);
            return;
        }

        if (!isAdmin) {
            const firstTime = !isKnown(chatId);
            markKnown(chatId);

            try {
                if (firstTime) {
                    await sendMessage(chatId, '👋 Здравствуйте! Это бот поддержки магазина Точка Монтажа.\n\nОпишите вашу проблему или вопрос, и наши менеджеры свяжутся с вами в ближайшее время.');
                } else {
                    await sendMessage(chatId, '✅ Спасибо за обращение! Ваш вопрос передан менеджерам. Мы ответим в ближайшее время.');
                }
            } catch (e) {
                console.error('[support] reply error:', e.message);
            }

            // Пересылаем менеджерам
            for (const adminId of SUPPORT_ADMINS) {
                if (adminId === chatId) continue;
                try {
                    await sendMessage(
                        adminId,
                        `💬 *Поддержка*\n👤 От: ${senderName}\n🆔 ID: ${chatId}\n📝 Сообщение:\n${text}\n\nОтветить: /reply ${chatId} ваш ответ`
                    );
                } catch (e) {
                    console.error(`[support] forward to ${adminId} error:`, e.message);
                }
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

/* ─── Start ─────────────────────────────────────────────── */
function startSupportBot() {
    if (!TOKEN) {
        console.log('[support] SUPPORT_BOT_TOKEN не задан — бот поддержки не запущен');
        return;
    }
    console.log('[support] Бот поддержки запущен, регистрирует webhook...');
    registerWebhook();
}

module.exports = { startSupportBot, processUpdate };
