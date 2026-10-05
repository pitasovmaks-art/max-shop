const router    = require('express').Router();
const crypto    = require('crypto');
const multer    = require('multer');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const db        = require('../db');
const { requireAdmin }  = require('../middleware/auth');
const { processImage }  = require('../utils/imageProcessor');
const { s3, bucket, publicUrl } = require('../utils/s3Client');

const VALID_LINK_TYPES = new Set(['product', 'category', 'subcategory', 'service', 'none']);

function normalize(b) {
    return {
        id:        b.id,
        title:     b.title,
        subtitle:  b.subtitle  || undefined,
        imageUrl:  b.image_url || undefined,
        linkType:  b.link_type,
        linkId:    b.link_id,
        sortOrder: b.sort_order,
        isActive:  b.is_active === 1,
        startsAt:  b.starts_at || undefined,
        endsAt:    b.ends_at   || undefined,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
    };
}

/* <input type=date> отдаёт только дату (YYYY-MM-DD) — считаем границы
   суток по Краснодару/Москве (UTC+3) и переводим в UTC перед записью в
   TIMESTAMP. endsAt — КОНЕЦ суток, а не начало: иначе баннер пропал бы
   на сутки раньше, чем ожидает владелец. */
function startOfDayMsk(dateStr) {
    if (!dateStr) return null;
    return new Date(`${dateStr}T00:00:00+03:00`).toISOString();
}
function endOfDayMsk(dateStr) {
    if (!dateStr) return null;
    return new Date(`${dateStr}T23:59:59+03:00`).toISOString();
}

/* GET /api/banners — публичный: только активные и в периоде показа,
   в порядке sort_order. Читает Главная. */
router.get('/', async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT * FROM banners
             WHERE is_active = 1
               AND (starts_at IS NULL OR starts_at <= NOW())
               AND (ends_at   IS NULL OR ends_at   >= NOW())
             ORDER BY sort_order, id`
        );
        res.json(rows.map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET /api/banners/all — админский: ВСЕ баннеры без фильтра по
   активности/периоду (иначе в админке нельзя было бы увидеть и включить
   обратно выключенный или ещё не начавшийся баннер). Объявлен раньше
   /:id-маршрутов по той же причине, что и reorder/upload ниже. */
router.get('/all', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query('SELECT * FROM banners ORDER BY sort_order, id');
        res.json(rows.map(normalize));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ─── Маршруты ниже объявлены ДО /:id и /:id-зависимых — иначе Express
   примет "reorder"/"upload" за значение :id. ───────────────────────── */

/* PUT /api/banners/reorder — {order:[...ids]}. Защищено от чужих id
   (игнорируются) и повторов (схлопываются); баннеры, пропущенные в
   order, не теряются — дописываются в конец в исходном относительном
   порядке. Источник истины — реальный список id в БД, не присланный
   массив. */
router.put('/reorder', requireAdmin, async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Expected { order: [...ids] }' });
    try {
        const existingIds = (await db.query('SELECT id FROM banners ORDER BY sort_order, id')).map(r => r.id);
        const existingSet = new Set(existingIds);

        const seen = new Set();
        const reconciled = [];
        for (const rawId of order) {
            const id = +rawId;
            if (existingSet.has(id) && !seen.has(id)) { reconciled.push(id); seen.add(id); }
        }
        for (const id of existingIds) {
            if (!seen.has(id)) reconciled.push(id);
        }

        await db.inTransaction(async (client) => {
            for (let i = 0; i < reconciled.length; i++) {
                await client.query('UPDATE banners SET sort_order=$1, updated_at=NOW() WHERE id=$2', [i, reconciled[i]]);
            }
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
        else cb(new Error('Допустимы только файлы JPEG, PNG или WebP'));
    },
});

/* POST /api/banners/upload — ресайз (1200px) + WebP (~200КБ) + S3.
   Ошибки sharp/S3 ловятся явно и отдаются понятным JSON, а не роняют
   процесс необработанным исключением. */
router.post('/upload', requireAdmin, (req, res) => {
    upload.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file provided' });
        if (!bucket) return res.status(500).json({ error: 'S3_BUCKET not configured' });

        try {
            const { buffer, contentType } = await processImage(req.file.buffer);
            const key = `banners/${Date.now()}-${crypto.randomUUID()}.webp`; // уникально на каждую загрузку — замена картинки не остаётся под старым URL в кэше
            await s3.send(new PutObjectCommand({
                Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, ACL: 'public-read',
            }));
            res.json({ ok: true, url: publicUrl(key) });
        } catch (e) {
            res.status(500).json({ error: 'Не удалось обработать изображение: ' + e.message });
        }
    });
});

/* POST /api/banners */
router.post('/', requireAdmin, async (req, res) => {
    const { title, subtitle, imageUrl, linkType, linkId, isActive, startsAt, endsAt } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const type = VALID_LINK_TYPES.has(linkType) ? linkType : 'none';
    try {
        const maxRow = await db.queryOne('SELECT COALESCE(MAX(sort_order),-1) AS m FROM banners');
        const nextOrder = (maxRow?.m ?? -1) + 1;
        const row = await db.queryOne(
            `INSERT INTO banners (title,subtitle,image_url,link_type,link_id,sort_order,is_active,starts_at,ends_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
            [
                title, subtitle || null, imageUrl || null, type,
                type === 'none' ? null : (linkId ?? null),
                nextOrder, isActive === false ? 0 : 1,
                startOfDayMsk(startsAt), endOfDayMsk(endsAt),
            ]
        );
        res.status(201).json(normalize(await db.queryOne('SELECT * FROM banners WHERE id=$1', [row.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/banners/:id — полная замена полей (включая isActive — этим же
   эндпоинтом пользуется мгновенный тумблер "Показывать" в списке). */
router.put('/:id', requireAdmin, async (req, res) => {
    const { title, subtitle, imageUrl, linkType, linkId, isActive, startsAt, endsAt } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const type = VALID_LINK_TYPES.has(linkType) ? linkType : 'none';
    try {
        const changed = await db.execute(
            `UPDATE banners
             SET title=$1, subtitle=$2, image_url=$3, link_type=$4, link_id=$5,
                 is_active=$6, starts_at=$7, ends_at=$8, updated_at=NOW()
             WHERE id=$9`,
            [
                title, subtitle || null, imageUrl || null, type,
                type === 'none' ? null : (linkId ?? null),
                isActive === false ? 0 : 1,
                startOfDayMsk(startsAt), endOfDayMsk(endsAt), +req.params.id,
            ]
        );
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json(normalize(await db.queryOne('SELECT * FROM banners WHERE id=$1', [+req.params.id])));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/banners/:id */
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const changed = await db.execute('DELETE FROM banners WHERE id=$1', [+req.params.id]);
        if (changed === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
