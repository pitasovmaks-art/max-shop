const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const multer  = require('multer');
const express = require('express');
const router  = express.Router();
const { requireAdmin } = require('../middleware/auth');

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
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Allowed only image files'));
    },
});

router.post('/', requireAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const bucket = process.env.S3_BUCKET;
    if (!bucket) return res.status(500).json({ error: 'S3_BUCKET not configured' });

    const key = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    try {
        await s3.send(new PutObjectCommand({
            Bucket:      bucket,
            Key:         key,
            Body:        req.file.buffer,
            ContentType: 'image/jpeg',
            ACL:         'public-read',
        }));

        res.json({ ok: true, url: `https://${bucket}.s3.twcstorage.ru/${key}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
