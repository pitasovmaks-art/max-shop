const { Pool } = require('pg');

const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT || '5432';
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;

if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    console.error('FATAL: Не заданы переменные окружения DB_HOST, DB_NAME, DB_USER или DB_PASSWORD');
    process.exit(1);
}

const pool = new Pool({
    host:                   DB_HOST,
    port:                   parseInt(DB_PORT, 10),
    database:               DB_NAME,
    user:                   DB_USER,
    password:               DB_PASSWORD,
    ssl:                    { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis:       30000,
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));

/* ─── Query helpers ──────────────────────────────────────── */
async function query(sql, params = []) {
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function queryOne(sql, params = []) {
    const { rows } = await pool.query(sql, params);
    return rows[0] || null;
}

async function execute(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rowCount;
}

async function inTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await fn(client);
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/* ─── Schema ─────────────────────────────────────────────── */
async function createSchema() {
    // Run each statement separately — multi-statement strings are not
    // reliably supported by all connection poolers (e.g. PgBouncer).
    await pool.query(`
        CREATE TABLE IF NOT EXISTS categories (
            id    INTEGER PRIMARY KEY,
            name  TEXT    NOT NULL,
            icon  TEXT    NOT NULL DEFAULT '📦',
            color INTEGER NOT NULL DEFAULT 1
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS subcategories (
            id          INTEGER PRIMARY KEY,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            name        TEXT    NOT NULL
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id          SERIAL  PRIMARY KEY,
            name        TEXT    NOT NULL,
            "desc"      TEXT,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            sub_id      INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
            price       INTEGER NOT NULL DEFAULT 0,
            in_stock    INTEGER NOT NULL DEFAULT 1,
            is_service  INTEGER NOT NULL DEFAULT 0,
            price_label TEXT,
            image       TEXT
        )
    `);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_krd INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_msk INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_delivery INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_krd INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_msk INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_delivery INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_krd_pickup INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_msk_pickup INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price_msk_delivery INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_krd INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id         SERIAL PRIMARY KEY,
            name       TEXT    NOT NULL,
            phone      TEXT    NOT NULL,
            store      TEXT    NOT NULL,
            comment    TEXT,
            items      TEXT    NOT NULL,
            total      INTEGER NOT NULL,
            status     TEXT    NOT NULL DEFAULT 'new',
            created_at TEXT    NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        )
    `);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery TEXT NOT NULL DEFAULT 'pickup'`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS address TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS city TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tg_id TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS stores (
            id         SERIAL  PRIMARY KEY,
            name       TEXT    NOT NULL,
            city       TEXT    NOT NULL,
            address    TEXT    NOT NULL,
            hours      TEXT    NOT NULL DEFAULT '',
            phone      TEXT    NOT NULL DEFAULT '',
            directions TEXT    NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_variants (
            id         SERIAL  PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            label      TEXT    NOT NULL,
            price      INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_images (
            id         SERIAL  PRIMARY KEY,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            url        TEXT    NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    `);
}

/* ─── Seed default data ──────────────────────────────────── */
async function seedDefaults() {
    console.log('[SEED] Начало заполнения базы данных...');
    await inTransaction(async (client) => {
        console.log('[SEED] Вставка категорий...');
        await client.query(`INSERT INTO categories (id,name,icon,color) VALUES
            (1,'Монтажные пистолеты','🔨',1),
            (2,'Аккумуляторные инструменты','⚡',2),
            (3,'Расходники','📦',3),
            (4,'Услуги','🔧',4)`);
        console.log('[SEED] Категории добавлены (4)');

        console.log('[SEED] Вставка подкатегорий...');
        await client.query(`INSERT INTO subcategories (id,category_id,name) VALUES
            (1,1,'NTC'),(2,1,'FengBao'),
            (3,3,'Гвозди'),(4,3,'Газовые баллоны'),
            (5,3,'Клипсы'),(6,3,'Площадки'),(7,3,'Дюбеля')`);
        console.log('[SEED] Подкатегории добавлены (7)');

        const ins = (name, desc, catId, subId, price, inStock, isService, priceLabel) =>
            client.query(
                `INSERT INTO products (name,"desc",category_id,sub_id,price,in_stock,is_service,price_label)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                [name, desc, catId, subId, price, inStock, isService, priceLabel]
            );

        console.log('[SEED] Вставка NTC пистолетов с вариантами...');
        const r57 = (await ins('NTC57C3-1',  'Газовый монтажный пистолет, гвоздь до 57 мм', 1,1,46500,1,0,null)).rows[0].id;
        console.log(`[SEED] NTC57C3-1 → id=${r57}`);
        const r65 = (await ins('NTC65C3-1',  'Газовый монтажный пистолет, гвоздь до 65 мм', 1,1,52000,1,0,null)).rows[0].id;
        console.log(`[SEED] NTC65C3-1 → id=${r65}`);
        const r90 = (await ins('NTC90C3-1',  'Газовый монтажный пистолет, гвоздь до 90 мм', 1,1,61000,0,0,null)).rows[0].id;
        console.log(`[SEED] NTC90C3-1 → id=${r90}`);

        console.log('[SEED] Вставка вариантов аренды...');
        await client.query(
            `INSERT INTO product_variants (product_id,label,price,is_default,sort_order) VALUES
            ($1,'14 дней',46500,1,1),($1,'6 месяцев',51000,0,2),($1,'12 месяцев',56500,0,3),
            ($2,'14 дней',52000,1,1),($2,'6 месяцев',57000,0,2),($2,'12 месяцев',62000,0,3),
            ($3,'14 дней',61000,1,1),($3,'6 месяцев',67000,0,2),($3,'12 месяцев',73000,0,3)`,
            [r57, r65, r90]
        );
        console.log('[SEED] Варианты аренды добавлены (9)');

        const products = [
            ['FengBao F22',                       'Газовый монтажный пистолет, компактный',                    1,2,37800,1,0,null],
            ['FengBao N50',                       'Гвоздезабивной пистолет, гвоздь до 50 мм',                 1,2,34500,1,0,null],
            ['FengBao N65',                       'Гвоздезабивной пистолет, гвоздь до 65 мм',                 1,2,39900,1,0,null],
            ['Шуруповёрт аккумуляторный 18V',    '2 аккумулятора 2Ah, кейс в комплекте',                     2,null,11500,1,0,null],
            ['Перфоратор аккумуляторный 20V',    'SDS+, удар 2.5 Дж, аккумулятор 4Ah',                       2,null,19800,1,0,null],
            ['Дрель-шуруповёрт 18V',             'Безударная, 2 аккумулятора, 60 Нм',                         2,null,9200,0,0,null],
            ['УШМ аккумуляторная 18V',           'Диск 115 мм, аккумулятор 5Ah',                              2,null,15600,1,0,null],
            ['Гвозди монтажные 57 мм',           'Упак. 1000 шт, для газовых пистолетов',                     3,3,1250,1,0,null],
            ['Гвозди монтажные 65 мм',           'Упак. 1000 шт, для газовых пистолетов',                     3,3,1390,1,0,null],
            ['Гвозди монтажные 90 мм',           'Упак. 1000 шт, повышенная прочность',                       3,3,1580,1,0,null],
            ['Газовый баллон для пистолета',     'Совместим с NTC и FengBao, 165 мл',                         3,4,890,1,0,null],
            ['Газовый баллон (3 шт)',            'Комплект 3 баллона по 165 мл',                               3,4,2490,1,0,null],
            ['Клипсы монтажные 16 мм (100 шт)', 'Для кабелей и труб, крепление пистолетом',                  3,5,420,1,0,null],
            ['Клипсы монтажные 22 мм (100 шт)', 'Для труб Ø22 мм, крепление пистолетом',                     3,5,490,1,0,null],
            ['Площадки монтажные 25×25 (100 шт)','Самоклеящиеся, крепление пистолетом',                      3,6,360,1,0,null],
            ['Дюбель-гвоздь 6×40 (100 шт)',     'Нейлоновый, универсальный',                                  3,7,280,1,0,null],
            ['Дюбель-гвоздь 8×60 (50 шт)',      'Нейлоновый, усиленный',                                      3,7,310,0,0,null],
            ['Ремонт монтажного пистолета',      'Диагностика, замена деталей, настройка. NTC и FengBao',      4,null,3500,1,1,'от 3 500 ₽'],
            ['Чистка монтажного пистолета',      'Профессиональная разборка, очистка, смазка всех механизмов',4,null,1500,1,1,'от 1 500 ₽'],
        ];
        console.log(`[SEED] Вставка ${products.length} остальных продуктов...`);
        for (const p of products) await ins(...p);
        console.log(`[SEED] Продукты добавлены (${products.length})`);

        console.log('[SEED] Вставка магазинов...');
        await client.query(`INSERT INTO stores (name,city,address,hours,phone,directions,sort_order) VALUES
            ('Краснодар — ул. Селезнева',    'Краснодар','ул. Селезнева, 4/10',          'Пн–Сб 08:00–18:00','','',1),
            ('Краснодар — ул. Котлярова',    'Краснодар','ул. Котлярова, 21',            'Пн–Сб 08:00–18:00','','',2),
            ('Москва — Аллея Первой Маевки', 'Москва',   'Аллея Первой Маевки, 15 стр3','Пн–Сб 08:00–18:00','','',3)`);
        console.log('[SEED] Магазины добавлены (3)');
    });

    console.log('[SEED] База данных успешно заполнена начальными данными');
}

/* ─── Reset to defaults ──────────────────────────────────── */
async function resetToDefaults() {
    await pool.query(
        'TRUNCATE product_variants, products, subcategories, categories, orders, stores RESTART IDENTITY CASCADE'
    );
    await seedDefaults();
}

/* ─── Init: schema + auto-seed ───────────────────────────── */
async function init() {
    console.log(`[DB] Инициализация: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);

    console.log('[DB] Создание схемы (CREATE TABLE IF NOT EXISTS)...');
    try {
        await createSchema();
        console.log('[DB] Схема готова');
    } catch (e) {
        console.error('[DB] ОШИБКА при создании схемы:', e.message);
        console.error(e.stack);
        throw e;
    }

    let prodCount;
    try {
        prodCount = await queryOne('SELECT COUNT(*) AS n FROM products');
        console.log(`[DB] Продуктов в базе: ${prodCount.n}`);
    } catch (e) {
        console.error('[DB] ОШИБКА при проверке количества продуктов:', e.message);
        console.error(e.stack);
        throw e;
    }

    if (parseInt(prodCount.n, 10) === 0) {
        console.log('[DB] База пустая — запускаю автозаполнение...');
        try {
            await seedDefaults();
        } catch (e) {
            console.error('[DB] ОШИБКА при автозаполнении:', e.message);
            console.error(e.stack);
            throw e;
        }
    } else {
        console.log('[DB] Автозаполнение пропущено — данные уже есть');
    }

    console.log('[DB] PostgreSQL инициализирована и готова');
}

module.exports = { query, queryOne, execute, inTransaction, init, resetToDefaults };
