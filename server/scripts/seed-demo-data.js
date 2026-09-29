'use strict';

/* Явный ручной запуск: TRUNCATE каталога + заполнение демо-данными.
   Ничего похожего больше не выполняется автоматически при старте сервера —
   см. server/db.js:init(). Запуск: `npm run seed:demo`
   (нужны те же DB_* переменные окружения, что и у сервера). */

try { process.loadEnvFile(); } catch { /* .env отсутствует — переменные заданы окружением */ }

const db = require('../db');

db.resetToDefaults()
    .then(() => {
        console.log('[seed-demo-data] Готово: каталог очищен и заполнен демо-данными');
        return db.pool.end();
    })
    .catch((e) => {
        console.error('[seed-demo-data] Ошибка:', e.message);
        console.error(e.stack);
        process.exitCode = 1;
        return db.pool.end();
    });
