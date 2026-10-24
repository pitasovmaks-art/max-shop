-- ============================================================================
-- schema.sql
--
-- Реконструировано статическим анализом всех pool.query()/client.query()/
-- db.query()/db.queryOne()/db.execute() вызовов в server/ (см. server/db.js,
-- server/routes/*.js). Типы колонок определены по тому, как значения
-- используются в коде (сравнение с числами, ===1/===0 для булевых флагов,
-- JSON.stringify()/JSON.parse() для JSON-полей, BigInt() для tg/user/chat id
-- и т.д.). Внешние ключи добавлены по конвенции именования "<table>_id"
-- (например product_id → products.id), даже там, где исходный код их не
-- объявлял явно (favorites.product_id, stock_subscriptions.product_id).
--
-- Таблица ozon_transactions используется в server/routes/uploads.js, но её
-- CREATE TABLE в server/ отсутствует — она реально создаётся в
-- services/ozonSync.js (вне server/); структура колонок перепроверена по
-- обоим источникам и совпадает.
-- ============================================================================


-- ─── Каталог ────────────────────────────────────────────────────────────

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
    id                      SERIAL  PRIMARY KEY,
    name                    TEXT    NOT NULL,
    "desc"                  TEXT,
    category_id             INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    sub_id                  INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
    price                   INTEGER NOT NULL DEFAULT 0,
    in_stock                INTEGER NOT NULL DEFAULT 1,  -- boolean-флаг (0/1), сравнивается через ===1
    is_service              INTEGER NOT NULL DEFAULT 0,  -- boolean-флаг (0/1)
    price_label             TEXT,
    image                   TEXT,                        -- URL картинки (S3); base64 отклоняется API
    price_krd               INTEGER NOT NULL DEFAULT 0,
    price_msk               INTEGER NOT NULL DEFAULT 0,
    price_delivery          INTEGER NOT NULL DEFAULT 0,
    sort_order              INTEGER NOT NULL DEFAULT 0,
    sort_order_in_category  INTEGER NOT NULL DEFAULT 0,
    sale_notified           INTEGER NOT NULL DEFAULT 0   -- boolean-флаг (0/1)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_hit INTEGER NOT NULL DEFAULT 0;  -- boolean-флаг (0/1)
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand   TEXT;  -- до 100 символов, проверяется в server/routes/products.js
ALTER TABLE products ADD COLUMN IF NOT EXISTS article TEXT;  -- до 100 символов, проверяется в server/routes/products.js

CREATE TABLE IF NOT EXISTS product_variants (
    id                   SERIAL  PRIMARY KEY,
    product_id           INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label                TEXT    NOT NULL,
    price                INTEGER NOT NULL DEFAULT 0,
    is_default           INTEGER NOT NULL DEFAULT 0,     -- boolean-флаг (0/1)
    sort_order           INTEGER NOT NULL DEFAULT 0,
    sale_price           INTEGER NOT NULL DEFAULT 0,
    price_krd            INTEGER NOT NULL DEFAULT 0,
    price_msk            INTEGER NOT NULL DEFAULT 0,
    price_delivery       INTEGER NOT NULL DEFAULT 0,
    price_krd_pickup     INTEGER NOT NULL DEFAULT 0,
    price_msk_pickup     INTEGER NOT NULL DEFAULT 0,
    price_msk_delivery   INTEGER NOT NULL DEFAULT 0,
    is_krd               INTEGER NOT NULL DEFAULT 0      -- boolean-флаг (0/1)
);

-- Цены в долларах (usd-pricing, см. PROGRESS.md) — только на уровне
-- варианта: любой товар (в т.ч. "без вариантов" для пользователя)
-- представлен в этой таблице хотя бы одной строкой (пустой label).
-- usd_* в центах, is_usd=1 переключает normalizeVariant() на пересчёт
-- через server/utils/usdPrice.js вместо чтения рублёвых колонок напрямую.
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_usd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS usd_price_krd_pickup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS usd_price_msk_pickup INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS usd_sale_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS usd_delivery_surcharge_rub INTEGER NOT NULL DEFAULT 0;

-- Курс доллара (целое число ×10000, напр. 92.4567 -> 924567). Текущий
-- курс = последняя по created_at строка; пустая таблица = курс не задан.
CREATE TABLE IF NOT EXISTS usd_rate_history (
    id         SERIAL    PRIMARY KEY,
    rate       INTEGER   NOT NULL,
    prev_rate  INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Синхронизация корзины с сервера (нужна для уведомлений о смене цены
-- при смене курса, см. PROGRESS.md). Полностью перезаписывается при
-- каждой синхронизации (DELETE+INSERT в транзакции) — не upsert.
-- price_seen считает сервер (server/utils/pricing.js), не принимается
-- от клиента.
CREATE TABLE IF NOT EXISTS cart_sync (
    id            SERIAL    PRIMARY KEY,
    tg_id         BIGINT    NOT NULL,
    product_id    BIGINT    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_label TEXT      NOT NULL DEFAULT '',
    city          TEXT      NOT NULL DEFAULT '',
    qty           INTEGER   NOT NULL,
    price_seen    INTEGER   NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (tg_id, product_id, variant_label)
);

-- Лимит уведомлений о смене цены — не чаще раза в сутки на человека.
CREATE TABLE IF NOT EXISTS usd_notify_log (
    tg_id       BIGINT    PRIMARY KEY,
    notified_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS product_images (
    id         SERIAL  PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url        TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Баннеры главной (управление из админки). link_id — полиморфная ссылка
-- (products/categories/subcategories по link_type), без FK; link_type='service'
-- тоже хранит id из products (is_service=1), отдельной таблицы услуг нет.
CREATE TABLE IF NOT EXISTS banners (
    id         SERIAL  PRIMARY KEY,
    title      TEXT    NOT NULL,
    subtitle   TEXT,
    image_url  TEXT,
    link_type  TEXT    NOT NULL DEFAULT 'none',
    link_id    INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1,
    starts_at  TIMESTAMP,
    ends_at    TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Оформление баннера (текстовые блоки + фон). text_blocks NULL у старых
-- строк — Главная рисует их по title/subtitle, как раньше.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS text_blocks JSONB;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS bg_style TEXT NOT NULL DEFAULT 'brand';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS bg_color TEXT;
ALTER TABLE banners ADD COLUMN IF NOT EXISTS overlay TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE banners ADD COLUMN IF NOT EXISTS text_pos TEXT NOT NULL DEFAULT 'bottom-left';


-- ─── Заказы и магазины ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orders (
    id              SERIAL  PRIMARY KEY,
    name            TEXT    NOT NULL,
    phone           TEXT    NOT NULL,
    store           TEXT    NOT NULL,
    comment         TEXT,
    items           TEXT    NOT NULL,   -- JSON.stringify(items) — хранится строкой, парсится через JSON.parse()
    total           INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'new',  -- new|in_progress|ready|shipped|completed|cancelled
    created_at      TEXT    NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    delivery        TEXT    NOT NULL DEFAULT 'pickup',
    address         TEXT,
    city            TEXT,
    tg_id           TEXT,               -- MAX/Telegram user id
    tracking_number TEXT
);

-- ─── Заявки на ремонт/обслуживание инструмента ──────────────────────────
-- Этап 1 (см. PROGRESS.md): создание заявки покупателем + уведомление
-- менеджера магазина. Назначение стоимости/мастера/статуса — этап 2,
-- полей для них (cost, admin_comment) здесь уже достаточно.
CREATE TABLE IF NOT EXISTS service_requests (
    id              SERIAL  PRIMARY KEY,
    tg_id           TEXT    NOT NULL,   -- MAX user id (как у orders.tg_id), из requireUser
    name            TEXT    NOT NULL,
    phone           TEXT    NOT NULL,
    store           TEXT,               -- устарело: раньше код магазина, выбор убран (см. миграцию ниже) — NULL у новых заявок
    delivery_needed INTEGER NOT NULL DEFAULT 0,
    address         TEXT,               -- обязателен, если delivery_needed=1 (проверяется в роуте)
    comment         TEXT,
    status          TEXT    NOT NULL DEFAULT 'accepted',  -- accepted|in_progress|ready|issued
    cost            INTEGER,            -- NULL, пока мастер не оценит — этап 2
    admin_comment   TEXT,               -- NULL, комментарий мастера — этап 2
    created_at      TEXT    NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    updated_at      TEXT    NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);

-- Миграция: выбор магазина в форме заявки убран — у уже созданной в проде
-- таблицы store мог остаться NOT NULL (CREATE TABLE IF NOT EXISTS его не
-- трогает). Идемпотентно — повторный запуск на уже нетребуемой колонке не
-- ошибка.
ALTER TABLE service_requests ALTER COLUMN store DROP NOT NULL;

-- Номер для показа («Р-123») не хранится отдельным столбцом — это просто
-- 'Р-' + id, вычисляется при чтении (см. normalize() в роуте); отдельная
-- колонка потребовала бы двухшагового INSERT (узнать id → обновить номер)
-- без какой-либо дополнительной гарантии, которую не даёт сам id.

CREATE TABLE IF NOT EXISTS service_request_items (
    id         SERIAL  PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    tool_name  TEXT    NOT NULL,
    problem    TEXT
);

-- История смены статуса заявки. changed_by: 'system' для начальной записи
-- при создании (status='accepted'), логин/метка админа — когда появится
-- смена статуса из админки (этап 2, здесь не реализовывалось).
CREATE TABLE IF NOT EXISTS service_request_events (
    id         SERIAL  PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
    status     TEXT    NOT NULL,
    changed_by TEXT    NOT NULL DEFAULT 'system',
    created_at TEXT    NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
);

CREATE TABLE IF NOT EXISTS stores (
    id         SERIAL  PRIMARY KEY,
    name       TEXT    NOT NULL,
    city       TEXT    NOT NULL,
    address    TEXT    NOT NULL,
    hours      TEXT    NOT NULL DEFAULT '',
    phone      TEXT    NOT NULL DEFAULT '',
    directions TEXT    NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
);


-- ─── Пользовательские данные (избранное, подписки, уведомления) ────────

CREATE TABLE IF NOT EXISTS favorites (
    id         SERIAL    PRIMARY KEY,
    tg_id      BIGINT    NOT NULL,
    product_id BIGINT    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (tg_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_subscriptions (
    id         SERIAL    PRIMARY KEY,
    tg_id      BIGINT    NOT NULL,
    product_id BIGINT    NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    notified   BOOLEAN   DEFAULT FALSE,
    UNIQUE (tg_id, product_id)
);

CREATE TABLE IF NOT EXISTS promo_subscribers (
    tg_id      BIGINT    PRIMARY KEY,
    consent_at TIMESTAMP DEFAULT NOW()
);
-- Мягкая отписка (не DELETE) + источник последнего согласия/отзыва —
-- иначе отписавшийся через "стоп акции" или переключатель в приложении
-- терял бы саму историю того, что он когда-то подписывался и когда отозвал
-- согласие. unsubscribed_at IS NULL — подписан (см. GET /api/promo/status
-- в server/routes/promo.js); у существующих строк оба поля NULL — они
-- остаются подписанными, как и были до этой миграции.
ALTER TABLE promo_subscribers ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP;
ALTER TABLE promo_subscribers ADD COLUMN IF NOT EXISTS source TEXT; -- checkout | bot | toggle
-- Версия текста согласия, который человек видел при последнем subscribe
-- (см. server/config.js / src/shared/sellerConfig.js — PROMO_CONSENT_VERSION).
-- NULL для строк, созданных до этой колонки, и для отписок от бота (там
-- нет текста согласия, только команда). Это "текущий снимок", в отличие
-- от promo_consent_log ниже — полной истории, которая никогда не
-- перезаписывается.
ALTER TABLE promo_subscribers ADD COLUMN IF NOT EXISTS consent_text_version TEXT;

-- Журнал каждого действия (подписка/отписка) — отдельно от
-- promo_subscribers, который хранит только ТЕКУЩЕЕ состояние и
-- перезаписывается при повторном согласии. Сюда пишется КАЖДЫЙ вызов
-- subscribe/unsubscribe, без исключений — история никогда не трётся.
CREATE TABLE IF NOT EXISTS promo_consent_log (
    id                   SERIAL    PRIMARY KEY,
    tg_id                BIGINT    NOT NULL,
    action               TEXT      NOT NULL,              -- subscribe | unsubscribe
    source               TEXT      NOT NULL,               -- checkout | bot | toggle
    consent_text_version TEXT,                              -- NULL у unsubscribe (нет текста согласия)
    created_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_map (
    user_id    BIGINT    PRIMARY KEY,
    chat_id    BIGINT    NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_admins (
    user_id    BIGINT    PRIMARY KEY,
    chat_id    BIGINT    NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_known (
    chat_id BIGINT PRIMARY KEY
);

-- Список chat_id основного бота (bot.js), кому пересылаются обращения
-- клиентов и кто может использовать /reply. Раньше хранилось в
-- bot_admins.json в корне проекта — заменено на таблицу, т.к. файловая
-- система контейнера в проде доступна только на чтение (EACCES при
-- попытке записи). Отдельная таблица от support_admins, т.к. это другой
-- бот (свой BOT_TOKEN/вебхук) с другой семантикой (chat_id добавляется
-- автоматически при каждом /start, а не явным upsert-эндпоинтом).
CREATE TABLE IF NOT EXISTS bot_admins (
    chat_id    BIGINT    PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW()
);


-- ─── Загрузки данных продавца (Ozon seller-cabinet, /api/uploads/*) ─────

CREATE TABLE IF NOT EXISTS upload_history (
    id            SERIAL    PRIMARY KEY,
    file_type     TEXT,
    filename      TEXT,
    rows_imported INTEGER,
    status        TEXT,
    error_message TEXT,
    uploaded_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ozon_competitors (
    id           SERIAL    PRIMARY KEY,
    product_name TEXT,
    seller       TEXT,
    brand        TEXT,
    category     TEXT,
    price        DECIMAL(10,2),
    orders       INTEGER,
    revenue      DECIMAL(12,2),
    period_date  DATE,
    uploaded_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_costs (
    id         SERIAL    PRIMARY KEY,
    sku        TEXT,
    article    TEXT,
    name       TEXT,
    barcode    TEXT,
    cost_price DECIMAL(10,2),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (article)
);

CREATE TABLE IF NOT EXISTS unit_economics (
    id           SERIAL    PRIMARY KEY,
    account      VARCHAR(20),
    period_start DATE,
    period_end   DATE,
    sku          TEXT,
    article      TEXT,
    name         TEXT,
    scheme       VARCHAR(10),
    cost_price   DECIMAL(10,2),
    revenue      DECIMAL(12,2),
    profit       DECIMAL(12,2),
    margin       DECIMAL(5,2),
    uploaded_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_reports (
    id           SERIAL    PRIMARY KEY,
    account      VARCHAR(20),
    period_start DATE,
    period_end   DATE,
    metric       TEXT,
    amount       DECIMAL(12,2),
    uploaded_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ozon_products (
    id              SERIAL    PRIMARY KEY,
    account         VARCHAR(20),
    article         TEXT,
    ozon_product_id TEXT,
    sku             TEXT,
    barcode         TEXT,
    name            TEXT,
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE (account, article)
);

CREATE TABLE IF NOT EXISTS ozon_category (
    id             SERIAL    PRIMARY KEY,
    category       TEXT,
    orders_amount  DECIMAL(12,2),
    orders_dynamic DECIMAL(5,2),
    orders_count   INTEGER,
    avg_price      DECIMAL(10,2),
    price_dynamic  DECIMAL(5,2),
    period_start   DATE,
    period_end     DATE,
    uploaded_at    TIMESTAMP DEFAULT NOW()
);

-- Используется в server/routes/uploads.js (INSERT/TRUNCATE), но создаётся
-- в services/ozonSync.js — включена сюда, т.к. попадает под условие
-- "используется в server/". Типы сверены с оригинальным CREATE TABLE.
CREATE TABLE IF NOT EXISTS ozon_transactions (
    id                  SERIAL       PRIMARY KEY,
    account             TEXT         NOT NULL,
    operation_id        TEXT,
    operation_type      TEXT,
    operation_type_name TEXT,
    operation_date      TIMESTAMPTZ,
    amount              NUMERIC      NOT NULL DEFAULT 0,
    period_from         DATE,
    period_to           DATE,
    raw                 JSONB,
    synced_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
