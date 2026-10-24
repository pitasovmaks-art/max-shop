'use strict';

/* Единая точка пересчёта $ -> ₽ (usd-pricing, см. PROGRESS.md).

   Всё целочисленно, без единого float: центы и курс (×10000) — целые
   числа, арифметика — на BigInt, результат округляется ВВЕРХ до кратного
   50 рублям (1201 -> 1250, 1250 -> 1250, 1251 -> 1300).

   rateX10000: курс вида 92.4567 ₽ хранится как 924567.
   cents: $12.34 хранится как 1234. */

const db = require('../db');

const RUB_STEP = 50n;

/* cents * rateX10000 / 1_000_000 — целые рубли (до округления до 50),
   округление вверх на каждом шаге, никаких промежуточных чисел с
   плавающей точкой. */
function centsAndRateToRub(cents, rateX10000) {
    const c = BigInt(Math.round(Number(cents) || 0));
    const r = BigInt(Math.round(Number(rateX10000) || 0));
    if (c <= 0n || r <= 0n) return 0;

    const numerator = c * r;         // центы * (курс×10000)
    const unit       = 1000000n * RUB_STEP; // 50 рублей в тех же единицах
    const steps       = (numerator + unit - 1n) / unit; // округление вверх
    const rubles       = steps * RUB_STEP;

    return Number(rubles);
}

async function getCurrentRate() {
    const row = await db.queryOne(
        `SELECT rate FROM usd_rate_history ORDER BY created_at DESC, id DESC LIMIT 1`
    );
    return row ? row.rate : null;
}

async function getRateHistory() {
    return db.query(
        `SELECT rate, prev_rate, created_at FROM usd_rate_history ORDER BY created_at DESC, id DESC`
    );
}

/* Не рассылает уведомления сама — это отдельная забота (cart-sync.js),
   чтобы здесь оставался чистый пересчёт без побочных эффектов. */
async function setRate(newRateX10000) {
    const rate = Math.round(newRateX10000);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Курс должен быть положительным целым числом (×10000)');
    }
    const prevRate = await getCurrentRate();
    const row = await db.queryOne(
        `INSERT INTO usd_rate_history (rate, prev_rate) VALUES ($1, $2) RETURNING id, rate, prev_rate, created_at`,
        [rate, prevRate]
    );
    return { rate: row.rate, prevRate: row.prev_rate, rateVersion: row.id };
}

/* row — строка product_variants (snake_case, как из БД). Возвращает
   объект с теми же именами полей, перезаписанными конвертированными
   значениями, если is_usd=1. Рублёвые варианты (is_usd=0) возвращаются
   без изменений — п.1 задачи ("рублёвые товары не трогаются"). */
function applyUsdToVariantRow(row, rateX10000) {
    if (!row || Number(row.is_usd) !== 1) return row;

    const rate = rateX10000;
    const priceKrdPickup = rate ? centsAndRateToRub(row.usd_price_krd_pickup, rate) : 0;
    const priceMskPickup = rate ? centsAndRateToRub(row.usd_price_msk_pickup, rate) : 0;
    const salePrice       = rate && row.usd_sale_price > 0 ? centsAndRateToRub(row.usd_sale_price, rate) : 0;
    const surcharge        = Number(row.usd_delivery_surcharge_rub) || 0;
    const priceMskDelivery = priceMskPickup > 0 ? priceMskPickup + surcharge : 0;

    return {
        ...row,
        price_krd_pickup:   priceKrdPickup,
        price_msk_pickup:   priceMskPickup,
        price_msk_delivery: priceMskDelivery,
        sale_price:          salePrice,
    };
}

module.exports = {
    centsAndRateToRub,
    getCurrentRate,
    getRateHistory,
    setRate,
    applyUsdToVariantRow,
};
