/* Проверка server/routes/banners.js — без реального Postgres.

   Поднимает временный Express-сервер с РЕАЛЬНЫМ роутом banners.js на
   свободном порту (как test-require-user.js), но, в отличие от него,
   здесь нужен весь CRUD-путь (не только 401-до-БД), поэтому db.query/
   queryOne/execute/inTransaction подменены прямо на объекте модуля
   server/db (require() кеширует модуль — banners.js получает ту же
   самую ссылку), на маленький in-memory массив баннеров. DB_* ниже —
   заглушки только чтобы server/db.js не упал при require() на
   отсутствующих переменных окружения (сам pool.query никогда не
   вызывается, т.к. db.query/queryOne/execute подменены раньше).

   Проверяет:
   (а) публичный GET отдаёт только активные и только в периоде показа,
       в правильном порядке по sort_order;
   (б) POST/PUT/DELETE/PUT reorder/POST upload без пароля/с неверным
       паролем -> 401;
   (в) PUT reorder с чужими (несуществующими) и повторяющимися id не
       ломает порядок реальных баннеров — никто не теряется и не
       дублируется.

   Запуск: node server/scripts/test-banners.js
*/
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_NAME     = process.env.DB_NAME     || 'test';
process.env.DB_USER     = process.env.DB_USER     || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';

const express = require('express');
const db      = require('../db');

/* ─── In-memory замена БД для banners.js ───────────────────────────
   Поддерживает ровно те формы запросов, которые реально выпускает
   server/routes/banners.js (см. его исходник) — не универсальный SQL. */
let banners = [];
let nextId  = 1;

function resetBanners(rows) {
    banners = rows.map(r => ({ ...r }));
    nextId  = (banners.reduce((m, b) => Math.max(m, b.id), 0)) + 1;
}

function sortedIds() {
    return banners.slice().sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
}

async function fakeQuery(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s === 'SELECT * FROM banners ORDER BY sort_order, id') {
        return sortedIds();
    }
    if (s.startsWith('SELECT * FROM banners WHERE is_active')) {
        const now = Date.now();
        return sortedIds().filter(b =>
            b.is_active === 1 &&
            (!b.starts_at || new Date(b.starts_at).getTime() <= now) &&
            (!b.ends_at   || new Date(b.ends_at).getTime()   >= now)
        );
    }
    if (s.startsWith('SELECT id FROM banners ORDER BY sort_order')) {
        return sortedIds().map(b => ({ id: b.id }));
    }
    if (s.startsWith('SELECT COALESCE(MAX(sort_order)')) {
        const m = banners.length ? Math.max(...banners.map(b => b.sort_order)) : -1;
        return [{ m }];
    }
    if (s.startsWith('SELECT * FROM banners WHERE id=')) {
        const row = banners.find(b => b.id === params[0]);
        return row ? [row] : [];
    }
    if (s.startsWith('UPDATE banners SET sort_order=')) {
        const [sortOrder, id] = params;
        const b = banners.find(x => x.id === id);
        if (b) { b.sort_order = sortOrder; b.updated_at = new Date().toISOString(); }
        return [];
    }
    if (s.startsWith('UPDATE banners SET title=')) {
        const [title, subtitle, imageUrl, linkType, linkId, isActive, startsAt, endsAt, textBlocks, bgStyle, bgColor, overlay, textPos, id] = params;
        const b = banners.find(x => x.id === id);
        if (!b) return { rowCount: 0 };
        Object.assign(b, {
            title, subtitle, image_url: imageUrl, link_type: linkType, link_id: linkId,
            is_active: isActive, starts_at: startsAt, ends_at: endsAt,
            text_blocks: textBlocks ? JSON.parse(textBlocks) : null, // имитация pg: JSONB возвращается уже распарсенным
            bg_style: bgStyle, bg_color: bgColor, overlay, text_pos: textPos,
            updated_at: new Date().toISOString(),
        });
        return { rowCount: 1 };
    }
    if (s.startsWith('DELETE FROM banners WHERE id=')) {
        const before = banners.length;
        banners = banners.filter(b => b.id !== params[0]);
        return { rowCount: before - banners.length };
    }
    if (s.startsWith('INSERT INTO banners')) {
        const [title, subtitle, imageUrl, linkType, linkId, sortOrder, isActive, startsAt, endsAt, textBlocks, bgStyle, bgColor, overlay, textPos] = params;
        const id = nextId++;
        banners.push({
            id, title, subtitle, image_url: imageUrl, link_type: linkType, link_id: linkId,
            sort_order: sortOrder, is_active: isActive, starts_at: startsAt, ends_at: endsAt,
            text_blocks: textBlocks ? JSON.parse(textBlocks) : null, // имитация pg: JSONB возвращается уже распарсенным
            bg_style: bgStyle, bg_color: bgColor, overlay, text_pos: textPos,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        return [{ id }];
    }

    throw new Error('test-banners: неизвестный запрос к фейковой БД: ' + s);
}

db.query = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    return Array.isArray(r) ? r : [];
};
db.queryOne = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    return Array.isArray(r) ? (r[0] || null) : null;
};
db.execute = async (sql, params = []) => {
    const r = await fakeQuery(sql, params);
    if (Array.isArray(r)) return r.length; // DELETE-подобные формы, если вдруг вернут массив
    return r.rowCount ?? 0;
};
db.inTransaction = async (fn) => {
    const client = { query: (sql, params) => fakeQuery(sql, params) };
    return fn(client);
};

// banners.js требуется ПОСЛЕ подмены db.*, но это не обязательно — методы
// читаются с объекта db в момент вызова (db.query(...)), а не
// деструктурируются при require().
const bannersRouter = require('../routes/banners');

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    const app = express();
    app.use(express.json());
    app.use('/api/banners', bannersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const AUTH = { Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` };
    const WRONG_AUTH = { Authorization: 'Bearer not-the-password' };

    /* ── (а) публичный GET: только активные + в периоде + порядок ──── */
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    resetBanners([
        { id: 1, title: 'Активный, без периода',        subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 2, is_active: 1, starts_at: null, ends_at: null, created_at: null, updated_at: null },
        { id: 2, title: 'Выключен',                       subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 0, is_active: 0, starts_at: null, ends_at: null, created_at: null, updated_at: null },
        { id: 3, title: 'Ещё не начался',                 subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 1, is_active: 1, starts_at: new Date(now + DAY).toISOString(), ends_at: null, created_at: null, updated_at: null },
        { id: 4, title: 'Уже закончился',                 subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 1, is_active: 1, starts_at: null, ends_at: new Date(now - DAY).toISOString(), created_at: null, updated_at: null },
        { id: 5, title: 'Активный, внутри периода, первый', subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 0, is_active: 1, starts_at: new Date(now - DAY).toISOString(), ends_at: new Date(now + DAY).toISOString(), created_at: null, updated_at: null },
    ]);
    {
        const r = await fetch(`${base}/api/banners`);
        const body = await r.json();
        check('GET /api/banners: 200', r.status === 200);
        check('GET /api/banners: только активные-в-периоде (2 из 5)', body.length === 2);
        check('GET /api/banners: порядок по sort_order (id 5 раньше id 1)',
            body.length === 2 && body[0].id === 5 && body[1].id === 1);
        check('GET /api/banners: выключенный/ещё-не-начавшийся/уже-закончившийся отсутствуют',
            !body.some(b => [2, 3, 4].includes(b.id)));
    }

    /* ── (б) админские ручки без пароля / с неверным паролем -> 401 ── */
    const protectedRequests = [
        ['GET',    '/api/banners/all',      null],
        ['POST',   '/api/banners',          { title: 'x' }],
        ['PUT',    '/api/banners/1',        { title: 'x' }],
        ['DELETE', '/api/banners/1',        null],
        ['PUT',    '/api/banners/reorder',  { order: [1, 2] }],
        ['POST',   '/api/banners/upload',   null],
    ];
    for (const [method, path, body] of protectedRequests) {
        const optsNoAuth = { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined };
        const r1 = await fetch(`${base}${path}`, optsNoAuth);
        check(`${method} ${path}: без Authorization -> 401`, r1.status === 401);

        const optsWrongAuth = { method, headers: { 'Content-Type': 'application/json', ...WRONG_AUTH }, body: body ? JSON.stringify(body) : undefined };
        const r2 = await fetch(`${base}${path}`, optsWrongAuth);
        check(`${method} ${path}: с неверным паролем -> 401`, r2.status === 401);
    }

    /* ── (в) reorder с чужими/повторяющимися id не ломает порядок ──── */
    resetBanners([
        { id: 10, title: 'A', subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 0, is_active: 1, starts_at: null, ends_at: null, created_at: null, updated_at: null },
        { id: 11, title: 'B', subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 1, is_active: 1, starts_at: null, ends_at: null, created_at: null, updated_at: null },
        { id: 12, title: 'C', subtitle: null, image_url: null, link_type: 'none', link_id: null, sort_order: 2, is_active: 1, starts_at: null, ends_at: null, created_at: null, updated_at: null },
    ]);
    {
        // 9999 не существует, 11 повторён дважды, 12 вовсе пропущен из order
        const r = await fetch(`${base}/api/banners/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify({ order: [9999, 11, 11, 10] }),
        });
        check('PUT /api/banners/reorder: с чужим/повторяющимся id -> 200', r.status === 200);

        const ids = banners.map(b => b.id).sort((a, b) => a - b);
        check('PUT /api/banners/reorder: ни один реальный баннер не потерян/не задублирован',
            ids.length === 3 && ids.join(',') === '10,11,12');

        const orders = banners.map(b => b.sort_order).sort((a, b) => a - b);
        check('PUT /api/banners/reorder: sort_order остаётся последовательным 0..N-1 без дыр/дублей',
            orders.join(',') === '0,1,2');

        const byId = Object.fromEntries(banners.map(b => [b.id, b.sort_order]));
        check('PUT /api/banners/reorder: присланный порядок учтён (11 раньше 10, пропущенный 12 — в конце)',
            byId[11] < byId[10] && byId[12] > byId[10] && byId[12] > byId[11]);
    }

    /* ── (г) Оформление: белый список, 400, дефолты, эмодзи, XSS,
       обратная совместимость ───────────────────────────────────── */
    resetBanners([]);

    async function postBanner(body) {
        const r = await fetch(`${base}/api/banners`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...AUTH },
            body: JSON.stringify(body),
        });
        const json = await r.json().catch(() => ({}));
        return { status: r.status, body: json };
    }

    // Белый список — каждое поле по отдельности с заведомо неверным значением
    const invalidWhitelistCases = [
        ['size',    { textBlocks: [{ text: 'x', size: 'huge',  weight: 'regular', italic: false, color: 'auto', align: 'left' }] }],
        ['weight',  { textBlocks: [{ text: 'x', size: 'm', weight: 'ultra',       italic: false, color: 'auto', align: 'left' }] }],
        ['color',   { textBlocks: [{ text: 'x', size: 'm', weight: 'regular',     italic: false, color: 'rainbow', align: 'left' }] }],
        ['align',   { textBlocks: [{ text: 'x', size: 'm', weight: 'regular',     italic: false, color: 'auto', align: 'justify' }] }],
        ['bgStyle', { bgStyle: 'neon' }],
        ['overlay', { overlay: 'extreme' }],
        ['textPos', { textPos: 'middle-right' }],
    ];
    for (const [label, extra] of invalidWhitelistCases) {
        const { status, body } = await postBanner({ title: 'T', ...extra });
        check(`POST /api/banners: неверный ${label} -> 400`, status === 400 && typeof body.error === 'string');
    }

    // Максимум 4 блока
    {
        const fiveBlocks = Array.from({ length: 5 }, (_, i) => ({ text: `${i}`, size: 'm', weight: 'regular', italic: false, color: 'auto', align: 'left' }));
        const { status } = await postBanner({ title: 'T', textBlocks: fiveBlocks });
        check('POST /api/banners: 5 блоков (>4) -> 400', status === 400);
    }

    // Текст >120 символов
    {
        const longText = 'a'.repeat(121);
        const { status } = await postBanner({ title: 'T', textBlocks: [{ text: longText, size: 'm', weight: 'regular', italic: false, color: 'auto', align: 'left' }] });
        check('POST /api/banners: текст блока >120 символов -> 400', status === 400);
    }

    // Перенос строки в тексте блока
    {
        const { status } = await postBanner({ title: 'T', textBlocks: [{ text: 'строка1\nстрока2', size: 'm', weight: 'regular', italic: false, color: 'auto', align: 'left' }] });
        check('POST /api/banners: перенос строки в тексте блока -> 400', status === 400);
    }

    // customColor невалиден/отсутствует при color='custom'
    {
        const { status } = await postBanner({ title: 'T', textBlocks: [{ text: 'x', size: 'm', weight: 'regular', italic: false, color: 'custom', align: 'left' }] });
        check('POST /api/banners: color=custom без customColor -> 400', status === 400);
    }
    {
        const { status } = await postBanner({ title: 'T', textBlocks: [{ text: 'x', size: 'm', weight: 'regular', italic: false, color: 'custom', customColor: 'not-a-hex', align: 'left' }] });
        check('POST /api/banners: color=custom с невалидным customColor -> 400', status === 400);
    }

    // bgColor невалиден/отсутствует при bgStyle='custom'
    {
        const { status } = await postBanner({ title: 'T', bgStyle: 'custom' });
        check('POST /api/banners: bgStyle=custom без bgColor -> 400', status === 400);
    }
    {
        const { status } = await postBanner({ title: 'T', bgStyle: 'custom', bgColor: 'red' });
        check('POST /api/banners: bgStyle=custom с невалидным bgColor -> 400', status === 400);
    }

    // Значения по умолчанию — запрос вообще без стилевых полей (обратная
    // совместимость со старым форматом: только title/subtitle)
    {
        const { status, body } = await postBanner({ title: 'Старый формат', subtitle: 'Подзаголовок' });
        check('POST /api/banners: без стилевых полей -> 201', status === 201);
        check('POST /api/banners: дефолт bgStyle=brand',       body.bgStyle === 'brand');
        check('POST /api/banners: дефолт overlay=medium',      body.overlay === 'medium');
        check('POST /api/banners: дефолт textPos=bottom-left', body.textPos === 'bottom-left');
        check('POST /api/banners: textBlocks не задан -> null', body.textBlocks === null);
        check('POST /api/banners: title/subtitle сохранились как есть', body.title === 'Старый формат' && body.subtitle === 'Подзаголовок');
    }

    // Эмодзи — сохраняется и возвращается побайтово тем же
    {
        const emojiText = '🔧 Скидки до 50% 🔥 ⭐⭐⭐';
        const { status, body } = await postBanner({ title: 'T', textBlocks: [{ text: emojiText, size: 'l', weight: 'bold', italic: false, color: 'light', align: 'center' }] });
        check('POST /api/banners: эмодзи в тексте блока -> 201', status === 201);
        check('POST /api/banners: эмодзи возвращается без искажений', body.textBlocks?.[0]?.text === emojiText);
    }

    // XSS-строка — сохраняется и возвращается как обычный текст, не отклоняется
    {
        const xss = '<img src=x onerror=alert(1)>';
        const { status, body } = await postBanner({ title: 'T', textBlocks: [{ text: xss, size: 'm', weight: 'regular', italic: false, color: 'auto', align: 'left' }] });
        check('POST /api/banners: XSS-строка в тексте блока -> 201 (не отклонена как невалидная)', status === 201);
        check('POST /api/banners: XSS-строка возвращается как обычный текст, без изменений', body.textBlocks?.[0]?.text === xss);
    }

    server.close();

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
