/* Проверка фикса аудита безопасности, находка D (~/security-audit.md):
   /api/users/map и /api/users/chat раньше принимали запросы без
   какой-либо проверки, что вызов пришёл от самого бота, а не от любого
   клиента из интернета — например, GET /api/users/chat?user_id=...
   отдавало chat_id ЛЮБОГО пользователя кому угодно. Теперь оба
   защищены requireInternal (server/middleware/requireInternal.js) —
   заголовок X-Internal-Secret, сравнение через SHA-256 + timingSafeEqual.

   /api/support/admin-map, /api/support/admins, /api/support/known были
   защищены тем же способом, но удалены целиком — grep по всему
   репозиторию не нашёл ни одного вызывающего места (bot-support.js
   пишет в support_admins/support_known прямо в БД, не через HTTP) —
   их тесты отсюда убраны вместе с самими роутами.

   Без реального Postgres — db.query/execute подменены на in-memory
   заглушки, та же архитектура, что в остальных test-*.js этого проекта.

   Запуск: node server/scripts/test-internal-routes.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

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
    throw new Error('test-internal-routes: неизвестный execute: ' + sql);
};
db.queryOne = async (sql, params = []) => {
    if (sql.includes('SELECT chat_id FROM user_map')) {
        const row = userMapRows.find(r => r.user_id === String(params[0]));
        return row ? { chat_id: row.chat_id } : null;
    }
    throw new Error('test-internal-routes: неизвестный queryOne: ' + sql);
};

const usersRouter = require('../routes/users');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const routes = [
        ['POST', '/api/users/map',          { userId: 999, chatId: 9999 }],
        ['GET',  '/api/users/chat?user_id=42', null],
    ];

    for (const [method, path, body] of routes) {
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);

        const noSecret = await fetch(`${base}${path}`, opts);
        check(`${method} ${path}: без X-Internal-Secret -> 401`, noSecret.status === 401);

        const wrongSecret = await fetch(`${base}${path}`, {
            ...opts,
            headers: { ...opts.headers, 'X-Internal-Secret': 'wrong-secret' },
        });
        check(`${method} ${path}: с неверным X-Internal-Secret -> 401`, wrongSecret.status === 401);

        const withSecret = await fetch(`${base}${path}`, {
            ...opts,
            headers: { ...opts.headers, 'X-Internal-Secret': INTERNAL_SECRET },
        });
        check(`${method} ${path}: с верным X-Internal-Secret -> не 401`, withSecret.status !== 401);
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
