/* Проверка фикса аудита безопасности, находка A (~/security-audit.md):
   раньше addAdmin(chatId) вызывался из handleStart() на КАЖДЫЙ /start —
   любой написавший боту получал право на /reply и мог слать поддельные
   "ответы поддержки" произвольному chat_id. Теперь список админов бота
   берётся ТОЛЬКО из BOT_ADMIN_IDS (env) и из таблицы bot_admins, которая
   больше не пополняется автоматически.

   Без реального Postgres и без реальных сетевых запросов к Max — db и
   https.request подменены на in-memory заглушки, та же архитектура, что
   в остальных test-*.js этого проекта.

   Запуск: node server/scripts/test-bot-admins.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';

process.env.MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || 'test-bot-token';
process.env.WEBHOOK_URL   = process.env.WEBHOOK_URL   || 'https://example.invalid/webhook';
process.env.BOT_ADMIN_IDS = '555';

const https = require('https');
const db    = require('../db');

/* ─── db stub: bot_admins уже содержит одну "легаси" строку (777) —
   проверяем, что таблицу не чистили, но и новые строки в неё не
   добавляются (insertCalls остаётся пустым после любых /start). ────── */
let botAdminsRows = [{ chat_id: '777' }];
const insertCalls = [];

db.query = async (sql) => {
    if (sql.trim().startsWith('SELECT chat_id FROM bot_admins')) return botAdminsRows;
    throw new Error('test-bot-admins: неизвестный query: ' + sql);
};
db.execute = async (sql, params = []) => {
    if (sql.includes('INSERT INTO bot_admins')) {
        insertCalls.push(params);
        return 1;
    }
    throw new Error('test-bot-admins: неизвестный execute: ' + sql);
};

/* ─── https.request stub: не делаем реальных запросов к Max, просто
   записываем каждое отправленное sendMessage(chatId, text). ─────────── */
const sentMessages = []; // { chatId, text }
https.request = (opts, callback) => {
    const qs = (opts.path.split('?')[1]) || '';
    const chatId = new URLSearchParams(qs).get('chat_id');
    let bodyStr = '';
    const fakeReq = {
        on() { return fakeReq; },
        write(chunk) { bodyStr += chunk; },
        setTimeout() { return fakeReq; },
        end() {
            let text;
            try { text = JSON.parse(bodyStr || '{}').text; } catch { text = undefined; }
            if (opts.path.startsWith('/messages')) sentMessages.push({ chatId, text });
            const fakeRes = {
                statusCode: 200,
                on(event, cb) {
                    if (event === 'data') cb(Buffer.from(JSON.stringify({ ok: true })));
                    if (event === 'end') cb();
                    return fakeRes;
                },
            };
            callback(fakeRes);
        },
    };
    return fakeReq;
};

const bot = require('../../bot');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }
    async function flush() { await new Promise(r => setTimeout(r, 10)); }

    /* ── 1. loadAdmins() объединяет env (555) и таблицу (777) ───────── */
    {
        const admins = await bot.loadAdmins();
        check('loadAdmins() включает ID из BOT_ADMIN_IDS (555)', admins.includes(555));
        check('loadAdmins() включает ID из таблицы bot_admins (777)', admins.includes(777));
        check('loadAdmins() не включает посторонних', !admins.includes(999));
    }

    /* ── 2. Обычный /start НЕ добавляет отправителя в bot_admins ────── */
    {
        insertCalls.length = 0;
        await bot.processUpdate({
            update_type: 'bot_started',
            chat_id: 999,
            user: { name: 'Случайный покупатель' },
        });
        check('bot_started от нового пользователя -> нет INSERT в bot_admins', insertCalls.length === 0);

        const admins = await bot.loadAdmins();
        check('после /start посторонний (999) всё равно не админ', !admins.includes(999));
    }

    /* То же через текстовое сообщение "/start" (второй путь в processUpdate,
       см. message_created -> text === '/start'). */
    {
        insertCalls.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 888, name: 'Ещё один покупатель' },
                recipient: { chat_id: 888 },
                body:      { text: '/start' },
            },
        });
        check('текстовый /start -> нет INSERT в bot_admins', insertCalls.length === 0);
        check('после текстового /start посторонний (888) всё равно не админ', !(await bot.loadAdmins()).includes(888));
    }

    /* ── 3. /reply от постороннего (не админ) -> сообщение НЕ отправлено ── */
    {
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 999, name: 'Самозванец' },
                recipient: { chat_id: 999 },
                body:      { text: '/reply 12345 Поддельный ответ от "поддержки"' },
            },
        });
        await flush();
        check('/reply от постороннего (999) -> ничего не отправлено жертве (12345)',
            !sentMessages.some(m => m.chatId === '12345'));
    }

    /* ── 4. /reply от админа из env (555) -> сообщение отправлено ───── */
    {
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 555, name: 'Менеджер (env)' },
                recipient: { chat_id: 555 },
                body:      { text: '/reply 12345 Здравствуйте, чем помочь?' },
            },
        });
        await flush();
        check('/reply от админа из BOT_ADMIN_IDS (555) -> сообщение дошло жертве (12345)',
            sentMessages.some(m => m.chatId === '12345'));
    }

    /* ── 5. /reply от "легаси" админа из таблицы bot_admins (777) -> тоже работает ── */
    {
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 777, name: 'Менеджер (таблица)' },
                recipient: { chat_id: 777 },
                body:      { text: '/reply 12345 Второй ответ' },
            },
        });
        await flush();
        check('/reply от админа из таблицы bot_admins (777) -> сообщение дошло жертве (12345)',
            sentMessages.some(m => m.chatId === '12345'));
    }

    /* ── 6. Проверка прав — именно по sender.user_id, не по recipient.chat_id ──
       Раньше (до этой правки) проверка шла по chatId
       (recipient.chat_id ?? sender.user_id), что в теории позволяло бы
       подделать recipient.chat_id под чужой/админский, не будучи этим
       отправителем. Ниже user_id и chat_id у сообщения РАЗНЫЕ —
       результат должен зависеть только от user_id. ──────────────────── */
    {
        // user_id НЕ админ (111), chat_id ПОДМЕНЁН под админский (555) —
        // /reply не должен сработать, если проверка по chatId всё ещё
        // где-то осталась.
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 111, name: 'Не админ с чужим chat_id' },
                recipient: { chat_id: 555 }, // подменённый chat_id админа
                body:      { text: '/reply 12345 Попытка через подменённый chat_id' },
            },
        });
        await flush();
        check('/reply: user_id (111) не админ, несмотря на chat_id=555 (админский) -> не сработал',
            !sentMessages.some(m => m.chatId === '12345'));
    }
    {
        // user_id — админ (555), chat_id — ПРОИЗВОЛЬНЫЙ, не совпадающий
        // с админским (4242) — /reply ДОЛЖЕН сработать, раз проверка по
        // user_id, а не по chatId.
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 555, name: 'Админ из другого чата' },
                recipient: { chat_id: 4242 }, // НЕ входит в admins
                body:      { text: '/reply 12345 Ответ через нестандартный chat_id' },
            },
        });
        await flush();
        check('/reply: user_id (555) админ, несмотря на chat_id=4242 (не админский) -> сработал',
            sentMessages.some(m => m.chatId === '12345'));
    }

    /* ── 7. /myid отвечает и user_id, и chat_id отдельно ─────────────── */
    {
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 4001, name: 'Любопытный' },
                recipient: { chat_id: 4002 }, // намеренно другое значение
                body:      { text: '/myid' },
            },
        });
        await flush();
        const reply = sentMessages.find(m => m.chatId === '4002');
        check('/myid: ответ содержит user_id', !!reply && reply.text.includes('4001'));
        check('/myid: ответ содержит chat_id', !!reply && reply.text.includes('4002'));
        check('/myid: user_id и chat_id подписаны разными метками (не перепутать)',
            !!reply && /user_id/i.test(reply.text) && /chat_id/i.test(reply.text));
    }

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
