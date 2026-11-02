process.env.NODE_ENV='test';
Object.assign(process.env,{DB_HOST:'localhost',DB_NAME:'test',DB_USER:'test',DB_PASSWORD:'test',ADMIN_PASSWORD:'test-admin-password',MAX_BOT_TOKEN:'test-max-token',SUPPORT_BOT_TOKEN:'test-support-token'});
const assert=require('assert/strict'),crypto=require('crypto'),fs=require('fs/promises'),os=require('os'),path=require('path'),express=require('express');
const db=require('../db'),{issueAdminToken}=require('../middleware/auth'),{webhookSecret,requireWebhook}=require('../middleware/webhook'),{securityHeaders}=require('../middleware/securityHeaders');
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
let state={services:[],items:[],jobs:[],orders:[],catalog:[]},failItems=false,failEnqueue=false,sendFails=false,sends=0,transactionRollbacks=0,lockTail=Promise.resolve();
const fakeBot={notifyStore:async()=>{sends++;if(sendFails)throw Error('simulated')},notifyServiceRequest:async()=>{sends++;if(sendFails)throw Error('simulated')},notifyCustomer:async()=>{}};
const botPath=require.resolve('../../bot');require.cache[botPath]={id:botPath,filename:botPath,loaded:true,exports:fakeBot};
const product={id:1,name:'Товар',in_stock:1,is_service:0,price:100,price_krd:100,price_msk:100};
async function query(sql,p=[],client){
 const s=sql.replace(/\s+/g,' ').trim();
 if(s==='BEGIN'){client.snapshot=structuredClone(state);return {rows:[]}}
 if(s==='COMMIT'){client.unlock?.();return {rows:[]}}
 if(s==='ROLLBACK'){state=client.snapshot;transactionRollbacks++;client.unlock?.();return {rows:[]}}
 if(s.startsWith('SELECT id,city,address FROM stores'))return {rows:[{id:1,city:'Москва',address:'Тестовая, 1'}]};
 if(s.startsWith('SELECT pg_advisory_xact_lock')){const prev=lockTail;lockTail=new Promise(r=>client.unlock=r);await prev;client.snapshot=structuredClone(state);return {rows:[]}}
 if(s.startsWith('SELECT COUNT(*)::int AS c FROM service_requests'))return {rows:[{c:state.services.filter(r=>r.tg_id===p[0]).length}]};
 if(s.startsWith('SELECT COUNT(*)::int AS c FROM orders'))return {rows:[{c:state.orders.filter(r=>r.tg_id===p[0]).length}]};
 if(s.startsWith('INSERT INTO service_requests')){const id=state.services.length+1;state.services.push({id,tg_id:p[0],name:p[1],phone:p[2],delivery_needed:p[4],address:p[5],comment:p[6]});return {rows:[{id}]}}
 if(s.startsWith('INSERT INTO service_request_items')){if(failItems)throw Error('item failure');state.items.push({request_id:p[0],tool_name:p[1],problem:p[2]});return {rows:[]}}
 if(s.startsWith('INSERT INTO service_request_events'))return {rows:[]};
 if(s.startsWith('INSERT INTO notification_outbox')){if(failEnqueue)throw Error('queue failure');state.jobs.push({id:state.jobs.length+1,kind:p[0],entity_id:p[1],attempts:0});return {rows:[]}}
 if(s.startsWith('SELECT * FROM products WHERE id IN'))return {rows:[product]};
 if(s.startsWith('SELECT * FROM product_variants WHERE product_id IN'))return {rows:[]};
 if(s.startsWith('SELECT id FROM orders WHERE tg_id=$1 AND client_request_id=$2'))return {rows:state.orders.filter(r=>r.tg_id===p[0]&&r.client_request_id===p[1]).map(r=>({id:r.id}))};
 if(s.startsWith('INSERT INTO orders')){const id=state.orders.length+1;state.orders.push({id,name:p[0],phone:p[1],store:p[2],delivery:p[3],address:p[4],city:p[5],tg_id:p[6],comment:p[7],items:p[8],total:p[9],delivery_carrier:p[10],client_request_id:p[11]});return {rows:[{id}]}}
 if(s.startsWith('SELECT * FROM orders WHERE id=$1'))return {rows:state.orders.filter(r=>r.id===p[0])};
 if(s.startsWith('SELECT * FROM service_requests WHERE id=$1'))return {rows:state.services.filter(r=>r.id===p[0])};
 if(s.startsWith('SELECT tool_name,problem FROM service_request_items'))return {rows:state.items.filter(r=>r.request_id===p[0])};
 if(s.startsWith('UPDATE notification_outbox SET locked_until=NOW()')){const jobs=state.jobs.filter(j=>!j.delivered_at&&j.attempts<12);jobs.forEach(j=>j.attempts++);return {rows:jobs}}
 if(s.startsWith('UPDATE notification_outbox SET delivered_at')){state.jobs.find(j=>j.id===p[0]).delivered_at=true;return {rows:[],rowCount:1}}
 if(s.startsWith('UPDATE notification_outbox SET locked_until=NULL'))return {rows:[],rowCount:1};
 if(s.startsWith('DELETE FROM notification_outbox'))return {rows:[],rowCount:0};
 if(s==='SELECT id, name FROM categories')return {rows:[{id:1,name:'Инструменты'}]};
 if(s==='SELECT id, name, category_id FROM subcategories')return {rows:[]};
 if(s.startsWith('SELECT COALESCE(MAX(sort_order'))return {rows:[{m:0}]};
 if(s.startsWith('SELECT id FROM products WHERE'))return {rows:p[1]==='DUP'?[{id:9}]:state.catalog.filter(r=>r.article===p[1] && r.brand===p[0] || r.name===p[2]).map(r=>({id:r.id}))};
 if(s.startsWith('INSERT INTO products')){const id=state.catalog.length+10;state.catalog.push({id,name:p[0],brand:p[7],article:p[8]});return {rows:[{id}]}}
 if(s.startsWith('INSERT INTO product_variants'))return {rows:[]};
 throw Error('Unexpected test SQL: '+s);
}
db.pool.query=(sql,p)=>query(sql,p);db.pool.connect=async()=>{const client={release(){},query:(sql,p)=>query(sql,p,client)};return client};
function initData(id){const sp=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id})});const str=[...sp].map(([k,v])=>k+'='+v).sort().join('\n');const key=crypto.createHmac('sha256','WebAppData').update(process.env.MAX_BOT_TOKEN).digest();sp.set('hash',crypto.createHmac('sha256',key).update(str).digest('hex'));return encodeURIComponent(sp.toString())}
const app=express();app.use(express.json());app.use(securityHeaders);
let handled=0;app.post('/webhook',requireWebhook('main'),(q,r)=>{handled++;r.sendStatus(200)});app.post('/webhook-support',requireWebhook('support'),(q,r)=>{handled++;r.sendStatus(200)});
app.get('/admin/',(q,r)=>r.send('admin'));app.use('/api/orders',require('../routes/orders'));app.use('/api/service-requests',require('../routes/service-requests'));app.use('/api/products',require('../routes/products'));
async function main(){const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const post=async(url,body={},headers={})=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>null),headers:r.headers}};
const auth={'X-Init-Data':initData(101)},order={name:'Иван',phone:'+79991234567',store:'Москва, Тестовая, 1',city:'msk',items:[{id:1,qty:1}],total:100,requestId:'test-request-00001'};
try{
 await check('unsigned manager webhook rejected before handler',async()=>{assert.equal((await post('/webhook-support',{update_type:'bot_started',user:{user_id:5149723},chat_id:900001})).status,401);assert.equal(handled,0)});
 await check('wrong webhook secret rejected',async()=>assert.equal((await post('/webhook',{update_type:'bot_started'},{'X-Max-Bot-Api-Secret':'wrong'})).status,401));
 await check('valid main webhook accepted',async()=>assert.equal((await post('/webhook',{update_type:'bot_started'},{'X-Max-Bot-Api-Secret':webhookSecret('main')})).status,200));
 await check('main secret cannot authenticate support bot',async()=>assert.equal((await post('/webhook-support',{update_type:'bot_started'},{'X-Max-Bot-Api-Secret':webhookSecret('main')})).status,401));
 await check('valid support webhook accepted',async()=>assert.equal((await post('/webhook-support',{update_type:'bot_started'},{'X-Max-Bot-Api-Secret':webhookSecret('support')})).status,200));
 await check('admin embedding blocked and MIME sniffing disabled',async()=>{const r=await fetch(base+'/admin/');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('x-content-type-options'),'nosniff')});
 await check('malformed phone rejected without DB write',async()=>{assert.equal((await post('/api/orders',{...order,phone:'123'},auth)).status,400);assert.equal(state.orders.length,0)});
 await check('unknown city rejected',async()=>assert.equal((await post('/api/orders',{...order,city:'unknown'},auth)).status,400));
 await check('order plus outbox committed together',async()=>{const r=await post('/api/orders',order,auth);assert.equal(r.status,201);assert.equal(state.orders.length,1);assert.equal(state.jobs.length,1);assert.equal(r.headers.get('cache-control'),'no-store')});
 await check('retry returns same order without duplication',async()=>{const r=await post('/api/orders',order,auth);assert.equal(r.status,201);assert.equal(r.body.id,1);assert.equal(state.orders.length,1);assert.equal(state.jobs.length,1)});
 await check('concurrent same request creates only one order',async()=>{const data={...order,requestId:'test-concurrent-0001'};const r=await Promise.all([post('/api/orders',data,auth),post('/api/orders',data,auth)]);assert.ok(r.every(v=>v.status===201));assert.equal(r[0].body.id,r[1].body.id);assert.equal(state.orders.length,2)});
 await check('outbox failure rolls back order',async()=>{failEnqueue=true;const count=state.orders.length;assert.equal((await post('/api/orders',{...order,requestId:'test-failure-00001'},auth)).status,500);assert.equal(state.orders.length,count);failEnqueue=false});
 const service={name:'Иван',phone:'+79991234567',consent:true,items:[{toolName:'Тест',problem:'Тест'}]};
 await check('item failure rolls back complete service request',async()=>{failItems=true;assert.equal((await post('/api/service-requests',service,auth)).status,500);assert.equal(state.services.length,0);assert.equal(state.items.length,0);failItems=false;assert.ok(transactionRollbacks>=2)});
 await check('parallel service submissions cannot bypass hourly limit',async()=>{const results=await Promise.all(Array.from({length:6},()=>post('/api/service-requests',service,auth)));assert.equal(results.filter(r=>r.status===201).length,5);assert.equal(results.filter(r=>r.status===429).length,1)});
 await check('outbox retains failed deliveries then retries successfully',async()=>{const outbox=require('../utils/notificationOutbox');sendFails=true;await outbox.drain();assert.ok(state.jobs.every(j=>!j.delivered_at));assert.ok(state.jobs.every(j=>j.attempts===1));sendFails=false;await outbox.drain();assert.ok(state.jobs.every(j=>j.delivered_at));assert.ok(sends>=state.jobs.length*2)});
 const admin={Authorization:'Bearer '+issueAdminToken()};
 await check('Excel preview validates without writing',async()=>{const before=JSON.stringify(state);const r=await post('/api/products/import?preview=1',[{name:'Новый',category:'Инструменты',priceMskPickup:100}],admin);assert.equal(r.status,200);assert.equal(r.body.created,1);assert.equal(r.body.preview,true);assert.equal(JSON.stringify(state),before)});
 await check('Excel duplicate SKU reported without writing',async()=>{const r=await post('/api/products/import?preview=1',[{name:'Дубль',category:'Инструменты',article:'DUP',priceMskPickup:100}],admin);assert.equal(r.body.created,0);assert.equal(r.body.skipped,1);assert.match(r.body.errors[0].reason,/существует/)});
 await check('invalid import price rejected in preview',async()=>{const r=await post('/api/products/import?preview=1',[{name:'Цена',category:'Инструменты',priceMskPickup:'oops'}],admin);assert.equal(r.body.created,0);assert.equal(r.body.skipped,1)});
 await check('Excel import creates once and skips repeated upload',async()=>{const rows=[{name:'Импорт',category:'Инструменты',brand:'Toua',article:'NEW',priceMskPickup:100}];let r=await post('/api/products/import',rows,admin);assert.equal(r.body.created,1);r=await post('/api/products/import',rows,admin);assert.equal(r.body.created,0);assert.equal(r.body.skipped,1);assert.equal(state.catalog.length,1)});
 await check('parallel imports cannot create the same SKU twice',async()=>{const rows=[{name:'Другой',category:'Инструменты',brand:'Toua',article:'PARALLEL',priceMskPickup:100}];const r=await Promise.all([post('/api/products/import',rows,admin),post('/api/products/import',rows,admin)]);assert.equal(r.reduce((sum,x)=>sum+x.body.created,0),1);assert.equal(state.catalog.length,2)});
 await check('pickup rejects a nonexistent store',async()=>{const r=await post('/api/orders',{...order,requestId:'bad-store-request-01',store:'Несуществующий магазин'},auth);assert.equal(r.status,400)});
 await check('HTML and image URL guards handle hostile content',async()=>{const vm=require('vm'),c={URL};vm.runInNewContext(await fs.readFile(path.join(__dirname,'../../src/shared/escHtml.js'),'utf8'),c);assert.equal(c.escHtml('<img onerror="1">'),'&lt;img onerror=&quot;1&quot;&gt;');for(const value of ['javascript:alert(1)','data:image/svg+xml,a','x" onerror="1','https://user:pass@example.com'])assert.equal(c.safeImageUrl(value),'');assert.equal(c.safeImageUrl('https://example.com/image.webp'),'https://example.com/image.webp')});
 await check('uploaded image decoded, SVG rejected',async()=>{const {processImage}=require('../utils/imageProcessor'),sharp=require('sharp');const png=await sharp({create:{width:5,height:5,channels:3,background:'white'}}).png().toBuffer();assert.equal((await processImage(png)).contentType,'image/webp');await assert.rejects(processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"></svg>')))});
 await check('backup encryption authenticates and rejects corruption',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tm-backup-test-'));try{const {encryptFile,decryptFile}=require('../utils/backupCrypto'),key=crypto.randomBytes(32),input=path.join(dir,'input'),enc=path.join(dir,'enc'),output=path.join(dir,'output');await fs.writeFile(input,'synthetic backup');await encryptFile(input,enc,key);await decryptFile(enc,output,key);assert.equal(await fs.readFile(output,'utf8'),'synthetic backup');const b=await fs.readFile(enc);b[b.length-1]^=1;await fs.writeFile(enc,b);await assert.rejects(decryptFile(enc,path.join(dir,'bad'),key));await assert.rejects(fs.stat(path.join(dir,'bad')))}finally{await fs.rm(dir,{recursive:true,force:true})}});
 await check('updated SheetJS reads Cyrillic XLSX and legacy CP1251 CSV',async()=>{const XLSX=require('xlsx'),iconv=require('iconv-lite'),vm=require('vm');const data=[['Название','Цена КРД'],['Пистолет',18990]],wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data),'Товары');const binary=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});const source=await fs.readFile(path.join(__dirname,'../routes/uploads.js'),'utf8');const start=source.indexOf('function readWorkbook('),end=source.indexOf('\n}',start)+2,c={XLSX,iconv};vm.runInNewContext(source.slice(start,end),c);for(const buffer of [binary,iconv.encode('Название;Цена КРД\nПистолет;18990','cp1251')]){const parsed=c.readWorkbook(buffer,{});assert.equal(XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]],{header:1})[1][0],'Пистолет')}});
 await check('old support mapping cannot redirect messages to another user or a group',async()=>{const {verifiedManagerMap}=require('../utils/supportRecipients');const rows=[{user_id:'1',chat_id:'100'},{user_id:'2',chat_id:'200'},{user_id:'3',chat_id:'300'},{user_id:'999',chat_id:'999'}];const lookup=async id=>id==='100'?{type:'dialog',dialog_with_user:{user_id:1}}:id==='200'?{type:'dialog',dialog_with_user:{user_id:999}}:{type:'chat',dialog_with_user:{user_id:3}};const result=await verifiedManagerMap(rows,[1,2,3],lookup);assert.deepEqual(result,{'1':'100'})});
 await check('DB CA enables certificate verification',async()=>{const {databaseSsl}=require('../utils/databaseSsl');assert.equal(databaseSsl({DB_SSL_VERIFY:'true'}).rejectUnauthorized,true);assert.deepEqual(databaseSsl({DB_SSL_CA:'test\\nCA'}),{rejectUnauthorized:true,ca:'test\nCA'})});
 console.log('Passed '+checks+' security/reliability checks');
}finally{server.close();await db.pool.end()}}
main().catch(e=>{console.error(e);process.exitCode=1});
