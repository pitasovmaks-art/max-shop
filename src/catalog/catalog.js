/* ─── In-memory cache (filled at startup) ───────────────── */
let _categories    = [];
let _subcategories = [];
let _products      = [];

/* ─── State ─────────────────────────────────────────────── */
const state = { categoryId: null, subId: null, query: '' };
let _searchTimer = null;

/* ─── API ────────────────────────────────────────────────── */
async function apiFetch(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
}

/* ─── Lookup helpers ────────────────────────────────────── */
function catById(id) {
    return _categories.find(c => c.id === id) || { id, name: 'Без категории', icon: '📦', color: 3 };
}
function subById(id) {
    if (!id) return null;
    return _subcategories.find(s => s.id === id) || null;
}

/* ─── Cart (localStorage) ───────────────────────────────── */
function getCart() {
    try { return JSON.parse(localStorage.getItem('cart') || '[]'); }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
    updateBadges();
}

function addToCart(id) {
    const product = _products.find(p => p.id === id);
    if (!product) return;
    const cart = getCart();
    const existing = cart.find(i => i.id === id);
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({ id, name: product.name, price: product.price, qty: 1, categoryId: product.categoryId });
    }
    saveCart(cart);
    showToast(`${product.name} добавлен в корзину`);
}

function getTotalQty() {
    return getCart().reduce((s, i) => s + i.qty, 0);
}

function updateBadges() {
    const qty      = getTotalQty();
    const badge    = document.getElementById('cartBadge');
    const navBadge = document.getElementById('navBadge');
    if (!badge) return;
    if (qty > 0) {
        badge.textContent = qty > 99 ? '99+' : qty;
        badge.classList.remove('hidden');
        if (navBadge) { navBadge.textContent = badge.textContent; navBadge.classList.remove('hidden'); }
    } else {
        badge.classList.add('hidden');
        if (navBadge) navBadge.classList.add('hidden');
    }
}

/* ─── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2400);
}

/* ─── Category filters ──────────────────────────────────── */
function renderCategoryFilters() {
    const el = document.getElementById('categories');
    if (!el) return;
    el.innerHTML = `<button class="cat-btn ${state.categoryId === null ? 'active' : ''}" onclick="setCategory(null,this)">Все</button>`
        + _categories.map(c =>
            `<button class="cat-btn ${state.categoryId === c.id ? 'active' : ''}" onclick="setCategory(${c.id},this)">${c.icon} ${c.name}</button>`
        ).join('');
}

/* ─── Subcategory filters ───────────────────────────────── */
function renderSubFilters() {
    const subScroll = document.getElementById('subScroll');
    const subsEl    = document.getElementById('subcategories');
    if (!subScroll || !subsEl) return;

    if (state.categoryId === null) { subScroll.classList.add('hidden'); return; }

    const subs = _subcategories.filter(s => s.categoryId === state.categoryId);
    if (!subs.length) { subScroll.classList.add('hidden'); return; }

    subScroll.classList.remove('hidden');
    subsEl.innerHTML = `<button class="sub-btn ${state.subId === null ? 'active' : ''}" onclick="setSub(null,this)">Все</button>`
        + subs.map(s =>
            `<button class="sub-btn ${state.subId === s.id ? 'active' : ''}" onclick="setSub(${s.id},this)">${s.name}</button>`
        ).join('');
}

/* ─── Filter setters ────────────────────────────────────── */
function setCategory(id) {
    state.categoryId = id;
    state.subId      = null;
    renderCategoryFilters();
    renderSubFilters();
    render();
}

function setSub(id) {
    state.subId = id;
    renderSubFilters();
    render();
}

/* ─── Search ────────────────────────────────────────────── */
function handleSearch() {
    const input = document.getElementById('searchInput');
    state.query = input.value.trim().toLowerCase();
    document.getElementById('searchClear').classList.toggle('hidden', !state.query);
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(render, 250);
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.query = '';
    document.getElementById('searchClear').classList.add('hidden');
    render();
}

/* ─── Filter products ───────────────────────────────────── */
function getFiltered() {
    return _products.filter(p => {
        if (state.categoryId !== null && p.categoryId !== state.categoryId) return false;
        if (state.subId      !== null && p.subId      !== state.subId)      return false;
        if (state.query) {
            const cat = catById(p.categoryId);
            const sub = subById(p.subId);
            const hay = (p.name + ' ' + (p.desc || '') + ' ' + cat.name + ' ' + (sub ? sub.name : '')).toLowerCase();
            if (!hay.includes(state.query)) return false;
        }
        return true;
    });
}

/* ─── Helpers ───────────────────────────────────────────── */
function fmt(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ─── Render ────────────────────────────────────────────── */
function render() {
    const list  = getFiltered();
    const grid  = document.getElementById('productsGrid');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('resultsCount');

    count.textContent = list.length ? plural(list.length, 'товар', 'товара', 'товаров') : '';

    if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    grid.innerHTML = list.map(p => {
        const cat     = catById(p.categoryId);
        const sub     = subById(p.subId);
        const imgBg   = p.image ? '' : `cat-bg-${cat.color}`;
        const imgIcon = p.image
            ? `<img class="product-card__photo" src="${p.image}" alt="${p.name}">`
            : cat.icon;

        const outBadge = !p.inStock
            ? `<span class="product-card__badge-out">Нет в наличии</span>` : '';
        const subBadge = sub
            ? `<span class="product-card__badge-brand">${sub.name}</span>` : '';

        if (p.isService) {
            return `
            <div class="product-card">
                <div class="product-card__img ${imgBg}">${imgIcon}${subBadge}</div>
                <div class="product-card__body">
                    <div class="product-card__name">${p.name}</div>
                    <div class="product-card__desc">${p.desc || ''}</div>
                    <div class="product-card__footer">
                        <span class="product-card__price product-card__price--service">${p.priceLabel || fmt(p.price)}</span>
                        <button class="add-btn add-btn--service" onclick="addToCart(${p.id})">Записаться</button>
                    </div>
                </div>
            </div>`;
        }

        const btn = p.inStock
            ? `<button class="add-btn" onclick="addToCart(${p.id})" aria-label="В корзину">+</button>`
            : `<button class="add-btn add-btn--disabled" disabled>+</button>`;

        return `
        <div class="product-card">
            <div class="product-card__img ${imgBg}">${imgIcon}${outBadge}${subBadge}</div>
            <div class="product-card__body">
                <div class="product-card__name">${p.name}</div>
                <div class="product-card__desc">${p.desc || ''}</div>
                <div class="product-card__footer">
                    <span class="product-card__price">${fmt(p.price)}</span>
                    ${btn}
                </div>
            </div>
        </div>`;
    }).join('');
}

/* ─── Init ──────────────────────────────────────────────── */
async function init() {
    try {
        [_categories, _subcategories, _products] = await Promise.all([
            apiFetch('/api/categories'),
            apiFetch('/api/subcategories'),
            apiFetch('/api/products'),
        ]);
    } catch (e) {
        console.error('Ошибка загрузки каталога:', e);
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('resultsCount').textContent = 'Ошибка загрузки';
    }
    renderCategoryFilters();
    renderSubFilters();
    render();
    updateBadges();
}

document.addEventListener('DOMContentLoaded', init);
