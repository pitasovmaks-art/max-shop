const sharp = require('sharp');

/* Общая утилита обработки изображений для загрузки в S3 — ресайз по ширине
   и конвертация в WebP с подбором качества под целевой размер файла.
   Сейчас используется баннерами (server/routes/banners.js); /api/upload
   (фото товаров, server/routes/upload.js) пока не переведён на неё — это
   отдельная, не выполненная в этой сессии задача.

   Валидация типа файла и лимит размера — на уровне multer (fileFilter +
   limits.fileSize) до вызова этой функции; сюда приходит уже проверенный
   буфер. */

const QUALITY_STEPS = [80, 70, 60, 50, 40];

/* sharp(buffer).rotate() без аргументов — поворачивает картинку по EXIF
   Orientation и встраивает поворот в пиксели. Без этого шага вертикальные
   фото с телефона лягут на бок: при конвертации в WebP метаданные EXIF
   теряются, а поворот без них безвозвратно пропадает. */
async function processImage(buffer, { maxWidth = 1200, maxBytes = 200 * 1024 } = {}) {
    const base = sharp(buffer).rotate().resize({ width: maxWidth, withoutEnlargement: true });

    let best = null;
    for (const quality of QUALITY_STEPS) {
        const out = await base.clone().webp({ quality }).toBuffer();
        if (!best || out.length < best.length) best = out;
        if (out.length <= maxBytes) { best = out; break; }
    }

    return { buffer: best, contentType: 'image/webp' };
}

module.exports = { processImage };
