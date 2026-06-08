const router  = require('express').Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const iconv   = require('iconv-lite');
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

function fixEncoding(str) {
    try {
        return Buffer.from(str, 'latin1').toString('utf8');
    } catch (e) {
        return str;
    }
}

function detectAccount(filename) {
    const lower = fixEncoding(filename).toLowerCase();
    if (lower.includes('бм'))        return 'БМ';
    if (lower.includes('fix'))       return 'FIX';
    if (lower.includes('деталькин')) return 'Деталькин';
    return null;
}

function parsePeriodFromFilename(filename) {
    const lower    = fixEncoding(filename).toLowerCase();
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

function findPeriodRange(rawRows) {
    for (const row of rawRows) {
        for (const cell of (row || [])) {
            const m = /Период:?\s*(\d{2})\.(\d{2})\.(\d{4})\s*[-–—]\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(String(cell ?? ''));
            if (m) {
                return {
                    periodStart: `${m[3]}-${m[2]}-${m[1]}`,
                    periodEnd:   `${m[6]}-${m[5]}-${m[4]}`,
                };
            }
        }
    }
    return { periodStart: null, periodEnd: null };
}

/* ─── Чтение книги с учётом кодировки ────────────────────── */
// Выгрузки из ЛК продавца с расширением .xlsx часто на деле являются
// HTML/CSV-файлами в кодировке Windows-1251, а не настоящим xlsx (zip-архивом).
// Опция XLSX.read({ codepage: 1251 }) не декодирует такие буферы, поэтому
// вручную перекодируем не-zip буфер из CP1251 в UTF-8 через iconv-lite.
function readWorkbook(buffer, readOpts) {
    const isZip = buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4B; // сигнатура "PK"
    if (isZip) return XLSX.read(buffer, { type: 'buffer', ...readOpts });
    return XLSX.read(iconv.decode(buffer, 'cp1251'), { type: 'string', ...readOpts });
}

// Некоторые выгрузки — настоящие .xlsx (zip), но текстовые ячейки в них
// записаны байтами CP1251, прочитанными как отдельные code units (мойибаке
// вида "=0G8A;5=8O" вместо "начисления"). Перекодируем такую строку обратно.
function decodeCell(cell) {
    try {
        const buf = Buffer.alloc(cell.length);
        for (let i = 0; i < cell.length; i++) {
            buf[i] = cell.charCodeAt(i) & 0xff;
        }
        return iconv.decode(buf, 'cp1251');
    } catch (e) {
        return cell;
    }
}

/* ─── Чтение листа: поиск строки заголовков по известным именам ─ */
function parseSheet(buffer, knownHeaders, sheetNameHint, readOpts, opts = {}) {
    const wb        = readWorkbook(buffer, readOpts);
    const sheetName = sheetNameHint
        ? (wb.SheetNames.find(n => n.trim() === sheetNameHint) || wb.SheetNames[0])
        : wb.SheetNames[0];
    const ws  = wb.Sheets[sheetName];
    let raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (opts.decodeMojibake) {
        raw = raw.map(row => Array.isArray(row)
            ? row.map(cell => typeof cell === 'string' ? decodeCell(cell) : cell)
            : row);
    }

    // Строка заголовков должна содержать НЕСКОЛЬКО известных названий столбцов —
    // иначе строки вида "Категория: <название>" из шапки отчёта ложно матчатся
    // по одному совпадению ("Категория") раньше настоящей строки заголовков.
    const minMatches = Math.min(2, knownHeaders.length);
    const headerRowIdx = raw.findIndex(row =>
        Array.isArray(row) &&
        knownHeaders.filter(h => row.some(cell => String(cell).trim().includes(h))).length >= minMatches
    );
    if (headerRowIdx === -1) {
        console.log('Первые строки файла:', raw.slice(0, 5));
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

    const { raw, rows } = parseSheet(buffer, TRANSACTIONS_HEADERS, undefined, undefined, { decodeMojibake: true });
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
    if (!account) {
        console.log('Имя файла:', filename);
        console.log('Lower:', filename.toLowerCase());
        throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');
    }

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
    if (!account) {
        console.log('Имя файла:', filename);
        console.log('Lower:', filename.toLowerCase());
        throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');
    }

    const { periodStart, periodEnd } = parsePeriodFromFilename(filename);

    const wb        = readWorkbook(buffer);
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

/* ─── 6. Товары по аккаунтам ─────────────────────────────── */
const PRODUCTS_HEADERS = ['Артикул', 'Ozon Product ID', 'SKU', 'Barcode', 'Название товара'];

router.post('/products', requireAdmin, upload.single('file'), handleUpload('products', async (buffer, filename) => {
    const account = detectAccount(filename);
    if (!account) {
        console.log('Имя файла:', filename);
        console.log('Lower:', filename.toLowerCase());
        throw new Error('Не удалось определить аккаунт по имени файла (ожидается "бм", "fix" или "деталькин")');
    }

    const { rows } = parseSheet(buffer, PRODUCTS_HEADERS, 'Товары');

    let count = 0;
    for (const r of rows) {
        const article = String(r['Артикул'] || '').trim();
        if (!article) continue;

        await db.execute(
            `INSERT INTO ozon_products (account, article, ozon_product_id, sku, barcode, name, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (account, article) DO UPDATE SET
                ozon_product_id = EXCLUDED.ozon_product_id,
                sku             = EXCLUDED.sku,
                barcode         = EXCLUDED.barcode,
                name            = EXCLUDED.name,
                updated_at      = NOW()`,
            [
                account,
                article,
                String(r['Ozon Product ID'] || '').trim(),
                String(r['SKU']             || '').trim(),
                String(r['Barcode']         || '').trim(),
                String(r['Название товара'] || '').trim(),
            ]
        );
        count++;
    }
    return count;
}));

/* ─── 7. Категория и объём рынка ─────────────────────────── */
const CATEGORY_HEADERS = ['Категория', 'Заказано на сумму', 'Динамика суммы', 'Заказано товаров', 'Средняя цена', 'Динамика средней цены'];

router.post('/category', requireAdmin, upload.single('file'), handleUpload('category', async (buffer) => {
    const { raw, rows } = parseSheet(buffer, CATEGORY_HEADERS);
    const { periodStart, periodEnd } = findPeriodRange(raw);

    let count = 0;
    for (const r of rows) {
        const category = String(r['Категория'] || '').trim();
        if (!category) continue;

        await db.execute(
            `INSERT INTO ozon_category
                (category, orders_amount, orders_dynamic, orders_count, avg_price, price_dynamic, period_start, period_end, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
                category,
                parseNumber(r['Заказано на сумму']),
                parseNumber(r['Динамика суммы']),
                Math.round(parseNumber(r['Заказано товаров'])),
                parseNumber(r['Средняя цена']),
                parseNumber(r['Динамика средней цены']),
                periodStart,
                periodEnd,
            ]
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

/* ─── Очистка всех загруженных данных ────────────────────── */
router.delete('/clear-all', requireAdmin, async (req, res) => {
    try {
        await db.execute(`TRUNCATE TABLE
            upload_history, ozon_competitors, product_costs,
            unit_economics, financial_reports, ozon_transactions,
            ozon_products, ozon_category
            RESTART IDENTITY`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
