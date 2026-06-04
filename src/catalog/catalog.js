/* ─── In-memory cache (filled at startup) ───────────────────── */
let _categories    = [];
let _subcategories = [];
let _products      = [];
let _favorites     = new Set();      // Set of product_id (Number)
let _subscriptions = new Set();      // product_ids subscribed for restock notifications

/* ─── City ──────────────────────────────────────────────────── */
let _city = localStorage.getItem('city') || null;

const _24H = 900000; // 15 minutes

/* Краснодарский край → krd pricing */
const KRD_CITIES = new Set([
    'Краснодар', 'Сочи', 'Новороссийск', 'Армавир', 'Анапа', 'Геленджик', 'Туапсе',
    'Тихорецк', 'Кропоткин', 'Темрюк', 'Лабинск', 'Славянск-на-Кубани', 'Белореченск',
    'Ейск', 'Тимашевск', 'Апшеронск', 'Горячий Ключ', 'Абинск', 'Гулькевичи',
    'Курганинск', 'Новокубанск', 'Каневская', 'Усть-Лабинск',
]);

/* Полный список городов РФ (алфавитный порядок) */
const ALL_CITIES = [
    'Абакан','Абинск','Агрыз','Азов','Алейск','Александров','Алексин','Альметьевск',
    'Амурск','Анапа','Ангарск','Апатиты','Апшеронск','Арзамас','Армавир','Арсеньев',
    'Артём','Архангельск','Асбест','Астрахань','Ачинск',
    'Балаково','Балашиха','Балашов','Барнаул','Батайск','Белгород','Белово','Белорецк',
    'Белореченск','Березники','Бийск','Биробиджан','Благовещенск','Бор','Братск','Брянск',
    'Бузулук',
    'Великий Новгород','Великие Луки','Видное','Владивосток','Владикавказ','Владимир',
    'Волгоград','Волжский','Вологда','Воркута','Воронеж','Воткинск',
    'Геленджик','Горно-Алтайск','Горячий Ключ','Грозный','Губкин','Гулькевичи',
    'Дербент','Димитровград','Дмитров','Домодедово','Дубна','Дзержинск',
    'Ейск','Екатеринбург','Елец','Электросталь','Элиста','Энгельс',
    'Железногорск','Жигулёвск','Жуковский',
    'Иваново','Ижевск','Иркутск','Искитим',
    'Йошкар-Ола',
    'Казань','Калининград','Калуга','Каменск-Уральский','Каменск-Шахтинский',
    'Каневская','Канск','Кемерово','Кинешма','Киров','Кирово-Чепецк','Кисловодск',
    'Коломна','Комсомольск-на-Амуре','Копейск','Кострома','Краснодар','Краснокаменск',
    'Краснотурьинск','Красноярск','Кропоткин','Курганинск','Курган','Курск',
    'Лабинск','Лениногорск','Липецк','Лыткарино',
    'Магнитогорск','Майкоп','Махачкала','Миасс','Москва','Мурманск','Мытищи',
    'Набережные Челны','Нальчик','Находка','Нефтекамск','Нефтеюганск',
    'Нижневартовск','Нижний Новгород','Нижний Тагил','Нижнекамск',
    'Новокубанск','Новокузнецк','Новороссийск','Новосибирск','Новочеркасск',
    'Новочебоксарск','Новый Уренгой','Ногинск','Норильск','Ноябрьск',
    'Обнинск','Одинцово','Омск','Оренбург','Орёл','Орск',
    'Пенза','Первоуральск','Пермь','Петрозаводск','Петропавловск-Камчатский',
    'Подольск','Прокопьевск','Псков',
    'Ростов-на-Дону','Рубцовск','Рязань',
    'Самара','Санкт-Петербург','Саранск','Сарапул','Саратов','Северодвинск',
    'Северск','Сергиев Посад','Серпухов','Симферополь','Славянск-на-Кубани',
    'Смоленск','Сочи','Старый Оскол','Ставрополь','Стерлитамак','Сургут',
    'Сызрань','Сыктывкар',
    'Тамбов','Тверь','Темрюк','Тимашевск','Тихорецк','Тольятти','Томск',
    'Туапсе','Тула','Тюмень',
    'Улан-Удэ','Ульяновск','Усть-Илимск','Усть-Лабинск','Уфа','Ухта',
    'Хабаровск','Хасавюрт','Химки',
    'Чебоксары','Челябинск','Череповец','Черкесск','Чита',
    'Шахты','Щёлково',
    'Южно-Сахалинск','Якутск','Ярославль',
].sort((a, b) => a.localeCompare(b, 'ru'));

function cityLabel() {
    return localStorage.getItem('cityName') || ((_city === 'krd') ? 'Краснодар' : (_city === 'msk') ? 'Москва' : _city || '—');
}

/* ─── Price logic ──────────────────────────────────────────── */
function getEffectivePrice(variant, city, deliveryType) {
    if (!variant) return 0;
    const isKrd = city === 'krd';
    const isRussiaDelivery = deliveryType === 'russia';
    if (isKrd) return variant.priceKrdPickup || 0;
    if (isRussiaDelivery) return variant.priceMskDelivery || 0;
    return variant.priceMskPickup || 0;
}

/* ─── City screen ──────────────────────────────────────────── */
function renderCityList(query) {
    const inner = document.getElementById('cityListInner');
    if (!inner) return;
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? ALL_CITIES.filter(c => c.toLowerCase().includes(q)) : ALL_CITIES;
    inner.innerHTML = filtered.map(city =>
        `<button class="city-list-btn" onclick="selectCityByName('${city.replace(/'/g,"\\'")}')">📍 ${city}</button>`
    ).join('');
}

function filterCityList(val) { renderCityList(val); }

function selectCityByName(cityName) {
    const code = KRD_CITIES.has(cityName) ? 'krd' : 'msk';
    selectCity(code, cityName);
}

function selectCity(cityCode, cityName) {
    _city = cityCode;
    localStorage.setItem('city', cityCode);
    localStorage.setItem('cityTimestamp', String(Date.now()));
    if (cityName) localStorage.setItem('cityName', cityName);
    const screen = document.getElementById('city-screen');
    if (screen) screen.style.display = 'none';
    const label = document.getElementById('cityLabel');
    if (label) label.textContent = cityLabel();
    if (_products.length) render();
    else init();
}

function showCityScreen() {
    const screen = document.getElementById('city-screen');
    if (screen) screen.style.display = 'flex';
    const search = document.getElementById('citySearchInput');
    if (search) { search.value = ''; renderCityList(''); setTimeout(() => search.focus(), 100); }
}

function detectCity() {
    const ts = parseInt(localStorage.getItem('cityTimestamp') || '0', 10);
    if (_city && Date.now() - ts < _24H) {
        const screen = document.getElementById('city-screen');
        if (screen) screen.style.display = 'none';
        const label = document.getElementById('cityLabel');
        if (label) label.textContent = cityLabel();
        return true;
    }
    _city = null;
    localStorage.removeItem('city');
    localStorage.removeItem('cityTimestamp');
    localStorage.removeItem('cityName');
    showCityScreen();
    return false;
}

/* ─── State ─────────────────────────────────────────────────── */
const state = { categoryId: null, subId: null, query: '' };
let _searchTimer = null;

/* ─── API ────────────────────────────────────────────────────── */
async function apiFetch(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
}

/* ─── Lookup helpers ────────────────────────────────────────── */
function catById(id) {
    return _categories.find(c => c.id === id) || { id, name: 'Без категории', icon: '📦', color: 3 };
}
function subById(id) {
    if (!id) return null;
    return _subcategories.find(s => s.id === id) || null;
}

/* ─── Variant selection state ───────────────────────────────── */
const _selectedVariants = {}; // { [productId]: variantId }

function _cityVariants(variants) {
    if (!variants || !variants.length) return [];
    if (_city === 'krd') return variants.filter(v => v.isKrd && v.priceKrdPickup > 0);
    return variants.filter(v => !v.isKrd && (v.priceMskPickup > 0 || v.priceMskDelivery > 0));
}

function _effectiveVariant(product) {
    if (!product.variants || !product.variants.length) return null;
    const cv = _cityVariants(product.variants);
    if (!cv.length) return null;
    const selId = _selectedVariants[product.id];
    return selId ? (cv.find(v => v.id === selId) || cv[0]) : (cv.find(v => v.isDefault) || cv[0]);
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
        if (priceEl) priceEl.textContent = fmt(getEffectivePrice(variant, _city));
    }
}

/* ─── Cart (localStorage) ───────────────────────────────────── */
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

    const city    = _city || localStorage.getItem('city');
    const variant = _effectiveVariant(product);

    let priceKrdPickup, priceMskPickup, priceMskDelivery, salePrice;
    if (variant) {
        priceKrdPickup   = variant.priceKrdPickup   || 0;
        priceMskPickup   = variant.priceMskPickup   || 0;
        priceMskDelivery = variant.priceMskDelivery || 0;
        salePrice        = variant.salePrice        || 0;
    } else {
        priceKrdPickup   = product.priceKrd      || product.price || 0;
        priceMskPickup   = product.priceMsk      || product.price || 0;
        priceMskDelivery = product.priceDelivery || product.price || 0;
        salePrice        = 0;
    }
    const basePrice = city === 'krd' ? priceKrdPickup : priceMskPickup;
    const price     = salePrice > 0 ? salePrice : basePrice;

    const key  = variant ? `${productId}_v${variant.id}` : String(productId);
    const cart = getCart();
    const existing = cart.find(i => i.key === key);
    if (existing) {
        existing.qty += 1;
    } else {
        const item = {
            key, id: productId, name: product.name,
            price, priceKrdPickup, priceMskPickup, priceMskDelivery,
            priceDelivery: priceMskDelivery,
            qty: 1, categoryId: product.categoryId,
            image: product.image || undefined,
        };
        if (salePrice > 0) item.salePrice = salePrice;
        if (variant) { item.variantId = variant.id; item.variantLabel = variant.label; }
        cart.push(item);
    }
    saveCart(cart);
    showToast('✓ Добавлено в корзину');
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

/* ─── Product page navigation ───────────────────────────────── */
function openProduct(id) {
    location.href = `src/catalog/product.html?id=${id}`;
}

/* ─── Toast ─────────────────────────────────────────────────── */
function showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

/* ─── Category filters ──────────────────────────────────────── */
function renderCategoryFilters() {
    const el = document.getElementById('categories');
    if (!el) return;
    const hasSale = _products.some(p => p.isSale);
    const salBtn  = hasSale
        ? `<button class="cat-btn cat-btn--sale ${state.categoryId === 'sale' ? 'active' : ''}" onclick="setCategory('sale',this)">🔥 Акция</button>`
        : '';
    el.innerHTML = `<button class="cat-btn ${state.categoryId === null ? 'active' : ''}" onclick="setCategory(null,this)">Все</button>`
        + salBtn
        + _categories.map(c =>
            `<button class="cat-btn ${state.categoryId === c.id ? 'active' : ''}" onclick="setCategory(${c.id},this)">${c.name}</button>`
        ).join('');
}

/* ─── Subcategory filters ───────────────────────────────────── */
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

/* ─── Filter setters ────────────────────────────────────────── */
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

/* ─── Search ────────────────────────────────────────────────── */
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

/* ─── Filter products ───────────────────────────────────────── */
function getFiltered() {
    if (state.categoryId === 'sale') {
        return _products.filter(p => p.isSale);
    }
    const list = _products.filter(p => {
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
    if (state.categoryId !== null && !state.query) {
        return [...list].sort((a, b) => a.sortOrderInCategory - b.sortOrderInCategory);
    }
    return list;
}

/* ─── Helpers ───────────────────────────────────────────────── */
function fmt(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

function fmtPrice(regularPrice, salePrice) {
    if (salePrice > 0) {
        return `<s class="price-old">${fmt(regularPrice)}</s><span class="price-sale">${fmt(salePrice)}</span>`;
    }
    return fmt(regularPrice);
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ─── Render ────────────────────────────────────────────────── */
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

        const cityVars  = _cityVariants(p.variants || []);
        const activeVar = _effectiveVariant(p);
        const displayPrice = activeVar
            ? getEffectivePrice(activeVar, _city)
            : (_city === 'krd' ? (p.priceKrd || p.price || 0) : (p.priceMsk || p.price || 0));
        const displaySale  = activeVar?.salePrice || 0;

        const visiblePills = cityVars.filter(vr => vr.label && vr.label.trim());
        const variantPills = visiblePills.length
            ? `<div class="variant-pills">${visiblePills.map(vr =>
                `<button class="variant-pill${activeVar && vr.id === activeVar.id ? ' variant-pill--active' : ''}"
                    data-vid="${vr.id}"
                    onclick="event.stopPropagation();selectVariant(${p.id},${vr.id})">${vr.label}</button>`
              ).join('')}</div>`
            : '';

        const tgId   = getTgId();
        const isFav  = _favorites.has(p.id);
        const favBtn = tgId
            ? `<button class="fav-btn${isFav ? ' fav-btn--active' : ''}" onclick="event.stopPropagation();toggleFav(${p.id})" aria-label="Избранное">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${isFav ? '#FF3B30' : 'none'}" stroke="${isFav ? '#FF3B30' : 'rgba(255,255,255,0.8)'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:fill .2s,stroke .2s">
                    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                </svg>
               </button>`
            : '';

        if (p.isService) {
            return `
            <div class="product-card" id="pcard-${p.id}" onclick="openProduct(${p.id})">
                <div class="product-card__img ${imgBg}">${imgIcon}${subBadge}${favBtn}</div>
                <div class="product-card__body">
                    <div class="product-card__name">${p.name}</div>
                    <div class="product-card__footer">
                        <span class="product-card__price product-card__price--service">${p.priceLabel || fmt(p.price)}</span>
                        <button class="add-btn add-btn--service" onclick="event.stopPropagation();addToCart(${p.id})">Записаться</button>
                    </div>
                </div>
            </div>`;
        }

        let btn;
        if (p.inStock) {
            btn = `<button class="add-btn" onclick="event.stopPropagation();addToCart(${p.id})" aria-label="В корзину">+</button>`;
        } else if (tgId) {
            const subscribed = _subscriptions.has(p.id);
            btn = subscribed
                ? `<button class="add-btn add-btn--subscribed" disabled aria-label="Вы подписаны">${_bellSvg(true)}</button>`
                : `<button class="add-btn add-btn--notify" onclick="event.stopPropagation();subscribeNotify(${p.id})" aria-label="Уведомить о поступлении">${_bellSvg(false)}</button>`;
        } else {
            btn = `<button class="add-btn add-btn--disabled" disabled>+</button>`;
        }

        return `
        <div class="product-card" id="pcard-${p.id}" onclick="openProduct(${p.id})">
            <div class="product-card__img ${imgBg}">${imgIcon}${outBadge}${subBadge}${favBtn}</div>
            <div class="product-card__body">
                <div class="product-card__name">${p.name}</div>
                ${variantPills}
                <div class="product-card__footer">
                    <span class="product-card__price">${fmtPrice(displayPrice, displaySale)}</span>
                    ${btn}
                </div>
            </div>
        </div>`;
    }).join('');
}

/* ─── Favourites ─────────────────────────────────────────────── */
async function toggleFav(productId) {
    const tgId = getTgId();
    if (!tgId) return;
    const wasFav = _favorites.has(productId);
    // Optimistic update
    if (wasFav) { _favorites.delete(productId); } else { _favorites.add(productId); }
    const btn = document.querySelector(`#pcard-${productId} .fav-btn`);
    const svg = btn?.querySelector('svg');
    function applyFavState(active) {
        if (!btn) return;
        btn.classList.toggle('fav-btn--active', active);
        if (svg) {
            svg.setAttribute('fill',   active ? '#FF3B30' : 'none');
            svg.setAttribute('stroke', active ? '#FF3B30' : 'rgba(255,255,255,0.8)');
        }
    }
    applyFavState(!wasFav);
    fetch('/api/favorites', {
        method:  wasFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tgId, productId }),
    }).catch(() => {
        if (wasFav) { _favorites.add(productId); } else { _favorites.delete(productId); }
        applyFavState(wasFav);
    });
}

/* ─── Stock notify ───────────────────────────────────────────── */
function _bellSvg(filled) {
    const f = filled ? '#FFD60A' : 'none';
    const s = filled ? '#FFD60A' : 'rgba(255,255,255,0.75)';
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${f}" stroke="${s}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:fill .2s,stroke .2s"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}

async function subscribeNotify(productId) {
    const tgId = getTgId();
    if (!tgId) { showToast('Откройте магазин через бота в Max Messenger'); return; }
    try {
        await fetch('/api/stock-notify', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tgId, productId }),
        });
        _subscriptions.add(productId);
        const btn = document.querySelector(`#pcard-${productId} .add-btn--notify`);
        if (btn) {
            btn.classList.replace('add-btn--notify', 'add-btn--subscribed');
            btn.disabled = true;
            btn.innerHTML = _bellSvg(true);
            btn.setAttribute('aria-label', 'Вы подписаны');
            btn.onclick = null;
        }
        showToast('🔔 Уведомим когда товар появится');
    } catch { showToast('Ошибка. Попробуйте снова'); }
}

function openFavorites() {
    const tgId = getTgId();
    const base = 'src/favorites/favorites.html';
    location.href = tgId ? `${base}?tg_id=${tgId}` : base;
}

/* ─── Init ──────────────────────────────────────────────────── */
async function init() {
    const tgId = getTgId();
    try {
        const [cats, subs, prods, favs, stockSubs] = await Promise.all([
            apiFetch('/api/categories'),
            apiFetch('/api/subcategories'),
            apiFetch('/api/products'),
            tgId ? apiFetch(`/api/favorites?tg_id=${encodeURIComponent(tgId)}`).catch(() => []) : Promise.resolve([]),
            tgId ? apiFetch(`/api/stock-notify/list?tg_id=${encodeURIComponent(tgId)}`).catch(() => []) : Promise.resolve([]),
        ]);
        _categories    = cats;
        _subcategories = subs;
        _products      = prods;
        _favorites     = new Set(favs.map(f => Number(f.id)));
        _subscriptions = new Set((stockSubs || []).map(id => Number(id)));
    } catch (e) {
        console.error('Ошибка загрузки каталога:', e);
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('resultsCount').textContent = 'Ошибка загрузки';
    }
    localStorage.removeItem('favorites_changed');
    renderCategoryFilters();
    renderSubFilters();
    render();
    updateBadges();
    _startPolling();
}

/* ─── Reload favorites state (e.g. after bfcache restore) ───── */
async function reloadFavorites() {
    const tgId = getTgId();
    if (!tgId) return;
    try {
        const favs = await apiFetch(`/api/favorites?tg_id=${encodeURIComponent(tgId)}`).catch(() => []);
        _favorites = new Set(favs.map(f => Number(f.id)));
        document.querySelectorAll('.fav-btn').forEach(btn => {
            const card = btn.closest('[id^="pcard-"]');
            if (!card) return;
            const productId = Number(card.id.replace('pcard-', ''));
            const active    = _favorites.has(productId);
            btn.classList.toggle('fav-btn--active', active);
            const svg = btn.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill',   active ? '#FF3B30' : 'none');
                svg.setAttribute('stroke', active ? '#FF3B30' : 'rgba(255,255,255,0.8)');
            }
        });
        localStorage.removeItem('favorites_changed');
    } catch (e) {
        console.error('[favorites] reloadFavorites error:', e);
    }
}

/* ─── Reload products + stock subscriptions + favorites ──────── */
async function reloadProductsAndSubscriptions() {
    if (!_products.length) return;
    const tgId = getTgId();
    try {
        const [prods, stockSubs, favs] = await Promise.all([
            apiFetch('/api/products'),
            tgId ? apiFetch(`/api/stock-notify/list?tg_id=${encodeURIComponent(tgId)}`).catch(() => []) : Promise.resolve([]),
            tgId ? apiFetch(`/api/favorites?tg_id=${encodeURIComponent(tgId)}`).catch(() => []) : Promise.resolve([]),
        ]);
        _products      = prods;
        _subscriptions = new Set((stockSubs || []).map(id => Number(id)));
        _favorites     = new Set(favs.map(f => Number(f.id)));
        localStorage.removeItem('favorites_changed');
        render();
    } catch (e) {
        console.error('[reload] reloadProductsAndSubscriptions error:', e);
    }
}

/* ─── Stock state polling (runs while tab is visible) ───────── */
let _pollInterval = null;

async function pollStockState() {
    const tgId = getTgId();
    if (!tgId || !_products.length) return;
    try {
        const [prods, stockSubs] = await Promise.all([
            apiFetch('/api/products'),
            apiFetch(`/api/stock-notify/list?tg_id=${encodeURIComponent(tgId)}`).catch(() => []),
        ]);
        const newSubs = new Set((stockSubs || []).map(id => Number(id)));
        const hasChange = prods.some(p => {
            const old = _products.find(op => op.id === p.id);
            return old && (old.inStock !== p.inStock || _subscriptions.has(p.id) !== newSubs.has(p.id));
        });
        _products      = prods;
        _subscriptions = newSubs;
        if (hasChange) render();
    } catch { /* silent poll failure */ }
}

function _startPolling() {
    if (_pollInterval) return;
    _pollInterval = setInterval(pollStockState, 20_000);
}

function _stopPolling() {
    clearInterval(_pollInterval);
    _pollInterval = null;
}

document.addEventListener('DOMContentLoaded', () => {
    renderCityList('');
    if (detectCity()) init();
});

window.addEventListener('pageshow', () => {
    if (_products.length) reloadProductsAndSubscriptions();
    else if (localStorage.getItem('favorites_changed')) reloadFavorites();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (_products.length) { reloadProductsAndSubscriptions(); _startPolling(); }
    } else {
        _stopPolling();
    }
});

/* ─── Support ───────────────────────────────────────────────── */
let _supportBotUsername = 'id635009278943_1_bot';

fetch('/api/config')
    .then(r => r.json())
    .then(cfg => { _supportBotUsername = cfg.supportBotUsername || 'id635009278943_1_bot'; })
    .catch(() => {});

function openSupport() {
    const username = _supportBotUsername;
    if (window.WebApp && window.WebApp.openLink) {
        window.WebApp.openLink(`https://max.ru/${username}`);
    } else {
        window.location.href = `https://max.ru/${username}`;
    }
}
