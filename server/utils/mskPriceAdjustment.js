const crypto = require('crypto');
function validateOptions(body = {}) {
    const bps = Math.round(Number(body.percent) * 100);
    if (typeof body.percent !== 'number' || !Number.isFinite(body.percent) || bps < 1 || bps > 10000 || Math.abs(body.percent*100-bps)>0.00001) throw new Error('Укажите повышение от 0,01 до 100%, не более двух знаков после запятой');
    if (!['all','categories','products'].includes(body.scope)) throw new Error('Выберите область изменения');
    if (body.includeSales != null && typeof body.includeSales !== 'boolean') throw new Error('Некорректная настройка акционных цен');
    const ids = body.scope === 'categories' ? body.categoryIds : body.scope === 'products' ? body.productIds : [];
    if (!Array.isArray(ids) || ids.length > 5000 || (body.scope !== 'all' && !ids.length) || ids.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error('Выберите категории или товары');
    return { percent:bps/100, bps, scope:body.scope, ids:[...new Set(ids)].sort((a,b)=>a-b), includeSales:body.includeSales===true };
}
function adjustedPrice(price,bps) {
    if (!Number.isSafeInteger(price) || price < 1) throw new Error('Некорректная исходная цена');
    const divisor=500000n;
    const numerator=BigInt(price)*BigInt(10000+bps);
    const value=Number(((numerator+divisor-1n)/divisor)*50n);
    if(value>2147483647)throw new Error('Итоговая цена превышает допустимое значение');
    return value;
}
function buildPlan(rows,options) {
    return rows.filter(r=>options.scope==='all' || options.ids.includes(Number(options.scope==='categories'?r.category_id:r.product_id)))
        .map(r=>({kind:r.kind,id:Number(r.id),productId:Number(r.product_id),name:r.name,label:r.label||'',oldPrice:Number(r.base_price),newPrice:adjustedPrice(Number(r.base_price),options.bps),oldSale:Number(r.sale_price||0),newSale:options.includeSales && Number(r.sale_price)>0?adjustedPrice(Number(r.sale_price),options.bps):Number(r.sale_price||0)}))
        .sort((a,b)=>a.kind.localeCompare(b.kind)||a.id-b.id);
}
function fingerprint(options,plan) {return crypto.createHash('sha256').update(JSON.stringify({options:{bps:options.bps,scope:options.scope,ids:options.ids,includeSales:options.includeSales},plan})).digest('hex')}
const SCHEMA=`CREATE TABLE IF NOT EXISTS msk_price_adjustments (
    request_id TEXT PRIMARY KEY,
    options JSONB NOT NULL,
    changes JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
module.exports={validateOptions,adjustedPrice,buildPlan,fingerprint,SCHEMA};
