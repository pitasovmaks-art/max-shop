'use strict';

/* Одноразовая очистка демо-каталога, который автоматически залился в
   прод-базу автосидом (до того как он был убран из server/db.js:init()).
   Чистит ТОЛЬКО каталог: categories, subcategories, products,
   product_variants, product_images, stores (CASCADE подтягивает
   зависимые FK автоматически). НЕ трогает favorites, orders,
   stock_subscriptions — там могут быть реальные пользовательские данные.

   Запуск: `node server/scripts/truncate-demo-catalog.js`
   (нужны те же DB_* переменные окружения, что и у сервера). */

try { process.loadEnvFile(); } catch { /* .env отсутствует — переменные заданы окружением */ }

const db = require('../db');

async function main() {
    console.log('[truncate-demo-catalog] Очищаю: categories, subcategories, products, product_variants, product_images, stores');
    await db.pool.query(
        'TRUNCATE product_images, product_variants, products, subcategories, categories, stores RESTART IDENTITY CASCADE'
    );
    console.log('[truncate-demo-catalog] Готово. favorites/orders/stock_subscriptions не затронуты.');
}

main()
    .catch((e) => {
        console.error('[truncate-demo-catalog] Ошибка:', e.message);
        console.error(e.stack);
        process.exitCode = 1;
    })
    .finally(() => db.pool.end());
