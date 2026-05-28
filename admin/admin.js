/* ─── Global cache (products; categories/subs in categories.js) */
let _products = [];

/* ─── Variants form state ───────────────────────────────────── */
let _formVariants = []; // { label, priceKrdPickup, priceMskPickup, priceMskDelivery, isDefault }

/* ─── Extra images form state ───────────────────────────────── */
let _extraImages = []; // { id, productId, url, sortOrder }

function renderVariantRows() {
    const el = document.getElementById('variant-rows');
    if (!el) return;
    if (!_formVariants.length) {
        el.innerHTML = '<div class="variant-empty">Нет вариантов — товар добавляется одним вариантом</div>';
        return;
    }
    el.innerHTML = _formVariants.map((v, i) => `
        <div class="variant-row" id="vrow-${i}">
            <div class="variant-row__top">
                <input class="ff__input variant-row__label" type="text"
                       value="${_escAttr(v.label)}"
                       placeholder="Название (напр. 14 дней)"
                       oninput="_varField(${i},'label',this.value)">
                <label class="variant-row__def" title="По умолчанию">
                    <input type="radio" name="f-var-default"
                           ${v.isDefault ? 'checked' : ''}
                           onchange="setDefaultVariant(${i})">
                    <span class="vdef-dot"></span>
                </label>
                <button type="button" class="variant-row__del" onclick="removeVariantRow(${i})" aria-label="Удалить">×</button>
            </div>
            <div class="variant-row__prices">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceKrdPickup || ''}"
                       placeholder="Краснодар, самовывоз ₽"
                       min="0"
                       oninput="_varField(${i},'priceKrdPickup',+this.value||0)">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceMskPickup || ''}"
                       placeholder="Москва, самовывоз ₽"
                       min="0"
                       oninput="_varField(${i},'priceMskPickup',+this.value||0)">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceMskDelivery || ''}"
                       placeholder="Москва, доставка по России ₽"
                       min="0"
                       oninput="_varField(${i},'priceMskDelivery',+this.value||0)">
            </div>
        </div>`).join('');
}

function _escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function _varField(i, field, val) { if (_formVariants[i]) _formVariants[i][field] = val; }

function addVariantRow() {
    _formVariants.push({ label: '', priceKrdPickup: 0, priceMskPickup: 0, priceMskDelivery: 0, isDefault: _formVariants.length === 0 });
    renderVariantRows();
    const inputs = document.querySelectorAll('.variant-row__label');
    if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeVariantRow(idx) {
    const wasDefault = _formVariants[idx]?.isDefault;
    _formVariants.splice(idx, 1);
    if (wasDefault && _formVariants.length) _formVariants[0].isDefault = true;
    renderVariantRows();
}

function setDefaultVariant(idx) {
    _formVariants.forEach((v, i) => { v.isDefault = i === idx; });
}

function _collectVariants() {
    return _formVariants
        .filter(v => String(v.label).trim())
        .map((v, i) => ({
            label:           String(v.label).trim(),
            price:           0,
            priceKrd:        0,
            priceMsk:        0,
            priceDelivery:   0,
            priceKrdPickup:  v.priceKrdPickup  || 0,
            priceMskPickup:  v.priceMskPickup  || 0,
            priceMskDelivery:v.priceMskDelivery|| 0,
            isDefault:       !!v.isDefault,
            sortOrder:       i,
        }));
}

/* ─── Auth ──────────────────────────────────────────────── */
const TOKEN_KEY     = 'admin_token';
const AUTH_KEY      = 'adminAuth';
const AUTH_TIME_KEY = 'adminAuthTime';
const SESSION_TTL   = 3600000; // 60 минут

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

function checkAuth() {
    const app   = document.getElementById('app');
    const login = document.getElementById('loginScreen');
    const auth  = localStorage.getItem(AUTH_KEY);
    const ts    = parseInt(localStorage.getItem(AUTH_TIME_KEY) || '0', 10);
    if (auth === 'true' && Date.now() - ts < SESSION_TTL) {
        login.style.display = 'none';
        app.style.display   = '';
        adminInit();
    } else {
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(AUTH_TIME_KEY);
        localStorage.removeItem(TOKEN_KEY);
        app.style.display   = 'none';
        login.style.display = 'flex';
    }
}

async function attemptLogin() {
    const input = document.getElementById('loginInput');
    try {
        const r    = await fetch('/api/auth/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password: input.value }),
        });
        const data = await r.json();
        if (data.ok) {
            localStorage.setItem(TOKEN_KEY, data.token);
            localStorage.setItem(AUTH_KEY, 'true');
            localStorage.setItem(AUTH_TIME_KEY, String(Date.now()));
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').style.display = '';
            input.value = '';
            adminInit();
        } else {
            _showLoginError();
        }
    } catch {
        _showLoginError();
    }
}

function _showLoginError() {
    const input = document.getElementById('loginInput');
    const field = document.getElementById('loginField');
    document.getElementById('loginError').classList.remove('hidden');
    input.classList.add('login-input--error');
    field.classList.remove('login-field--shake');
    void field.offsetWidth;
    field.classList.add('login-field--shake');
    input.select();
}

function clearLoginError() {
    document.getElementById('loginError').classList.add('hidden');
    document.getElementById('loginInput').classList.remove('login-input--error');
}

function toggleEye() {
    const input = document.getElementById('loginInput');
    const icon  = document.getElementById('eyeIcon');
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerHTML = `
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
    } else {
        input.type = 'password';
        icon.innerHTML = `
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`;
    }
}

function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
    document.getElementById('app').style.display   = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginInput').value = '';
    clearLoginError();
    document.getElementById('loginInput').type = 'password';
    document.getElementById('eyeIcon').innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>`;
}

/* ─── API helpers ───────────────────────────────────────── */
async function apiAdmin(path, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Authorization': `Bearer ${getToken()}`,
            'Content-Type':  'application/json',
        },
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    if (r.status === 401) { logout(); return null; }
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}

/* ─── Data refresh ──────────────────────────────────────── */
async function refreshData() {
    const [cats, subs, prods, stores] = await Promise.all([
        fetch('/api/categories').then(r => r.json()),
        fetch('/api/subcategories').then(r => r.json()),
        fetch('/api/products').then(r => r.json()),
        fetch('/api/stores').then(r => r.json()),
    ]);
    _categories    = cats;
    _subcategories = subs;
    _products      = prods;
    _stores        = stores;
}

/* ─── Sync lookup helpers ───────────────────────────────── */
function catById(id) {
    return _categories.find(c => c.id === id) || { id, name: 'Без категории', icon: '📦', color: 3 };
}
function subById(id) {
    if (!id) return null;
    return _subcategories.find(s => s.id === id) || null;
}
function loadProducts()    { return _products; }

/* ─── Init ──────────────────────────────────────────────── */
async function adminInit() {
    await refreshData();
    render();
}

/* ─── Reset ─────────────────────────────────────────────── */
function confirmReset() {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.id = 'resetOverlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Сбросить все данные?</p>
            <p class="dialog__sub">Восстановит товары, категории и подкатегории по умолчанию. Все изменения будут потеряны</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="doReset()">Сбросить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="document.getElementById('resetOverlay').remove()">Отмена</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

async function doReset() {
    document.getElementById('resetOverlay')?.remove();
    try {
        await apiAdmin('/api/admin/reset', 'POST');
        await refreshData();
        render();
        renderCategories();
        renderStores();
        showToast('Данные сброшены');
    } catch {
        showToast('Ошибка сброса данных');
    }
}

/* ─── Tab switching ─────────────────────────────────────── */
function switchTab(tab) {
    const isProducts   = tab === 'products';
    const isCategories = tab === 'categories';
    const isOrders     = tab === 'orders';
    const isStores     = tab === 'stores';

    document.getElementById('sectionProducts').classList.toggle('hidden',   !isProducts);
    document.getElementById('sectionCategories').classList.toggle('hidden', !isCategories);
    document.getElementById('sectionOrders').classList.toggle('hidden',     !isOrders);
    document.getElementById('sectionStores').classList.toggle('hidden',     !isStores);

    document.getElementById('fabProducts').classList.toggle('hidden',   !isProducts);
    document.getElementById('fabCategories').classList.toggle('hidden', !isCategories);
    document.getElementById('fabStores').classList.toggle('hidden',     !isStores);

    document.getElementById('tabProducts').classList.toggle('active',   isProducts);
    document.getElementById('tabCategories').classList.toggle('active', isCategories);
    document.getElementById('tabOrders').classList.toggle('active',     isOrders);
    document.getElementById('tabStores').classList.toggle('active',     isStores);

    if (isCategories) renderCategories();
    if (isOrders)     renderOrders();
    if (isStores)     renderStores();
}

/* ─── Format ────────────────────────────────────────────── */
function fmt(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

/* ─── Stats ─────────────────────────────────────────────── */
function renderStats() {
    const all     = _products;
    const inStock = all.filter(p => p.inStock).length;
    const out     = all.length - inStock;
    document.getElementById('stats').innerHTML = `
        <div class="stat-chip">
            <div class="stat-chip__num">${all.length}</div>
            <div class="stat-chip__label">Всего</div>
        </div>
        <div class="stat-chip stat-chip--green">
            <div class="stat-chip__num">${inStock}</div>
            <div class="stat-chip__label">В наличии</div>
        </div>
        <div class="stat-chip stat-chip--red">
            <div class="stat-chip__num">${out}</div>
            <div class="stat-chip__label">Нет в наличии</div>
        </div>`;
}

/* ─── Filters ───────────────────────────────────────────── */
let state = { filter: 'all', query: '', editId: null };

function renderFilters() {
    const filtersEl = document.getElementById('filters');
    if (!filtersEl) return;
    filtersEl.innerHTML = `<button class="filter-btn ${state.filter === 'all' ? 'active' : ''}" onclick="setFilter('all',this)">Все</button>`
        + _categories.map(c =>
            `<button class="filter-btn ${state.filter === c.id ? 'active' : ''}" onclick="setFilter(${c.id},this)">${c.icon} ${c.name}</button>`
        ).join('');
}

function setFilter(catId, btn) {
    state.filter = catId;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
}

function handleSearch() {
    const val = document.getElementById('searchInput').value.trim().toLowerCase();
    state.query = val;
    document.getElementById('searchClear').classList.toggle('hidden', !val);
    renderList();
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.query = '';
    document.getElementById('searchClear').classList.add('hidden');
    renderList();
}

/* ─── Product list ──────────────────────────────────────── */
function getFiltered() {
    return _products.filter(p => {
        if (state.filter !== 'all' && p.categoryId !== state.filter) return false;
        if (state.query) {
            const cat = catById(p.categoryId);
            const sub = subById(p.subId);
            const hay = (p.name + ' ' + (p.desc || '') + ' ' + cat.name + ' ' + (sub ? sub.name : '')).toLowerCase();
            if (!hay.includes(state.query)) return false;
        }
        return true;
    });
}

function renderList() {
    const list  = getFiltered();
    const el    = document.getElementById('productList');
    const empty = document.getElementById('emptyState');

    if (!list.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    el.innerHTML = list.map(p => {
        const cat = catById(p.categoryId);
        const sub = subById(p.subId);
        const metaParts = [cat.name];
        if (sub) metaParts.push(sub.name);

        const stockHtml = p.inStock
            ? `<span class="product-row__stock product-row__stock--in">● В наличии</span>`
            : `<span class="product-row__stock product-row__stock--out">● Нет в наличии</span>`;

        const varHtml = p.variants && p.variants.length
            ? `<span class="product-row__vars">${p.variants.length} вар.</span>`
            : '';

        const priceHtml = p.isService
            ? `<span class="product-row__price">${p.priceLabel || fmt(p.price)}</span>`
            : `<span class="product-row__price">${fmt(p.price)}</span>`;

        return `
        <div class="product-row" id="row-${p.id}">
            ${p.image
                ? `<div class="product-row__img product-row__img--photo"><img src="${p.image}" alt=""></div>`
                : `<div class="product-row__img cat-bg-${cat.color}">${cat.icon}</div>`}
            <div class="product-row__info">
                <div class="product-row__name">${p.name}</div>
                <div class="product-row__meta">${metaParts.join(' · ')}</div>
                <div class="product-row__bottom">${priceHtml}${varHtml}${stockHtml}</div>
            </div>
            <div class="product-row__actions">
                <button class="action-btn action-btn--edit" onclick="openProductForm(${p.id})" aria-label="Редактировать">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="action-btn action-btn--delete" onclick="confirmDelete(${p.id})" aria-label="Удалить">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

/* ─── Photo upload ──────────────────────────────────────── */
let currentPhotoBase64 = null;

function triggerPhotoInput() { document.getElementById('photoInput').click(); }

function handlePhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        const img = new Image();
        img.onload = () => {
            const MAX = 800;
            let w = img.width, h = img.height;
            if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
            else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            setPhotoPreview(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

function setPhotoPreview(base64) {
    currentPhotoBase64 = base64;
    document.getElementById('photoPreview').src = base64;
    document.getElementById('photoPreview').classList.remove('hidden');
    document.getElementById('photoPlaceholder').classList.add('hidden');
    document.getElementById('photoRemove').classList.remove('hidden');
    document.getElementById('photoUpload').classList.add('photo-upload--filled');
}

function clearPhotoPreview() {
    currentPhotoBase64 = null;
    const preview = document.getElementById('photoPreview');
    if (!preview) return;
    preview.src = '';
    preview.classList.add('hidden');
    document.getElementById('photoPlaceholder').classList.remove('hidden');
    document.getElementById('photoRemove').classList.add('hidden');
    document.getElementById('photoUpload').classList.remove('photo-upload--filled');
}

function removePhoto(e) { e.stopPropagation(); clearPhotoPreview(); }

/* ─── Extra photos ──────────────────────────────────────── */
async function loadExtraImages(productId) {
    _extraImages = [];
    renderExtraImages();
    try {
        const images = await fetch(`/api/products/${productId}/images`).then(r => r.json());
        _extraImages = Array.isArray(images) ? images : [];
        renderExtraImages();
    } catch {
        _extraImages = [];
    }
}

function renderExtraImages() {
    const grid = document.getElementById('extraPhotosGrid');
    if (!grid) return;
    grid.innerHTML = _extraImages.map(img => `
        <div class="extra-photo-item" id="extra-${img.id}">
            <img src="${img.url}" alt="">
            <button type="button" class="extra-photo-item__del"
                onclick="deleteExtraImage(${img.id})" aria-label="Удалить">✕</button>
        </div>`).join('');
}

function triggerExtraPhotoInput() {
    document.getElementById('extraPhotoInput').click();
}

async function handleExtraPhotoSelect(e) {
    const file = e.target.files[0];
    if (!file || !state.editId) return;
    e.target.value = '';

    const btn = document.querySelector('.add-extra-photo-btn');
    const savedHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }

    try {
        const formData = new FormData();
        formData.append('file', file);
        const uploadRes = await fetch('/api/upload', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body:    formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadData.ok) throw new Error(uploadData.error || 'Upload failed');

        const saved = await apiAdmin(`/api/products/${state.editId}/images`, 'POST', {
            url:        uploadData.url,
            sort_order: _extraImages.length,
        });
        _extraImages.push(saved);
        renderExtraImages();
        showToast('✓ Фото добавлено');
    } catch {
        showToast('Ошибка загрузки фото');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = savedHTML; }
    }
}

async function deleteExtraImage(imageId) {
    if (!state.editId) return;
    try {
        await apiAdmin(`/api/products/${state.editId}/images/${imageId}`, 'DELETE');
        _extraImages = _extraImages.filter(img => img.id !== imageId);
        renderExtraImages();
    } catch {
        showToast('Ошибка удаления фото');
    }
}

/* ─── Form: populate selects ────────────────────────────── */
function populateCategorySelect() {
    const sel = document.getElementById('f-cat');
    sel.innerHTML = '<option value="">— выберите —</option>'
        + _categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
}

function handleCatChange() {
    const catId = parseInt(document.getElementById('f-cat').value) || null;
    const subs  = catId ? _subcategories.filter(s => s.categoryId === catId) : [];
    const ffSub = document.getElementById('ff-sub');
    const fSub  = document.getElementById('f-sub');
    if (subs.length) {
        fSub.innerHTML = '<option value="">Не указана</option>'
            + subs.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        ffSub.classList.remove('hidden');
    } else {
        fSub.innerHTML = '';
        ffSub.classList.add('hidden');
    }
    clearFE('ff-cat');
}

function handleServiceChange() {
    const isService = document.getElementById('f-service').checked;
    document.getElementById('ff-price-label').classList.toggle('hidden', !isService);
}

/* ─── Form open / close ─────────────────────────────────── */
function openProductForm(id = null) {
    state.editId = id;
    populateCategorySelect();
    document.getElementById('formTitle').textContent = id ? 'Редактировать товар' : 'Новый товар';
    const extraSection = document.getElementById('ff-extra-photos');
    if (id) {
        const p = _products.find(p => p.id === id);
        if (p) fillForm(p);
        extraSection.classList.remove('hidden');
        loadExtraImages(id);
    } else {
        clearForm();
        extraSection.classList.add('hidden');
    }
    document.getElementById('formOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { document.getElementById('sheetBody').scrollTop = 0; });
}

function openForm(id = null) { openProductForm(id); }

function closeForm() {
    document.getElementById('formOverlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleOverlayClick(e) {
    if (e.target === document.getElementById('formOverlay')) closeForm();
}

/* ─── Fill / clear form ─────────────────────────────────── */
function fillForm(p) {
    v('f-name',        p.name);
    v('f-desc',        p.desc  || '');
    v('f-price',       p.price);
    v('f-price-label', p.priceLabel || '');
    v('f-price-krd',      p.priceKrd      || 0);
    v('f-price-msk',      p.priceMsk      || 0);
    v('f-price-delivery', p.priceDelivery || 0);
    document.getElementById('f-instock').checked = !!p.inStock;
    document.getElementById('f-service').checked = !!p.isService;
    const catSel = document.getElementById('f-cat');
    catSel.value = p.categoryId || '';
    handleCatChange();
    if (p.subId) document.getElementById('f-sub').value = p.subId;
    handleServiceChange();
    if (p.image) setPhotoPreview(p.image); else clearPhotoPreview();
    document.querySelectorAll('.ff--error').forEach(el => el.classList.remove('ff--error'));
    document.querySelectorAll('.ff__error').forEach(el => el.textContent = '');
    _formVariants = (p.variants || []).map(vr => ({
        label:           vr.label,
        priceKrdPickup:  vr.priceKrdPickup  || 0,
        priceMskPickup:  vr.priceMskPickup  || 0,
        priceMskDelivery:vr.priceMskDelivery|| 0,
        isDefault:       vr.isDefault,
    }));
    renderVariantRows();
}

function clearForm() {
    ['f-name','f-desc','f-price','f-price-label','f-price-krd','f-price-msk','f-price-delivery'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    v('f-cat', '');
    document.getElementById('f-instock').checked = true;
    document.getElementById('f-service').checked = false;
    handleCatChange();
    handleServiceChange();
    clearPhotoPreview();
    document.querySelectorAll('.ff--error').forEach(el => el.classList.remove('ff--error'));
    document.querySelectorAll('.ff__error').forEach(el => el.textContent = '');
    _formVariants = [];
    renderVariantRows();
    _extraImages = [];
    renderExtraImages();
}

function v(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

/* ─── Validation ────────────────────────────────────────── */
function clearFE(ffId) {
    const el = document.getElementById(ffId);
    if (!el) return;
    el.classList.remove('ff--error');
    const err = el.querySelector('.ff__error');
    if (err) err.textContent = '';
}

function setFE(ffId, msg) {
    const el = document.getElementById(ffId);
    if (!el) return;
    el.classList.add('ff--error');
    const err = el.querySelector('.ff__error');
    if (err) err.textContent = msg;
}

function validateForm() {
    let ok = true;
    const name = document.getElementById('f-name').value.trim();
    if (!name) { setFE('ff-name', 'Введите название'); ok = false; }
    else if (name.length < 2) { setFE('ff-name', 'Слишком короткое название'); ok = false; }
    if (!document.getElementById('f-cat').value) { setFE('ff-cat', 'Выберите категорию'); ok = false; }
    const price = document.getElementById('f-price').value;
    if (!price || isNaN(+price) || +price < 0) { setFE('ff-price', 'Введите корректную цену'); ok = false; }
    return ok;
}

/* ─── Save product ──────────────────────────────────────── */
async function saveProduct() {
    if (!validateForm()) return;

    const isService  = document.getElementById('f-service').checked;
    const ffSub      = document.getElementById('ff-sub');
    const subVisible = !ffSub.classList.contains('hidden');
    const subVal     = subVisible ? parseInt(document.getElementById('f-sub').value) || null : null;

    const product = {
        name:       document.getElementById('f-name').value.trim(),
        desc:       document.getElementById('f-desc').value.trim() || null,
        categoryId: parseInt(document.getElementById('f-cat').value),
        subId:      subVal,
        price:      parseInt(document.getElementById('f-price').value, 10),
        priceKrd:      parseInt(document.getElementById('f-price-krd').value, 10)      || 0,
        priceMsk:      parseInt(document.getElementById('f-price-msk').value, 10)      || 0,
        priceDelivery: parseInt(document.getElementById('f-price-delivery').value, 10) || 0,
        inStock:    document.getElementById('f-instock').checked,
        isService,
        priceLabel: (isService && document.getElementById('f-price-label').value)
                        ? document.getElementById('f-price-label').value : null,
        image:      currentPhotoBase64 || null,
    };

    const btn = document.querySelector('#formOverlay .save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем...'; }

    try {
        let saved;
        if (state.editId) {
            saved = await apiAdmin(`/api/products/${state.editId}`, 'PUT', product);
        } else {
            saved = await apiAdmin('/api/products', 'POST', product);
        }
        const productId = state.editId || saved?.id;
        if (productId) {
            await apiAdmin(`/api/products/${productId}/variants`, 'PUT', _collectVariants());
        }
        await refreshData();
        closeForm();
        render();
        showToast(state.editId ? '✓ Товар обновлён' : '✓ Товар добавлен');
    } catch (e) {
        showToast('Ошибка сохранения товара');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    }
}

/* ─── Delete product ────────────────────────────────────── */
function confirmDelete(id) {
    const p = _products.find(p => p.id === id);
    if (!p) return;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.id = 'deleteOverlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Удалить товар?</p>
            <p class="dialog__sub">«${p.name}»</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="deleteProduct(${id})">Удалить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="closeDeleteDialog()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDeleteDialog(); });
    document.body.appendChild(overlay);
}

function closeDeleteDialog() {
    const el = document.getElementById('deleteOverlay');
    if (el) el.remove();
}

async function deleteProduct(id) {
    try {
        await apiAdmin(`/api/products/${id}`, 'DELETE');
        await refreshData();
        closeDeleteDialog();
        render();
        showToast('Товар удалён');
    } catch {
        showToast('Ошибка удаления');
    }
}

/* ─── Orders ────────────────────────────────────────────── */
const ORDER_STATUSES = {
    new:        { label: 'Новый',     cls: 'order-status--new' },
    processing: { label: 'В работе',  cls: 'order-status--processing' },
    done:       { label: 'Выполнен',  cls: 'order-status--done' },
    cancelled:  { label: 'Отменён',   cls: 'order-status--cancelled' },
};

const DELIVERY_LABELS_ADM = { pickup: 'Самовывоз', city: 'По городу', russia: 'По России' };

let _allOrders    = [];
let _orderFilter  = { store: '', status: '', delivery: '' };

function renderOrderFilters() {
    const el = document.getElementById('orderFilters');
    if (!el) return;
    const stores = [...new Set(_allOrders.map(o => o.store).filter(Boolean))].sort();
    el.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px 4px;">
            <select class="order-filter-sel" onchange="_oFilter('store',this.value)">
                <option value="">Все магазины</option>
                ${stores.map(s => `<option value="${s}" ${_orderFilter.store===s?'selected':''}>${s}</option>`).join('')}
            </select>
            <select class="order-filter-sel" onchange="_oFilter('status',this.value)">
                <option value="">Все статусы</option>
                ${Object.entries(ORDER_STATUSES).map(([k,v]) =>
                    `<option value="${k}" ${_orderFilter.status===k?'selected':''}>${v.label}</option>`
                ).join('')}
            </select>
            <select class="order-filter-sel" onchange="_oFilter('delivery',this.value)">
                <option value="">Все способы</option>
                ${Object.entries(DELIVERY_LABELS_ADM).map(([k,v]) =>
                    `<option value="${k}" ${_orderFilter.delivery===k?'selected':''}>${v}</option>`
                ).join('')}
            </select>
        </div>`;
}

function _oFilter(key, val) {
    _orderFilter[key] = val;
    renderOrderList();
}

function renderOrderList() {
    const el = document.getElementById('ordersListInner');
    if (!el) return;
    let orders = _allOrders;
    if (_orderFilter.store)    orders = orders.filter(o => o.store    === _orderFilter.store);
    if (_orderFilter.status)   orders = orders.filter(o => o.status   === _orderFilter.status);
    if (_orderFilter.delivery) orders = orders.filter(o => o.delivery === _orderFilter.delivery);

    if (!orders.length) {
        el.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">📋</div>
            <p class="empty-state__title">Нет заказов</p>
            <p class="empty-state__sub">По выбранным фильтрам заказов нет</p>
        </div>`;
        return;
    }

    el.innerHTML = orders.map(o => {
        const st      = ORDER_STATUSES[o.status] || { label: o.status, cls: '' };
        const dlLabel = DELIVERY_LABELS_ADM[o.delivery] || o.delivery || '';
        const date    = new Date(o.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const itemsText = o.items.map(i => `${i.name} × ${i.qty}`).join(', ');
        const options   = Object.entries(ORDER_STATUSES).map(([key, val]) =>
            `<option value="${key}" ${o.status === key ? 'selected' : ''}>${val.label}</option>`
        ).join('');

        return `
        <div class="order-card">
            <div class="order-card__header">
                <span class="order-card__num">Заказ #${o.id}</span>
                <span class="order-status ${st.cls}">${st.label}</span>
            </div>
            <div class="order-card__meta">
                <span class="order-card__client">${o.name} · ${o.phone}</span>
                <span class="order-card__date">${date}</span>
            </div>
            <div class="order-card__store">&#128205; ${o.store}${dlLabel ? ` <span style="opacity:.6;font-size:12px">(${dlLabel})</span>` : ''}</div>
            <div class="order-card__items">${itemsText}</div>
            ${o.comment ? `<div class="order-card__comment">&#128172; ${o.comment}</div>` : ''}
            <div class="order-card__footer">
                <span class="order-card__total">${fmt(o.total)}</span>
                <select class="order-status-select" onchange="updateOrderStatus(${o.id},this.value)">${options}</select>
            </div>
        </div>`;
    }).join('');
}

async function renderOrders() {
    const wrapper = document.getElementById('ordersList');
    wrapper.innerHTML = `<div id="orderFilters"></div><div id="ordersListInner"><div style="padding:24px;text-align:center;color:var(--gray)">Загрузка...</div></div>`;
    try {
        const orders = await apiAdmin('/api/orders');
        _allOrders = orders || [];
        renderOrderFilters();
        renderOrderList();
    } catch {
        document.getElementById('ordersListInner').innerHTML =
            '<div style="padding:24px;text-align:center;color:#FF3B30">Ошибка загрузки заказов</div>';
    }
}

async function updateOrderStatus(id, status) {
    try {
        await apiAdmin(`/api/orders/${id}/status`, 'PUT', { status });
        showToast('✓ Статус обновлён');
    } catch {
        showToast('Ошибка обновления статуса');
    }
}

/* ─── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ─── Full render ───────────────────────────────────────── */
function render() {
    renderStats();
    renderFilters();
    renderList();
}

/* ─── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', checkAuth);
