/* Проверка фикса аудита безопасности, находка A (~/security-audit.md):
   раньше addAdmin(chatId) вызывался из handleStart() на КАЖДЫЙ /start —
   любой написавший боту получал право на /reply и мог слать поддельные
   "ответы поддержки" произвольному chat_id. Список админов бота теперь
   берётся ТОЛЬКО из BOT_ADMIN_IDS (env) — таблица bot_admins больше не
   читается кодом вовсе (не удалена, просто не используется; старые
   строки в ней, если есть, ни на что не влияют).

   Без реальных сетевых запросов к Max — https.request подменён на
   in-memory заглушку, та же архитектура, что в остальных test-*.js
   этого проекта. Postgres не нужен — bot.js больше не требует ../db.

   Запуск: node server/scripts/test-bot-admins.js
*/
process.env.MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || 'test-bot-token';
process.env.WEBHOOK_URL   = process.env.WEBHOOK_URL   || 'https://example.invalid/webhook';
process.env.BOT_ADMIN_IDS = '555';

const path           = require('path');
const { spawnSync }  = require('child_process');
const https          = require('https');

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

    /* ── 0. Без BOT_ADMIN_IDS — console.warn при старте (отдельный
       процесс: предупреждение печатается один раз, при require() модуля,
       а в этом файле BOT_ADMIN_IDS уже задана выше). ────────────────── */
    {
        const botPath = path.join(__dirname, '..', '..', 'bot.js');
        const withoutIds = spawnSync(
            process.execPath, ['-e', `require(${JSON.stringify(botPath)})`],
            { env: { ...process.env, BOT_ADMIN_IDS: '' } }
        );
        check('без BOT_ADMIN_IDS -> console.warn при старте',
            /BOT_ADMIN_IDS не задана/.test(withoutIds.stderr.toString()));

        const withIds = spawnSync(
            process.execPath, ['-e', `require(${JSON.stringify(botPath)})`],
            { env: { ...process.env, BOT_ADMIN_IDS: '555' } }
        );
        check('с заданной BOT_ADMIN_IDS -> нет предупреждения',
            !/BOT_ADMIN_IDS не задана/.test(withIds.stderr.toString()));
    }

    /* ── 1. loadAdmins() — только из BOT_ADMIN_IDS ───────────────────── */
    {
        const admins = await bot.loadAdmins();
        check('loadAdmins() включает ID из BOT_ADMIN_IDS (555)', admins.includes(555));
        check('loadAdmins() не включает посторонних', !admins.includes(999));
    }

    /* ── 2. Обычный /start не делает отправителя админом ─────────────── */
    {
        await bot.processUpdate({
            update_type: 'bot_started',
            chat_id: 999,
            user: { name: 'Случайный покупатель' },
        });
        const admins = await bot.loadAdmins();
        check('после /start посторонний (999) всё равно не админ', !admins.includes(999));
    }

    /* То же через текстовое сообщение "/start" (второй путь в processUpdate,
       см. message_created -> text === '/start'). */
    {
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 888, name: 'Ещё один покупатель' },
                recipient: { chat_id: 888 },
                body:      { text: '/start' },
            },
        });
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

    /* ── 4. /reply от админа из BOT_ADMIN_IDS (555) -> сообщение отправлено ── */
    {
        sentMessages.length = 0;
        await bot.processUpdate({
            update_type: 'message_created',
            message: {
                sender:    { user_id: 555, name: 'Менеджер' },
                recipient: { chat_id: 555 },
                body:      { text: '/reply 12345 Здравствуйте, чем помочь?' },
            },
        });
        await flush();
        check('/reply от админа из BOT_ADMIN_IDS (555) -> сообщение дошло жертве (12345)',
            sentMessages.some(m => m.chatId === '12345'));
    }

    /* ── 5. Проверка прав — именно по sender.user_id, не по recipient.chat_id ──
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

    /* ── 6. /myid отвечает и user_id, и chat_id отдельно ─────────────── */
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
