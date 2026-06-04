const CLIENT_ID = process.env.OZON_CLIENT_ID;
const API_KEY   = process.env.OZON_API_KEY;
const BASE      = 'https://api-seller.ozon.ru';

async function post(path, body) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Client-Id': CLIENT_ID, 'Api-Key': API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

// ── Prices raw ───────────────────────────────────────────────
console.log('\n=== /v5/product/info/prices — raw top-level keys ===');
const p = await post('/v5/product/info/prices', { filter: {}, last_id: '', limit: 3 });
console.log('status:', p.status);
console.log('top-level keys:', Object.keys(p.body));
console.log('result keys:', p.body.result ? Object.keys(p.body.result) : 'no result');
console.log('raw:', JSON.stringify(p.body, null, 2).slice(0, 800));

// ── Stocks raw ───────────────────────────────────────────────
console.log('\n=== /v4/product/info/stocks — raw top-level keys ===');
const s = await post('/v4/product/info/stocks', { filter: {}, last_id: '', limit: 3 });
console.log('status:', s.status);
console.log('top-level keys:', Object.keys(s.body));
console.log('result keys:', s.body.result ? Object.keys(s.body.result) : 'no result');
console.log('raw:', JSON.stringify(s.body, null, 2).slice(0, 800));
