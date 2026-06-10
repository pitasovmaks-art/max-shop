/* ─── Global cache (products; categories/subs in categories.js) */
let _products = [];

/* ─── Variants form state (two blocks: KRD and MSK) ─────────── */
let _formVariantsKrd = []; // { label, priceKrdPickup, isDefault }
let _formVariantsMsk = []; // { label, priceMskPickup, priceMskDelivery, isDefault }

/* ─── Extra images form state ───────────────────────────────── */
let _extraImages = []; // { id, productId, url, sortOrder }

function _escAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function _varFieldKrd(i, field, val) { if (_formVariantsKrd[i]) _formVariantsKrd[i][field] = val; }
function _varFieldMsk(i, field, val) { if (_formVariantsMsk[i]) _formVariantsMsk[i][field] = val; }

function renderVariantRowsKrd() {
    const el = document.getElementById('variant-rows-krd');
    if (!el) return;
    if (!_formVariantsKrd.length) {
        el.innerHTML = '<div class="variant-empty">Нет вариантов для Краснодарского края</div>';
        return;
    }
    el.innerHTML = _formVariantsKrd.map((v, i) => `
        <div class="variant-row" id="vrow-krd-${i}">
            <div class="variant-row__top">
                <input class="ff__input variant-row__label" type="text"
                       value="${_escAttr(v.label)}"
                       placeholder="Название (напр. 14 дней)"
                       oninput="_varFieldKrd(${i},'label',this.value)">
                <label class="variant-row__def" title="По умолчанию">
                    <input type="radio" name="f-var-default-krd"
                           ${v.isDefault ? 'checked' : ''}
                           onchange="setDefaultVariantKrd(${i})">
                    <span class="vdef-dot"></span>
                </label>
                <button type="button" class="variant-row__del" onclick="removeVariantRowKrd(${i})" aria-label="Удалить">×</button>
            </div>
            <div class="variant-row__prices">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceKrdPickup || ''}"
                       placeholder="Цена самовывоз (₽)"
                       min="0"
                       oninput="_varFieldKrd(${i},'priceKrdPickup',+this.value||0)">
                <input class="ff__input variant-row__price variant-row__price--sale" type="number"
                       value="${v.salePrice || ''}"
                       placeholder="Акц. цена (₽)"
                       min="0"
                       oninput="_varFieldKrd(${i},'salePrice',+this.value||0)">
            </div>
        </div>`).join('');
}

function renderVariantRowsMsk() {
    const el = document.getElementById('variant-rows-msk');
    if (!el) return;
    if (!_formVariantsMsk.length) {
        el.innerHTML = '<div class="variant-empty">Нет вариантов для других городов</div>';
        return;
    }
    el.innerHTML = _formVariantsMsk.map((v, i) => `
        <div class="variant-row" id="vrow-msk-${i}">
            <div class="variant-row__top">
                <input class="ff__input variant-row__label" type="text"
                       value="${_escAttr(v.label)}"
                       placeholder="Название (напр. 14 дней)"
                       oninput="_varFieldMsk(${i},'label',this.value)">
                <label class="variant-row__def" title="По умолчанию">
                    <input type="radio" name="f-var-default-msk"
                           ${v.isDefault ? 'checked' : ''}
                           onchange="setDefaultVariantMsk(${i})">
                    <span class="vdef-dot"></span>
                </label>
                <button type="button" class="variant-row__del" onclick="removeVariantRowMsk(${i})" aria-label="Удалить">×</button>
            </div>
            <div class="variant-row__prices">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceMskPickup || ''}"
                       placeholder="Самовывоз (₽)"
                       min="0"
                       oninput="_varFieldMsk(${i},'priceMskPickup',+this.value||0)">
                <input class="ff__input variant-row__price" type="number"
                       value="${v.priceMskDelivery || ''}"
                       placeholder="Доставка по России (₽)"
                       min="0"
                       oninput="_varFieldMsk(${i},'priceMskDelivery',+this.value||0)">
                <input class="ff__input variant-row__price variant-row__price--sale" type="number"
                       value="${v.salePrice || ''}"
                       placeholder="Акц. цена (₽)"
                       min="0"
                       oninput="_varFieldMsk(${i},'salePrice',+this.value||0)">
            </div>
        </div>`).join('');
}

function addVariantRowKrd() {
    _formVariantsKrd.push({ label: '', priceKrdPickup: 0, salePrice: 0, isDefault: _formVariantsKrd.length === 0 });
    renderVariantRowsKrd();
    const inputs = document.querySelectorAll('#variant-rows-krd .variant-row__label');
    if (inputs.length) inputs[inputs.length - 1].focus();
}

function addVariantRowMsk() {
    _formVariantsMsk.push({ label: '', priceMskPickup: 0, priceMskDelivery: 0, salePrice: 0, isDefault: _formVariantsMsk.length === 0 });
    renderVariantRowsMsk();
    const inputs = document.querySelectorAll('#variant-rows-msk .variant-row__label');
    if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeVariantRowKrd(idx) {
    const wasDefault = _formVariantsKrd[idx]?.isDefault;
    _formVariantsKrd.splice(idx, 1);
    if (wasDefault && _formVariantsKrd.length) _formVariantsKrd[0].isDefault = true;
    renderVariantRowsKrd();
}

function removeVariantRowMsk(idx) {
    const wasDefault = _formVariantsMsk[idx]?.isDefault;
    _formVariantsMsk.splice(idx, 1);
    if (wasDefault && _formVariantsMsk.length) _formVariantsMsk[0].isDefault = true;
    renderVariantRowsMsk();
}

function setDefaultVariantKrd(idx) { _formVariantsKrd.forEach((v, i) => { v.isDefault = i === idx; }); }
function setDefaultVariantMsk(idx) { _formVariantsMsk.forEach((v, i) => { v.isDefault = i === idx; }); }

function _collectVariants() {
    const krd = _formVariantsKrd
        .filter(v => String(v.label).trim() || v.priceKrdPickup > 0)
        .map((v, i) => ({
            label:           String(v.label).trim(),
            price:           0, priceKrd: 0, priceMsk: 0, priceDelivery: 0,
            priceKrdPickup:  v.priceKrdPickup || 0,
            priceMskPickup:  0,
            priceMskDelivery:0,
            isKrd:           true,
            isDefault:       !!v.isDefault,
            sortOrder:       i,
            salePrice:       v.salePrice || 0,
        }));
    const msk = _formVariantsMsk
        .filter(v => String(v.label).trim() || v.priceMskPickup > 0 || v.priceMskDelivery > 0)
        .map((v, i) => ({
            label:           String(v.label).trim(),
            price:           0, priceKrd: 0, priceMsk: 0, priceDelivery: 0,
            priceKrdPickup:  0,
            priceMskPickup:  v.priceMskPickup  || 0,
            priceMskDelivery:v.priceMskDelivery|| 0,
            isKrd:           false,
            isDefault:       !!v.isDefault,
            sortOrder:       i,
            salePrice:       v.salePrice || 0,
        }));
    return [...krd, ...msk];
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
    const isUploads    = tab === 'uploads';
    const isExports    = tab === 'exports';

    document.getElementById('sectionProducts').classList.toggle('hidden',   !isProducts);
    document.getElementById('sectionCategories').classList.toggle('hidden', !isCategories);
    document.getElementById('sectionOrders').classList.toggle('hidden',     !isOrders);
    document.getElementById('sectionStores').classList.toggle('hidden',     !isStores);
    document.getElementById('sectionUploads').classList.toggle('hidden',    !isUploads);
    document.getElementById('sectionExports').classList.toggle('hidden',    !isExports);

    document.getElementById('fabProducts').classList.toggle('hidden',   !isProducts);
    document.getElementById('fabImport').classList.toggle('hidden',     !isProducts);
    document.getElementById('fabCategories').classList.toggle('hidden', !isCategories);
    document.getElementById('fabStores').classList.toggle('hidden',     !isStores);

    document.getElementById('tabProducts').classList.toggle('active',   isProducts);
    document.getElementById('tabCategories').classList.toggle('active', isCategories);
    document.getElementById('tabOrders').classList.toggle('active',     isOrders);
    document.getElementById('tabStores').classList.toggle('active',     isStores);
    document.getElementById('tabUploads').classList.toggle('active',    isUploads);
    document.getElementById('tabExports').classList.toggle('active',    isExports);

    if (isCategories) renderCategories();
    if (isOrders)     renderOrders();
    if (isStores)     renderStores();
    if (isUploads)    renderFileUploader();
    if (isExports)    renderExports();
}

/* ─── Exports ───────────────────────────────────────────── */
async function renderExports() {
    const el = document.getElementById('exportsList');
    if (!el) return;
    el.innerHTML = '<div class="exports-loading">Загрузка...</div>';
    try {
        const files = await apiAdmin('/api/exports/list');
        if (!files || !files.length) {
            el.innerHTML = '<div class="exports-empty">Экспортированных файлов нет</div>';
            return;
        }
        el.innerHTML = `
            <table class="exports-table">
                <thead>
                    <tr>
                        <th>Имя файла</th>
                        <th>Размер</th>
                        <th>Дата</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${files.map(f => `
                    <tr>
                        <td class="exports-table__name">${f.name}</td>
                        <td class="exports-table__size">${_fmtSize(f.size)}</td>
                        <td class="exports-table__date">${_fmtDate(f.modifiedAt)}</td>
                        <td class="exports-table__action">
                            <a href="${f.url}" target="_blank" download class="exports-dl-btn">Скачать</a>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } catch {
        el.innerHTML = '<div class="exports-empty" style="color:var(--red)">Ошибка загрузки списка файлов</div>';
    }
}

function _fmtSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024)       return bytes + ' Б';
    if (bytes < 1048576)    return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / 1048576).toFixed(1) + ' МБ';
}

function _fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
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
    const list = _products.filter(p => {
        if (state.filter !== 'all' && p.categoryId !== state.filter) return false;
        if (state.query) {
            const cat = catById(p.categoryId);
            const sub = subById(p.subId);
            const hay = (p.name + ' ' + (p.desc || '') + ' ' + cat.name + ' ' + (sub ? sub.name : '')).toLowerCase();
            if (!hay.includes(state.query)) return false;
        }
        return true;
    });
    if (typeof state.filter === 'number' && !state.query) {
        return [...list].sort((a, b) => (a.sortOrderInCategory ?? 0) - (b.sortOrderInCategory ?? 0));
    }
    return list;
}

function renderList() {
    const list  = getFiltered();
    const el    = document.getElementById('productList');
    const empty = document.getElementById('emptyState');

    if (!list.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    const isDragEnabled = !state.query && (state.filter === 'all' || typeof state.filter === 'number');

    el.innerHTML = list.map(p => {
        const cat = catById(p.categoryId);
        const sub = subById(p.subId);
        const metaParts = [cat.name];
        if (sub) metaParts.push(sub.name);

        const stockHtml = p.inStock
            ? `<button class="product-row__stock product-row__stock--in" onclick="quickToggleStock(${p.id})" title="Нажмите чтобы снять с продажи">● В наличии</button>`
            : `<button class="product-row__stock product-row__stock--out" onclick="quickToggleStock(${p.id})" title="Нажмите чтобы поставить в наличие">● Нет в наличии</button>`;

        const varHtml = p.variants && p.variants.length
            ? `<span class="product-row__vars">${p.variants.length} вар.</span>`
            : '';

        const priceHtml = (() => {
            if (p.isService) return `<span class="product-row__price">${p.priceLabel || fmt(p.price)}</span>`;
            if (p.price > 0) return `<span class="product-row__price">${fmt(p.price)}</span>`;
            if (p.variants && p.variants.length) {
                const prices = p.variants
                    .map(v => v.priceKrdPickup || v.priceMskPickup || 0)
                    .filter(x => x > 0);
                if (prices.length) {
                    const min = Math.min(...prices);
                    const max = Math.max(...prices);
                    const label = min === max ? fmt(min) : `от ${fmt(min)}`;
                    return `<span class="product-row__price">${label}</span>`;
                }
            }
            return `<span class="product-row__price">${fmt(p.price)}</span>`;
        })();

        const dragHandle = isDragEnabled
            ? `<div class="drag-handle" title="Перетащить">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                    <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                </svg>
               </div>`
            : '';

        return `
        <div class="product-row${isDragEnabled ? ' product-row--draggable' : ''}" id="row-${p.id}" data-id="${p.id}"${isDragEnabled ? ' draggable="true"' : ''}>
            ${dragHandle}
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

    if (isDragEnabled) initDragDrop(el);
}

/* ─── Drag & drop sorting ───────────────────────────────── */
function initDragDrop(container) {
    let dragSrc = null;

    container.querySelectorAll('.product-row--draggable').forEach(row => {
        row.addEventListener('dragstart', e => {
            dragSrc = row;
            row.classList.add('drag-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', row.dataset.id);
        });

        row.addEventListener('dragend', () => {
            row.classList.remove('drag-dragging');
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        row.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (row === dragSrc) return;
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            row.classList.add('drag-over');
        });

        row.addEventListener('dragleave', e => {
            if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over');
        });

        row.addEventListener('drop', e => {
            e.preventDefault();
            row.classList.remove('drag-over');
            if (!dragSrc || dragSrc === row) return;

            const rows = [...container.querySelectorAll('.product-row--draggable')];
            const srcIdx = rows.indexOf(dragSrc);
            const tgtIdx = rows.indexOf(row);

            if (srcIdx < tgtIdx) row.after(dragSrc);
            else row.before(dragSrc);

            saveNewOrder(container);
        });
    });
}

async function saveNewOrder(container) {
    const order = [...container.querySelectorAll('.product-row--draggable')]
        .map(row => +row.dataset.id);
    try {
        if (state.filter === 'all') {
            await apiAdmin('/api/products/reorder', 'PUT', { order });
            const idxMap = {};
            order.forEach((id, i) => { idxMap[id] = i; });
            _products.sort((a, b) => (idxMap[a.id] ?? 999) - (idxMap[b.id] ?? 999));
            showToast('✓ Порядок сохранён');
        } else {
            await apiAdmin('/api/products/reorder-category', 'PUT', { categoryId: state.filter, order });
            const idxMap = {};
            order.forEach((id, i) => { idxMap[id] = i; });
            _products.forEach(p => {
                if (idxMap[p.id] !== undefined) p.sortOrderInCategory = idxMap[p.id];
            });
            showToast('✓ Порядок в категории сохранён');
        }
    } catch {
        showToast('Ошибка сохранения порядка');
    }
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
    v('f-desc',        p.desc || '');
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
    _formVariantsKrd = (p.variants || []).filter(vr => vr.isKrd).map(vr => ({
        label:          vr.label,
        priceKrdPickup: vr.priceKrdPickup || 0,
        salePrice:      vr.salePrice      || 0,
        isDefault:      vr.isDefault,
    }));
    _formVariantsMsk = (p.variants || []).filter(vr => !vr.isKrd).map(vr => ({
        label:           vr.label,
        priceMskPickup:  vr.priceMskPickup  || 0,
        priceMskDelivery:vr.priceMskDelivery|| 0,
        salePrice:       vr.salePrice       || 0,
        isDefault:       vr.isDefault,
    }));
    renderVariantRowsKrd();
    renderVariantRowsMsk();
}

function clearForm() {
    ['f-name','f-desc','f-price-label'].forEach(id => {
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
    _formVariantsKrd = [];
    _formVariantsMsk = [];
    renderVariantRowsKrd();
    renderVariantRowsMsk();
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
        name:          document.getElementById('f-name').value.trim(),
        desc:          document.getElementById('f-desc').value.trim() || null,
        categoryId:    parseInt(document.getElementById('f-cat').value),
        subId:         subVal,
        price:         0,
        priceKrd:      0,
        priceMsk:      0,
        priceDelivery: 0,
        inStock:       document.getElementById('f-instock').checked,
        isService,
        priceLabel:    (isService && document.getElementById('f-price-label').value)
                           ? document.getElementById('f-price-label').value : null,
        image:         currentPhotoBase64 || null,
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

/* ─── Import products from XLSX ─────────────────────────── */
function triggerImport() {
    document.getElementById('importFileInput').value = '';
    document.getElementById('importFileInput').click();
}

function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let rows;
        try {
            if (typeof XLSX === 'undefined') throw new Error('Библиотека XLSX не загружена. Проверьте интернет-соединение и обновите страницу.');
            const wb  = XLSX.read(e.target.result, { type: 'array' });
            // Prefer sheet named "Товары", fall back to first sheet
            const sheetName = wb.SheetNames.find(n => n.trim() === 'Товары') || wb.SheetNames[0];
            const ws  = wb.Sheets[sheetName];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
            // Find header row: first row that contains 'name' or 'Название' or 'category' or 'Категория'
            const KNOWN = ['name','Название','category','Категория','variantLabel','Вариант'];
            const headerRowIdx = raw.findIndex(row =>
                Array.isArray(row) && row.some(cell => KNOWN.includes(String(cell).trim()))
            );
            if (headerRowIdx === -1) throw new Error('Строка заголовков не найдена. Первая строка должна содержать: name (или Название), category (или Категория) и т.д.');
            const headers = raw[headerRowIdx].map(h => String(h).trim());
            const dataRows = raw.slice(headerRowIdx + 1).filter(row =>
                row.some(cell => cell !== '' && cell !== null && cell !== undefined)
            );
            rows = dataRows.map(row => {
                const r = {};
                headers.forEach((h, i) => { r[h] = row[i] ?? ''; });
                return {
                    name:             String(r['name']             || r['Название']        || '').trim(),
                    category:         String(r['category']         || r['Категория']       || '').trim(),
                    subcategory:      String(r['subcategory']      || r['Подкатегория']    || '').trim(),
                    desc:             String(r['desc']             || r['Описание']        || '').trim(),
                    inStock:          r['inStock']  !== undefined && r['inStock']  !== '' ? r['inStock']  :
                                      r['Наличие'] !== undefined && r['Наличие']  !== '' ? r['Наличие']  : 1,
                    variantLabel:     String(r['variantLabel']     || r['Вариант']         || '').trim(),
                    priceKrdPickup:   +(r['priceKrdPickup']   || r['Цена КРД']      || 0),
                    priceMskPickup:   +(r['priceMskPickup']   || r['Цена МСК']      || 0),
                    priceMskDelivery: +(r['priceMskDelivery'] || r['Цена доставка'] || 0),
                    isDefault:        +(r['isDefault']        || r['По умолчанию']  || 0),
                };
            });
        } catch (err) {
            alert('Не удалось прочитать файл.\n\n' + (err.message || err));
            return;
        }
        if (!rows.length) { alert('Файл пустой или не содержит данных.'); return; }
        showToast('⏳ Импортируем...');
        try {
            const result = await apiAdmin('/api/products/import', 'POST', rows);
            await refreshData();
            render();
            showImportResult(result);
        } catch (err) {
            alert('Ошибка импорта. Проверьте подключение и попробуйте снова.');
        }
    };
    reader.readAsArrayBuffer(file);
}

function showImportResult(result) {
    document.getElementById('importResultTitle').textContent =
        `Импорт завершён: создано ${result.created}, пропущено ${result.skipped}`;
    const body = document.getElementById('importResultBody');
    if (result.errors && result.errors.length) {
        body.innerHTML = '<div style="margin-bottom:8px;font-weight:600;color:rgba(255,255,255,.7)">Ошибки:</div>'
            + result.errors.map(e =>
                `<div style="font-size:13px;margin-bottom:4px;color:#FF3B30">Строка ${e.row}: ${e.reason}</div>`
            ).join('');
    } else {
        body.innerHTML = '<div style="color:#22c55e;font-size:14px">Все товары импортированы успешно.</div>';
    }
    document.getElementById('importResultOverlay').classList.remove('hidden');
}

function closeImportResult() {
    document.getElementById('importResultOverlay').classList.add('hidden');
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
    new:         { label: 'Новый',          cls: 'order-status--new' },
    in_progress: { label: 'В работе',       cls: 'order-status--processing' },
    ready:       { label: 'Готов к выдаче', cls: 'order-status--shipped' },
    shipped:     { label: 'Отправлен',      cls: 'order-status--shipped' },
    completed:   { label: 'Получен',        cls: 'order-status--done' },
    cancelled:   { label: 'Отменён',        cls: 'order-status--cancelled' },
};

const ORDER_STATUSES_BY_DELIVERY = {
    pickup: [
        { key: 'new',         label: 'Новый' },
        { key: 'in_progress', label: 'В работе' },
        { key: 'ready',       label: 'Готов к выдаче' },
        { key: 'completed',   label: 'Получен' },
        { key: 'cancelled',   label: 'Отменён' },
    ],
    city: [
        { key: 'new',         label: 'Новый' },
        { key: 'in_progress', label: 'В работе' },
        { key: 'shipped',     label: 'Отправлен' },
        { key: 'completed',   label: 'Получен' },
        { key: 'cancelled',   label: 'Отменён' },
    ],
    russia: [
        { key: 'new',         label: 'Новый' },
        { key: 'in_progress', label: 'В работе' },
        { key: 'shipped',     label: 'Отправлен' },
        { key: 'completed',   label: 'Получен' },
        { key: 'cancelled',   label: 'Отменён' },
    ],
};

const DELIVERY_LABELS_ADM = { pickup: 'Самовывоз', city: 'По городу', russia: 'По России' };

let _allOrders    = [];
let _orderFilter  = { store: '', status: '', delivery: '' };

function renderOrderFilters() {
    const el = document.getElementById('orderFilters');
    if (!el) return;
    const stores = [...new Set(_allOrders.map(o => o.store).filter(Boolean))].sort()
        .filter(s => s.includes(','));
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
        const statusList = ORDER_STATUSES_BY_DELIVERY[o.delivery] || ORDER_STATUSES_BY_DELIVERY.russia;
        const options   = statusList.map(s =>
            `<option value="${s.key}" ${o.status === s.key ? 'selected' : ''}>${s.label}</option>`
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
            ${o.delivery === 'city'   && o.address ? `<div class="order-card__store">&#128205; Адрес доставки: ${o.address}</div>` : ''}
            ${o.delivery === 'russia' && o.address ? `<div class="order-card__store">&#128230; Пункт СДЭК: ${o.address}</div>` : ''}
            <div class="order-card__items">${itemsText}</div>
            ${o.comment ? `<div class="order-card__comment">&#128172; ${o.comment}</div>` : ''}
            ${(o.delivery === 'russia' || o.deliveryType === 'russia' || (o.delivery !== 'pickup' && o.delivery !== 'city')) ? `
            <div class="order-card__tracking">
                <input class="tracking-input" id="tracking-${o.id}"
                       value="${o.trackingNumber || ''}" placeholder="Введите трек-номер СДЭК...">
                <button class="tracking-btn" onclick="saveTracking(${o.id})">&#128228; Отправить</button>
            </div>` : ''}
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

async function saveTracking(id) {
    const input = document.getElementById(`tracking-${id}`);
    const trackingNumber = input?.value?.trim();
    if (!trackingNumber) { showToast('Введите трек-номер'); return; }
    try {
        const result = await apiAdmin(`/api/orders/${id}/tracking`, 'PUT', { tracking_number: trackingNumber });
        console.log('[TRACKING] ответ сервера:', result);
        showToast('✓ Трек-номер отправлен клиенту');
        renderOrders();
    } catch(e) {
        console.error('[TRACKING] ошибка:', e.message);
        showToast('Ошибка: ' + e.message);
    }
}

/* ─── Quick stock toggle ─────────────────────────────────── */
async function quickToggleStock(id) {
    const p = _products.find(p => p.id === id);
    if (!p) return;
    const newStock = !p.inStock;

    const btn = document.querySelector(`#row-${id} .product-row__stock`);
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    try {
        const updated = await apiAdmin(`/api/products/${id}`, 'PUT', {
            name:          p.name,
            desc:          p.desc          || null,
            categoryId:    p.categoryId,
            subId:         p.subId         || null,
            price:         p.price         || 0,
            priceKrd:      p.priceKrd      || 0,
            priceMsk:      p.priceMsk      || 0,
            priceDelivery: p.priceDelivery || 0,
            inStock:       newStock,
            isService:     p.isService     || false,
            priceLabel:    p.priceLabel    || null,
            image:         p.image         || null,
        });
        const idx = _products.findIndex(p => p.id === id);
        if (idx !== -1) _products[idx] = { ..._products[idx], ...updated };
        renderList();
        showToast(newStock ? '✓ Наличие обновлено: В наличии' : '✓ Наличие обновлено: Нет в наличии');
    } catch (e) {
        if (btn) { btn.disabled = false; btn.style.opacity = ''; }
        showToast('Ошибка: ' + e.message);
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
