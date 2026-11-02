const {setTimeout:delay}=require('timers/promises');
async function run(){
    const base=process.env.SHOP_URL;if(!base || new URL(base).protocol!=='https:')throw Error('Set SHOP_URL to the HTTPS storefront URL');
    for(let attempt=0;attempt<3;attempt++){
        try{const res=await fetch(new URL('/readyz',base),{signal:AbortSignal.timeout(10000),redirect:'error'});if(res.ok){
            if(process.env.ADMIN_PASSWORD){
                const login=await fetch(new URL('/api/auth/login',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(10000),redirect:'error'});
                if(!login.ok)throw Error('Health authentication failed');
                const {token}=await login.json();
                const health=await fetch(new URL('/api/admin/health',base),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),redirect:'error'});
                if(!health.ok)throw Error('Queue health unavailable');
                const data=await health.json();
                if(data.notifications.failed>0 || (data.notifications.oldest_pending && Date.now()-new Date(data.notifications.oldest_pending).getTime()>15*60*1000))throw Error('Notification queue unhealthy');
            }
            console.log('[health] OK');return;}
}catch{}
        if(attempt<2)await delay(2000);
    }
    throw Error('Shop readiness failed');
}
if(require.main===module)run().catch(()=>{console.error('[health] FAILED');process.exitCode=1});
