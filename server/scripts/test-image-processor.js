/* Проверка server/utils/imageProcessor.js на реальных картинках — без S3
   и без Postgres (POST /api/banners/upload тестируется тоже, но с
   застабленным S3-клиентом и без единого обращения к БД — маршрут
   /upload её и не трогает).

   Тестовые картинки генерируются через sharp во временную папку ОС
   (os.tmpdir()), в репозиторий не добавляются и остаются на диске для
   ручного осмотра (путь печатается в начале вывода).

   Проверяет:
   1. JPEG 4000×3000 с шумом (большой вес), тот же JPEG с EXIF
      orientation=6 (как вертикальное фото с iPhone), PNG 2000×800 с
      прозрачностью, маленький JPEG 600×300.
   2. Для каждого: content-type image/webp; ширина ≤1200; маленький не
      растянут (остаётся 600); итоговый размер ≤200КБ там, где это
      достижимо, иначе — лучший из перебранных вариантов без ошибки;
      у JPEG с orientation=6 итоговые ширина/высота повёрнуты
      (встроенный rotate() обязан отработать до ресайза).
   3. Мусорный файл, выданный за image/jpeg, -> понятная JSON-ошибка от
      POST /api/banners/upload (500, не падение процесса); файл >10МБ
      отклоняется на уровне multer (400) раньше, чем доходит до sharp.
   4. Итоговая таблица: файл -> КБ на входе/выходе, итоговые WxH,
      подобранное качество.

   Запуск: node server/scripts/test-image-processor.js
*/
process.env.DB_HOST       = process.env.DB_HOST       || 'localhost';
process.env.DB_NAME       = process.env.DB_NAME       || 'test';
process.env.DB_USER       = process.env.DB_USER       || 'test';
process.env.DB_PASSWORD   = process.env.DB_PASSWORD   || 'test';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'test-admin-password';
process.env.S3_BUCKET     = process.env.S3_BUCKET     || 'test-bucket';

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const sharp  = require('sharp');
const express = require('express');

const { processImage, QUALITY_STEPS } = require('../utils/imageProcessor');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'max-shop-image-test-'));

/* ─── Генераторы тестовых картинок ───────────────────────────────── */
function randomNoiseBuffer(width, height, channels) {
    const buf = Buffer.allocUnsafe(width * height * channels);
    crypto.randomFillSync(buf);
    return buf;
}

/* Шумный JPEG — случайные пиксели сжимаются JPEG'ом плохо, поэтому вес
   получается большим (в отличие от однотонных/градиентных картинок),
   что и нужно для проверки подбора качества под целевой размер. */
async function makeNoiseJpeg(width, height, { orientation } = {}) {
    const raw = randomNoiseBuffer(width, height, 3);
    let img = sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 });
    if (orientation) img = img.withMetadata({ orientation });
    return img.toBuffer();
}

async function makeTransparentPng(width, height) {
    return sharp({
        create: { width, height, channels: 4, background: { r: 70, g: 140, b: 200, alpha: 0.35 } },
    }).png().toBuffer();
}

async function makeSmallJpeg(width, height) {
    return sharp({
        create: { width, height, channels: 3, background: { r: 210, g: 110, b: 40 } },
    }).jpeg({ quality: 90 }).toBuffer();
}

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    console.log(`Временная папка с тестовыми картинками: ${TMP_DIR}\n`);

    /* ─── 1-2. processImage() на четырёх картинках ───────────────── */
    const cases = [];

    {
        const buf = await makeNoiseJpeg(4000, 3000);
        fs.writeFileSync(path.join(TMP_DIR, 'noise-4000x3000.jpg'), buf);
        cases.push({ label: 'JPEG 4000×3000, шум', buffer: buf });
    }
    {
        const buf = await makeNoiseJpeg(4000, 3000, { orientation: 6 });
        fs.writeFileSync(path.join(TMP_DIR, 'noise-4000x3000-exif6.jpg'), buf);
        cases.push({ label: 'JPEG 4000×3000, EXIF orientation=6 (как iPhone)', buffer: buf, expectRotated: true });
    }
    {
        const buf = await makeTransparentPng(2000, 800);
        fs.writeFileSync(path.join(TMP_DIR, 'alpha-2000x800.png'), buf);
        cases.push({ label: 'PNG 2000×800, альфа-канал', buffer: buf, expectAlpha: true });
    }
    {
        const buf = await makeSmallJpeg(600, 300);
        fs.writeFileSync(path.join(TMP_DIR, 'small-600x300.jpg'), buf);
        cases.push({ label: 'JPEG 600×300 (маленький)', buffer: buf, expectNoUpscale: true });
    }

    const tableRows = [];
    const MAX_BYTES = 200 * 1024;
    const LOWEST_QUALITY = QUALITY_STEPS[QUALITY_STEPS.length - 1];

    for (const c of cases) {
        const rawMeta = await sharp(c.buffer).metadata(); // без rotate() — "сырые" пиксельные размеры, как хранятся в файле
        const result  = await processImage(c.buffer, { maxWidth: 1200, maxBytes: MAX_BYTES });
        const outMeta = await sharp(result.buffer).metadata();

        tableRows.push({
            'Файл':            c.label,
            'Вход, КБ':        (c.buffer.length / 1024).toFixed(1),
            'Выход, КБ':       (result.buffer.length / 1024).toFixed(1),
            'Итог WxH':        `${outMeta.width}×${outMeta.height}`,
            'Качество':        result.quality,
        });

        console.log(`\n--- ${c.label} ---`);
        check('content-type image/webp', result.contentType === 'image/webp');
        check(`ширина ≤ 1200 (получили ${outMeta.width})`, outMeta.width <= 1200);

        const under200 = result.buffer.length <= MAX_BYTES;
        check(
            `размер ≤200КБ, либо (если недостижимо) лучший из перебранных вариантов без ошибки (${(result.buffer.length / 1024).toFixed(1)}КБ, качество=${result.quality})`,
            under200 || result.quality === LOWEST_QUALITY
        );

        if (c.expectNoUpscale) {
            check(`маленькая картинка НЕ растянута (ширина осталась ${rawMeta.width})`, outMeta.width === rawMeta.width);
        }

        if (c.expectRotated) {
            check(
                `сырой файл landscape (${rawMeta.width}×${rawMeta.height}) -> итог повёрнут в портрет (${outMeta.width}×${outMeta.height}, height>width)`,
                rawMeta.width > rawMeta.height && outMeta.height > outMeta.width
            );
        }

        if (c.expectAlpha) {
            check('альфа-канал сохранён в WebP (hasAlpha)', outMeta.hasAlpha === true);
        }
    }

    /* ─── 3. Мусорный файл и файл >10МБ — через реальный роут,
       S3 застаблен, БД не используется этим маршрутом вообще ────── */
    const { s3 } = require('../utils/s3Client');
    s3.send = async () => ({}); // не бьём по реальному S3
    const bannersRouter = require('../routes/banners');

    const app = express();
    app.use('/api/banners', bannersRouter);
    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const AUTH = { Authorization: `Bearer ${process.env.ADMIN_PASSWORD}` };

    console.log('\n--- Мусорный файл с типом image/jpeg ---');
    {
        const garbage = Buffer.from('это не картинка, просто текст. '.repeat(200));
        const form = new FormData();
        form.append('file', new Blob([garbage], { type: 'image/jpeg' }), 'garbage.jpg');
        const r = await fetch(`${base}/api/banners/upload`, { method: 'POST', headers: AUTH, body: form });
        const body = await r.json().catch(() => ({}));
        console.log(`   статус: ${r.status}, тело: ${JSON.stringify(body)}`);
        check('мусорный файл (image/jpeg, но не картинка) -> понятная JSON-ошибка (500), не падение сервера', r.status === 500 && typeof body.error === 'string' && body.error.length > 0);

        // Процесс не упал: HTTP-сервер по-прежнему принимает и завершает
        // соединения (статус ответа не важен — БД в этом тесте не
        // застаблена, важно само наличие ответа, а не обрыв/зависание).
        let stillAlive = false;
        try { stillAlive = !!(await fetch(`${base}/api/banners`)).status; } catch { stillAlive = false; }
        check('сервер остался живым после ошибки обработки (следующий запрос получает ответ, не обрыв соединения)', stillAlive);
    }

    console.log('\n--- Файл больше 10МБ ---');
    {
        const big = Buffer.alloc(11 * 1024 * 1024, 1);
        const form = new FormData();
        form.append('file', new Blob([big], { type: 'image/jpeg' }), 'big.jpg');
        const r = await fetch(`${base}/api/banners/upload`, { method: 'POST', headers: AUTH, body: form });
        const body = await r.json().catch(() => ({}));
        console.log(`   статус: ${r.status}, тело: ${JSON.stringify(body)}`);
        check('файл >10МБ отклонён на уровне multer (400), не дошёл до sharp', r.status === 400);
    }

    server.close();

    /* ─── 4. Таблица ─────────────────────────────────────────────── */
    console.log('\n=== Таблица: вход -> выход ===');
    console.table(tableRows);

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
