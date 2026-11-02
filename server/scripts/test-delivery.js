/* Real auth/router + fake address provider. No external requests or orders. */
process.env.MAX_BOT_TOKEN = 'delivery-test-token';
process.env.ADMIN_PASSWORD = 'delivery-test-admin';
process.env.BOT_ADMIN_IDS = '123';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { createRouter } = require('../routes/address-suggestions');
function signed(id) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({id}) });
    const secret = crypto.createHmac('sha256','WebAppData').update(process.env.MAX_BOT_TOKEN).digest();
    params.set('hash',crypto.createHmac('sha256',secret).update([...params].map(([k,v])=>`${k}=${v}`).sort().join('\n')).digest('hex'));
    return encodeURIComponent(params.toString());
}
async function main() {
    let calls=0,lastRequest;
    const app=express();
    app.use('/disabled',createRouter({token:''}));
    app.use('/broken',createRouter({token:'test',fetchImpl:async()=>{throw Error('network')}}));
    app.use('/suggest',createRouter({token:'server-only-key',fetchImpl:async(url,options)=>{
        calls++;lastRequest={url,...options};return {ok:true,json:async()=>({suggestions:[
            {value:'ул Авроры',data:{city:'Самара'}},
            {value:'ул Авроры, д 7',data:{city:'Самара',house:'7'}},
            {value:'Москва, Авроры 7',data:{city:'Москва',house:'7'}},
        ]})};
    }}));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    let count=0;
    const check=(name,fn)=>{fn();count++;console.log('✅ '+name)};
    const get=async(path,auth=signed(123))=>{const res=await fetch(base+path,{headers:auth?{'X-Init-Data':auth}:{}});return {status:res.status,body:await res.json()}};
    try {
        let r=await get('/suggest?city=Самара&q=Авр',null);
        check('unauthenticated request rejected',()=>assert.equal(r.status,401));
        r=await get('/disabled?city=Самара&q=Авр');
        check('no key: explicit disabled response, manual input remains available',()=>assert.deepEqual(r.body,{enabled:false,suggestions:[]}));
        r=await get('/suggest?city=Самара&q=А');
        check('short query rejected before provider',()=>assert.equal(r.status,400));
        r=await get('/suggest?city=&q=Авр');
        check('missing city rejected',()=>assert.equal(r.status,400));
        r=await get('/suggest?city=Самара&q='+ 'a'.repeat(201));
        check('long query rejected',()=>assert.equal(r.status,400));
        r=await get('/suggest?city=Самара&q=Авр');
        check('street and house suggestions returned',()=>assert.equal(r.body.suggestions.length,2));
        check('other-city suggestions removed',()=>assert.ok(r.body.suggestions.every(s=>!s.value.includes('Москва'))));
        check('house flag differentiates partial street from complete address',()=>assert.deepEqual(r.body.suggestions.map(s=>s.hasHouse),[false,true]));
        check('city passed as provider restriction',()=>assert.deepEqual(JSON.parse(lastRequest.body).locations,[{city:'Самара'}]));
        check('only server sends provider key',()=>{assert.equal(lastRequest.headers.Authorization,'Token server-only-key');assert.ok(!JSON.stringify(r.body).includes('server-only-key'))});
        r=await get('/broken?city=Самара&q=Авр');
        check('provider failure gives recoverable 503',()=>assert.equal(r.status,503));
        for(let i=0;i<29;i++) await get('/suggest?city=Самара&q=Авр');
        const previous=calls;r=await get('/suggest?city=Самара&q=Авр');
        check('30/min per-user quota, excess never reaches provider',()=>{assert.equal(r.status,429);assert.equal(calls,previous)});
        r=await get('/suggest?city=Самара&q=Авр',signed(456));
        check('other user has separate quota',()=>assert.equal(r.status,200));
        // Exercise real bot formatting and CDEK route with HTTPS stubbed at the boundary.
        const https=require('https'),{EventEmitter}=require('events');
        const originalRequest=https.request;
        let message='';
        https.request=(options,callback)=>{
            const request=new EventEmitter();let body='';
            request.write=chunk=>{body+=chunk};request.setTimeout=()=>request;
            request.end=()=>queueMicrotask(()=>{
                const response=new EventEmitter();response.statusCode=200;callback(response);
                let payload={};
                if(options.path==='/v2/oauth/token')payload={access_token:'test-token',expires_in:3600};
                else if(options.path.startsWith('/v2/location/cities'))payload=[{city:'Самара',code:63}];
                else if(options.path.startsWith('/v2/deliverypoints'))payload=Array.from({length:65},(_,i)=>({code:'S'+i,location:{address:'Тестовая, '+i}}));
                else if(options.path.startsWith('/messages')) {message=JSON.parse(body).text;payload={success:true};}
                response.emit('data',JSON.stringify(payload));response.emit('end');
            });return request;
        };
        try {
            const bot=require('../../bot');
            await bot.notifyCustomer(123,1,'tracking','OZ123','ozon');
            check('Ozon notification has no CDEK link or name',()=>{assert.ok(message.includes('Ozon'));assert.ok(!message.includes('cdek.ru'));assert.ok(!message.includes('СДЭК'))});
            await bot.notifyCustomer(123,1,'tracking','CD123','cdek');
            check('CDEK tracking link preserved',()=>assert.ok(message.includes('cdek.ru')));
            app.use('/cdek',require('../routes/cdek'));
            r=await get('/cdek/offices?city=Самара');
            check('CDEK does not truncate directory to 50 points',()=>assert.equal(r.body.length,65));
            r=await get('/cdek/offices?city=Другой');
            check('CDEK does not silently select unrelated first city',()=>assert.deepEqual(r.body,[]));
        } finally {https.request=originalRequest;}
        console.log(`Passed ${count} checks`);
    } finally {server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
