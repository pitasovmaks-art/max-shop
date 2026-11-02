// Bounded per-process limiter for public integrations. No request contents stored.
function requestLimit({max=60,windowMs=60000}={}) {
    const entries=new Map();
    setInterval(()=>{const now=Date.now();for(const [key,v] of entries)if(now>=v.until)entries.delete(key)},windowMs).unref();
    return (req,res,next)=>{
        const now=Date.now(),key=req.ip || 'unknown';let item=entries.get(key);
        if(!item || now>=item.until){if(entries.size>=10000){res.setHeader('Retry-After','60');return res.status(429).json({error:'Попробуйте немного позже'})}item={count:0,until:now+windowMs};entries.set(key,item)}
        if(++item.count>max){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((item.until-now)/1000))));return res.status(429).json({error:'Слишком много запросов, попробуйте позже'})}
        next();
    };
}
module.exports={requestLimit};
