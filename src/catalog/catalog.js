/* ─── In-memory cache (filled at startup) ───────────────── */
let _categories    = [];
let _subcategories = [];
let _products      = [];

/* ─── City ──────────────────────────────────────────────── */
let _city = localStorage.getItem('city') || null;

const CITIES = [
    'Абакан','Азов','Александров','Альметьевск','Анапа','Ангарск','Анжеро-Судженск',
    'Апатиты','Армавир','Арсеньев','Артём','Архангельск','Асбест','Астрахань','Ачинск',
    'Балаково','Балашиха','Барнаул','Батайск','Белгород','Белово','Белорецк',
    'Березники','Берёзовский','Бийск','Биробиджан','Благовещенск','Братск','Брянск','Бугульма','Бузулук',
    'Великий Новгород','Верхняя Пышма','Владивосток','Владикавказ','Владимир',
    'Волгоград','Волгодонск','Волжский','Вологда','Воронеж','Воткинск','Всеволожск',
    'Гатчина','Геленджик','Глазов','Грозный','Гудермес',
    'Дербент','Дзержинск','Димитровград','Долгопрудный','Домодедово','Дубна',
    'Евпатория','Екатеринбург','Елец','Ессентуки',
    'Железногорск','Жуковский',
    'Иваново','Ижевск','Иркутск','Ишим',
    'Йошкар-Ола',
    'Казань','Калининград','Калуга','Каменск-Уральский','Каменск-Шахтинский',
    'Камышин','Канск','Каспийск','Кемерово','Кинешма','Киров','Кисловодск',
    'Ковров','Когалым','Коломна','Комсомольск-на-Амуре','Копейск','Королёв',
    'Кострома','Красногорск','Краснодар','Красноярск','Кропоткин','Курган','Курск',
    'Ленинск-Кузнецкий','Лесосибирск','Липецк','Лобня','Люберцы',
    'Магадан','Магнитогорск','Майкоп','Махачкала','Мегион','Миасс',
    'Минеральные Воды','Мичуринск','Москва','Мурманск','Муром','Мытищи',
    'Набережные Челны','Назрань','Нальчик','Находка','Невинномысск',
    'Нефтекамск','Нефтеюганск','Нижневартовск','Нижнекамск',
    'Нижний Новгород','Нижний Тагил','Новокузнецк','Новомосковск',
    'Новороссийск','Новосибирск','Новочеркасск','Новошахтинск','Ногинск','Норильск','Ноябрьск','Нягань',
    'Обнинск','Одинцово','Октябрьский','Омск','Орёл','Оренбург','Орехово-Зуево','Орск',
    'Пенза','Первоуральск','Пермь','Петрозаводск','Петропавловск-Камчатский',
    'Подольск','Прокопьевск','Псков','Пушкино','Пятигорск',
    'Раменское','Реутов','Ростов-на-Дону','Рубцовск','Рыбинск','Рязань',
    'Салават','Самара','Санкт-Петербург','Саранск','Сарапул','Саратов','Севастополь',
    'Северодвинск','Серов','Серпухов','Сибай','Симферополь','Смоленск',
    'Сочи','Ставрополь','Старый Оскол','Стерлитамак','Сургут','Сызрань','Сыктывкар',
    'Таганрог','Тамбов','Тверь','Тихвин','Тихорецк','Тобольск','Тольятти',
    'Томск','Туапсе','Тула','Тюмень',
    'Улан-Удэ','Ульяновск','Усолье-Сибирское','Уссурийск','Усть-Илимск','Уфа','Ухта',
    'Феодосия',
    'Хабаровск','Ханты-Мансийск','Хасавюрт','Химки',
    'Чебоксары','Челябинск','Череповец','Черкесск','Черногорск','Чита',
    'Шахты',
    'Электросталь','Элиста','Энгельс',
    'Южно-Сахалинск','Юрга','Якутск','Ярославль',
];

const _24H = 900000;

function getEffectivePrice(product) {
    if (_city === 'Краснодар') return product.priceKrd || product.price;
    return product.priceMsk || product.price;
}

function renderCityList(filter) {
    const list = document.getElementById('city-list');
    if (!list) return;
    const q = (filter || '').toLowerCase();
    const filtered = q ? CITIES.filter(c => c.toLowerCase().includes(q)) : CITIES;
    list.innerHTML = filtered.length
        ? filtered.map(city =>
            `<div onclick='selectCity(${JSON.stringify(city)})' style='padding:14px 16px;font-size:16px;color:#fff;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.08);'>${city}</div>`
          ).join('')
        : '<div style="padding:20px 16px;color:rgba(255,255,255,0.5);font-size:14px;">Ничего не найдено</div>';
}

function filterCities(value) {
    renderCityList(value);
}

function selectCity(cityName) {
    _city = cityName;
    localStorage.setItem('city', cityName);
    localStorage.setItem('cityTimestamp', String(Date.now()));
    const screen = document.getElementById('city-screen');
    if (screen) screen.style.display = 'none';
    const label = document.getElementById('cityLabel');
    if (label) label.textContent = cityName;
    if (_products.length) render();
    else init();
}

function showCityScreen() {
    const screen = document.getElementById('city-screen');
    if (screen) screen.style.display = 'flex';
    const search = document.getElementById('city-search');
    if (search) { search.value = ''; renderCityList(''); }
}

function detectCity() {
    const ts = parseInt(localStorage.getItem('cityTimestamp') || '0', 10);
    if (_city && Date.now() - ts < _24H) {
        const screen = document.getElementById('city-screen');
        if (screen) screen.style.display = 'none';
        const label = document.getElementById('cityLabel');
        if (label) label.textContent = _city;
        return true;
    }
    _city = null;
    localStorage.removeItem('city');
    localStorage.removeItem('cityTimestamp');
    showCityScreen();
    return false;
}

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

/* ─── Variant selection state ───────────────────────────── */
const _selectedVariants = {}; // { [productId]: variantId }

function _effectiveVariant(product) {
    if (!product.variants || !product.variants.length) return null;
    const selId = _selectedVariants[product.id];
    return selId
        ? product.variants.find(v => v.id === selId) || null
        : product.variants.find(v => v.isDefault) || product.variants[0];
}

function selectVariant(productId, variantId) {
    _selectedVariants[productId] = variantId;
    const card = document.getElementById(`pcard-${productId}`);
    if (!card) return;
    card.querySelectorAll('.variant-pill').forEach(pill => {
        pill.classList.toggle('variant-pill--active', +pill.dataset.vid === variantId);
    });
    const product = _products.find(p => p.id === productId);
    const variant  = product && product.variants.find(v => v.id === variantId);
    if (variant) {
        const priceEl = card.querySelector('.product-card__price');
        if (priceEl) priceEl.textContent = fmt(variant.price);
    }
}

/* ─── Cart (localStorage) ───────────────────────────────── */
function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem('cart') || '[]');
        return cart.map(i => ({ ...i, key: i.key || String(i.id) }));
    }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
    updateBadges();
}

function addToCart(productId) {
    const product = _products.find(p => p.id === productId);
    if (!product) return;

    let variantId = null, variantLabel = null, price = getEffectivePrice(product);
    const variant = _effectiveVariant(product);
    if (variant) { variantId = variant.id; variantLabel = variant.label; price = variant.price; }

    const key  = variantId != null ? `${productId}_v${variantId}` : String(productId);
    const cart = getCart();
    const existing = cart.find(i => i.key === key);
    if (existing) {
        existing.qty += 1;
    } else {
        const item = { key, id: productId, name: product.name, price, qty: 1, categoryId: product.categoryId };
        if (variantId != null) { item.variantId = variantId; item.variantLabel = variantLabel; }
        cart.push(item);
    }
    saveCart(cart);
    showToast(`${product.name}${variantLabel ? ` (${variantLabel})` : ''} добавлен в корзину`);
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

/* ─── Product page navigation ───────────────────────────── */
function openProduct(id) {
    location.href = `src/catalog/product.html?id=${id}`;
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
            `<button class="cat-btn ${state.categoryId === c.id ? 'active' : ''}" onclick="setCategory(${c.id},this)">${c.name}</button>`
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

        const hasVariants = p.variants && p.variants.length > 0;
        const activeVar   = _effectiveVariant(p);
        const displayPrice = activeVar ? activeVar.price : getEffectivePrice(p);

        const variantPills = hasVariants
            ? `<div class="variant-pills">${p.variants.map(vr =>
                `<button class="variant-pill${activeVar && vr.id === activeVar.id ? ' variant-pill--active' : ''}"
                    data-vid="${vr.id}"
                    onclick="event.stopPropagation();selectVariant(${p.id},${vr.id})">${vr.label}</button>`
              ).join('')}</div>`
            : '';

        if (p.isService) {
            return `
            <div class="product-card" id="pcard-${p.id}" onclick="openProduct(${p.id})">
                <div class="product-card__img ${imgBg}">${imgIcon}${subBadge}</div>
                <div class="product-card__body">
                    <div class="product-card__name">${p.name}</div>
                    <div class="product-card__footer">
                        <span class="product-card__price product-card__price--service">${p.priceLabel || fmt(p.price)}</span>
                        <button class="add-btn add-btn--service" onclick="event.stopPropagation();addToCart(${p.id})">Записаться</button>
                    </div>
                </div>
            </div>`;
        }

        const btn = p.inStock
            ? `<button class="add-btn" onclick="event.stopPropagation();addToCart(${p.id})" aria-label="В корзину">+</button>`
            : `<button class="add-btn add-btn--disabled" disabled>+</button>`;

        return `
        <div class="product-card" id="pcard-${p.id}" onclick="openProduct(${p.id})">
            <div class="product-card__img ${imgBg}">${imgIcon}${outBadge}${subBadge}</div>
            <div class="product-card__body">
                <div class="product-card__name">${p.name}</div>
                ${variantPills}
                <div class="product-card__footer">
                    <span class="product-card__price">${fmt(displayPrice)}</span>
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

document.addEventListener('DOMContentLoaded', () => {
    if (detectCity()) init();
});

/* ─── Support ───────────────────────────────────────────── */
let _botUsername = '';

fetch('/api/config')
    .then(r => r.json())
    .then(cfg => { _botUsername = cfg.botUsername || ''; })
    .catch(() => {});

function openSupport() {
    const username = _botUsername || 'id635009278943_bot';

    if (window.WebApp && window.WebApp.openLink) {
        window.WebApp.openLink(`https://max.ru/${username}`);
    } else {
        window.location.href = `https://max.ru/${username}`;
    }
}
