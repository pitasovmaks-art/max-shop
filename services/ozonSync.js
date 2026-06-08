const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const db   = require('../server/db');

const BASE_URL    = 'https://api-seller.ozon.ru';
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

const ACCOUNTS = [
    { name: 'БМ',        clientId: process.env.BM_CLIENT_ID,       apiKey: process.env.BM_API_KEY       },
    { name: 'FIX',       clientId: process.env.FIX_CLIENT_ID,      apiKey: process.env.FIX_API_KEY      },
    { name: 'Деталькин', clientId: process.env.DETALKYN_CLIENT_ID, apiKey: process.env.DETALKYN_API_KEY },
].filter(acc => acc.clientId && acc.apiKey);

/* ─── Запрос к Ozon Seller API ───────────────────────────── */
async function ozonRequest(account, endpoint, body) {
    const res = await fetch(BASE_URL + endpoint, {
        method:  'POST',
        headers: {
            'Client-Id':    account.clientId,
            'Api-Key':      account.apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ozon API ${endpoint} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
}

async function logSync(account, dataType, status, count, errorMessage) {
    await db.execute(
        `INSERT INTO sync_log (account, data_type, sync_date, status, records_count, error_message)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)`,
        [account.name, dataType, status, count, errorMessage || null]
    );
}

const fmtDate = d => d.toISOString().slice(0, 10);

/* ─── 1. Остатки FBO/FBS ─────────────────────────────────── */
async function syncStocks() {
    for (const account of ACCOUNTS) {
        let count = 0;
        try {
            const items  = [];
            let   cursor = '';
            do {
                const data  = await ozonRequest(account, '/v3/product/info/stocks', { cursor, filter: {}, limit: 1000 });
                const batch = data.items || data.result?.items || [];
                items.push(...batch);
                cursor = data.cursor || '';
                if (!batch.length) break;
            } while (cursor);

            for (const item of items) {
                for (const stock of (item.stocks || [])) {
                    await db.execute(
                        `INSERT INTO ozon_stocks (account, product_id, offer_id, sku, warehouse_name, stock_type, present, reserved, synced_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                        [
                            account.name,
                            item.product_id ?? null,
                            item.offer_id   ?? null,
                            stock.sku            ?? null,
                            stock.warehouse_name ?? null,
                            stock.type           ?? null,
                            stock.present  ?? 0,
                            stock.reserved ?? 0,
                        ]
                    );
                    count++;
                }
            }
            await logSync(account, 'stocks', 'success', count);
            console.log(`[ozonSync] Остатки (${account.name}): сохранено ${count} запис.`);
        } catch (e) {
            await logSync(account, 'stocks', 'error', count, e.message);
            console.error(`[ozonSync] Ошибка остатков (${account.name}):`, e.message);
        }
    }
}

/* ─── 2. Аналитика товаров (за 28 дней) ──────────────────── */
async function syncAnalytics() {
    const dateTo   = new Date();
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateFrom.getDate() - 28);

    const metrics = ['revenue', 'ordered_units', 'returns', 'cancellations', 'delivered_units'];

    for (const account of ACCOUNTS) {
        let count = 0;
        try {
            const data = await ozonRequest(account, '/v1/analytics/data', {
                date_from: fmtDate(dateFrom),
                date_to:   fmtDate(dateTo),
                metrics,
                dimension: ['sku'],
                limit:     1000,
                offset:    0,
            });
            const rows = data.result?.data || [];
            for (const row of rows) {
                const dims = row.dimensions || [];
                const vals = row.metrics     || [];
                await db.execute(
                    `INSERT INTO ozon_analytics
                        (account, date_from, date_to, sku, revenue, ordered_units, returns, cancellations, delivered_units, synced_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                    [
                        account.name,
                        fmtDate(dateFrom),
                        fmtDate(dateTo),
                        dims[0]?.id ?? null,
                        vals[0] ?? 0,
                        vals[1] ?? 0,
                        vals[2] ?? 0,
                        vals[3] ?? 0,
                        vals[4] ?? 0,
                    ]
                );
                count++;
            }
            await logSync(account, 'analytics', 'success', count);
            console.log(`[ozonSync] Аналитика (${account.name}): сохранено ${count} запис.`);
        } catch (e) {
            await logSync(account, 'analytics', 'error', count, e.message);
            console.error(`[ozonSync] Ошибка аналитики (${account.name}):`, e.message);
        }
    }
}

/* ─── 3. Финансовые начисления (за прошлый месяц) ────────── */
async function syncTransactions() {
    const now              = new Date();
    const firstDayThisMo   = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMo   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMo    = new Date(firstDayThisMo.getTime() - 86400000);
    const periodFrom       = fmtDate(firstDayLastMo);
    const periodTo         = fmtDate(lastDayLastMo);
    const pageSize         = 1000;

    for (const account of ACCOUNTS) {
        let count = 0;
        try {
            let page = 1;
            while (true) {
                const data = await ozonRequest(account, '/v3/finance/transaction/list', {
                    filter: {
                        date: {
                            from: `${periodFrom}T00:00:00.000Z`,
                            to:   `${periodTo}T23:59:59.999Z`,
                        },
                        transaction_type: 'all',
                    },
                    page,
                    page_size: pageSize,
                });
                const ops = data.result?.operations || [];
                for (const op of ops) {
                    await db.execute(
                        `INSERT INTO ozon_transactions
                            (account, operation_id, operation_type, operation_type_name, operation_date, amount, period_from, period_to, raw, synced_at)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
                        [
                            account.name,
                            op.operation_id        ?? null,
                            op.operation_type      ?? null,
                            op.operation_type_name ?? null,
                            op.operation_date      ?? null,
                            op.amount ?? 0,
                            periodFrom,
                            periodTo,
                            JSON.stringify(op),
                        ]
                    );
                    count++;
                }
                if (ops.length < pageSize) break;
                page++;
            }
            await logSync(account, 'transactions', 'success', count);
            console.log(`[ozonSync] Транзакции (${account.name}): сохранено ${count} запис.`);
        } catch (e) {
            await logSync(account, 'transactions', 'error', count, e.message);
            console.error(`[ozonSync] Ошибка транзакций (${account.name}):`, e.message);
        }
    }
}

/* ─── 4. Отчёт по товарам (асинхронный отчёт Ozon) ───────── */
async function waitForReport(account, code, { intervalMs = 10000, maxAttempts = 30 } = {}) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const data   = await ozonRequest(account, '/v1/report/info', { code });
        const report = data.result || data;
        if (report.status === 'success') return report;
        if (report.status === 'failed')  throw new Error(`Отчёт ${code} завершился со статусом failed`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`Отчёт ${code} не стал готов за ${maxAttempts} попыток`);
}

async function syncReports() {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    for (const account of ACCOUNTS) {
        let reportCode = null;
        try {
            const created = await ozonRequest(account, '/v1/report/products/create', {
                language:   'DEFAULT',
                offer_id:   [],
                search:     '',
                sku:        [],
                visibility: 'ALL',
            });
            reportCode = created.code || created.result?.code;
            if (!reportCode) throw new Error('Ozon не вернул code отчёта');

            const report  = await waitForReport(account, reportCode);
            const fileUrl = report.file || report.file_url;
            if (!fileUrl) throw new Error('В готовом отчёте нет file_url');

            const fileRes = await fetch(fileUrl);
            if (!fileRes.ok) throw new Error(`Не удалось скачать файл отчёта: ${fileRes.status}`);
            const buffer = Buffer.from(await fileRes.arrayBuffer());

            const fileName = `${account.name}_товары_${fmtDate(new Date())}.xlsx`;
            const filePath = path.join(REPORTS_DIR, fileName);
            fs.writeFileSync(filePath, buffer);

            await db.execute(
                `INSERT INTO ozon_reports (account, report_code, file_path, status, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [account.name, reportCode, filePath, 'success']
            );
            await logSync(account, 'reports', 'success', 1);
            console.log(`[ozonSync] Отчёт по товарам (${account.name}): сохранён в ${filePath}`);
        } catch (e) {
            await db.execute(
                `INSERT INTO ozon_reports (account, report_code, file_path, status, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [account.name, reportCode, null, 'error']
            );
            await logSync(account, 'reports', 'error', 0, e.message);
            console.error(`[ozonSync] Ошибка отчёта по товарам (${account.name}):`, e.message);
        }
    }
}

/* ─── Таблицы ─────────────────────────────────────────────── */
async function ensureTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ozon_stocks (
            id             SERIAL PRIMARY KEY,
            account        TEXT NOT NULL,
            product_id     BIGINT,
            offer_id       TEXT,
            sku            BIGINT,
            warehouse_name TEXT,
            stock_type     TEXT,
            present        INTEGER NOT NULL DEFAULT 0,
            reserved       INTEGER NOT NULL DEFAULT 0,
            synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ozon_analytics (
            id              SERIAL PRIMARY KEY,
            account         TEXT NOT NULL,
            date_from       DATE NOT NULL,
            date_to         DATE NOT NULL,
            sku             BIGINT,
            revenue         NUMERIC NOT NULL DEFAULT 0,
            ordered_units   INTEGER NOT NULL DEFAULT 0,
            returns         INTEGER NOT NULL DEFAULT 0,
            cancellations   INTEGER NOT NULL DEFAULT 0,
            delivered_units INTEGER NOT NULL DEFAULT 0,
            synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ozon_transactions (
            id                  SERIAL PRIMARY KEY,
            account             TEXT NOT NULL,
            operation_id        BIGINT,
            operation_type      TEXT,
            operation_type_name TEXT,
            operation_date      TIMESTAMPTZ,
            amount              NUMERIC NOT NULL DEFAULT 0,
            period_from         DATE,
            period_to           DATE,
            raw                 JSONB,
            synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ozon_reports (
            id           SERIAL PRIMARY KEY,
            account      TEXT NOT NULL,
            report_code  TEXT,
            file_path    TEXT,
            status       TEXT NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await db.execute(`
        CREATE TABLE IF NOT EXISTS sync_log (
            id            SERIAL PRIMARY KEY,
            account       TEXT NOT NULL,
            data_type     TEXT NOT NULL,
            sync_date     DATE NOT NULL DEFAULT CURRENT_DATE,
            status        TEXT NOT NULL,
            records_count INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

/* ─── Расписание ──────────────────────────────────────────── */
function start() {
    if (!ACCOUNTS.length) {
        console.warn('[ozonSync] Не найдено ни одного аккаунта Ozon в .env — расписание не запущено');
        return;
    }

    ensureTables()
        .then(() => console.log('[ozonSync] Таблицы ozon_stocks/ozon_analytics/ozon_transactions/ozon_reports/sync_log готовы'))
        .catch(e => console.error('[ozonSync] Ошибка создания таблиц:', e.message));

    // Остатки FBO/FBS — каждый день в 8:00
    cron.schedule('0 8 * * *', () => {
        console.log('[ozonSync] Старт: выгрузка остатков FBO/FBS');
        syncStocks().catch(e => console.error('[ozonSync] syncStocks:', e.message));
    });

    // Аналитика товаров — каждый понедельник в 9:00
    cron.schedule('0 9 * * 1', () => {
        console.log('[ozonSync] Старт: выгрузка аналитики товаров');
        syncAnalytics().catch(e => console.error('[ozonSync] syncAnalytics:', e.message));
    });

    // Финансовые начисления — 1-го числа каждого месяца в 10:00
    cron.schedule('0 10 1 * *', () => {
        console.log('[ozonSync] Старт: выгрузка финансовых начислений');
        syncTransactions().catch(e => console.error('[ozonSync] syncTransactions:', e.message));
    });

    // Отчёт по товарам — каждый понедельник в 9:30
    cron.schedule('30 9 * * 1', () => {
        console.log('[ozonSync] Старт: выгрузка отчёта по товарам');
        syncReports().catch(e => console.error('[ozonSync] syncReports:', e.message));
    });

    console.log(`[ozonSync] Расписание зарегистрировано: 4 задачи (аккаунты: ${ACCOUNTS.map(a => a.name).join(', ')})`);
}

module.exports = { start, syncStocks, syncAnalytics, syncTransactions, syncReports };
