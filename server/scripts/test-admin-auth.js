/* Проверка фикса аудита безопасности, находка C (~/security-audit.md):
   server/middleware/auth.js и server/routes/auth.js.
   1. Без ADMIN_PASSWORD в env приложение не запускается (было: дефолт
      '1608').
   2. requireAdmin больше не сравнивает Bearer-токен с самим паролем —
      токен выдаёт issueAdminToken() (случайные 32 байта), со сроком
      жизни, и сравнение пароля — через crypto.timingSafeEqual.
   3. POST /api/auth/login ограничен по попыткам (на IP и общий счётчик)
      и не логирует сам пароль при неудаче.

   Без реального Postgres — требуются только middleware/auth.js и
   routes/auth.js, которые сами БД не трогают.

   Запуск: node server/scripts/test-admin-auth.js
*/
const path          = require('path');
const { spawnSync } = require('child_process');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    /* ── 0. Без ADMIN_PASSWORD процесс не запускается ────────────────
       Отдельный child-процесс: require('../middleware/auth') бросает
       исключение синхронно при загрузке модуля — проверяем именно это,
       не трогая ADMIN_PASSWORD в текущем процессе (он нужен ниже). ── */
    {
        const authPath = path.join(__dirname, '..', 'middleware', 'auth.js');
        const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(authPath)})`], {
            env: { ...process.env, ADMIN_PASSWORD: '' },
        });
        check('без ADMIN_PASSWORD в env процесс завершается с ошибкой (не запускается)', r.status !== 0);
        check('сообщение об ошибке объясняет, что нужно задать ADMIN_PASSWORD',
            (r.stderr || '').toString().includes('ADMIN_PASSWORD'));
    }

    process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple';
    const {
        requireAdmin, issueAdminToken, verifyAdminPassword,
    } = require('../middleware/auth');
    const express = require('express');

    /* ── 1. verifyAdminPassword() — timing-safe, без утечки через длину ── */
    {
        check('verifyAdminPassword(верный пароль) -> true', verifyAdminPassword('correct-horse-battery-staple') === true);
        check('verifyAdminPassword(неверный, та же длина) -> false', verifyAdminPassword('correct-horse-battery-staplE') === false);
        check('verifyAdminPassword(неверный, другая длина) -> false', verifyAdminPassword('короче') === false);
        check('verifyAdminPassword(не строка) -> false, без исключения', verifyAdminPassword(undefined) === false);
    }

    /* ── 2. issueAdminToken()/requireAdmin — токен не равен паролю ──── */
    {
        const token = issueAdminToken();
        check('issueAdminToken() не возвращает сам пароль', token !== process.env.ADMIN_PASSWORD);
        check('issueAdminToken() возвращает достаточно длинный случайный токен', token.length >= 32);

        const app = express();
        app.get('/admin-only', requireAdmin, (req, res) => res.json({ ok: true }));
        const server = app.listen(0);
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;

        const noAuth = await fetch(`${base}/admin-only`);
        check('requireAdmin: без Authorization -> 401', noAuth.status === 401);

        const garbage = await fetch(`${base}/admin-only`, { headers: { Authorization: 'Bearer garbage-not-a-real-token' } });
        check('requireAdmin: случайный Bearer-токен (не выданный issueAdminToken) -> 401', garbage.status === 401);

        const asPassword = await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` } });
        check('requireAdmin: сам пароль как Bearer-токен -> 401 (токен больше не равен паролю)', asPassword.status === 401);

        const valid = await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${token}` } });
        check('requireAdmin: токен, выданный issueAdminToken() -> 200', valid.status === 200);

        server.close();
    }

    /* ── 3. Срок жизни токена (12ч) — проверяем через подмену Date.now ── */
    {
        const realNow = Date.now;
        const token = issueAdminToken();

        const app = express();
        app.get('/admin-only', requireAdmin, (req, res) => res.json({ ok: true }));
        const server = app.listen(0);
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;

        const fresh = await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${token}` } });
        check('requireAdmin: свежий токен -> 200', fresh.status === 200);

        Date.now = () => realNow() + 13 * 60 * 60 * 1000; // +13ч — за пределами TTL (12ч)
        try {
            const expired = await fetch(`${base}/admin-only`, { headers: { Authorization: `Bearer ${token}` } });
            check('requireAdmin: токен старше 12ч -> 401 (истёк)', expired.status === 401);
        } finally {
            Date.now = realNow;
        }

        server.close();
    }

    /* ── 4. POST /api/auth/login: лимит попыток, токен ≠ пароль, лог без пароля ── */
    {
        const originalWarn = console.warn;
        const warnLines = [];
        console.warn = (...args) => { warnLines.push(args.join(' ')); };

        delete require.cache[require.resolve('../routes/auth')];
        delete require.cache[require.resolve('../routes/subscription')];
        const authRouter = require('../routes/auth');

        const app = express();
        app.use(express.json());
        app.use('/api/auth', authRouter);
        const server = app.listen(0);
        const port = server.address().port;
        const base = `http://127.0.0.1:${port}`;

        async function login(password) {
            const r = await fetch(`${base}/api/auth/login`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ password }),
            });
            return { status: r.status, body: await r.json().catch(() => ({})) };
        }

        // 4 неверных попытки — все 401, в рамках лимита (5 на IP)
        for (let i = 0; i < 4; i++) {
            const r = await login('wrong-password');
            check(`POST /login с неверным паролем #${i + 1} -> 401`, r.status === 401);
        }
        check('неудачные попытки логируются без самого пароля',
            warnLines.some(l => l.includes('[auth]') && !l.includes('wrong-password')));

        // 5-я попытка (в рамках лимита) — с ВЕРНЫМ паролем -> 200, токен ≠ пароль
        const ok = await login('correct-horse-battery-staple');
        check('POST /login #5 (верный пароль, ещё в рамках лимита) -> 200', ok.status === 200);
        check('POST /login возвращает ok:true и токен', ok.body.ok === true && typeof ok.body.token === 'string');
        check('выданный /login токен НЕ равен паролю', ok.body.token !== 'correct-horse-battery-staple');

        // 6-я попытка (сверх лимита 5/IP) — даже с верным паролем -> 429
        const limited = await login('correct-horse-battery-staple');
        check('POST /login #6 (сверх лимита 5 попыток/IP) -> 429, даже с верным паролем', limited.status === 429);

        console.warn = originalWarn;
        server.close();
    }

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
