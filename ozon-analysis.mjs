/**
 * Ozon Seller API — data export
 * Usage: OZON_CLIENT_ID=xxx OZON_API_KEY=yyy node ozon-analysis.js
 * Output: ozon-data/{products,prices,stocks,analytics}.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/* ─── Config ─────────────────────────────────────────────── */
const CLIENT_ID = process.env.OZON_CLIENT_ID;
const API_KEY   = process.env.OZON_API_KEY;
const BASE_URL  = 'https://api-seller.ozon.ru';
const OUT_DIR   = './ozon-data';

const PAUSE_MS       = 500;   // between requests
const BATCH_SIZE     = 1000;  // items per page
const INFO_BATCH     = 100;   // product/info/list max
const ANALYTICS_DAYS = 90;

if (!CLIENT_ID || !API_KEY) {
    console.error('Error: set OZON_CLIENT_ID and OZON_API_KEY environment variables');
    process.exit(1);
}

/* ─── Helpers ────────────────────────────────────────────── */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function ozonPost(path, body) {
    const url = BASE_URL + path;
    const res = await fetch(url, {
        method:  'POST',
        headers: {
            'Client-Id':    CLIENT_ID,
            'Api-Key':      API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} — ${path}\n${text}`);
    }

    return res.json();
}

async function save(filename, data) {
    const dest = join(OUT_DIR, filename);
    await writeFile(dest, JSON.stringify(data, null, 2), 'utf8');
    log(`Saved ${dest} (${Array.isArray(data) ? data.length + ' items' : JSON.stringify(data).length + ' bytes'})`);
}

/* ─── 1. Products ────────────────────────────────────────── */
async function fetchProducts() {
    log('=== Products: fetching list ===');
    const allItems = [];
    let lastId = '';

    while (true) {
        const data = await ozonPost('/v3/product/list', {
            filter:  {},
            last_id: lastId,
            limit:   BATCH_SIZE,
        });

        const items = data?.result?.items ?? [];
        if (!items.length) break;

        allItems.push(...items);
        lastId = data.result.last_id;
        log(`  List: fetched ${allItems.length} so far (last_id=${lastId})`);

        if (!lastId || items.length < BATCH_SIZE) break;
        await sleep(PAUSE_MS);
    }

    log(`Products list complete: ${allItems.length} products. Fetching details...`);

    const productIds = allItems.map(i => i.product_id);
    const details    = [];

    for (let i = 0; i < productIds.length; i += INFO_BATCH) {
        const chunk = productIds.slice(i, i + INFO_BATCH);
        const data  = await ozonPost('/v3/product/info/list', { product_id: chunk });
        const items = data?.items ?? [];          // top-level, no result wrapper
        details.push(...items);
        log(`  Details: ${details.length}/${productIds.length}`);
        if (i + INFO_BATCH < productIds.length) await sleep(PAUSE_MS);
    }

    await save('products.json', details);
    return productIds;
}

/* ─── 2. Prices ──────────────────────────────────────────── */
async function fetchPrices() {
    log('=== Prices ===');
    const allItems = [];
    let cursor = '';

    while (true) {
        const data = await ozonPost('/v5/product/info/prices', {
            filter:  {},
            last_id: cursor,
            limit:   BATCH_SIZE,
        });

        const items = data?.items ?? [];          // top-level, pagination via cursor
        if (!items.length) break;

        allItems.push(...items);
        cursor = data.cursor ?? '';
        log(`  Prices: fetched ${allItems.length} so far`);

        if (!cursor || items.length < BATCH_SIZE) break;
        await sleep(PAUSE_MS);
    }

    await save('prices.json', allItems);
}

/* ─── 3. Stocks ──────────────────────────────────────────── */
async function fetchStocks() {
    log('=== Stocks ===');
    const allItems = [];
    let cursor = '';

    while (true) {
        const data = await ozonPost('/v4/product/info/stocks', {
            filter:  {},
            last_id: cursor,
            limit:   BATCH_SIZE,
        });

        const items = data?.items ?? [];          // top-level, pagination via cursor
        if (!items.length) break;

        allItems.push(...items);
        cursor = data.cursor ?? '';
        log(`  Stocks: fetched ${allItems.length} so far`);

        if (!cursor || items.length < BATCH_SIZE) break;
        await sleep(PAUSE_MS);
    }

    await save('stocks.json', allItems);
}

/* ─── 4. Analytics ───────────────────────────────────────── */
async function fetchAnalytics() {
    log('=== Analytics (last 90 days) ===');

    const now      = new Date();
    const dateTo   = now.toISOString().slice(0, 10);
    const dateFrom = new Date(now - ANALYTICS_DAYS * 86400_000).toISOString().slice(0, 10);

    log(`  Period: ${dateFrom} → ${dateTo}`);

    const allRows = [];
    let offset    = 0;

    while (true) {
        const data = await ozonPost('/v1/analytics/data', {
            date_from:  dateFrom,
            date_to:    dateTo,
            dimension:  ['sku', 'day'],
            metrics:    ['ordered_units', 'revenue'],
            limit:      BATCH_SIZE,
            offset,
        });

        const rows  = data?.result?.data ?? [];
        const total = data?.result?.totals ?? null;

        if (!rows.length) break;

        allRows.push(...rows);
        log(`  Analytics: fetched ${allRows.length} rows so far`);

        if (rows.length < BATCH_SIZE) break;
        offset += BATCH_SIZE;
        await sleep(PAUSE_MS);
    }

    await save('analytics.json', { dateFrom, dateTo, rows: allRows });
}

/* ─── Main ───────────────────────────────────────────────── */
async function main() {
    if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

    const started = Date.now();
    log('Starting Ozon data export...');

    try {
        await fetchProducts();
        await sleep(PAUSE_MS);

        await fetchPrices();
        await sleep(PAUSE_MS);

        await fetchStocks();
        await sleep(PAUSE_MS);

        await fetchAnalytics();

        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        log(`Done in ${elapsed}s. Files in ${OUT_DIR}/`);
    } catch (err) {
        console.error('\nFailed:', err.message);
        process.exit(1);
    }
}

main();
