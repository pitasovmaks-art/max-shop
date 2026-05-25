const { DatabaseSync } = require('node:sqlite');
const path             = require('path');

const db = new DatabaseSync(path.join(__dirname, '..', 'shop.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ─── Schema ─────────────────────────────────────────────── */
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
    id    INTEGER PRIMARY KEY,
    name  TEXT    NOT NULL,
    icon  TEXT    NOT NULL DEFAULT '📦',
    color INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subcategories (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    desc        TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sub_id      INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
    price       INTEGER NOT NULL DEFAULT 0,
    in_stock    INTEGER NOT NULL DEFAULT 1,
    is_service  INTEGER NOT NULL DEFAULT 0,
    price_label TEXT,
    image       TEXT
);

CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    phone      TEXT    NOT NULL,
    store      TEXT    NOT NULL,
    comment    TEXT,
    items      TEXT    NOT NULL,
    total      INTEGER NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'new',
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS stores (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    city       TEXT    NOT NULL,
    address    TEXT    NOT NULL,
    hours      TEXT    NOT NULL DEFAULT '',
    phone      TEXT    NOT NULL DEFAULT '',
    directions TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);
`);

/* ─── Transaction helper ─────────────────────────────────── */
function inTransaction(fn) {
    db.exec('BEGIN');
    try   { fn(); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ─── Seed default data ──────────────────────────────────── */
function seedDefaults() {
    const insCat   = db.prepare('INSERT INTO categories (id,name,icon,color) VALUES (?,?,?,?)');
    const insSub   = db.prepare('INSERT INTO subcategories (id,category_id,name) VALUES (?,?,?)');
    const insProd  = db.prepare(`
        INSERT INTO products (name,desc,category_id,sub_id,price,in_stock,is_service,price_label)
        VALUES (?,?,?,?,?,?,?,?)`);
    const insStore = db.prepare(`
        INSERT INTO stores (name,city,address,hours,phone,directions,sort_order)
        VALUES (?,?,?,?,?,?,?)`);

    inTransaction(() => {
        insCat.run(1, 'Монтажные пистолеты',       '🔨', 1);
        insCat.run(2, 'Аккумуляторные инструменты', '⚡',  2);
        insCat.run(3, 'Расходники',                '📦', 3);
        insCat.run(4, 'Услуги',                    '🔧', 4);

        insSub.run(1, 1, 'NTC');
        insSub.run(2, 1, 'FengBao');
        insSub.run(3, 3, 'Гвозди');
        insSub.run(4, 3, 'Газовые баллоны');
        insSub.run(5, 3, 'Клипсы');
        insSub.run(6, 3, 'Площадки');
        insSub.run(7, 3, 'Дюбеля');

        insProd.run('NTC57C3-1',                          'Газовый монтажный пистолет, гвоздь до 57 мм',                 1, 1, 46500, 1, 0, null);
        insProd.run('NTC65C3-1',                          'Газовый монтажный пистолет, гвоздь до 65 мм',                 1, 1, 52000, 1, 0, null);
        insProd.run('NTC90C3-1',                          'Газовый монтажный пистолет, гвоздь до 90 мм',                 1, 1, 61000, 0, 0, null);
        insProd.run('FengBao F22',                        'Газовый монтажный пистолет, компактный',                      1, 2, 37800, 1, 0, null);
        insProd.run('FengBao N50',                        'Гвоздезабивной пистолет, гвоздь до 50 мм',                    1, 2, 34500, 1, 0, null);
        insProd.run('FengBao N65',                        'Гвоздезабивной пистолет, гвоздь до 65 мм',                    1, 2, 39900, 1, 0, null);
        insProd.run('Шуруповёрт аккумуляторный 18V',     '2 аккумулятора 2Ah, кейс в комплекте',                        2, null, 11500, 1, 0, null);
        insProd.run('Перфоратор аккумуляторный 20V',     'SDS+, удар 2.5 Дж, аккумулятор 4Ah',                          2, null, 19800, 1, 0, null);
        insProd.run('Дрель-шуруповёрт 18V',              'Безударная, 2 аккумулятора, 60 Нм',                            2, null,  9200, 0, 0, null);
        insProd.run('УШМ аккумуляторная 18V',            'Диск 115 мм, аккумулятор 5Ah',                                 2, null, 15600, 1, 0, null);
        insProd.run('Гвозди монтажные 57 мм',            'Упак. 1000 шт, для газовых пистолетов',                        3, 3,  1250, 1, 0, null);
        insProd.run('Гвозди монтажные 65 мм',            'Упак. 1000 шт, для газовых пистолетов',                        3, 3,  1390, 1, 0, null);
        insProd.run('Гвозди монтажные 90 мм',            'Упак. 1000 шт, повышенная прочность',                          3, 3,  1580, 1, 0, null);
        insProd.run('Газовый баллон для пистолета',      'Совместим с NTC и FengBao, 165 мл',                            3, 4,   890, 1, 0, null);
        insProd.run('Газовый баллон (3 шт)',             'Комплект 3 баллона по 165 мл',                                  3, 4,  2490, 1, 0, null);
        insProd.run('Клипсы монтажные 16 мм (100 шт)',  'Для кабелей и труб, крепление пистолетом',                     3, 5,   420, 1, 0, null);
        insProd.run('Клипсы монтажные 22 мм (100 шт)',  'Для труб Ø22 мм, крепление пистолетом',                        3, 5,   490, 1, 0, null);
        insProd.run('Площадки монтажные 25×25 (100 шт)','Самоклеящиеся, крепление пистолетом',                           3, 6,   360, 1, 0, null);
        insProd.run('Дюбель-гвоздь 6×40 (100 шт)',      'Нейлоновый, универсальный',                                     3, 7,   280, 1, 0, null);
        insProd.run('Дюбель-гвоздь 8×60 (50 шт)',       'Нейлоновый, усиленный',                                         3, 7,   310, 0, 0, null);
        insProd.run('Ремонт монтажного пистолета',       'Диагностика, замена деталей, настройка. NTC и FengBao',         4, null, 3500, 1, 1, 'от 3 500 ₽');
        insProd.run('Чистка монтажного пистолета',       'Профессиональная разборка, очистка, смазка всех механизмов',   4, null, 1500, 1, 1, 'от 1 500 ₽');

        insStore.run('Краснодар — ул. Селезнева', 'Краснодар', 'ул. Селезнева, 4/10',            'Пн–Сб 08:00–18:00', '', '', 1);
        insStore.run('Краснодар — ул. Котлярова', 'Краснодар', 'ул. Котлярова, 21',              'Пн–Сб 08:00–18:00', '', '', 2);
        insStore.run('Москва — Аллея Первой Маевки', 'Москва', 'Аллея Первой Маевки, 15 стр3',  'Пн–Сб 08:00–18:00', '', '', 3);
    });

    console.log('База данных заполнена начальными данными');
}

function resetToDefaults() {
    inTransaction(() => {
        db.exec('DELETE FROM orders');
        db.exec('DELETE FROM products');
        db.exec('DELETE FROM subcategories');
        db.exec('DELETE FROM categories');
        db.exec('DELETE FROM stores');
        db.exec("DELETE FROM sqlite_sequence WHERE name IN ('products','orders','stores')");
    });
    seedDefaults();
}

/* ─── Auto-seed on first run ─────────────────────────────── */
if (db.prepare('SELECT COUNT(*) as n FROM categories').get().n === 0) {
    seedDefaults();
} else if (db.prepare('SELECT COUNT(*) as n FROM stores').get().n === 0) {
    const insStore = db.prepare(`
        INSERT INTO stores (name,city,address,hours,phone,directions,sort_order)
        VALUES (?,?,?,?,?,?,?)`);
    inTransaction(() => {
        insStore.run('Краснодар — ул. Селезнева',    'Краснодар', 'ул. Селезнева, 4/10',           'Пн–Сб 08:00–18:00', '', '', 1);
        insStore.run('Краснодар — ул. Котлярова',    'Краснодар', 'ул. Котлярова, 21',             'Пн–Сб 08:00–18:00', '', '', 2);
        insStore.run('Москва — Аллея Первой Маевки', 'Москва',    'Аллея Первой Маевки, 15 стр3', 'Пн–Сб 08:00–18:00', '', '', 3);
    });
    console.log('Магазины добавлены в базу данных');
}

/* ─── Data migrations (idempotent) ───────────────────────── */
db.exec("UPDATE stores SET hours='Пн–Сб 08:00–18:00' WHERE hours IN ('Пн–Пт 9:00–18:00, Сб 10:00–16:00','Пн–Пт 9:00–19:00, Сб 10:00–17:00')");
db.exec("UPDATE subcategories SET name='NTC' WHERE name='Toua'");
db.exec("UPDATE products SET name=REPLACE(name,'Toua ','') WHERE name LIKE 'Toua %'");
db.exec("UPDATE products SET desc=REPLACE(desc,'Toua','NTC') WHERE desc LIKE '%Toua%'");

db.inTransaction   = inTransaction;
db.resetToDefaults = resetToDefaults;

module.exports = db;
