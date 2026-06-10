'use strict';

/* Telegram-бот для группового обсуждения бизнес-вопросов командой агентов
   ("Точка Монтажа"). Слушает сообщения вида "/ask <вопрос>" в группе и
   последовательно публикует ответы агентов: оркестратор → аналитик →
   маркетолог → ассортиментщик → взаимная проверка → критик (финал). */

const db      = require('../server/db');
const PROMPTS = require('../agents/prompts');

const BOT_TOKEN       = process.env.AGENT_BOT_TOKEN;
const GROUP_CHAT_ID   = process.env.AGENT_GROUP_CHAT_ID;
const OPENROUTER_KEY  = process.env.OPENROUTER_API_KEY;
const CLAUDE_MODEL    = 'anthropic/claude-sonnet-4-6';
const TELEGRAM_LIMIT  = 4096;

const AGENT_LABELS = {
    orchestrator: 'Оркестратор',
    analyst:      'Аналитик',
    marketer:     'Маркетолог',
    assortment:   'Ассортиментщик',
    critic:       'Критик',
};

/* ---------- Telegram Bot API (long polling, raw fetch) ---------- */

async function tg(method, params) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params || {}),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
}

function splitMessage(text, limit) {
    const parts = [];
    let rest = String(text || '');
    while (rest.length > limit) {
        let cut = rest.lastIndexOf('\n', limit);
        if (cut <= 0) cut = limit;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest) parts.push(rest);
    return parts;
}

async function sendToGroup(text) {
    for (const chunk of splitMessage(text, TELEGRAM_LIMIT)) {
        await tg('sendMessage', { chat_id: GROUP_CHAT_ID, text: chunk });
    }
}

/* ---------- Claude API (raw fetch) ---------- */

async function callClaude(systemPrompt, userMessage) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type':  'application/json',
            'HTTP-Referer':  'https://pitasovmaks-art-max-shop-c149.twc1.net',
            'X-Title':       'Точка Монтажа Агенты',
        },
        body: JSON.stringify({
            model:      CLAUDE_MODEL,
            max_tokens: 2000,
            messages:   [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userMessage },
            ],
        }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Claude API ${res.status}: ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const choice = (data.choices || [])[0];
    return ((choice && choice.message && choice.message.content) || '').trim();
}

/* ---------- Контекст из PostgreSQL для промптов ---------- */

async function getProductsContext() {
    try {
        const rows = await db.query(
            `SELECT article, name, sku FROM ozon_products ORDER BY updated_at DESC LIMIT 50`
        );
        if (!rows.length) return 'Список товаров пуст.';
        const lines = rows.map(r => `- ${r.article || '—'} | ${r.name || '—'} | sku ${r.sku || '—'}`);
        return `Товары магазина (последние ${rows.length}):\n${lines.join('\n')}`;
    } catch (e) {
        return `(не удалось получить список товаров: ${e.message})`;
    }
}

async function getCompetitorsContext() {
    try {
        const rows = await db.query(`
            SELECT product_name, seller, brand, category, price, orders, revenue
            FROM ozon_competitors
            WHERE period_date = (SELECT MAX(period_date) FROM ozon_competitors)
            ORDER BY revenue DESC NULLS LAST
            LIMIT 10
        `);
        if (!rows.length) return 'Данных о конкурентах нет.';
        const lines = rows.map((r, i) =>
            `${i + 1}. ${r.product_name || '—'} (${r.seller || '—'}, бренд ${r.brand || '—'}, ` +
            `категория ${r.category || '—'}) — цена ${r.price ?? '—'}₽, заказов ${r.orders ?? '—'}, ` +
            `выручка ${r.revenue ?? '—'}₽`
        );
        return `Топ-10 конкурентов по выручке за последний период:\n${lines.join('\n')}`;
    } catch (e) {
        return `(не удалось получить данные о конкурентах: ${e.message})`;
    }
}

async function getCostsContext() {
    try {
        const rows = await db.query(
            `SELECT article, name, cost_price FROM product_costs ORDER BY updated_at DESC LIMIT 30`
        );
        if (!rows.length) return 'Себестоимость по товарам не загружена.';
        const lines = rows.map(r => `- ${r.article || '—'} | ${r.name || '—'} | себестоимость ${r.cost_price ?? '—'}₽`);
        return `Себестоимость товаров (последние ${rows.length}):\n${lines.join('\n')}`;
    } catch (e) {
        return `(не удалось получить себестоимость: ${e.message})`;
    }
}

async function getUnitEconomicsContext() {
    try {
        const rows = await db.query(`
            SELECT article, name, scheme, cost_price, revenue, profit, margin
            FROM unit_economics
            ORDER BY uploaded_at DESC
            LIMIT 20
        `);
        if (!rows.length) return 'Данных по юнит-экономике нет.';
        const lines = rows.map(r =>
            `- ${r.article || '—'} | ${r.name || '—'} (${r.scheme || '—'}) — себестоимость ${r.cost_price ?? '—'}₽, ` +
            `выручка ${r.revenue ?? '—'}₽, прибыль ${r.profit ?? '—'}₽, маржа ${r.margin ?? '—'}%`
        );
        return `Последние данные по юнит-экономике (${rows.length}):\n${lines.join('\n')}`;
    } catch (e) {
        return `(не удалось получить юнит-экономику: ${e.message})`;
    }
}

async function getDataContext() {
    const [competitors, costs, unitEconomics] = await Promise.all([
        getCompetitorsContext(),
        getCostsContext(),
        getUnitEconomicsContext(),
    ]);
    return `--- Конкуренты ---\n${competitors}\n\n--- Себестоимость ---\n${costs}\n\n--- Юнит-экономика ---\n${unitEconomics}`;
}

/* ---------- Хранение сессий и ответов ---------- */

async function ensureSchema() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS agent_sessions (
            id          SERIAL PRIMARY KEY,
            chat_id     TEXT NOT NULL,
            question    TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'running',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at TIMESTAMPTZ
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS agent_responses (
            id          SERIAL PRIMARY KEY,
            session_id  INTEGER NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
            agent_name  TEXT NOT NULL,
            step        TEXT NOT NULL,
            content     TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function createSession(question) {
    const row = await db.queryOne(
        `INSERT INTO agent_sessions (chat_id, question, status) VALUES ($1, $2, 'running') RETURNING id`,
        [String(GROUP_CHAT_ID), question]
    );
    return row.id;
}

async function saveResponse(sessionId, agentName, step, content) {
    await db.execute(
        `INSERT INTO agent_responses (session_id, agent_name, step, content) VALUES ($1, $2, $3, $4)`,
        [sessionId, agentName, step, content]
    );
}

/* ---------- Запуск одного агента с обработкой ошибок ---------- */

async function runAgent(sessionId, agentKey, step, systemPrompt, userMessage) {
    try {
        const answer = await callClaude(systemPrompt, userMessage);
        await saveResponse(sessionId, agentKey, step, answer);
        return answer;
    } catch (e) {
        const label = AGENT_LABELS[agentKey] || agentKey;
        await saveResponse(sessionId, agentKey, step, `[ОШИБКА] ${e.message}`).catch(() => {});
        await sendToGroup(`⚠️ Ошибка агента [${label}]: ${e.message}`).catch(() => {});
        throw e;
    }
}

/* ---------- Основной сценарий обсуждения ---------- */

async function runDiscussion(question) {
    const sessionId = await createSession(question);

    try {
        const productsContext = await getProductsContext();

        await sendToGroup('🎯 Оркестратор разбивает задачу...');
        const orchestratorAnswer = await runAgent(
            sessionId, 'orchestrator', 'Разбивка задачи',
            `${PROMPTS.orchestrator}\n\n--- Товары магазина ---\n${productsContext}`,
            `Вопрос пользователя: ${question}`
        );
        await sendToGroup(orchestratorAnswer);

        await sendToGroup('📊 Аналитик изучает данные...');
        const dataContext = await getDataContext();
        const analystAnswer = await runAgent(
            sessionId, 'analyst', 'Анализ данных',
            `${PROMPTS.analyst}\n\n${dataContext}\n\n--- Товары магазина ---\n${productsContext}`,
            `Вопрос пользователя: ${question}\n\nЗадача от оркестратора:\n${orchestratorAnswer}`
        );
        await sendToGroup(analystAnswer);

        await sendToGroup('📣 Маркетолог читает аналитика...');
        const marketerAnswer = await runAgent(
            sessionId, 'marketer', 'Маркетинговая оценка',
            `${PROMPTS.marketer}\n\n--- Товары магазина ---\n${productsContext}`,
            `Вопрос пользователя: ${question}\n\nОтвет аналитика:\n${analystAnswer}`
        );
        await sendToGroup(marketerAnswer);

        await sendToGroup('🛒 Ассортиментщик анализирует...');
        const assortmentAnswer = await runAgent(
            sessionId, 'assortment', 'Оценка ассортимента',
            `${PROMPTS.assortment}\n\n${dataContext}\n\n--- Товары магазина ---\n${productsContext}`,
            `Вопрос пользователя: ${question}\n\nОтвет аналитика:\n${analystAnswer}\n\nОтвет маркетолога:\n${marketerAnswer}`
        );
        await sendToGroup(assortmentAnswer);

        await sendToGroup('🔄 Агенты проверяют друг друга...');
        const peers = [
            { key: 'analyst',    prompt: PROMPTS.analyst,    answer: analystAnswer },
            { key: 'marketer',   prompt: PROMPTS.marketer,   answer: marketerAnswer },
            { key: 'assortment', prompt: PROMPTS.assortment, answer: assortmentAnswer },
        ];
        const reviews = [];
        for (const agent of peers) {
            const others = peers
                .filter(p => p.key !== agent.key)
                .map(p => `${AGENT_LABELS[p.key]}:\n${p.answer}`)
                .join('\n\n');
            const reviewPrompt =
                `${agent.prompt}\n\nТеперь проверь ответы коллег по обсуждению. Прочитай их и, если у ` +
                `тебя есть замечания или ты хочешь скорректировать свой ответ с учётом их мнения — ` +
                `напиши краткую корректировку. Если замечаний нет и ты согласен с коллегами — ` +
                `ответь ровно "✓ Подтверждаю" и больше ничего.`;
            const reviewAnswer = await runAgent(
                sessionId, agent.key, 'Взаимная проверка', reviewPrompt,
                `Вопрос пользователя: ${question}\n\nТвой предыдущий ответ:\n${agent.answer}\n\n` +
                `Ответы коллег:\n${others}`
            );
            reviews.push({ key: agent.key, answer: reviewAnswer });
            await sendToGroup(`${AGENT_LABELS[agent.key]}:\n${reviewAnswer}`);
        }

        await sendToGroup('✅ Критик формирует финальный ответ...');
        const fullDiscussion =
            `Вопрос пользователя: ${question}\n\n` +
            `Разбивка оркестратора:\n${orchestratorAnswer}\n\n` +
            `Ответ аналитика:\n${analystAnswer}\n\n` +
            `Ответ маркетолога:\n${marketerAnswer}\n\n` +
            `Ответ ассортиментщика:\n${assortmentAnswer}\n\n` +
            `Корректировки после взаимной проверки:\n` +
            reviews.map(r => `${AGENT_LABELS[r.key]}: ${r.answer}`).join('\n');
        const finalAnswer = await runAgent(sessionId, 'critic', 'Финальный ответ', PROMPTS.critic, fullDiscussion);
        await sendToGroup(finalAnswer);

        await db.execute(`UPDATE agent_sessions SET status = 'done', finished_at = NOW() WHERE id = $1`, [sessionId]);
    } catch (e) {
        await db.execute(`UPDATE agent_sessions SET status = 'error', finished_at = NOW() WHERE id = $1`, [sessionId]).catch(() => {});
        console.error('[agentBot] runDiscussion error:', e.message);
    }
}

/* ---------- Long polling Telegram ---------- */

let pollOffset         = 0;
let polling            = false;
let consecutiveErrors  = 0;
let lastErrorLogTime   = 0;

const POLL_ERROR_DELAY      = 30_000;       // 30 с между попытками при ошибке
const POLL_PAUSE_DELAY      = 5 * 60_000;   // 5 мин пауза после 3 ошибок подряд
const MAX_CONSECUTIVE_ERRORS = 3;
const ERROR_LOG_INTERVAL    = 5 * 60_000;   // логировать не чаще раза в 5 мин

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollLoop() {
    polling = true;
    while (polling) {
        try {
            const updates = await tg('getUpdates', { offset: pollOffset, timeout: 30 });
            consecutiveErrors = 0;
            for (const update of updates) {
                pollOffset = update.update_id + 1;
                const msg = update.message;
                if (!msg || !msg.text) continue;
                if (String(msg.chat && msg.chat.id) !== String(GROUP_CHAT_ID)) continue;

                const text = msg.text.trim();
                if (!text.startsWith('/ask')) continue;

                const question = text.slice(4).trim();
                if (!question) continue;

                runDiscussion(question).catch(e => console.error('[agentBot] runDiscussion error:', e.message));
            }
        } catch (e) {
            consecutiveErrors++;
            const now = Date.now();
            if (now - lastErrorLogTime >= ERROR_LOG_INTERVAL) {
                console.error('[agentBot] poll error:', e.message);
                lastErrorLogTime = now;
            }
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                consecutiveErrors = 0;
                await sleep(POLL_PAUSE_DELAY);
            } else {
                await sleep(POLL_ERROR_DELAY);
            }
        }
    }
}

/* ---------- Запуск ---------- */

function start() {
    if (!BOT_TOKEN || !GROUP_CHAT_ID || !OPENROUTER_KEY) {
        console.log('[agentBot] не запущен: не заданы AGENT_BOT_TOKEN / AGENT_GROUP_CHAT_ID / OPENROUTER_API_KEY');
        return;
    }

    ensureSchema()
        .then(() => {
            console.log('[agentBot] таблицы agent_sessions/agent_responses готовы, запускаю long polling');
            pollLoop();
        })
        .catch(e => console.error('[agentBot] ensureSchema error:', e.message));
}

module.exports = { start, runDiscussion };
