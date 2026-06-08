const router  = require('express').Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const db      = require('../db');
const { requireAdmin } = require('../middleware/auth');

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 25 * 1024 * 1024 },
});

const MONTHS_RU = [
    'январь', 'февраль', 'март',     'апрель', 'май',    'июнь',
    'июль',   'август',  'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const fmtDate = d => d.toISOString().slice(0, 10);

/* ─── Вспомогательные парсеры ────────────────────────────── */
function parseNumber(value) {
    if (value === '' || value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const n = parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function isNumericCell(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (value === '' || value === null || value === undefined) return false;
    const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s);
}

function parseExcelDate(value) {
    if (value === '' || value === null || value === undefined) return null;
    if (typeof value === 'number') {
        const d = XLSX.SSF.parse_date_code(value);
        if (!d) return null;
        return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, d.S || 0));
    }
    const s = String(value).trim();
    const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

function detectAccount(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('бм'))        return 'БМ';
    if (lower.includes('fix'))       return 'FIX';
    if (lower.includes('деталькин')) return 'Деталькин';
    return null;
}

function parsePeriodFromFilename(filename) {
    const lower    = filename.toLowerCase();
    const monthIdx = MONTHS_RU.findIndex(m => lower.includes(m));
    if (monthIdx === -1) return { periodStart: null, periodEnd: null };

    const yearMatch = /(\d{4})/.exec(lower);
    const year      = yearMatch ? +yearMatch[1] : new Date().getFullYear();
    const now       = new Date();

    const periodStart = new Date(Date.UTC(year, monthIdx, 1));
    const isCurrentMonth = now.getUTCFullYear() === year && now.getUTCMonth() === monthIdx;
    const periodEnd = isCurrentMonth
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : new Date(Date.UTC(year, monthIdx + 1, 0));

    return { periodStart: fmtDate(periodStart), periodEnd: fmtDate(periodEnd) };
}

function findPeriodDate(rawRows) {
    for (const row of rawRows) {
        for (const cell of (row || [])) {
            const m = /Период:\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(String(cell ?? ''));
            if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        }
    }
    return null;
}

/* ─── Чтение листа: поиск строки заголовков по известным именам ─ */
function parseSheet(buffer, knownHeaders) {
    const wb  = XLSX.read(buffer, { type: 'buffer' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const headerRowIdx = raw.findIndex(row =>
        Array.isArray(row) && row.some(cell => knownHeaders.some(h => String(cell).trim().includes(h)))
    );
    if (headerRowIdx === -1) {
        throw new Error(`Строка заголовков не найдена. Ожидаются столбцы: ${knownHeaders.join(', ')}`);
    }

    const headers  = raw[headerRowIdx].map(h => String(h).trim());
    const dataRows = raw.slice(headerRowIdx + 1).filter(row =>
        Array.isArray(row) && row.some(cell => cell !== '' && cell !== null && cell !== undefined)
    );
    const rows = dataRows.map(row => {
        const r = {};
        headers.forEach((h, i) => { r[h] = row[i] ?? ''; });
        return r;
    });

    return { raw, rows };
}

async function logUpload(fileType, filename, rowsImported, status, errorMessage) {
    await db.execute(
        `INSERT INTO upload_history (file_type, filename, rows_imported, status, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        [fileType, filename, rowsImported, status, errorMessage || null]
    );
}

function handleUpload(fileType, processFn) {
    return async (req, res) => {
        if (!req.file) return res.status(400).json({ success: false, error: 'Файл не передан' });
        const filename = req.file.originalname;
        let rowsImported = 0;
        try {
            rowsImported = await processFn(req.file.buffer, filename);
            await logUpload(fileType, filename, rowsImported, 'success');
            res.json({ success: true, rows_imported: rowsImported, filename, timestamp: new Date().toISOString() });
        } catch (e) {
            await logUpload(fileType, filename, rowsImported, 'error', e.message);
            res.status(400).json({ success: false, error: e.message, filename });
        }
    };
}

/* ─── 1. Конкуренты Ozon ─────────────────────────────────── */
const COMPETITORS_HEADERS = ['Название товара', 'Продавец', 'Бренд', 'Категория', 'Цена', 'Заказано', 'Выручка'];

router.post('/competitors', requireAdmin, upload.single('file'), handleUpload('competitors', async (buffer) => {
    const { rows } = parseSheet(buffer, COMPETITORS_HEADERS);
    const periodDate = fmtDate(new Date());

    await db.execute('DELETE FROM ozon_competitors WHERE period_date = $1', [periodDate]);

    let count = 0;
    for (const r of rows) {
        await db.execute(
            `INSERT INTO ozon_competitors (product_name, seller, brand, category, price, orders, revenue, period_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                String(r['Название товара'] || '').trim(),
                String(r['Продавец']        || '').trim(),
                String(r['Бренд']           || '').trim(),
                String(r['Категория']       || '').trim(),
                parseNumber(r['Цена']),
                Math.round(parseNumber(r['Заказано'])),
                parseNumber(r['Выручка']),
                periodDate,
            ]
        );
        count++;
    }
    return count;
}));

/* ─── 2. Себестоимость товаров ───────────────────────────── */
const COST_PRICE_HEADERS = ['Название', 'Артикул', 'Штрихкод', 'Себестоимость'];

router.post('/cost-price', requireAdmin, upload.single('file'), handleUpload('cost-price', async (buffer) => {
    const { rows } = parseSheet(buffer, COST_PRICE_HEADERS);

    let count = 0;
    for (const r of rows) {
        const costRaw = String(r['Себестоимость'] ?? '').trim();
        if (costRaw === '-- не указано --') continue;

        const article = String(r['Артикул'] || '').trim();
        if (!article) continue;

        await db.execute(
            `INSERT INTO product_costs (sku, article, name, barcode, cost_price, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (article) DO UPDATE SET
                sku        = EXCLUDED.sku,
                name       = EXCLUDED.name,
                barcode    = EXCLUDED.barcode,
                cost_price = EXCLUDED.cost_price,
                updated_at = NOW()`,
            [
                String(r['id'] || r['ID'] || '').trim(),
                article,
                String(r['Название'] || '').trim(),
                String(r['Штрихкод'] || '').trim(),
                parseNumber(costRaw),
            ]
        );
        count++;
    }
    return count;
}));

/* ─── 3. Начисления ──────────────────────────────────────── */
const TRANSACTIONS_HEADERS = ['ID начисления', 'Дата', 'Группа услуг', 'Тип начисления', 'Артикул', 'Сумма'];

router.post('/transactions', requireAdmin, upload.single('file'), handleUpload('transactions', async (buffer, filename) => {
    const account = detectAccount(filename);
    if (!account) throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');

    const { raw, rows } = parseSheet(buffer, TRANSACTIONS_HEADERS);
    const periodDate    = findPeriodDate(raw);

    let count = 0;
    for (const r of rows) {
        const date = parseExcelDate(r['Дата']);
        await db.execute(
            `INSERT INTO ozon_transactions
                (account, operation_id, operation_type, operation_type_name, operation_date, amount, period_from, period_to, raw, synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
                account,
                String(r['ID начисления'] || '').trim() || null,
                String(r['Группа услуг']  || '').trim() || null,
                String(r['Тип начисления']|| '').trim() || null,
                date,
                parseNumber(r['Сумма']),
                periodDate,
                periodDate,
                JSON.stringify({ article: r['Артикул'] ?? '' }),
            ]
        );
        count++;
    }
    return count;
}));

/* ─── 4. Юнит-экономика ──────────────────────────────────── */
const UNIT_ECONOMICS_HEADERS = ['SKU', 'Артикул', 'Название', 'Схема', 'Себестоимость', 'Выручка', 'Прибыль', 'Маржа'];

router.post('/unit-economics', requireAdmin, upload.single('file'), handleUpload('unit-economics', async (buffer, filename) => {
    const account = detectAccount(filename);
    if (!account) throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');

    const { periodStart, periodEnd } = parsePeriodFromFilename(filename);
    const { rows } = parseSheet(buffer, UNIT_ECONOMICS_HEADERS);

    let count = 0;
    for (const r of rows) {
        await db.execute(
            `INSERT INTO unit_economics
                (account, period_start, period_end, sku, article, name, scheme, cost_price, revenue, profit, margin, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
            [
                account,
                periodStart,
                periodEnd,
                String(r['SKU']     || '').trim(),
                String(r['Артикул'] || '').trim(),
                String(r['Название']|| '').trim(),
                String(r['Схема']   || '').trim(),
                parseNumber(r['Себестоимость']),
                parseNumber(r['Выручка']),
                parseNumber(r['Прибыль']),
                parseNumber(r['Маржа']),
            ]
        );
        count++;
    }
    return count;
}));

/* ─── 5. Финансовые отчёты (Точка банк, лист "Ozon - new") ─ */
router.post('/financial', requireAdmin, upload.single('file'), handleUpload('financial', async (buffer, filename) => {
    const account = detectAccount(filename);
    if (!account) throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');

    const { periodStart, periodEnd } = parsePeriodFromFilename(filename);

    const wb        = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find(n => n.trim() === 'Ozon - new') || wb.SheetNames[0];
    const ws        = wb.Sheets[sheetName];
    const raw       = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let count = 0;
    for (const row of raw) {
        if (!Array.isArray(row)) continue;
        const metric    = String(row[0] ?? '').trim();
        const amountRaw = row[1];
        if (!metric || !isNumericCell(amountRaw)) continue;

        await db.execute(
            `INSERT INTO financial_reports (account, period_start, period_end, metric, amount, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [account, periodStart, periodEnd, metric, parseNumber(amountRaw)]
        );
        count++;
    }
    return count;
}));

/* ─── История загрузок ───────────────────────────────────── */
router.get('/history', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT 200');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
