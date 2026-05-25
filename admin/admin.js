/* ─── Global cache (products; categories/subs in categories.js) */
let _products = [];

/* ─── Auth ──────────────────────────────────────────────── */
const TOKEN_KEY = 'admin_token';
function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }

function checkAuth() {
    const app   = document.getElementById('app');
    const login = document.getElementById('loginScreen');
    if (getToken()) {
        login.style.display = 'none';
        app.style.display   = '';
        adminInit();
    } else {
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
            sessionStorage.setItem(TOKEN_KEY, data.token);
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
    sessionStorage.removeItem(TOKEN_KEY);
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
                <div class="product-row__bottom">${priceHtml}${stockHtml}</div>
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
    if (id) {
        const p = _products.find(p => p.id === id);
        if (p) fillForm(p);
    } else {
        clearForm();
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
}

function clearForm() {
    ['f-name','f-desc','f-price','f-price-label'].forEach(id => v(id, ''));
    v('f-cat', '');
    document.getElementById('f-instock').checked = true;
    document.getElementById('f-service').checked = false;
    handleCatChange();
    handleServiceChange();
    clearPhotoPreview();
    document.querySelectorAll('.ff--error').forEach(el => el.classList.remove('ff--error'));
    document.querySelectorAll('.ff__error').forEach(el => el.textContent = '');
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
        inStock:    document.getElementById('f-instock').checked,
        isService,
        priceLabel: (isService && document.getElementById('f-price-label').value)
                        ? document.getElementById('f-price-label').value : null,
        image:      currentPhotoBase64 || null,
    };

    const btn = document.querySelector('#formOverlay .save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем...'; }

    try {
        if (state.editId) {
            await apiAdmin(`/api/products/${state.editId}`, 'PUT', product);
        } else {
            await apiAdmin('/api/products', 'POST', product);
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

async function renderOrders() {
    const el = document.getElementById('ordersList');
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--gray)">Загрузка...</div>';
    try {
        const orders = await apiAdmin('/api/orders');
        if (!orders || !orders.length) {
            el.innerHTML = `<div class="empty-state">
                <div class="empty-state__icon">📋</div>
                <p class="empty-state__title">Нет заказов</p>
                <p class="empty-state__sub">Заказы появятся после оформления покупателями</p>
            </div>`;
            return;
        }
        el.innerHTML = orders.map(o => {
            const st   = ORDER_STATUSES[o.status] || { label: o.status, cls: '' };
            const date = new Date(o.createdAt).toLocaleString('ru-RU', {
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
                <div class="order-card__store">📍 ${o.store}</div>
                <div class="order-card__items">${itemsText}</div>
                ${o.comment ? `<div class="order-card__comment">💬 ${o.comment}</div>` : ''}
                <div class="order-card__footer">
                    <span class="order-card__total">${fmt(o.total)}</span>
                    <select class="order-status-select" onchange="updateOrderStatus(${o.id},this.value)">${options}</select>
                </div>
            </div>`;
        }).join('');
    } catch {
        el.innerHTML = '<div style="padding:24px;text-align:center;color:#FF3B30">Ошибка загрузки заказов</div>';
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
