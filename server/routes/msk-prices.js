const router=require('express').Router();
const crypto=require('crypto'),db=require('../db');
const {requireAdmin}=require('../middleware/auth');
const {validateOptions,buildPlan,fingerprint}=require('../utils/mskPriceAdjustment');
async function loadRows(query,lock=false) {
    const variants=await query(`SELECT 'variant' AS kind,v.id,v.product_id,p.name,p.category_id,v.label,
        v.price_msk_pickup AS base_price,v.sale_price
        FROM product_variants v JOIN products p ON p.id=v.product_id
        WHERE COALESCE(v.is_krd,0)<>1 AND COALESCE(v.is_usd,0)=0 AND v.price_msk_pickup>0 AND p.is_service=0
        ORDER BY v.id${lock?' FOR UPDATE OF v':''}`);
    const products=await query(`SELECT 'product' AS kind,p.id,p.id AS product_id,p.name,p.category_id,'' AS label,
        COALESCE(NULLIF(p.price_msk,0),p.price) AS base_price,0 AS sale_price
        FROM products p WHERE p.is_service=0 AND COALESCE(NULLIF(p.price_msk,0),p.price)>0
        AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
        ORDER BY p.id${lock?' FOR UPDATE OF p':''}`);
    return [...variants,...products];
}
router.use(requireAdmin);
router.post('/preview',async(req,res)=>{
    let options;try{options=validateOptions(req.body)}catch(e){return res.status(400).json({error:e.message})}
    try{
        const plan=buildPlan(await loadRows((sql)=>db.query(sql)),options);
        res.json({requestId:crypto.randomUUID(),fingerprint:fingerprint(options,plan),changes:plan,products:new Set(plan.map(p=>p.productId)).size,options});
    }catch{res.status(500).json({error:'Не удалось рассчитать цены. Проверьте исходные значения.'})}
});
router.post('/apply',async(req,res)=>{
    let options;
    try{options=validateOptions(req.body);if(typeof req.body.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(req.body.requestId)||typeof req.body.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(req.body.fingerprint))throw Error('Сначала выполните предпросмотр')}catch(e){return res.status(400).json({error:e.message})}
    try{
        let result;
        await db.inTransaction(async client=>{
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['bulk-msk-prices']);
            const previous=await client.query('SELECT options,changes FROM msk_price_adjustments WHERE request_id=$1',[req.body.requestId]);
            if(previous.rows[0]){
                const row=previous.rows[0];
                if(fingerprint(row.options,[])!==fingerprint(options,[])) {const e=new Error('Идентификатор уже использован для другого изменения');e.status=409;throw e}
                result={applied:row.changes.length,repeated:true};return;
            }
            const rows=await loadRows(async sql=>(await client.query(sql)).rows,true),plan=buildPlan(rows,options);
            if(fingerprint(options,plan)!==req.body.fingerprint){const e=new Error('Цены или состав товаров изменились. Выполните новый предпросмотр.');e.status=409;throw e}
            for(const change of plan){
                if(change.kind==='variant')await client.query(`UPDATE product_variants SET price_msk_pickup=$1,sale_price=$2
                    WHERE id=$3 AND COALESCE(is_krd,0)<>1 AND COALESCE(is_usd,0)=0`,[change.newPrice,change.newSale,change.id]);
                else await client.query('UPDATE products SET price_msk=$1 WHERE id=$2',[change.newPrice,change.id]);
            }
            await client.query('INSERT INTO msk_price_adjustments (request_id,options,changes) VALUES ($1,$2,$3)',[req.body.requestId,JSON.stringify(options),JSON.stringify(plan)]);
            result={applied:plan.length,repeated:false};
        });
        res.json(result);
    }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Не удалось сохранить цены. Изменения отменены.'})}
});
module.exports=router;
