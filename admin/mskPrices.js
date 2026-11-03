let mskPricePreview = null;
let mskPriceBusy = false;
let mskPreviewGeneration = 0;
let mskRenderedScope = null;
function invalidateMskPreview() {
    mskPricePreview=null;
    mskPreviewGeneration++;
    document.getElementById('mskPreviewWrap').classList.add('hidden');
    document.getElementById('mskPriceMessage').textContent='';
}
function renderMskScope() {
    const scope=document.getElementById('mskScope').value,container=document.getElementById('mskSelection');
    const selected = scope===mskRenderedScope ? new Set([...container.querySelectorAll('input:checked')].map(el=>el.value)) : new Set();
    mskRenderedScope=scope;
    container.replaceChildren();container.classList.toggle('hidden',scope==='all');
    if(scope==='all')return;
    const list=scope==='categories'?_categories:_products;
    for(const item of list){
        const label=document.createElement('label');label.style.cssText='display:flex;gap:8px;align-items:center;padding:8px 0';
        const input=document.createElement('input');input.type='checkbox';input.value=String(item.id);input.checked=selected.has(input.value);input.disabled=mskPriceBusy;input.addEventListener('change',invalidateMskPreview);
        label.append(input,document.createTextNode(item.name));container.appendChild(label);
    }
}
function mskPriceOptions(){
    const scope=document.getElementById('mskScope').value;
    const ids=[...document.querySelectorAll('#mskSelection input:checked')].map(el=>Number(el.value));
    return {percent:Number(document.getElementById('mskPercent').value),scope,includeSales:document.getElementById('mskSales').checked,...(scope==='categories'?{categoryIds:ids}:scope==='products'?{productIds:ids}:{})};
}
function setMskBusy(busy){
    mskPriceBusy=busy;
    document.getElementById('mskPreviewBtn').disabled=busy;
    document.getElementById('mskApplyBtn').disabled=busy;
    for(const el of document.querySelectorAll('#sectionMskPrices input, #sectionMskPrices select'))el.disabled=busy;
}
async function mskPriceRequest(action,body){
    const response=await fetch('/api/admin/msk-prices/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+getToken()},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'Не удалось выполнить запрос');error.status=response.status;throw error}
    return data;
}
async function previewMskPrices(){
    if(mskPriceBusy)return;
    invalidateMskPreview();const generation=mskPreviewGeneration,options=mskPriceOptions();setMskBusy(true);
    try{
        const data=await mskPriceRequest('preview',options);
        if(generation!==mskPreviewGeneration)return;
        mskPricePreview={...data,submittedOptions:options};
        const body=document.getElementById('mskPreviewRows');body.replaceChildren();
        for(const row of data.changes){
            const tr=document.createElement('tr');
            for(const value of [row.name+(row.label?' — '+row.label:''),row.oldPrice.toLocaleString('ru-RU'),row.newPrice.toLocaleString('ru-RU'),row.oldSale?row.oldSale.toLocaleString('ru-RU')+' → '+row.newSale.toLocaleString('ru-RU'):'—']){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}
            body.appendChild(tr);
        }
        document.getElementById('mskPriceMessage').textContent=`Товаров: ${data.products}. Ценовых позиций: ${data.changes.length}. Проверьте расчёт перед подтверждением.`;
        document.getElementById('mskPreviewWrap').classList.toggle('hidden',!data.changes.length);
    }catch(e){document.getElementById('mskPriceMessage').textContent=e.message}finally{setMskBusy(false)}
}
async function applyMskPrices(){
    if(mskPriceBusy||!mskPricePreview)return;
    const preview=mskPricePreview;setMskBusy(true);
    try{
        const result=await mskPriceRequest('apply',{...preview.submittedOptions,requestId:preview.requestId,fingerprint:preview.fingerprint});
        mskPricePreview=null;document.getElementById('mskPreviewWrap').classList.add('hidden');
        document.getElementById('mskPriceMessage').textContent=`Готово. Изменено ценовых позиций: ${result.applied}. Краснодарские цены сохранены.`;
        try{await refreshData()}catch{document.getElementById('mskPriceMessage').textContent+=' Обновите страницу, чтобы загрузить свежий каталог.'}
    }catch(e){
        if(e.status===409){mskPricePreview=null;document.getElementById('mskPreviewWrap').classList.add('hidden')}
        document.getElementById('mskPriceMessage').textContent=e.message;
    }finally{setMskBusy(false)}
}
