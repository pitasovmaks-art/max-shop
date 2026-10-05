const { S3Client } = require('@aws-sdk/client-s3');

/* Общий S3-клиент (Timeweb Cloud Storage) — тот же конфиг, что и в
   server/routes/upload.js, вынесен сюда, чтобы не трогать upload.js
   (фото товаров) и не дублировать настройки для новых загрузчиков
   (сейчас — баннеры, server/routes/banners.js). */
const s3 = new S3Client({
    region:   'ru-1',
    endpoint: 'https://s3.twcstorage.ru',
    credentials: {
        accessKeyId:     process.env.S3_ACCESS_KEY || '',
        secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    forcePathStyle: true,
});

const bucket = process.env.S3_BUCKET;

function publicUrl(key) {
    return `https://${bucket}.s3.twcstorage.ru/${key}`;
}

module.exports = { s3, bucket, publicUrl };
