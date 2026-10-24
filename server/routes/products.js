const router           = require('express').Router();
const db               = require('../db');
const { requireAdmin, isValidAdminAuthHeader } = require('../middleware/auth');
const usdPrice         = require('../utils/usdPrice');

function normalize(p) {
    return {
        id:                   p.id,
        name:                 p.name,
        desc:                 p.desc,
        brand:                p.brand                   || undefined,
        article:              p.article                 || undefined,
        categoryId:           p.category_id,
        subId:                p.sub_id,
        price:                p.price,
        priceKrd:             p.price_krd               || 0,
        priceMsk:             p.price_msk               || 0,
        priceDelivery:        p.price_delivery          || 0,
        inStock:              p.in_stock                === 1,
        isService:            p.is_service              === 1,
        isHit:                p.is_hit                  === 1,
        priceLabel:           p.price_label             || undefined,
        image:                p.image                   || undefined,
        sortOrder:            p.sort_order              || 0,
        sortOrderInCategory:  p.sort_order_in_category  || 0,
    };
}

// Бренд/артикул — простой текст без разметки (рендерится только через
// textContent на фронте); обрезаем до разумной длины на входе, чтобы один
// слишком длинный запрос из админки/импорта не раздувал строки в БД.
const MAX_BRAND_ARTICLE_LEN = 100;
function sanitizeShortText(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return String(value).trim().slice(0, MAX_BRAND_ARTICLE_LEN);
}

// Поиск (q=) — экранирует спецсимволы ILIKE (% и _), чтобы они не
// интерпретировались как маски пользователя, и режет длину запроса и
// число результатов. Параметризовано — конкатенации SQL нет.
const MAX_SEARCH_QUERY_LEN   = 100;
const MAX_SEARCH_RESULTS     = 100;
function escapeLikePattern(q) {
    return q.replace(/[\\%_]/g, (c) => '\\' + c);
}

/* usd-pricing: rate — текущий курс (нужен, только если среди вариантов
   реально есть $-строки, см. вызовы ниже), includeUsdRaw — только для
   запросов с валидным admin-токеном (см. isAdminRequest ниже): тогда в
   ответе дополнительно идут сырые $-поля для формы редактирования.
   Рублёвые поля — ВСЕГДА уже пересчитанные ₽ (applyUsdToVariantRow),
   независимо от includeUsdRaw — клиентские формулы их не отличают от
   обычных рублёвых значений (п.6 задачи). */
function normalizeVariant(v, { rate, includeUsdRaw } = {}) {
    const row = usdPrice.applyUsdToVariantRow(v, rate);
    const out = {
        id:              row.id,
        productId:       row.product_id,
        label:           row.label,
        price:           row.price,
        priceKrd:        row.price_krd          || 0,
        priceMsk:        row.price_msk          || 0,
        priceDelivery:   row.price_delivery     || 0,
        priceKrdPickup:  row.price_krd_pickup   || 0,
        priceMskPickup:  row.price_msk_pickup   || 0,
        priceMskDelivery:row.price_msk_delivery || 0,
        isKrd:           row.is_krd             === 1,
        isDefault:       row.is_default         === 1,
        sortOrder:       row.sort_order,
        salePrice:       row.sale_price         || 0,
    };
    if (includeUsdRaw) {
        // Центы -> доллары: граница API всегда в долларах (как рубли везде
        // в админке — целыми, не копейками), центы — только внутри БД.
        out.isUsd                   = Number(v.is_usd) === 1;
        out.usdPriceKrdPickup       = (v.usd_price_krd_pickup || 0) / 100;
        out.usdPriceMskPickup       = (v.usd_price_msk_pickup || 0) / 100;
        out.usdSalePrice            = (v.usd_sale_price       || 0) / 100;
        out.usdDeliverySurchargeRub = v.usd_delivery_surcharge_rub || 0;
    }
    return out;
}

// Необязательная (не блокирующая) проверка admin-токена — см. комментарий
// у normalizeVariant/attachVariants. Неверный/отсутствующий токен просто
// означает includeUsdRaw=false, запрос не отклоняется.
function isAdminRequest(req) {
    return isValidAdminAuthHeader(req.headers.authorization);
}

async function attachVariants(products, opts = {}) {
    if (!products.length) return products;
    const allVars = await db.query(
        'SELECT * FROM product_variants ORDER BY sort_order, id'
    );
    const rate = allVars.some(v => Number(v.is_usd) === 1) ? await usdPrice.getCurrentRate() : null;
    const byProduct = {};
    allVars.forEach(v => {
        if (!byProduct[v.product_id]) byProduct[v.product_id] = [];
        byProduct[v.product_id].push(normalizeVariant(v, { rate, includeUsdRaw: opts.includeUsdRaw }));
    });
    products.forEach(p => {
        p.variants = byProduct[p.id] || [];
        p.isSale   = p.variants.some(v => v.salePrice > 0);
    });
    return products;
}

/* GET /api/products?categoryId=&subId=&q= — q ищет по name/brand/article,
   без учёта регистра, по подстроке; % и _ в запросе экранируются, чтобы
   не работали как маски ILIKE, а не как обычные символы поиска. */
router.get('/', async (req, res) => {
    try {
        let sql = 'SELECT * FROM products WHERE 1=1';
        const params = [];
        let i = 1;
        let hasQuery = false;
        if (req.query.categoryId) { sql += ` AND category_id=$${i++}`; params.push(+req.query.categoryId); }
        if (req.query.subId)      { sql += ` AND sub_id=$${i++}`;      params.push(+req.query.subId); }
        const rawQuery = req.query.q ? String(req.query.q).trim().slice(0, MAX_SEARCH_QUERY_LEN) : '';
        if (rawQuery) {
            hasQuery = true;
            const q = `%${escapeLikePattern(rawQuery)}%`;
            sql += ` AND (name ILIKE $${i} OR brand ILIKE $${i+1} OR article ILIKE $${i+2})`;
            params.push(q, q, q); i += 3;
        }
        sql += req.query.categoryId ? ' ORDER BY sort_order_in_category, id' : ' ORDER BY sort_order, id';
        if (hasQuery) { sql += ` LIMIT $${i++}`; params.push(MAX_SEARCH_RESULTS); }
        const products = (await db.query(sql, params)).map(normalize);
        res.json(await attachVariants(products, { includeUsdRaw: isAdminRequest(req) }));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products/import */
router.post('/import', requireAdmin, async (req, res) => {
    const rows = req.body;
    if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Expected array of rows' });

    const categories   = await db.query('SELECT id, name FROM categories');
    const subcategories = await db.query('SELECT id, name, category_id FROM subcategories');
    const catByName    = Object.fromEntries(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
    const subByName    = {};
    subcategories.forEach(s => {
        subByName[`${s.category_id}::${s.name.trim().toLowerCase()}`] = s.id;
    });

    // Group rows by (name + category) preserving insertion order
    const groups = [];
    const groupMap = {};
    rows.forEach((row, idx) => {
        const key = `${String(row.name || '').trim()}::${String(row.category || '').trim().toLowerCase()}`;
        if (!groupMap[key]) { groupMap[key] = []; groups.push({ key, rows: groupMap[key] }); }
        groupMap[key].push({ ...row, _idx: idx + 2 }); // +2: header row + 1-based
    });

    let created = 0;
    let skipped = 0;
    const errors = [];

    const globalMaxRow = await db.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products');
    let globalOrder = (globalMaxRow?.m ?? 0);

    for (const { rows: grp } of groups) {
        const first   = grp[0];
        const name    = String(first.name || '').trim();
        const catName = String(first.category || '').trim().toLowerCase();

        if (!name) {
            grp.forEach(r => errors.push({ row: r._idx, reason: 'Пустое название товара' }));
            skipped++; continue;
        }
        const categoryId = catByName[catName];
        if (!categoryId) {
            grp.forEach(r => errors.push({ row: r._idx, reason: `Категория не найдена: "${first.category}"` }));
            skipped++; continue;
        }

        // usd-pricing, п.12: строка, где одновременно заполнены рублёвые
        // (priceKrdPickup/priceMskPickup/priceMskDelivery) И $-колонки
        // (priceKrdPickupUsd/priceMskPickupUsd) — ошибка на уровне строки,
        // остальные строки того же товара обрабатываются как обычно.
        const mixedRows = [];
        const validRows = [];
        for (const r of grp) {
            const hasRub = (+r.priceKrdPickup || 0) > 0 || (+r.priceMskPickup || 0) > 0 || (+r.priceMskDelivery || 0) > 0;
            const hasUsd = (+r.priceKrdPickupUsd || 0) > 0 || (+r.priceMskPickupUsd || 0) > 0;
            if (hasRub && hasUsd) mixedRows.push(r); else validRows.push(r);
        }
        mixedRows.forEach(r => errors.push({
            row: r._idx, reason: `Строка смешивает рубли и $ — разделите на отдельные строки (товар "${name}")`,
        }));

        const hasPrice = validRows.some(r =>
            (+r.priceKrdPickup || 0) > 0 || (+r.priceMskPickup || 0) > 0 || (+r.priceMskDelivery || 0) > 0 ||
            (+r.priceKrdPickupUsd || 0) > 0 || (+r.priceMskPickupUsd || 0) > 0
        );
        if (!hasPrice) {
            // Если все строки уже отмечены как смешанные — не дублировать
            // ошибку: у каждой уже есть своя конкретная причина выше.
            if (!mixedRows.length) {
                grp.forEach(r => errors.push({ row: r._idx, reason: `Нет ни одной цены у товара "${name}"` }));
            }
            skipped++; continue;
        }

        const subName = String(first.subcategory || '').trim().toLowerCase();
        const subId   = subName ? (subByName[`${categoryId}::${subName}`] ?? null) : null;
        const inStock = first.inStock === undefined || first.inStock === '' ? true : !!+first.inStock;
        const desc    = String(first.desc || '').trim() || null;
        // Бренд/артикул — необязательные колонки; старые файлы без них
        // импортируются как раньше (оба поля просто остаются null).
        const brand   = sanitizeShortText(first.brand)   || null;
        const article = sanitizeShortText(first.article) || null;

        try {
            await db.inTransaction(async (client) => {
                globalOrder++;
                const catMaxRes = await client.query(
                    'SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1',
                    [categoryId]
                );
                const catOrder = (catMaxRes.rows[0]?.m ?? 0) + 1;

                const prodRes = await client.query(
                    `INSERT INTO products
                     (name,"desc",category_id,sub_id,price,price_krd,price_msk,price_delivery,
                      in_stock,is_service,sort_order,sort_order_in_category,brand,article)
                     VALUES ($1,$2,$3,$4,0,0,0,0,$5,0,$6,$7,$8,$9) RETURNING id`,
                    [name, desc, categoryId, subId, inStock ? 1 : 0, globalOrder, catOrder, brand, article]
                );
                const productId = prodRes.rows[0].id;

                // Each Excel row may produce up to two variants (KRD + MSK),
                // matching _collectVariants() in admin.js: KRD and MSK groups each
                // have their own isDefault, tracked independently — because
                // _effectiveVariant filters by city first, then looks for isDefault
                // within that city's subset.
                const hasExplicitDefault = validRows.some(r => +r.isDefault === 1);
                let defaultKrdSet = false;
                let defaultMskSet = false;
                let sortIdx = 0;
                for (let i = 0; i < validRows.length; i++) {
                    const r        = validRows[i];
                    const label    = String(r.variantLabel || '').trim();
                    const krdPrice = +r.priceKrdPickup   || 0;
                    const mskPrice = +r.priceMskPickup   || 0;
                    const delPrice = +r.priceMskDelivery || 0;
                    // usd-pricing, п.12: $ вводятся в долларах/центах дробно
                    // (напр. "12.34"), в БД хранятся целыми центами.
                    const krdPriceUsdCents  = Math.round((+r.priceKrdPickupUsd || 0) * 100);
                    const mskPriceUsdCents  = Math.round((+r.priceMskPickupUsd || 0) * 100);
                    const salePriceUsdCents = Math.round((+r.salePriceUsd       || 0) * 100);
                    const deliverySurchargeRub = Math.round(+r.deliverySurchargeRub || 0);
                    const rowWantsDefault = hasExplicitDefault ? +r.isDefault === 1 : i === 0;

                    if (krdPrice > 0) {
                        const def = rowWantsDefault && !defaultKrdSet;
                        if (def) defaultKrdSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order)
                             VALUES ($1,$2,0,0,0,0,$3,0,0,1,$4,$5)`,
                            [productId, label, krdPrice, def ? 1 : 0, sortIdx++]
                        );
                    }
                    if (mskPrice > 0 || delPrice > 0) {
                        const def = rowWantsDefault && !defaultMskSet;
                        if (def) defaultMskSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order)
                             VALUES ($1,$2,0,0,0,0,0,$3,$4,0,$5,$6)`,
                            [productId, label, mskPrice, delPrice, def ? 1 : 0, sortIdx++]
                        );
                    }
                    if (krdPriceUsdCents > 0) {
                        const def = rowWantsDefault && !defaultKrdSet;
                        if (def) defaultKrdSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order,
                              is_usd,usd_price_krd_pickup,usd_price_msk_pickup,usd_sale_price,usd_delivery_surcharge_rub)
                             VALUES ($1,$2,0,0,0,0,0,0,0,1,$3,$4,1,$5,0,$6,0)`,
                            [productId, label, def ? 1 : 0, sortIdx++, krdPriceUsdCents, salePriceUsdCents]
                        );
                    }
                    if (mskPriceUsdCents > 0) {
                        const def = rowWantsDefault && !defaultMskSet;
                        if (def) defaultMskSet = true;
                        await client.query(
                            `INSERT INTO product_variants
                             (product_id,label,price,price_krd,price_msk,price_delivery,
                              price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order,
                              is_usd,usd_price_krd_pickup,usd_price_msk_pickup,usd_sale_price,usd_delivery_surcharge_rub)
                             VALUES ($1,$2,0,0,0,0,0,0,0,0,$3,$4,1,0,$5,$6,$7)`,
                            [productId, label, def ? 1 : 0, sortIdx++, mskPriceUsdCents, salePriceUsdCents, deliverySurchargeRub]
                        );
                    }
                }
            });
            created++;
        } catch (e) {
            grp.forEach(r => errors.push({ row: r._idx, reason: `Ошибка БД: ${e.message}` }));
            skipped++;
        }
    }

    res.json({ created, skipped, errors });
});

/* PUT /api/products/reorder */
router.put('/reorder', requireAdmin, async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Expected { order: [...ids] }' });
    try {
        await db.inTransaction(async (client) => {
            for (let i = 0; i < order.length; i++) {
                await client.query('UPDATE products SET sort_order=$1 WHERE id=$2', [i, order[i]]);
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/reorder-category */
router.put('/reorder-category', requireAdmin, async (req, res) => {
    const { categoryId, order } = req.body;
    if (!Array.isArray(order) || !categoryId) return res.status(400).json({ error: 'Expected { categoryId, order: [...ids] }' });
    try {
        await db.inTransaction(async (client) => {
            for (let i = 0; i < order.length; i++) {
                await client.query(
                    'UPDATE products SET sort_order_in_category=$1 WHERE id=$2 AND category_id=$3',
                    [i, order[i], categoryId]
                );
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/export — admin-only, п.13: выгрузка каталога в том же
   формате колонок, что ждёт POST /import (включая $-колонки), чтобы можно
   было выгрузить -> поправить в Excel -> загрузить обратно. Одна строка
   на вариант (как и ждёт импорт); товар без вариантов — одна пустая
   ценовая строка. Без S3 — .xlsx собирается в памяти и отдаётся сразу. */
router.get('/export', requireAdmin, async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const [products, categories, subcategories, variants] = await Promise.all([
            db.query('SELECT * FROM products ORDER BY sort_order, id'),
            db.query('SELECT id, name FROM categories'),
            db.query('SELECT id, name FROM subcategories'),
            db.query('SELECT * FROM product_variants ORDER BY product_id, sort_order, id'),
        ]);
        const catName = Object.fromEntries(categories.map(c => [c.id, c.name]));
        const subName = Object.fromEntries(subcategories.map(s => [s.id, s.name]));
        const variantsByProduct = {};
        variants.forEach(v => {
            if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
            variantsByProduct[v.product_id].push(v);
        });

        const rows = [];
        const baseRow = (p) => ({
            'Название':    p.name,
            'Категория':   catName[p.category_id]    || '',
            'Подкатегория':subName[p.sub_id]          || '',
            'Описание':    p.desc                     || '',
            'Бренд':       p.brand                    || '',
            'Артикул':     p.article                  || '',
            'Наличие':     p.in_stock === 1 ? 1 : 0,
        });
        products.forEach(p => {
            const vars = variantsByProduct[p.id] || [];
            if (!vars.length) { rows.push({ ...baseRow(p), 'Вариант': '', 'Цена КРД': 0, 'Цена МСК': 0, 'Цена доставка': 0, 'По умолчанию': 0, 'Цена КРД $': 0, 'Цена МСК $': 0, 'Наценка доставка ₽': 0, 'Скидка $': 0 }); return; }
            vars.forEach(v => {
                rows.push({
                    ...baseRow(p),
                    'Вариант':             v.label || '',
                    'Цена КРД':            Number(v.is_usd) === 1 ? 0 : (v.price_krd_pickup   || 0),
                    'Цена МСК':            Number(v.is_usd) === 1 ? 0 : (v.price_msk_pickup   || 0),
                    'Цена доставка':       Number(v.is_usd) === 1 ? 0 : (v.price_msk_delivery || 0),
                    'По умолчанию':        v.is_default === 1 ? 1 : 0,
                    'Цена КРД $':          Number(v.is_usd) === 1 ? (v.usd_price_krd_pickup || 0) / 100 : 0,
                    'Цена МСК $':          Number(v.is_usd) === 1 ? (v.usd_price_msk_pickup || 0) / 100 : 0,
                    'Наценка доставка ₽':  Number(v.is_usd) === 1 ? (v.usd_delivery_surcharge_rub || 0) : 0,
                    'Скидка $':            Number(v.is_usd) === 1 ? (v.usd_sale_price || 0) / 100 : 0,
                });
            });
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Товары');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="catalog-export.xlsx"');
        res.send(buf);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id */
router.get('/:id', async (req, res) => {
    try {
        const p = await db.queryOne('SELECT * FROM products WHERE id=$1', [+req.params.id]);
        if (!p) return res.status(404).json({ error: 'Not found' });
        const product = normalize(p);
        await attachVariants([product], { includeUsdRaw: isAdminRequest(req) });
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id/variants */
router.get('/:id/variants', async (req, res) => {
    try {
        const vars = await db.query(
            'SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id',
            [+req.params.id]
        );
        const rate = vars.some(v => Number(v.is_usd) === 1) ? await usdPrice.getCurrentRate() : null;
        const includeUsdRaw = isAdminRequest(req);
        res.json(vars.map(v => normalizeVariant(v, { rate, includeUsdRaw })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/:id/variants — replace all variants */
router.put('/:id/variants', requireAdmin, async (req, res) => {
    const productId = +req.params.id;
    const variants  = req.body;
    if (!Array.isArray(variants)) return res.status(400).json({ error: 'Expected array' });
    try {
        // Check current sale state before replacing — считаем и рублёвую,
        // и $-скидку (usd_sale_price), иначе старт $-акции не триггерил бы
        // уведомление подписчикам.
        const hadSaleRow = await db.queryOne(
            'SELECT 1 FROM product_variants WHERE product_id=$1 AND (sale_price>0 OR usd_sale_price>0)', [productId]
        );
        const hadSale = !!hadSaleRow;

        // Защита от старого (не знающего про $) admin.js: он не присылает
        // поле isUsd вообще (ни true, ни false), а при чтении товара видит
        // в priceKrdPickup/priceMskPickup/salePrice уже КОНВЕРТИРОВАННОЕ в ₽
        // значение $-варианта (applyUsdToVariantRow) — если сохранить его
        // как обычную рублёвую цену, $-вариант незаметно превратится в
        // рублёвый с "замороженным" по текущему курсу значением. Поэтому
        // для строк без isUsd в теле запроса — если по (label,isKrd) уже
        // существует $-вариант, его is_usd/usd_*-поля и рублёвые колонки
        // (у $-варианта они всегда 0, см. _collectVariants в admin.js)
        // берём из БД как есть, игнорируя то, что прислал старый клиент.
        const existingRows = await db.query('SELECT * FROM product_variants WHERE product_id=$1', [productId]);
        const existingByKey = new Map();
        existingRows.forEach(r => existingByKey.set(`${r.label}|${r.is_krd}`, r));

        await db.inTransaction(async (client) => {
            await client.query('DELETE FROM product_variants WHERE product_id=$1', [productId]);
            for (let i = 0; i < variants.length; i++) {
                const v = variants[i];
                const label = String(v.label).trim();
                const isKrd = v.isKrd ? 1 : 0;
                const existing = existingByKey.get(`${label}|${isKrd}`);
                const oldClientRow = v.isUsd === undefined && existing && Number(existing.is_usd) === 1;

                const isUsd                  = oldClientRow ? 1 : (v.isUsd ? 1 : 0);
                const usdPriceKrdPickupCents  = oldClientRow ? existing.usd_price_krd_pickup       : Math.round((v.usdPriceKrdPickup || 0) * 100);
                const usdPriceMskPickupCents  = oldClientRow ? existing.usd_price_msk_pickup       : Math.round((v.usdPriceMskPickup || 0) * 100);
                const usdSalePriceCents       = oldClientRow ? existing.usd_sale_price             : Math.round((v.usdSalePrice       || 0) * 100);
                const usdDeliverySurchargeRub = oldClientRow ? existing.usd_delivery_surcharge_rub : (v.usdDeliverySurchargeRub || 0);
                // $-вариант всегда хранит рублёвые колонки нулями — не даём
                // старому клиенту записать туда конвертированное по курсу
                // число, которое он по ошибке принял за обычную рублёвую цену.
                const priceKrdPickup   = oldClientRow ? 0 : (v.priceKrdPickup   || 0);
                const priceMskPickup   = oldClientRow ? 0 : (v.priceMskPickup   || 0);
                const priceMskDelivery = oldClientRow ? 0 : (v.priceMskDelivery || 0);
                const salePrice         = oldClientRow ? 0 : (v.salePrice        || 0);

                await client.query(
                    `INSERT INTO product_variants
                     (product_id,label,price,price_krd,price_msk,price_delivery,
                      price_krd_pickup,price_msk_pickup,price_msk_delivery,is_krd,is_default,sort_order,sale_price,
                      is_usd,usd_price_krd_pickup,usd_price_msk_pickup,usd_sale_price,usd_delivery_surcharge_rub)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
                    [productId, label,
                     v.price || 0, v.priceKrd || 0, v.priceMsk || 0, v.priceDelivery || 0,
                     priceKrdPickup, priceMskPickup, priceMskDelivery,
                     isKrd, v.isDefault ? 1 : 0, v.sortOrder ?? i, salePrice,
                     // usd-pricing: с админки приходят доллары (как и везде
                     // в форме — целые единицы валюты), в БД храним центами.
                     isUsd, usdPriceKrdPickupCents, usdPriceMskPickupCents, usdSalePriceCents, usdDeliverySurchargeRub]
                );
            }
        });

        const saved = await db.query(
            'SELECT * FROM product_variants WHERE product_id=$1 ORDER BY sort_order, id',
            [productId]
        );
        const rate = saved.some(v => Number(v.is_usd) === 1) ? await usdPrice.getCurrentRate() : null;
        res.json(saved.map(v => normalizeVariant(v, { rate, includeUsdRaw: true })));

        // Async sale notification after response
        const hasSale = variants.some(v => (v.salePrice || 0) > 0 || (v.usdSalePrice || 0) > 0);
        if (hasSale && !hadSale) {
            // New sale started — notify subscribers if not already notified
            setImmediate(async () => {
                try {
                    const product = await db.queryOne('SELECT name, sale_notified FROM products WHERE id=$1', [productId]);
                    if (!product || product.sale_notified === 1) return;
                    const subscribers = await db.query('SELECT tg_id FROM promo_subscribers WHERE unsubscribed_at IS NULL');
                    if (!subscribers.length) return;
                    const { notifyPromo } = require('../../bot');
                    for (const s of subscribers) {
                        await notifyPromo(s.tg_id, product.name);
                        await new Promise(r => setTimeout(r, 250));
                    }
                    await db.execute('UPDATE products SET sale_notified=1 WHERE id=$1', [productId]);
                    console.log(`[promo] Notified ${subscribers.length} subscriber(s) for product ${productId}`);
                } catch (e) {
                    console.error('[promo] Notify error:', e.message);
                }
            });
        } else if (!hasSale && hadSale) {
            // Sale removed — reset flag so next sale triggers notification again
            db.execute('UPDATE products SET sale_notified=0 WHERE id=$1', [productId])
              .catch(e => console.error('[promo] Reset sale_notified error:', e.message));
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products */
router.post('/', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery, inStock, isService, isHit, priceLabel, image, brand, article } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (typeof image === 'string' && image.startsWith('data:')) {
        return res.status(400).json({ error: 'image must be S3 URL, not base64' });
    }
    try {
        const [globalMax, catMax] = await Promise.all([
            db.queryOne('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products'),
            categoryId
                ? db.queryOne('SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1', [categoryId])
                : Promise.resolve({ m: 0 }),
        ]);
        const nextOrder    = (globalMax?.m ?? 0) + 1;
        const nextCatOrder = (catMax?.m ?? 0) + 1;
        const row = await db.queryOne(
            `INSERT INTO products (name,"desc",category_id,sub_id,price,price_krd,price_msk,price_delivery,in_stock,is_service,is_hit,price_label,image,sort_order,sort_order_in_category,brand,article)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
            [name, desc || null, categoryId || null, subId || null, price || 0,
             priceKrd || 0, priceMsk || 0, priceDelivery || 0,
             inStock ? 1 : 0, isService ? 1 : 0, isHit ? 1 : 0, priceLabel || null, image || null, nextOrder, nextCatOrder,
             sanitizeShortText(brand) || null, sanitizeShortText(article) || null]
        );
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [row.id]));
        await attachVariants([product], { includeUsdRaw: true });
        res.status(201).json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/products/:id */
router.put('/:id', requireAdmin, async (req, res) => {
    const { name, desc, categoryId, subId, price, priceKrd, priceMsk, priceDelivery, inStock, isService, isHit, priceLabel, image, brand, article } = req.body;
    if (typeof image === 'string' && image.startsWith('data:')) {
        return res.status(400).json({ error: 'image must be S3 URL, not base64' });
    }
    try {
        const current = await db.queryOne('SELECT in_stock, category_id FROM products WHERE id=$1', [+req.params.id]);
        if (!current) return res.status(404).json({ error: 'Not found' });
        const wasInStock  = current.in_stock    === 1;
        const nowInStock  = !!inStock;
        const catChanged  = String(current.category_id) !== String(categoryId || null);

        let newCatOrder = undefined;
        if (catChanged && categoryId) {
            const catMax = await db.queryOne(
                'SELECT COALESCE(MAX(sort_order_in_category), 0) AS m FROM products WHERE category_id=$1',
                [categoryId]
            );
            newCatOrder = (catMax?.m ?? 0) + 1;
        }

        // isHit не передан (undefined) в теле -> is_hit в БД не меняется
        // (COALESCE на существующее значение). Сбросить в 0 можно только
        // явным isHit:false/0 — иначе вызовы вроде quickToggleStock()
        // (или любой другой код, который ещё не знает про isHit) тихо
        // стирали бы ранее выставленный хит при каждом PUT.
        const isHitParam = isHit !== undefined ? (isHit ? 1 : 0) : null;

        // brand/article не переданы (undefined) в теле -> не меняются (та же
        // COALESCE-логика, что у isHit). Переданная пустая строка '' — это не
        // SQL NULL, поэтому COALESCE её не отбрасывает и реально очищает поле.
        const brandParam   = brand   !== undefined ? sanitizeShortText(brand)   : null;
        const articleParam = article !== undefined ? sanitizeShortText(article) : null;

        const hasCatOrder        = newCatOrder !== undefined;
        const brandPlaceholder   = hasCatOrder ? '$16' : '$15';
        const articlePlaceholder = hasCatOrder ? '$17' : '$16';

        const changed = await db.execute(
            `UPDATE products
             SET name=$1,"desc"=$2,category_id=$3,sub_id=$4,price=$5,
                 price_krd=$6,price_msk=$7,price_delivery=$8,
                 in_stock=$9,is_service=$10,is_hit=COALESCE($11,is_hit),price_label=$12,image=$13,
                 brand=COALESCE(${brandPlaceholder},brand),article=COALESCE(${articlePlaceholder},article)
                 ${hasCatOrder ? ',sort_order_in_category=$15' : ''}
             WHERE id=$14`,
            hasCatOrder
                ? [name, desc || null, categoryId || null, subId || null, price || 0,
                   priceKrd || 0, priceMsk || 0, priceDelivery || 0,
                   inStock ? 1 : 0, isService ? 1 : 0, isHitParam, priceLabel || null, image || null, +req.params.id, newCatOrder, brandParam, articleParam]
                : [name, desc || null, categoryId || null, subId || null, price || 0,
                   priceKrd || 0, priceMsk || 0, priceDelivery || 0,
                   inStock ? 1 : 0, isService ? 1 : 0, isHitParam, priceLabel || null, image || null, +req.params.id, brandParam, articleParam]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        const product = normalize(await db.queryOne('SELECT * FROM products WHERE id=$1', [+req.params.id]));
        await attachVariants([product], { includeUsdRaw: true });
        res.json(product);

        // false → true: notify subscribers asynchronously after response
        if (!wasInStock && nowInStock) {
            setImmediate(async () => {
                try {
                    const subs = await db.query(
                        'SELECT tg_id FROM stock_subscriptions WHERE product_id=$1 AND notified=FALSE',
                        [+req.params.id]
                    );
                    if (!subs.length) return;
                    const { notifyStock } = require('../../bot');
                    for (const s of subs) {
                        await notifyStock(s.tg_id, product.name);
                        await new Promise(r => setTimeout(r, 250));
                    }
                    await db.execute(
                        'UPDATE stock_subscriptions SET notified=TRUE WHERE product_id=$1 AND notified=FALSE',
                        [+req.params.id]
                    );
                    console.log(`[stock-notify] Notified ${subs.length} subscriber(s) for product ${req.params.id}`);
                } catch (e) {
                    console.error('[stock-notify] Notify error:', e.message);
                }
            });
        }

        // true → false: delete already-notified rows so users must re-subscribe for next cycle
        if (wasInStock && !nowInStock) {
            db.execute(
                'DELETE FROM stock_subscriptions WHERE product_id=$1 AND notified=TRUE',
                [+req.params.id]
            ).catch(e => console.error('[stock-notify] Cleanup error:', e.message));
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/products/:id/images */
router.get('/:id/images', async (req, res) => {
    try {
        const rows = await db.query(
            'SELECT * FROM product_images WHERE product_id=$1 ORDER BY sort_order, id',
            [+req.params.id]
        );
        res.json(rows.map(r => ({ id: r.id, productId: r.product_id, url: r.url, sortOrder: r.sort_order })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/products/:id/images */
router.post('/:id/images', requireAdmin, async (req, res) => {
    const { url, sort_order } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
        const row = await db.queryOne(
            'INSERT INTO product_images (product_id,url,sort_order) VALUES ($1,$2,$3) RETURNING *',
            [+req.params.id, url, sort_order ?? 0]
        );
        res.status(201).json({ id: row.id, productId: row.product_id, url: row.url, sortOrder: row.sort_order });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/products/:id/images/:imageId */
router.delete('/:id/images/:imageId', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute(
            'DELETE FROM product_images WHERE id=$1 AND product_id=$2',
            [+req.params.imageId, +req.params.id]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/products/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute('DELETE FROM products WHERE id=$1', [+req.params.id]);
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
