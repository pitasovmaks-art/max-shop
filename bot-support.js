/* ─────────────────────────────────────────────────────────
   Max Messenger Support Bot — Точка Монтажа
   ───────────────────────────────────────────────────────── */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_BASE              = 'platform-api.max.ru';
const TOKEN                 = process.env.SUPPORT_BOT_TOKEN || '';
const WEBHOOK_BASE          = (process.env.WEBHOOK_URL || 'https://pitasovmaks-art-max-shop-c149.twc1.net/webhook').replace('/webhook', '');
const SUPPORT_WEBHOOK_URL   = WEBHOOK_BASE + '/webhook-support';
const SUPPORT_ADMIN_USER_IDS = [5149723, 100067838];   // user_id одинаков у обоих ботов
const KNOWN_FILE            = path.join(__dirname, 'bot_support_known_users.json');
const ADMIN_MAP_FILE        = path.join(__dirname, 'bot_support_admins.json');

/* ─── Known users ───────────────────────────────────────── */
function loadKnown() {
    try {
        if (!fs.existsSync(KNOWN_FILE)) return [];
        return JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveKnown(ids) {
    try { fs.writeFileSync(KNOWN_FILE, JSON.stringify(ids)); } catch (e) {}
}

/* ─── Admin map: { userId: chatId } ────────────────────── */
function loadAdminMap() {
    try {
        if (!fs.existsSync(ADMIN_MAP_FILE)) return {};
        return JSON.parse(fs.readFileSync(ADMIN_MAP_FILE, 'utf8'));
    } catch (e) { return {}; }
}

function saveAdminMap(map) {
    try { fs.writeFileSync(ADMIN_MAP_FILE, JSON.stringify(map)); } catch (e) {}
}

/* ─── HTTP helper ───────────────────────────────────────── */
function request(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: API_BASE,
            path:     endpoint,
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
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
                } else {
                    try { resolve(JSON.parse(raw)); }
                    catch { resolve(raw); }
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

/* ─── Send message ──────────────────────────────────────── */
function sendMessage(chatId, text) {
    return request('POST', '/messages', {
        recipient: { chat_id: chatId },
        body:      { type: 'text', text },
    }).catch(e => {
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

            // Если это менеджер — сохранить его chatId в этом боте
            if (userId && SUPPORT_ADMIN_USER_IDS.includes(userId)) {
                const map = loadAdminMap();
                if (map[userId] !== chatId) {
                    map[userId] = chatId;
                    saveAdminMap(map);
                    console.log(`[support] Менеджер зарегистрирован: userId=${userId} chatId=${chatId}`);
                }
                await sendMessage(chatId, '✅ Вы зарегистрированы как менеджер поддержки. Клиентские обращения будут приходить сюда.');
                return;
            }

            await sendMessage(chatId,
                '👋 Здравствуйте! Это служба поддержки магазина Точка Монтажа.\n\n' +
                'Опишите ваш вопрос или проблему, и наши менеджеры свяжутся с вами в ближайшее время.'
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
        if (msg.sender?.is_bot) return;

        /* ── Любое сообщение от менеджера — обновить маппинг ── */
        if (userId && SUPPORT_ADMIN_USER_IDS.includes(userId)) {
            const map = loadAdminMap();
            if (map[userId] !== chatId) {
                map[userId] = chatId;
                saveAdminMap(map);
                console.log(`[support] Менеджер обновил chatId: userId=${userId} chatId=${chatId}`);
            }

            /* ── /reply <client_chat_id> <текст> ── */
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
        const known   = loadKnown();
        const isFirst = !known.includes(chatId);

        if (isFirst) {
            await sendMessage(chatId,
                '👋 Здравствуйте! Это служба поддержки магазина Точка Монтажа.\n\n' +
                'Опишите ваш вопрос или проблему, и наши менеджеры свяжутся с вами в ближайшее время.'
            );
            saveKnown([...known, chatId]);
        } else {
            await sendMessage(chatId,
                '✅ Спасибо за обращение! Ваш вопрос передан менеджерам. Мы ответим в ближайшее время.'
            );
        }

        /* ── Переслать менеджерам чьи chatId уже известны ── */
        const adminMap    = loadAdminMap();
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
