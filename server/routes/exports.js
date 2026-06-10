const router = require('express').Router();
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const S3_BUCKET = process.env.S3_BUCKET || '';

const s3 = new S3Client({
    region:   'ru-1',
    endpoint: 'https://s3.twcstorage.ru',
    credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    forcePathStyle: true,
});

/* GET /api/exports/list */
router.get('/list', async (req, res) => {
    try {
        if (!S3_BUCKET) return res.json([]);

        const data     = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'exports/' }));
        const contents = (data.Contents || []).filter(obj => obj.Key !== 'exports/');

        const files = await Promise.all(contents.map(async obj => {
            const url = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }),
                { expiresIn: 86400 }
            );
            return {
                name:       obj.Key.replace('exports/', ''),
                size:       obj.Size,
                modifiedAt: obj.LastModified,
                url,
            };
        }));

        files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
