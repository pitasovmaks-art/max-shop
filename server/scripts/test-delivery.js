/* CDEK directory and carrier-specific notifications; HTTPS stubbed, no external requests. */
process.env.MAX_BOT_TOKEN = 'delivery-test-token';
process.env.ADMIN_PASSWORD = 'delivery-test-admin';
process.env.BOT_ADMIN_IDS = '123';
process.env.CDEK_CLIENT_ID = 'test-account';
process.env.CDEK_CLIENT_SECRET = 'test-secret';
const assert = require('node:assert/strict');
const express = require('express');
async function main() {
    const app=express();
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    let count=0;
    const check=(name,fn)=>{fn();count++;console.log('✅ '+name)};
    const get=async path=>{const res=await fetch(base+path);return {status:res.status,body:await res.json()}};
    let r;
    try {
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
        const fs=require('fs'),vm=require('vm'),path=require('path');
        const elements=new Map();
        const getElement=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,textContent:'',classList:{add(){},toggle(){}},setAttribute(){}});return elements.get(id)};
        const values=new Map([['city','msk'],['cityName','Самара']]);
        let externalRequests=0;
        const ctx=vm.createContext({console,window:{},document:{addEventListener(){},getElementById:getElement},
            localStorage:{getItem:key=>values.get(key)||null},fetch:()=>{externalRequests++;throw Error('unexpected network')}});
        const source=fs.readFileSync(path.join(__dirname,'../../src/cart/checkout.js'),'utf8');
        vm.runInContext(source,ctx);
        vm.runInContext('loadCdekOfficesForCurrentCity=function(){};setDeliveryCarrier("ozon")',ctx);
        check('empty manual Ozon address is rejected',()=>assert.equal(vm.runInContext('deliveryPointAddress()',ctx),''));
        getElement('pointAddress').value='Авроры';
        check('manual address requires a house number',()=>assert.equal(vm.runInContext('deliveryPointAddress()',ctx),''));
        getElement('pointAddress').value='ул. Авроры, 7, корпус 2';
        check('manual Ozon address includes selected city',()=>assert.equal(vm.runInContext('deliveryPointAddress()',ctx),'Ozon: Самара, ул. Авроры, 7, корпус 2'));
        vm.runInContext('handlePointAddressInput()',ctx);
        check('typing manual address makes no external request',()=>assert.equal(externalRequests,0));
        vm.runInContext('setDeliveryCarrier("cdek")',ctx);
        check('carrier switch clears previous manual address',()=>assert.equal(getElement('pointAddress').value,''));
        getElement('manualPoint').checked=true;
        vm.runInContext('toggleManualPoint()',ctx);
        getElement('pointAddress').value='Тестовая, 9';
        check('CDEK manual fallback works',()=>assert.equal(vm.runInContext('deliveryPointAddress()',ctx),'СДЭК: Самара, Тестовая, 9'));
        values.set('cityName','Москва');
        check('city change resets previous point',()=>assert.equal(vm.runInContext('deliveryPointAddress()',ctx),''));
        console.log(`Passed ${count} checks`);
    } finally {server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
