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

/* Catalog (catalog.html only): which screen is active — used to restore
   the right place when returning from a product page, and by openProduct(). */
let _activeScreen = 'root'; // 'root' | 'subcats' | 'pair'
let _activeCatId  = null;
let _activeSubId  = null;

/* ─── API ────────────────────────────────────────────────────── */
async function apiFetch(path) {
    const r = await authFetch(path);
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
        if (priceEl) priceEl.innerHTML = fmtPrice(getEffectivePrice(variant, _city), variant.salePrice || 0);
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
    const label   = variant?.label ?? '';

    // Strict match by label only — no fallback to a different label's variant
    const krdVar = (product.variants || []).find(v => v.isKrd  && v.label === label) || null;
    const mskVar = (product.variants || []).find(v => !v.isKrd && v.label === label) || null;

    const priceKrdPickup   = krdVar?.priceKrdPickup   || (!label ? product.priceKrd  || product.price || 0 : 0);
    const priceMskPickup   = mskVar?.priceMskPickup   || (!label ? product.priceMsk  || product.price || 0 : 0);
    const priceMskDelivery = mskVar?.priceMskDelivery || (!label ? product.priceDelivery || 0           : 0);
    const salePriceKrd     = krdVar?.salePrice || 0;
    const salePriceMsk     = mskVar?.salePrice || 0;

    const basePrice = city === 'krd' ? priceKrdPickup : priceMskPickup;
    const salePrice = city === 'krd' ? salePriceKrd   : salePriceMsk;
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
            salePriceKrd, salePriceMsk,
            qty: 1, categoryId: product.categoryId,
            image: product.image || undefined,
        };
        if (variant) { item.variantId = variant.id; item.variantLabel = variant.label; }
        cart.push(item);
    }
    saveCart(cart);
    showToast('✓ Добавлено в корзину');

    const cardBtn = document.querySelector(`#pcard-${productId} .add-btn`);
    if (cardBtn) {
        cardBtn.classList.add('add-btn--added');
        setTimeout(() => cardBtn.classList.remove('add-btn--added'), 500);
    }
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
    sessionStorage.setItem('catalog_scroll', String(Math.round(window.scrollY)));
    sessionStorage.setItem('catalog_screen', _activeScreen);
    sessionStorage.setItem('catalog_cat',    _activeCatId !== null ? String(_activeCatId) : '');
    sessionStorage.setItem('catalog_sub',    _activeSubId !== null ? String(_activeSubId) : '');
    sessionStorage.setItem('catalog_back',   '1');
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

/* ─── Sale helpers ───────────────────────────────────────────── */
function isSaleForCity(product, city) {
    if (!product.variants) return false;
    if (city === 'krd') return product.variants.some(v => v.isKrd  && v.salePrice > 0);
    return product.variants.some(v => !v.isKrd && v.salePrice > 0);
}

/* ─── Rails: right-edge fade mask (.rail--fade, see catalog.css) ────
   Only shown while there's more to scroll — removed once the rail is
   scrolled to its end so the last card stays fully opaque, and absent
   entirely when all cards already fit (nothing to scroll). Attached
   once per rail element (innerHTML gets replaced on re-render, but the
   element itself doesn't, so the listener must not be re-added). */
function initRailFade(rail) {
    if (!rail) return;
    const update = () => {
        const max = rail.scrollWidth - rail.clientWidth;
        rail.classList.toggle('rail--fade', max - rail.scrollLeft > 2);
    };
    if (!rail.dataset.fadeInit) {
        rail.dataset.fadeInit = '1';
        rail.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
    }
    update();
}

/* ─── Home: category rail ───────────────────────────────────── */
function renderCategoryRail() {
    const rail = document.getElementById('catRail');
    if (!rail) return;
    // On the Catalog tab itself, open the drill-down in place; from Home,
    // navigate to the Catalog tab pre-opened on that category.
    const onCatalogPage = !!document.getElementById('screen-root');
    const openTile = target => onCatalogPage
        ? `openCategoryDrilldown(${target})`
        : `location.href='catalog.html?category=${target}'`;

    const hasSale = _products.some(p => isSaleForCity(p, _city));
    const saleTile = hasSale
        ? `<button class="cat-tile cat-tile--sale" onclick="${openTile("'sale'")}">
            <span class="cat-tile__ic">${iconSvg('sale', 20)}</span>
            <span>Акции</span>
        </button>`
        : '';

    rail.innerHTML = saleTile + _categories.map(c =>
        `<button class="cat-tile" onclick="${openTile(c.id)}">
            <span class="cat-tile__ic">${categoryIconSvg(c, 20)}</span>
            <span>${c.name}</span>
        </button>`
    ).join('');
    initRailFade(rail);
}

/* ─── Home: promo banner carousel ───────────────────────────── */
/* Нейтральные тексты — без цен, скидок, сроков и условий (их никто не
   придумывал, см. PROGRESS.md «Баннеры главной»: сейчас это заглушка,
   управление из админки — отдельная задача этапа 2). categoryName —
   название категории для клика по баннеру (openBannerTarget ниже ищет
   её среди загруженных _categories по имени и ведёт на неё; если имя
   не найдено, открывает просто Каталог — на случай, если категорию
   переименуют/удалят в админке, это тоже «не найдено», а не ошибка). */
const HOME_BANNERS = [
    { cls: 'banner-slide--a', title: 'Точка Монтажа',       sub: 'Профессиональный строительный инструмент', categoryName: null },
    { cls: 'banner-slide--b', title: 'Монтажные пистолеты', sub: 'Toua, FengBao и другие бренды',             categoryName: 'Монтажные пистолеты' },
    { cls: 'banner-slide--c', title: 'Расходники',          sub: 'Для монтажных пистолетов и инструмента',    categoryName: 'Расходники' },
];
let _bannerIndex = 0;
let _bannerTimer = null;

function _bannerGoTo(i) {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track) return;
    _bannerIndex = ((i % HOME_BANNERS.length) + HOME_BANNERS.length) % HOME_BANNERS.length;
    track.style.transform = `translateX(-${_bannerIndex * 100}%)`;
    if (dots) {
        [...dots.children].forEach((dot, idx) => dot.classList.toggle('on', idx === _bannerIndex));
    }
}

function _bannerStart() {
    clearInterval(_bannerTimer);
    _bannerTimer = setInterval(() => _bannerGoTo(_bannerIndex + 1), 3000);
}

function _bannerPause() {
    clearInterval(_bannerTimer);
}

/* Баннер ведёт на свою категорию по имени (categoryName в HOME_BANNERS),
   если такая категория сейчас есть среди загруженных _categories —
   иначе просто на Каталог. Баннер показывается только на Главной, так
   что переход всегда "снаружи" каталога, как у рельсы категорий. */
function openBannerTarget(categoryName) {
    const cat = categoryName ? _categories.find(c => c.name === categoryName) : null;
    location.href = cat ? `catalog.html?category=${cat.id}` : 'catalog.html';
}

function initBanner() {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track || !dots) return;

    track.innerHTML = HOME_BANNERS.map(b =>
        `<div class="banner-slide ${b.cls}" onclick="openBannerTarget(${b.categoryName ? `'${b.categoryName}'` : 'null'})"><b>${b.title}</b><span>${b.sub}</span></div>`
    ).join('');
    dots.innerHTML = HOME_BANNERS.map(() => `<span></span>`).join('');
    _bannerIndex = 0;
    _bannerGoTo(0);

    track.addEventListener('touchstart', _bannerPause, { passive: true });
    track.addEventListener('touchend',   _bannerStart,  { passive: true });
    track.addEventListener('mousedown',  _bannerPause);
    window.addEventListener('mouseup',   _bannerStart);

    _bannerStart();
}

/* ─── Catalog: hits rail (source: products.isHit — not in the API yet,
   so this stays hidden until that field exists) ─────────────────── */
function renderHitsRail() {
    const section = document.getElementById('hitsSection');
    const rail    = document.getElementById('hitsRail');
    if (!section || !rail) return;
    const hits = _products.filter(p => p.isHit || p.is_hit);
    if (!hits.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    rail.innerHTML = hits.map(p => `<div class="hits-rail__item">${productCardHTML(p)}</div>`).join('');
    initRailFade(rail);
}

/* ─── Catalog: category → subcategory → products screens ────────── */
function showCatalogScreen(name) {
    ['root', 'subcats', 'pair'].forEach(n => {
        const el = document.getElementById('screen-' + n);
        if (el) el.classList.toggle('hidden', n !== name);
    });
    _activeScreen = name;
    window.scrollTo(0, 0);
}

function openCategoryDrilldown(catId, subId) {
    if (subId != null && !Number.isNaN(subId)) { openPairProducts(catId, subId); return; }
    const subs = _subcategories.filter(s => s.categoryId === catId);
    if (subs.length) openSubcatsScreen(catId);
    else openPairProducts(catId, null);
}

function openSubcatsScreen(catId) {
    const grid = document.getElementById('subcatGrid');
    const titleEl = document.getElementById('subcatsTitle');
    if (!grid || !titleEl) return;
    const cat  = catById(catId);
    _activeCatId = catId;
    _activeSubId = null;
    titleEl.textContent = cat.name;
    const subs = _subcategories.filter(s => s.categoryId === catId);
    grid.innerHTML = subs.map(s => `
        <button class="subcat-tile" onclick="openPairProducts(${catId},${s.id})">
            <span class="subcat-tile__ic">${categoryIconSvg(cat, 22)}</span>
            <span>${s.name}</span>
        </button>`).join('');
    history.replaceState(null, '', `catalog.html?category=${catId}`);
    showCatalogScreen('subcats');
}

function closeSubcatsScreen() {
    history.replaceState(null, '', 'catalog.html');
    showCatalogScreen('root');
}

/* Filters for the pair-products screen. Only brand + price exist today;
   per-subcategory params (power, weight, voltage…) will slot in here as
   extra sheet sections once that data and its admin UI exist — see
   buildSheetBody(). */
function emptyPairFilters() { return { brand: new Set(), price: [null, null] }; }
function clonePairFilters(f) { return { brand: new Set(f.brand), price: f.price.slice() }; }

let pairFilters      = emptyPairFilters();
let draftPairFilters = null;

function pairProductsList() {
    if (_activeCatId === 'sale') return _products.filter(p => isSaleForCity(p, _city));
    return _products.filter(p =>
        p.categoryId === _activeCatId && (_activeSubId == null || p.subId === _activeSubId)
    );
}

function matchesPairFilters(p, f) {
    if (f.brand.size && !f.brand.has(p.brand)) return false;
    const price = displayPriceFor(p);
    if (f.price[0] != null && price < f.price[0]) return false;
    if (f.price[1] != null && price > f.price[1]) return false;
    return true;
}

function countActivePairFilters(f) {
    let n = f.brand.size;
    if (f.price[0] != null || f.price[1] != null) n++;
    return n;
}

function updateFilterBadge() {
    const badge = document.getElementById('filterBadge');
    if (!badge) return;
    const n = countActivePairFilters(pairFilters);
    badge.classList.toggle('hidden', n === 0);
    badge.textContent = n;
}

function openPairProducts(catId, subId) {
    _activeCatId = catId;
    _activeSubId = (subId == null) ? null : subId;
    pairFilters  = emptyPairFilters();
    updateFilterBadge();

    const titleEl = document.getElementById('pairTitle');
    if (titleEl) {
        if (catId === 'sale') {
            titleEl.textContent = 'Акции';
        } else {
            const cat = catById(catId);
            const sub = _activeSubId != null ? subById(_activeSubId) : null;
            titleEl.textContent = sub ? sub.name : cat.name;
        }
    }

    const url = 'catalog.html?category=' + catId + (_activeSubId != null ? '&sub=' + _activeSubId : '');
    history.replaceState(null, '', url);
    renderPairProducts();
    showCatalogScreen('pair');
}

function closePairScreen() {
    const subs = _subcategories.filter(s => s.categoryId === _activeCatId);
    if (_activeSubId != null && subs.length) { openSubcatsScreen(_activeCatId); return; }
    history.replaceState(null, '', 'catalog.html');
    showCatalogScreen('root');
}

function renderPairChips() {
    const wrap  = document.getElementById('chipsRow');
    const outer = document.getElementById('chipsRowWrap');
    if (!wrap || !outer) return;
    wrap.innerHTML = '';
    let any = false;

    pairFilters.brand.forEach(b => {
        any = true;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        btn.innerHTML = `${b} <span aria-hidden="true">✕</span>`;
        btn.addEventListener('click', () => { pairFilters.brand.delete(b); renderPairProducts(); updateFilterBadge(); });
        wrap.appendChild(btn);
    });
    if (pairFilters.price[0] != null || pairFilters.price[1] != null) {
        any = true;
        const label = 'Цена: ' + (pairFilters.price[0] != null ? fmt(pairFilters.price[0]) : 'от')
            + '–' + (pairFilters.price[1] != null ? fmt(pairFilters.price[1]) : 'до');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        btn.innerHTML = `${label} <span aria-hidden="true">✕</span>`;
        btn.addEventListener('click', () => { pairFilters.price = [null, null]; renderPairProducts(); updateFilterBadge(); });
        wrap.appendChild(btn);
    }
    outer.classList.toggle('hidden', !any);
}

function renderPairProducts() {
    const all   = pairProductsList();
    const list  = all.filter(p => matchesPairFilters(p, pairFilters));
    const grid  = document.getElementById('pairProductsGrid');
    const empty = document.getElementById('pairEmptyState');
    const count = document.getElementById('pairResultsCount');
    if (!grid) return;

    if (count) count.textContent = list.length ? plural(list.length, 'товар', 'товара', 'товаров') : '';
    if (!list.length) {
        grid.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
    } else {
        if (empty) empty.classList.add('hidden');
        grid.innerHTML = list.map(productCardHTML).join('');
    }
    renderPairChips();
}

/* ─── Filter sheet: edits draftPairFilters while open; committed filters
   only change when "Показать N товаров" is pressed ──────────────── */
function rangeSection(label, key, range, unit) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-sect';
    const curMin = draftPairFilters[key][0] != null ? draftPairFilters[key][0] : '';
    const curMax = draftPairFilters[key][1] != null ? draftPairFilters[key][1] : '';
    wrap.innerHTML = `
        <p class="sheet-sect__label">${label}</p>
        <div class="range-row">
            <input type="number" inputmode="decimal" placeholder="от ${range[0]}" value="${curMin}" class="range-input" data-key="${key}" data-edge="0">
            <span>—</span>
            <input type="number" inputmode="decimal" placeholder="до ${range[1]}" value="${curMax}" class="range-input" data-key="${key}" data-edge="1">
            ${unit ? `<span>${unit}</span>` : ''}
        </div>`;
    wrap.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', () => {
            const v = inp.value === '' ? null : parseFloat(inp.value);
            draftPairFilters[inp.dataset.key][parseInt(inp.dataset.edge, 10)] = v;
            updateShowBtn();
        });
    });
    return wrap;
}

function checkSection(label, key, options) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-sect';
    wrap.innerHTML = `<p class="sheet-sect__label">${label}</p><div class="check-list">`
        + options.map(o => `<label class="check-row"><input type="checkbox" value="${o}"${draftPairFilters[key].has(o) ? ' checked' : ''}><span>${o}</span></label>`).join('')
        + `</div>`;
    wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) draftPairFilters[key].add(cb.value); else draftPairFilters[key].delete(cb.value);
            updateShowBtn();
        });
    });
    return wrap;
}

function buildSheetBody() {
    const body = document.getElementById('sheetBody');
    if (!body) return;
    body.innerHTML = '';
    const all = pairProductsList();

    const prices = all.map(displayPriceFor).filter(v => v > 0);
    const priceRange = prices.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0];
    body.appendChild(rangeSection('Цена', 'price', priceRange, '₽'));

    const brands = [...new Set(all.map(p => p.brand).filter(Boolean))].sort();
    if (brands.length) body.appendChild(checkSection('Бренд', 'brand', brands));
    // Параметры подкатегории (энергия удара, крутящий момент, вольтаж, вес
    // и т.п.) добавятся сюда следующим этапом вместе с базой характеристик
    // и админкой — сейчас у товаров этих полей нет.
}

function updateShowBtn() {
    const btn = document.getElementById('showBtn');
    if (!btn) return;
    const all = pairProductsList();
    const n = all.filter(p => matchesPairFilters(p, draftPairFilters)).length;
    btn.textContent = 'Показать ' + plural(n, 'товар', 'товара', 'товаров');
}

let _sheetCloseTimer = null;
const SHEET_ANIM_MS = 300;

function openFilterSheet() {
    draftPairFilters = clonePairFilters(pairFilters);
    buildSheetBody();
    updateShowBtn();
    clearTimeout(_sheetCloseTimer);
    const scrim = document.getElementById('sheetScrim');
    const sheet = document.getElementById('filterSheet');
    scrim.classList.remove('hidden');
    sheet.classList.remove('hidden');
    void sheet.offsetHeight; // force reflow so the transition runs from translateY(100%)
    requestAnimationFrame(() => {
        scrim.classList.add('is-open');
        sheet.classList.add('is-open');
    });
}

function cancelFilterSheet() { closeFilterSheetAnimated(); }

function confirmFilterSheet() {
    pairFilters = draftPairFilters;
    renderPairProducts();
    updateFilterBadge();
    closeFilterSheetAnimated();
}

function closeFilterSheetAnimated() {
    const scrim = document.getElementById('sheetScrim');
    const sheet = document.getElementById('filterSheet');
    scrim.classList.remove('is-open');
    sheet.classList.remove('is-open');
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    clearTimeout(_sheetCloseTimer);
    _sheetCloseTimer = setTimeout(() => {
        scrim.classList.add('hidden');
        sheet.classList.add('hidden');
    }, SHEET_ANIM_MS);
}

function initFilterSheet() {
    const openBtn  = document.getElementById('filterOpenBtn');
    const closeBtn = document.getElementById('sheetClose');
    const scrim    = document.getElementById('sheetScrim');
    const sheet    = document.getElementById('filterSheet');
    const showBtn  = document.getElementById('showBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (!openBtn || !sheet) return; // this page has no filter sheet (e.g. Home)

    openBtn.addEventListener('click', openFilterSheet);
    closeBtn.addEventListener('click', cancelFilterSheet);
    scrim.addEventListener('click', cancelFilterSheet);
    showBtn.addEventListener('click', confirmFilterSheet);
    resetBtn.addEventListener('click', () => {
        draftPairFilters = emptyPairFilters();
        buildSheetBody();
        updateShowBtn();
    });
    const emptyResetBtn = document.getElementById('pairEmptyResetBtn');
    if (emptyResetBtn) emptyResetBtn.addEventListener('click', () => {
        pairFilters = emptyPairFilters();
        renderPairProducts();
        updateFilterBadge();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !sheet.classList.contains('hidden')) cancelFilterSheet();
    });

    // Swipe down on the handle/head closes without applying the draft
    const dragEls = [document.querySelector('.sheet-handle'), document.querySelector('.sheet-head')];
    let startY = 0, dy = 0, dragging = false;
    dragEls.forEach(el => {
        if (!el) return;
        el.addEventListener('pointerdown', e => {
            dragging = true; startY = e.clientY; dy = 0;
            sheet.classList.add('dragging');
            el.setPointerCapture(e.pointerId);
        });
        el.addEventListener('pointermove', e => {
            if (!dragging) return;
            dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = `translate(-50%, ${dy}px)`;
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            sheet.classList.remove('dragging');
            if (dy > 90) cancelFilterSheet(); else sheet.style.transform = '';
            dy = 0;
        };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
    });
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
        return _products.filter(p => isSaleForCity(p, _city));
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

/* ─── Displayed price for the active city/variant ─────────────── */
function displayPriceFor(p) {
    const activeVar = _effectiveVariant(p);
    return activeVar
        ? getEffectivePrice(activeVar, _city)
        : (_city === 'krd' ? (p.priceKrd || p.price || 0) : (p.priceMsk || p.price || 0));
}

/* ─── Product card HTML — shared by the root/home grid, hits rail
   and the category›subcategory products screen ──────────────── */
function productCardHTML(p) {
        const cat     = catById(p.categoryId);
        const sub     = subById(p.subId);
        const imgBg   = p.image ? '' : `cat-bg-${cat.color}`;
        const imgIcon = p.image
            ? `<img class="product-card__photo" src="${p.image}" alt="${p.name}">`
            : iconSvg('image', 28);

        const outBadge = !p.inStock
            ? `<span class="product-card__badge-out">Нет в наличии</span>` : '';

        const cityVars  = _cityVariants(p.variants || []);
        const activeVar = _effectiveVariant(p);
        const displayPrice = displayPriceFor(p);
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
                <div class="product-card__accent"></div>
                <div class="product-card__img ${imgBg}">${imgIcon}${favBtn}</div>
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
            btn = `<button class="add-btn" onclick="event.stopPropagation();addToCart(${p.id})" aria-label="В корзину">${CART_SVG}В корзину</button>`;
        } else if (tgId) {
            const subscribed = _subscriptions.has(p.id);
            btn = subscribed
                ? `<button class="add-btn add-btn--subscribed" disabled aria-label="Вы подписаны">${_bellSvg(true)}Подписан</button>`
                : `<button class="add-btn add-btn--notify" onclick="event.stopPropagation();subscribeNotify(${p.id})" aria-label="Уведомить о поступлении">${_bellSvg(false)}Уведомить</button>`;
        } else {
            btn = `<button class="add-btn add-btn--disabled" disabled>Нет в наличии</button>`;
        }

        return `
        <div class="product-card" id="pcard-${p.id}" onclick="openProduct(${p.id})">
            <div class="product-card__accent"></div>
            <div class="product-card__img ${imgBg}">${imgIcon}${outBadge}${favBtn}</div>
            <div class="product-card__body">
                <div class="product-card__name">${p.name}</div>
                ${variantPills}
                <div class="product-card__footer">
                    <span class="product-card__price">${fmtPrice(displayPrice, displaySale)}</span>
                    ${btn}
                </div>
            </div>
        </div>`;
}

/* ─── Render: root/home grid ────────────────────────────────── */
function render() {
    const list  = getFiltered();
    const grid  = document.getElementById('productsGrid');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('resultsCount');

    if (count) count.textContent = list.length ? plural(list.length, 'товар', 'товара', 'товаров') : '';

    if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');
    grid.innerHTML = list.map(productCardHTML).join('');
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
    authFetch('/api/favorites', {
        method:  wasFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ productId }),
    }).catch(() => {
        if (wasFav) { _favorites.add(productId); } else { _favorites.delete(productId); }
        applyFavState(wasFav);
    });
}

const CART_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`;

/* ─── Stock notify ───────────────────────────────────────────── */
function _bellSvg(filled) {
    const f = filled ? '#FFD60A' : 'none';
    const s = filled ? '#FFD60A' : 'rgba(28,28,30,0.55)';
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${f}" stroke="${s}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:fill .2s,stroke .2s"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
}

async function subscribeNotify(productId) {
    const tgId = getTgId();
    if (!tgId) { showToast('Откройте магазин через бота в Max Messenger'); return; }
    try {
        await authFetch('/api/stock-notify', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ productId }),
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
    location.href = 'src/favorites/favorites.html';
}

/* ─── Init ──────────────────────────────────────────────────── */
async function init() {
    const tgId = getTgId();
    try {
        const [cats, subs, prods, favs, stockSubs] = await Promise.all([
            apiFetch('/api/categories'),
            apiFetch('/api/subcategories'),
            apiFetch('/api/products'),
            tgId ? apiFetch('/api/favorites').catch(() => []) : Promise.resolve([]),
            tgId ? apiFetch('/api/stock-notify/list').catch(() => []) : Promise.resolve([]),
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

    // Restore catalog position when coming back from a product page
    const isBack = !!sessionStorage.getItem('catalog_back');
    let savedScroll = null, backScreen = 'root', backCatId = null, backSubId = null;
    if (isBack) {
        backScreen  = sessionStorage.getItem('catalog_screen') || 'root';
        const rawCat = sessionStorage.getItem('catalog_cat');
        const rawSub = sessionStorage.getItem('catalog_sub');
        backCatId   = rawCat ? (rawCat === 'sale' ? 'sale' : Number(rawCat)) : null;
        backSubId   = rawSub ? Number(rawSub) : null;
        savedScroll = sessionStorage.getItem('catalog_scroll');
        sessionStorage.removeItem('catalog_back');
        sessionStorage.removeItem('catalog_screen');
        sessionStorage.removeItem('catalog_cat');
        sessionStorage.removeItem('catalog_sub');
        sessionStorage.removeItem('catalog_scroll');
    }

    localStorage.removeItem('favorites_changed');
    renderCategoryRail();
    renderHitsRail();
    initBanner();
    render();
    updateBadges();
    _startPolling();

    if (isBack && backScreen === 'pair' && backCatId != null) {
        // Returning from a product page opened inside the pair-products screen
        openPairProducts(backCatId, backSubId);
    } else if (!isBack) {
        // Coming from a Home/Catalog rail tile (?category=ID[&sub=ID], or
        // ?category=sale) — open the matching drill-down screen once ready.
        const params = new URLSearchParams(location.search);
        const urlCat = params.get('category');
        const urlSub = params.get('sub');
        if (urlCat === 'sale') {
            openPairProducts('sale', null);
        } else {
            const catNum = urlCat ? Number(urlCat) : NaN;
            if (!Number.isNaN(catNum)) {
                const subNum = urlSub ? Number(urlSub) : NaN;
                openCategoryDrilldown(catNum, Number.isNaN(subNum) ? undefined : subNum);
            }
        }
    }

    if (savedScroll) {
        requestAnimationFrame(() => requestAnimationFrame(() =>
            window.scrollTo({ top: +savedScroll, behavior: 'instant' })
        ));
    }
}

/* ─── Reload favorites state (e.g. after bfcache restore) ───── */
async function reloadFavorites() {
    const tgId = getTgId();
    if (!tgId) return;
    try {
        const favs = await apiFetch('/api/favorites').catch(() => []);
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
            tgId ? apiFetch('/api/stock-notify/list').catch(() => []) : Promise.resolve([]),
            tgId ? apiFetch('/api/favorites').catch(() => []) : Promise.resolve([]),
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
            apiFetch('/api/stock-notify/list').catch(() => []),
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
    initFilterSheet();
    if (detectCity()) init();
});

window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        // bfcache restore: JS state (incl. scroll + screen) already preserved
        sessionStorage.removeItem('catalog_back');
        sessionStorage.removeItem('catalog_screen');
        sessionStorage.removeItem('catalog_cat');
        sessionStorage.removeItem('catalog_sub');
        sessionStorage.removeItem('catalog_scroll');
    }
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
