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
const mskExcludedIds = new Set();
function fillMskSelect(id,items,placeholder) {
    const select=document.getElementById(id),value=select.value;
    select.replaceChildren(new Option(placeholder,''));
    for(const item of items) select.add(new Option(item.name,String(item.id)));
    select.value=[...select.options].some(o=>o.value===value)?value:'';
}
function mskFilters() {
    return {brand:document.getElementById('mskBrand').value,
        categoryId:Number(document.getElementById('mskCategory').value)||null,
        subId:Number(document.getElementById('mskSubcategory').value)||null};
}
function mskEligibleProducts() {
    return _products.filter(p=>!p.isService && (p.variants?.length
        ? p.variants.some(v=>!v.isKrd && !v.isUsd && v.priceMskPickup>0)
        : (p.priceMsk||p.price)>0));
}
function mskFilteredProducts() {
    const filters=mskFilters();
    return mskEligibleProducts().filter(p=>(!filters.brand || String(p.brand||'').trim().toLowerCase()===filters.brand)
        && (!filters.categoryId || p.categoryId===filters.categoryId)
        && (!filters.subId || p.subId===filters.subId));
}
function selectMskFiltered(selected) {
    if(mskPriceBusy)return;
    for(const p of mskFilteredProducts()) selected?mskExcludedIds.delete(p.id):mskExcludedIds.add(p.id);
    invalidateMskPreview();renderMskScope();
}
function renderMskScope() {
    const scope=document.getElementById('mskScope').value,container=document.getElementById('mskSelection');
    const selected=scope===mskRenderedScope ? new Set([...container.querySelectorAll('input:checked')].map(el=>el.value)) : new Set();
    mskRenderedScope=scope;
    document.getElementById('mskFilters').classList.toggle('hidden',scope!=='filtered');
    if(scope==='filtered') {
        const brands=[...new Set(mskEligibleProducts().map(p=>String(p.brand||'').trim().toLowerCase()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
        fillMskSelect('mskBrand',brands.map(b=>({id:b,name:mskEligibleProducts().find(p=>String(p.brand||'').trim().toLowerCase()===b).brand})), 'Все бренды');
        fillMskSelect('mskCategory',_categories,'Все категории');
        const cat=mskFilters().categoryId;
        fillMskSelect('mskSubcategory',_subcategories.filter(s=>!cat||s.categoryId===cat),'Все подкатегории');
    }
    container.replaceChildren();container.classList.toggle('hidden',scope==='all');
    if(scope==='all')return;
    const filtered=scope==='filtered'?mskFilteredProducts():[];
    const query=document.getElementById('mskSearch').value.trim().toLowerCase();
    const list=scope==='filtered'?filtered.filter(p=>!query||(p.name+' '+(p.article||'')).toLowerCase().includes(query)):scope==='categories'?_categories:mskEligibleProducts();
    for(const item of list){
        const label=document.createElement('label');label.className='msk-selection-row';
        const input=document.createElement('input');input.type='checkbox';input.value=String(item.id);
        input.checked=scope==='filtered'?!mskExcludedIds.has(item.id):selected.has(input.value);input.disabled=mskPriceBusy;
        input.addEventListener('change',()=>{if(scope==='filtered'){input.checked?mskExcludedIds.delete(item.id):mskExcludedIds.add(item.id);updateMskSelectionCount()}invalidateMskPreview()});
        label.append(input,document.createTextNode(item.name));container.appendChild(label);
    }
    if(!list.length)container.textContent='Товары не найдены';
    updateMskSelectionCount();
}
function updateMskSelectionCount() {
    const list=mskFilteredProducts(),chosen=list.filter(p=>!mskExcludedIds.has(p.id)).length;
    document.getElementById('mskSelectionCount').textContent=`По фильтрам: ${list.length}. Выбрано: ${chosen}. Исключено: ${list.length-chosen}.`;
}
function mskPriceOptions(){
    const scope=document.getElementById('mskScope').value;
    const ids=[...document.querySelectorAll('#mskSelection input:checked')].map(el=>Number(el.value));
    return {direction:document.getElementById('mskDirection').value,percent:Number(document.getElementById('mskPercent').value),scope,
        includeSales:document.getElementById('mskSales').checked,
        ...(scope==='filtered'?{filters:mskFilters(),excludedIds:[...mskExcludedIds]}:scope==='categories'?{categoryIds:ids}:scope==='products'?{productIds:ids}:{})};
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
        document.getElementById('mskApplyBtn').textContent=options.direction==='decrease'?'Подтвердить снижение':'Подтвердить повышение';
        document.getElementById('mskPriceMessage').textContent=(options.direction==='decrease'?'Снижение':'Повышение')+` на ${options.percent}%. Товаров: ${data.products}. Ценовых позиций: ${data.changes.length}. Проверьте расчёт перед подтверждением.`;
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
