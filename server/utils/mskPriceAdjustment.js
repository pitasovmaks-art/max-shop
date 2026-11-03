const crypto = require('crypto');
function validateOptions(body = {}) {
    const direction = body.direction ?? 'increase';
    if (!['increase', 'decrease'].includes(direction)) throw new Error('Выберите повышение или снижение');
    const bps = Math.round(Number(body.percent) * 100);
    if (typeof body.percent !== 'number' || !Number.isFinite(body.percent) || bps < 1 || bps > (direction === 'decrease' ? 9999 : 10000) || Math.abs(body.percent*100-bps)>0.00001) throw new Error(direction === 'decrease' ? 'Укажите снижение от 0,01 до 99,99%' : 'Укажите повышение от 0,01 до 100%');
    if (!['all','categories','products','filtered'].includes(body.scope)) throw new Error('Выберите область изменения');
    if (body.includeSales != null && typeof body.includeSales !== 'boolean') throw new Error('Некорректная настройка акционных цен');
    const ids = body.scope === 'categories' ? body.categoryIds : body.scope === 'products' ? body.productIds : [];
    if (!Array.isArray(ids) || ids.length > 5000 || (['categories','products'].includes(body.scope) && !ids.length) || ids.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error('Выберите категории или товары');
    const filters = body.scope === 'filtered' ? body.filters ?? {} : {};
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Некорректные фильтры');
    for (const key of ['categoryId','subId']) if (filters[key] != null && (!Number.isSafeInteger(filters[key]) || filters[key] < 1)) throw new Error('Некорректная категория');
    if (filters.brand != null && (typeof filters.brand !== 'string' || filters.brand.length > 100)) throw new Error('Некорректный бренд');
    const excludedIds = body.scope === 'filtered' ? body.excludedIds ?? [] : [];
    if (!Array.isArray(excludedIds) || excludedIds.length > 5000 || excludedIds.some(id=>!Number.isSafeInteger(id)||id<1)) throw new Error('Некорректные исключения');
    return { percent:bps/100, bps:direction === 'decrease' ? -bps : bps,
        filters:{categoryId:filters.categoryId ?? null,subId:filters.subId ?? null,brand:(filters.brand || '').trim().toLowerCase()},
        excludedIds:[...new Set(excludedIds)].sort((a,b)=>a-b), scope:body.scope, ids:[...new Set(ids)].sort((a,b)=>a-b), includeSales:body.includeSales===true };
}
function adjustedPrice(price,bps) {
    if (!Number.isSafeInteger(price) || price < 1) throw new Error('Некорректная исходная цена');
    if (!Number.isSafeInteger(bps) || bps < -9999 || bps > 10000) throw new Error('Некорректный процент');
    const divisor=500000n;
    const numerator=BigInt(price)*BigInt(10000+bps);
    const value=Number(((bps < 0 ? numerator : numerator+divisor-1n)/divisor)*50n);
    if (value < 1 || (bps < 0 && value >= price)) throw new Error('Снижение даёт нулевую цену или не уменьшает её. Измените процент или выбор товаров');
    if(value>2147483647)throw new Error('Итоговая цена превышает допустимое значение');
    return value;
}
function buildPlan(rows,options) {
    return rows.filter(r=>options.scope==='filtered' ? matchesFilters(r,options.filters) && !options.excludedIds.includes(Number(r.product_id)) : options.scope==='all' || options.ids.includes(Number(options.scope==='categories'?r.category_id:r.product_id)))
        .map(r=>{
            try {
                return {kind:r.kind,id:Number(r.id),productId:Number(r.product_id),name:r.name,label:r.label||'',
                    oldPrice:Number(r.base_price),newPrice:adjustedPrice(Number(r.base_price),options.bps),
                    oldSale:Number(r.sale_price||0),newSale:options.includeSales && Number(r.sale_price)>0?adjustedPrice(Number(r.sale_price),options.bps):Number(r.sale_price||0)};
            } catch(error) {
                error.status=400;
                throw error;
            }
        })
        .sort((a,b)=>a.kind.localeCompare(b.kind)||a.id-b.id);
}
function matchesFilters(row,filters={}) {
    return (!filters.categoryId || Number(row.category_id)===filters.categoryId)
        && (!filters.subId || Number(row.sub_id)===filters.subId)
        && (!filters.brand || String(row.brand||'').trim().toLowerCase()===filters.brand);
}
function fingerprint(options,plan) {return crypto.createHash('sha256').update(JSON.stringify({options:{bps:options.bps,scope:options.scope,ids:options.ids,includeSales:options.includeSales,filters:{categoryId:options.filters?.categoryId ?? null,subId:options.filters?.subId ?? null,brand:options.filters?.brand || ''},excludedIds:options.excludedIds || []},plan})).digest('hex')}
const SCHEMA=`CREATE TABLE IF NOT EXISTS msk_price_adjustments (
    request_id TEXT PRIMARY KEY,
    options JSONB NOT NULL,
    changes JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
module.exports={validateOptions,adjustedPrice,buildPlan,fingerprint,matchesFilters,SCHEMA};
