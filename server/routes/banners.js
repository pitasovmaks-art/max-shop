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
        textBlocks: b.text_blocks || null, // JSONB — pg уже отдаёт распарсенным
        bgStyle:    b.bg_style,
        bgColor:    b.bg_color || undefined,
        overlay:    b.overlay,
        textPos:    b.text_pos,
        createdAt: b.created_at,
        updatedAt: b.updated_at,
    };
}

/* ─── Оформление баннера: белый список + очистка ──────────────────────
   Один источник правды для POST и PUT. Схема блока (ТЗ, строго):
   { text: string 1–120 без переносов строк, size: s|m|l|xl,
     weight: regular|bold, italic: boolean, color: auto|light|dark|accent|custom,
     customColor: #RRGGBB (только при color='custom'), align: left|center|right,
     x, y: числа 0–100 (округляются до 0,1) — позиция блока на баннере,
     необязательные, задаются ТОЛЬКО вместе (см. sanitizeBlockPosition) }.
   XSS сюда не относится — это не санитайзер HTML, просто проверка формы;
   защита от XSS — на фронтенде (textContent/createTextNode, см.
   src/shared/bannerRender.js), текст как есть разрешён и здесь, и там. */
const MAX_TEXT_BLOCKS     = 4;
const VALID_BLOCK_SIZES   = new Set(['s', 'm', 'l', 'xl']);
const VALID_BLOCK_WEIGHTS = new Set(['regular', 'bold']);
const VALID_BLOCK_COLORS  = new Set(['auto', 'light', 'dark', 'accent', 'custom']);
const VALID_BLOCK_ALIGNS  = new Set(['left', 'center', 'right']);
const VALID_BG_STYLES     = new Set(['brand', 'dark', 'light', 'warm', 'cool', 'steel', 'custom']);
const VALID_OVERLAYS      = new Set(['none', 'light', 'medium', 'strong']);
const VALID_TEXT_POS      = new Set(['bottom-left', 'center', 'top-left']);
const HEX_COLOR_RE        = /^#[0-9A-Fa-f]{6}$/;
// Управляющие символы, которые тихо вырезаются из текста блока — кроме
// \n (0x0A) и \r (0x0D): перенос строки не вырезаем молча, а отклоняем
// запросом целиком (см. sanitizeTextBlock), чтобы админ сразу увидел
// причину, а не получил тихо склеенные в одну строку слова.
const CONTROL_CHARS_RE = /[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g;

function sanitizeTextBlock(raw, index) {
    const label = `Блок ${index + 1}`;
    if (!raw || typeof raw !== 'object') return { error: `${label}: некорректные данные` };
    if (typeof raw.text !== 'string') return { error: `${label}: текст обязателен` };
    if (/[\n\r]/.test(raw.text)) return { error: `${label}: текст не должен содержать переносы строк` };

    const text = raw.text.replace(CONTROL_CHARS_RE, '');
    if (text.length < 1 || text.length > 120) return { error: `${label}: длина текста должна быть от 1 до 120 символов` };
    if (!VALID_BLOCK_SIZES.has(raw.size))     return { error: `${label}: некорректный размер текста` };
    if (!VALID_BLOCK_WEIGHTS.has(raw.weight)) return { error: `${label}: некорректное начертание` };
    if (!VALID_BLOCK_COLORS.has(raw.color))   return { error: `${label}: некорректный цвет текста` };
    if (!VALID_BLOCK_ALIGNS.has(raw.align))   return { error: `${label}: некорректное выравнивание` };

    let customColor = null;
    if (raw.color === 'custom') {
        if (typeof raw.customColor !== 'string' || !HEX_COLOR_RE.test(raw.customColor)) {
            return { error: `${label}: укажите цвет текста в формате #RRGGBB` };
        }
        customColor = raw.customColor;
    }

    const pos = sanitizeBlockPosition(raw, label);
    if (pos.error) return { error: pos.error };

    return {
        block: { text, size: raw.size, weight: raw.weight, italic: !!raw.italic, color: raw.color, customColor, align: raw.align, x: pos.x, y: pos.y },
    };
}

/* Позиция блока (x/y, ТЗ п.8) — необязательна, но ТОЛЬКО вместе: одно
   поле без другого позиционировать блок не может (см. рендерер), поэтому
   отклоняется как некорректные данные, а не отбрасывается наполовину.
   Строки/NaN/выход за 0–100 — отклоняются (не приводятся к числу молча,
   чтобы кривой клиент сразу увидел ошибку, а не тихо потерял позицию). */
function sanitizeBlockPosition(raw, label) {
    const hasX = raw.x !== undefined && raw.x !== null;
    const hasY = raw.y !== undefined && raw.y !== null;
    if (!hasX && !hasY) return { x: null, y: null };
    if (!hasX || !hasY) return { error: `${label}: x и y должны быть заданы вместе` };
    if (typeof raw.x !== 'number' || !Number.isFinite(raw.x) || raw.x < 0 || raw.x > 100) {
        return { error: `${label}: x должен быть числом от 0 до 100` };
    }
    if (typeof raw.y !== 'number' || !Number.isFinite(raw.y) || raw.y < 0 || raw.y > 100) {
        return { error: `${label}: y должен быть числом от 0 до 100` };
    }
    return { x: Math.round(raw.x * 10) / 10, y: Math.round(raw.y * 10) / 10 };
}

function sanitizeBannerStyle(body) {
    const out = {};

    if (body.textBlocks === undefined || body.textBlocks === null) {
        out.textBlocks = null;
    } else {
        if (!Array.isArray(body.textBlocks)) return { error: 'textBlocks должен быть массивом' };
        if (body.textBlocks.length > MAX_TEXT_BLOCKS) return { error: `Максимум ${MAX_TEXT_BLOCKS} текстовых блока` };
        const blocks = [];
        for (let i = 0; i < body.textBlocks.length; i++) {
            const r = sanitizeTextBlock(body.textBlocks[i], i);
            if (r.error) return { error: r.error };
            blocks.push(r.block);
        }
        out.textBlocks = blocks.length ? blocks : null;
    }

    const bgStyle = body.bgStyle === undefined ? 'brand' : body.bgStyle;
    if (!VALID_BG_STYLES.has(bgStyle)) return { error: 'Некорректный стиль фона' };
    out.bgStyle = bgStyle;
    if (bgStyle === 'custom') {
        if (typeof body.bgColor !== 'string' || !HEX_COLOR_RE.test(body.bgColor)) {
            return { error: 'Укажите цвет фона в формате #RRGGBB' };
        }
        out.bgColor = body.bgColor;
    } else {
        out.bgColor = null;
    }

    const overlay = body.overlay === undefined ? 'medium' : body.overlay;
    if (!VALID_OVERLAYS.has(overlay)) return { error: 'Некорректное затемнение' };
    out.overlay = overlay;

    const textPos = body.textPos === undefined ? 'bottom-left' : body.textPos;
    if (!VALID_TEXT_POS.has(textPos)) return { error: 'Некорректное положение текста' };
    out.textPos = textPos;

    return { data: out };
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

    const styleResult = sanitizeBannerStyle(req.body);
    if (styleResult.error) return res.status(400).json({ error: styleResult.error });
    const style = styleResult.data;

    try {
        const maxRow = await db.queryOne('SELECT COALESCE(MAX(sort_order),-1) AS m FROM banners');
        const nextOrder = (maxRow?.m ?? -1) + 1;
        const row = await db.queryOne(
            `INSERT INTO banners (title,subtitle,image_url,link_type,link_id,sort_order,is_active,starts_at,ends_at,text_blocks,bg_style,bg_color,overlay,text_pos)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14) RETURNING id`,
            [
                title, subtitle || null, imageUrl || null, type,
                type === 'none' ? null : (linkId ?? null),
                nextOrder, isActive === false ? 0 : 1,
                startOfDayMsk(startsAt), endOfDayMsk(endsAt),
                style.textBlocks ? JSON.stringify(style.textBlocks) : null,
                style.bgStyle, style.bgColor, style.overlay, style.textPos,
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

    const styleResult = sanitizeBannerStyle(req.body);
    if (styleResult.error) return res.status(400).json({ error: styleResult.error });
    const style = styleResult.data;

    try {
        const changed = await db.execute(
            `UPDATE banners
             SET title=$1, subtitle=$2, image_url=$3, link_type=$4, link_id=$5,
                 is_active=$6, starts_at=$7, ends_at=$8,
                 text_blocks=$9::jsonb, bg_style=$10, bg_color=$11, overlay=$12, text_pos=$13,
                 updated_at=NOW()
             WHERE id=$14`,
            [
                title, subtitle || null, imageUrl || null, type,
                type === 'none' ? null : (linkId ?? null),
                isActive === false ? 0 : 1,
                startOfDayMsk(startsAt), endOfDayMsk(endsAt),
                style.textBlocks ? JSON.stringify(style.textBlocks) : null,
                style.bgStyle, style.bgColor, style.overlay, style.textPos,
                +req.params.id,
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
