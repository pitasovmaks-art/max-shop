'use strict';

/* Одноразовое добавление реальных магазинов в таблицу stores
   (по аналогии с server/scripts/truncate-demo-catalog.js).

   Запуск: `node server/scripts/insert-real-stores.js`
   (нужны те же DB_* переменные окружения, что и у сервера). */

try { process.loadEnvFile(); } catch { /* .env отсутствует — переменные заданы окружением */ }

const db = require('../db');

const STORES = [
    { name: 'Селезнева',  city: 'Краснодар', address: 'Селезнева 4/10',                          hours: 'Пн–Сб 08:00–18:00', phone: '', directions: '', sort_order: 1 },
    { name: 'Котлярова',  city: 'Краснодар', address: 'Котлярова 21',                             hours: 'Пн–Сб 08:00–18:00', phone: '', directions: '', sort_order: 2 },
    { name: 'Москва',     city: 'Москва',    address: 'Аллея Первой Маевки 15, строение 3',       hours: 'Пн–Сб 08:00–18:00', phone: '', directions: '', sort_order: 3 },
];

async function main() {
    for (const s of STORES) {
        const existing = await db.queryOne(
            'SELECT id FROM stores WHERE name = $1 AND address = $2',
            [s.name, s.address]
        );
        if (existing) {
            console.log(`[insert-real-stores] Пропущен (уже есть, id=${existing.id}): ${s.name} — ${s.address}`);
            continue;
        }
        const row = await db.queryOne(
            `INSERT INTO stores (name, city, address, hours, phone, directions, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [s.name, s.city, s.address, s.hours, s.phone, s.directions, s.sort_order]
        );
        console.log(`[insert-real-stores] Добавлен id=${row.id}: ${s.name} — ${s.city}, ${s.address}`);
    }
    console.log('[insert-real-stores] Готово.');
}

main()
    .catch((e) => {
        console.error('[insert-real-stores] Ошибка:', e.message);
        console.error(e.stack);
        process.exitCode = 1;
    })
    .finally(() => db.pool.end());
