/* Проверка фикса аудита безопасности, находка D (~/security-audit.md):
   /api/users/map, /api/users/chat, /api/support/admin-map,
   /api/support/admins, /api/support/known раньше принимали запросы без
   какой-либо проверки, что вызов пришёл от самого бота, а не от любого
   клиента из интернета — например, GET /api/users/chat?user_id=...
   отдавало chat_id ЛЮБОГО пользователя кому угодно. Теперь все пять
   защищены requireInternal (server/middleware/auth.js) — заголовок
   X-Internal-Secret, сравнение timing-safe с INTERNAL_API_SECRET.

   Без реального Postgres — db.query/execute подменены на in-memory
   заглушки, та же архитектура, что в остальных test-*.js этого проекта.

   Запуск: node server/scripts/test-internal-routes.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const INTERNAL_SECRET = 'test-internal-secret';
process.env.INTERNAL_API_SECRET = INTERNAL_SECRET;

const express = require('express');
const db      = require('../db');

let userMapRows = [{ user_id: '42', chat_id: '4242' }];
db.execute = async (sql, params = []) => {
    if (sql.includes('INSERT INTO user_map')) {
        const [userId, chatId] = params;
        const row = userMapRows.find(r => r.user_id === userId);
        if (row) row.chat_id = chatId; else userMapRows.push({ user_id: userId, chat_id: chatId });
        return 1;
    }
    if (sql.includes('INSERT INTO support_admins') || sql.includes('INSERT INTO support_known')) {
        return 1;
    }
    throw new Error('test-internal-routes: неизвестный execute: ' + sql);
};
db.queryOne = async (sql, params = []) => {
    if (sql.includes('SELECT chat_id FROM user_map')) {
        const row = userMapRows.find(r => r.user_id === String(params[0]));
        return row ? { chat_id: row.chat_id } : null;
    }
    throw new Error('test-internal-routes: неизвестный queryOne: ' + sql);
};
db.query = async (sql) => {
    if (sql.includes('SELECT user_id, chat_id FROM support_admins')) return [];
    throw new Error('test-internal-routes: неизвестный query: ' + sql);
};

const usersRouter   = require('../routes/users');
const supportRouter = require('../routes/support');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
    app.use('/api/support', supportRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const routes = [
        ['POST', '/api/users/map',          { userId: 999, chatId: 9999 }],
        ['GET',  '/api/users/chat?user_id=42', null],
        ['POST', '/api/support/admin-map',  { userId: 1, chatId: 1 }],
        ['GET',  '/api/support/admins',     null],
        ['POST', '/api/support/known',      { chatId: 1 }],
    ];

    for (const [method, path, body] of routes) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);

        const noSecret = await fetch(`${base}${path}`, opts);
        check(`${method} ${path}: без X-Internal-Secret -> 403`, noSecret.status === 403);

        const wrongSecret = await fetch(`${base}${path}`, {
            ...opts,
            headers: { ...opts.headers, 'X-Internal-Secret': 'wrong-secret' },
        });
        check(`${method} ${path}: с неверным X-Internal-Secret -> 403`, wrongSecret.status === 403);

        const withSecret = await fetch(`${base}${path}`, {
            ...opts,
            headers: { ...opts.headers, 'X-Internal-Secret': INTERNAL_SECRET },
        });
        check(`${method} ${path}: с верным X-Internal-Secret -> не 403`, withSecret.status !== 403);
    }

    /* ── GET /api/users/chat?user_id= раньше отдавало chat_id любого
       пользователя кому угодно без секрета — явно проверяем, что без
       секрета тело ответа вообще не содержит chat_id. ──────────────── */
    {
        const r = await fetch(`${base}/api/users/chat?user_id=42`);
        const body = await r.json().catch(() => ({}));
        check('GET /api/users/chat без секрета: ответ не содержит chatId жертвы', body.chatId === undefined);
    }
    {
        const r = await fetch(`${base}/api/users/chat?user_id=42`, { headers: { 'X-Internal-Secret': INTERNAL_SECRET } });
        const body = await r.json().catch(() => ({}));
        check('GET /api/users/chat с верным секретом: возвращает chatId', body.chatId === '4242');
    }

    server.close();

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
