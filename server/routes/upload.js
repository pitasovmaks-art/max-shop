const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer  = require('multer');
const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { processImage } = require('../utils/imageProcessor');
const crypto = require('crypto');

const s3 = new S3Client({
    region:   'ru-1',
    endpoint: 'https://s3.twcstorage.ru',
    credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    forcePathStyle: true,
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (['image/jpeg','image/png','image/webp','image/avif','image/heic','image/heif'].includes(file.mimetype)) cb(null, true);
        else cb(new Error('Allowed only image files'));
    },
});

router.post('/', requireAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const bucket = process.env.S3_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'S3_BUCKET not configured' });

    const key = `products/${crypto.randomUUID()}.webp`;

    try {
        const processed = await processImage(req.file.buffer);
        await s3.send(new PutObjectCommand({
            Bucket:      bucket,
            Key:         key,
            Body:        processed.buffer,
            ContentType: processed.contentType,
            ACL:         'public-read',
        }));

        res.json({ ok: true, url: `https://${bucket}.s3.twcstorage.ru/${key}` });
    } catch (e) {
        console.error('[upload] image_upload_failed');
        res.status(400).json({ error: 'Не удалось обработать или сохранить изображение' });
    }
});

module.exports = router;
