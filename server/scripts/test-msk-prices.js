Object.assign(process.env,{NODE_ENV:'test',ADMIN_PASSWORD:'test-password',DB_HOST:'localhost',DB_NAME:'test',DB_USER:'test',DB_PASSWORD:'test'});
const assert=require('assert/strict'),express=require('express'),db=require('../db');
const {issueAdminToken}=require('../middleware/auth');
const {adjustedPrice,validateOptions}=require('../utils/mskPriceAdjustment');
let state,failUpdate=false,tail=Promise.resolve(),checks=0;
function reset(){state={variants:[
{id:1,product_id:1,name:'Пистолет',category_id:1,label:'14 дней',price:18990,sale:18000,is_krd:0,is_usd:0},
{id:2,product_id:1,name:'Пистолет',category_id:1,label:'14 дней',price:25000,sale:24000,is_krd:1,is_usd:0},
{id:3,product_id:2,name:'Долларовый',category_id:1,label:'Гарантия',price:10000,sale:9000,is_krd:0,is_usd:1},
{id:4,product_id:3,name:'Ящик',category_id:2,label:'',price:1000,sale:0,is_krd:0,is_usd:0}],products:[{id:5,name:'Без вариантов',category_id:2,price:501,price_msk:0,price_krd:777}],history:[]}}
async function query(sql,p=[],client){const s=sql.replace(/\s+/g,' ').trim();
 if(s==='BEGIN'){client.snapshot=structuredClone(state);return {rows:[]}}
 if(s==='COMMIT'){client.unlock?.();return {rows:[]}}
 if(s==='ROLLBACK'){state=client.snapshot;client.unlock?.();return {rows:[]}}
 if(s.startsWith('SELECT pg_advisory_xact_lock')){const prev=tail;tail=new Promise(r=>client.unlock=r);await prev;client.snapshot=structuredClone(state);return {rows:[]}}
 if(s.includes("SELECT 'variant' AS kind")){assert.ok(s.includes('COALESCE(v.is_usd,0)=0'));assert.ok(s.includes('COALESCE(v.is_krd,0)<>1'));return {rows:state.variants.filter(v=>!v.is_usd&&!v.is_krd).map(v=>({...v,kind:'variant',base_price:v.price,sale_price:v.sale}))}}
 if(s.includes("SELECT 'product' AS kind")){assert.ok(s.includes('NOT EXISTS'));return {rows:state.products.map(v=>({...v,kind:'product',product_id:v.id,label:'',base_price:v.price_msk||v.price,sale_price:0}))}}
 if(s.startsWith('SELECT options,changes FROM msk_price_adjustments')){const row=state.history.find(r=>r.request_id===p[0]);return {rows:row?[{...row,options:Object.fromEntries(Object.entries(row.options).reverse())}]:[]}}
 if(s.startsWith('UPDATE product_variants')){if(failUpdate)throw Error('simulated');const row=state.variants.find(v=>v.id===p[2]);assert.equal(row.is_krd,0);assert.equal(row.is_usd,0);row.price=p[0];row.sale=p[1];return {rows:[],rowCount:1}}
 if(s.startsWith('UPDATE products SET price_msk')){state.products.find(v=>v.id===p[1]).price_msk=p[0];return {rows:[],rowCount:1}}
 if(s.startsWith('INSERT INTO msk_price_adjustments')){state.history.push({request_id:p[0],options:JSON.parse(p[1]),changes:JSON.parse(p[2])});return {rows:[]}}
 throw Error('Unexpected SQL '+s);
}
db.pool.query=(s,p)=>query(s,p);db.pool.connect=async()=>{const client={release(){},query:(s,p)=>query(s,p,client)};return client};
async function main(){reset();const app=express();app.use(express.json());app.use('/prices',require('../routes/msk-prices'));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port,token=issueAdminToken();
const post=async(action,body,authorized=true)=>{const r=await fetch(base+'/prices/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()}};
const all={percent:5,scope:'all',includeSales:false};const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name)};
const applyBody=(options,preview)=>({...options,requestId:preview.body.requestId,fingerprint:preview.body.fingerprint});
try{
 await check('rounding is exact and upward to 50 rubles',()=>{assert.equal(adjustedPrice(18990,500),19950);assert.equal(adjustedPrice(27000,500),28350);assert.equal(adjustedPrice(27004,500),28400);assert.equal(adjustedPrice(100,1),150)});
 await check('reject invalid percentages and selectors',()=>{for(const percent of [0,-5,101,NaN,1.001,'5'])assert.throws(()=>validateOptions({...all,percent}));assert.throws(()=>validateOptions({percent:5,scope:'products',productIds:[]}));assert.throws(()=>adjustedPrice(2147483647,10000))});
 await check('preview and apply require admin auth',async()=>{assert.equal((await post('preview',all,false)).status,401);assert.equal((await post('apply',all,false)).status,401)});
 await check('preview does not change prices and excludes KRD/USD',async()=>{const before=structuredClone(state),r=await post('preview',all);assert.equal(r.status,200);assert.deepEqual(state,before);assert.equal(r.body.changes.length,3);assert.ok(!r.body.changes.some(v=>v.id===2||v.id===3));assert.equal(r.body.changes.find(v=>v.id===1).newSale,18000)});
 await check('selected category filters legacy products and variants',async()=>{const r=await post('preview',{...all,scope:'categories',categoryIds:[2]});assert.equal(r.body.changes.length,2);assert.ok(r.body.changes.every(v=>[3,5].includes(v.productId)))});
 await check('selected product filters all other products',async()=>{const r=await post('preview',{...all,scope:'products',productIds:[1]});assert.equal(r.body.changes.length,1)});
 await check('apply changes only Moscow, preserving KRD, USD and original generic base',async()=>{const r=await post('preview',all);assert.equal((await post('apply',applyBody(all,r))).status,200);assert.equal(state.variants[0].price,19950);assert.equal(state.variants[0].sale,18000);assert.equal(state.variants[1].price,25000);assert.equal(state.variants[1].sale,24000);assert.equal(state.variants[2].price,10000);assert.equal(state.products[0].price_msk,550);assert.equal(state.products[0].price,501);assert.equal(state.products[0].price_krd,777);assert.equal(state.history.length,1)});
 await check('repeat confirmation does not multiply prices, including JSONB key order',async()=>{const options={...all,scope:'products',productIds:[1]},p=await post('preview',options);await post('apply',applyBody(options,p));const before=structuredClone(state);const r=await post('apply',applyBody(options,p));assert.equal(r.status,200);assert.equal(r.body.repeated,true);assert.deepEqual(state,before)});
 await check('explicit sale option increases only existing Moscow sale',async()=>{reset();const options={...all,includeSales:true},p=await post('preview',options);await post('apply',applyBody(options,p));assert.equal(state.variants[0].sale,18900);assert.equal(state.variants[1].sale,24000);assert.equal(state.variants[3].sale,0)});
 await check('changed price after preview requires new preview without partial writes',async()=>{reset();const p=await post('preview',all);state.variants[0].price=19000;const before=structuredClone(state);assert.equal((await post('apply',applyBody(all,p))).status,409);assert.deepEqual(state,before)});
 await check('changed selection or percentage cannot reuse old preview',async()=>{reset();const p=await post('preview',all);assert.equal((await post('apply',applyBody({...all,percent:10},p))).status,409);assert.equal(state.history.length,0)});
 await check('failure rolls back the complete adjustment',async()=>{reset();const p=await post('preview',all),before=structuredClone(state);failUpdate=true;assert.equal((await post('apply',applyBody(all,p))).status,500);failUpdate=false;assert.deepEqual(state,before)});
 await check('parallel confirmations apply exactly once',async()=>{reset();const p=await post('preview',all),results=await Promise.all([post('apply',applyBody(all,p)),post('apply',applyBody(all,p))]);assert.ok(results.every(r=>r.status===200));assert.equal(state.history.length,1);assert.equal(state.variants[0].price,19950)});
 console.log('Passed '+checks+' Moscow pricing checks');
}finally{server.close();await db.pool.end()}}
main().catch(e=>{console.error(e);process.exitCode=1});
