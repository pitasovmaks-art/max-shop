/* ─── In-memory cache (filled at startup) ───────────────────── */
let _categories    = [];
let _subcategories = [];
let _products      = [];
let _favorites     = new Set();      // Set of product_id (Number)
let _subscriptions = new Set();      // product_ids subscribed for restock notifications

/* ─── Catalog cache (stale-while-revalidate) ─────────────────── */
// Показываем сохранённый каталог сразу (без ожидания сети), затем тихо
// обновляем его в фоне тем же /api/categories+/api/subcategories+/api/products
// запросом, который init() всё равно делает. Если фоновое обновление
// упало, а показанные данные уже из кэша — ошибку не показываем, просто
// оставляем то, что уже на экране (см. init()).
const CATALOG_CACHE_KEY = 'catalog_cache_v1';

function loadCatalogCache() {
    try {
        const data = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null');
        if (!data || !Array.isArray(data.categories) || !Array.isArray(data.subcategories) || !Array.isArray(data.products)) return null;
        return data;
    } catch { return null; }
}

function saveCatalogCache(categories, subcategories, products) {
    try {
        localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ categories, subcategories, products, savedAt: Date.now() }));
    } catch { /* localStorage переполнен/недоступен (приватный режим) — не критично */ }
}

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

/* Home "Популярные товары": how many of the shuffled list are shown right
   now (grows by 24 via loadMorePopular()); reset to 24 whenever the user
   leaves the unfiltered "all products" view (search/category), so coming
   back to it starts collapsed again. */
let _popularVisibleCount = 24;

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

    // Категории без единого товара не показываем — тапать на них всё
    // равно было бы некуда (пустой экран подкатегорий/товаров).
    const nonEmptyCats = _categories.filter(c => _products.some(p => p.categoryId === c.id));

    rail.innerHTML = saleTile + nonEmptyCats.map(c =>
        `<button class="cat-tile" onclick="${openTile(c.id)}">
            <span class="cat-tile__ic">${categoryIconSvg(c, 20)}</span>
            <span>${c.name}</span>
        </button>`
    ).join('');
    initRailFade(rail);
}

/* ─── Home: promo banner carousel ───────────────────────────── */
/* Нейтральные тексты — без цен, скидок, сроков и условий (их никто не
   придумывал). Фолбэк: показывается только если в БД нет активных
   баннеров (см. loadBannersCache/initBanner ниже) или запрос к
   /api/banners не удался — управление баннерами теперь в админке
   (server/routes/banners.js, admin/banners.js). categoryName —
   название категории для клика (openBannerTarget ищет её среди
   загруженных _categories по имени; если не найдено — просто Каталог). */
const HOME_BANNERS = [
    { cls: 'banner-slide--a', title: 'Точка Монтажа',       sub: 'Профессиональный строительный инструмент', linkType: 'none', linkId: null },
    { cls: 'banner-slide--b', title: 'Монтажные пистолеты', sub: 'Toua, FengBao и другие бренды',             linkType: 'category', linkId: null, categoryName: 'Монтажные пистолеты' },
    { cls: 'banner-slide--c', title: 'Расходники',          sub: 'Для монтажных пистолетов и инструмента',    linkType: 'category', linkId: null, categoryName: 'Расходники' },
];
let _bannerIndex    = 0;
let _bannerTimer    = null;
let _activeBanners  = HOME_BANNERS;

const BANNERS_CACHE_KEY = 'banners_cache_v1';

function loadBannersCache() {
    try {
        const raw = localStorage.getItem(BANNERS_CACHE_KEY);
        if (raw === null) return undefined; // кэша ещё не было вообще — отличаем от «кэш: баннеров нет»
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : undefined;
    } catch { return undefined; }
}
function saveBannersCache(banners) {
    try { localStorage.setItem(BANNERS_CACHE_KEY, JSON.stringify(banners)); } catch { /* приватный режим и т.п. — не критично */ }
}

function _bannerGoTo(i) {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track || !_activeBanners.length) return;
    _bannerIndex = ((i % _activeBanners.length) + _activeBanners.length) % _activeBanners.length;
    track.style.transform = `translateX(-${_bannerIndex * 100}%)`;
    if (dots) {
        [...dots.children].forEach((dot, idx) => dot.classList.toggle('on', idx === _bannerIndex));
    }
}

function _bannerStart() {
    clearInterval(_bannerTimer);
    if (_activeBanners.length > 1) _bannerTimer = setInterval(() => _bannerGoTo(_bannerIndex + 1), 3000);
}

function _bannerPause() {
    clearInterval(_bannerTimer);
}

/* Клик по баннеру — с проверкой, что цель ещё существует среди уже
   загруженных данных (товар/категория/подкатегория могли быть удалены
   после того, как баннер на них настроили) — иначе вместо перехода на
   несуществующую страницу просто открываем Каталог. */
function openBannerTarget(linkType, linkId) {
    if (linkType === 'product' || linkType === 'service') {
        if (!_products.find(p => p.id === linkId)) { location.href = 'catalog.html'; return; }
        location.href = `src/catalog/product.html?id=${linkId}`;
    } else if (linkType === 'category') {
        if (!_categories.find(c => c.id === linkId)) { location.href = 'catalog.html'; return; }
        location.href = `catalog.html?category=${linkId}`;
    } else if (linkType === 'subcategory') {
        const sub = _subcategories.find(s => s.id === linkId);
        if (!sub) { location.href = 'catalog.html'; return; }
        location.href = `catalog.html?category=${sub.categoryId}&sub=${linkId}`;
    } else {
        location.href = 'catalog.html';
    }
}

/* HOME_BANNERS использует старое поле categoryName (ищем id по имени
   среди уже загруженных категорий — как и раньше); серверные баннеры
   уже приходят с готовым linkType/linkId. */
function _resolveFallbackBanners() {
    return HOME_BANNERS.map(b => {
        if (b.linkType !== 'category' || !b.categoryName) return b;
        const cat = _categories.find(c => c.name === b.categoryName);
        return cat ? { ...b, linkId: cat.id } : { ...b, linkType: 'none', linkId: null };
    });
}

/* Собирает DOM разметку слайда через общий src/shared/bannerRender.js
   (textContent/createTextNode внутри — никакого innerHTML с данными
   баннера, это и есть защита от XSS в text_blocks/title/subtitle).
   Клик вешается здесь, а не в bannerRender.js — это уже специфика
   страницы (Главная), а не внешний вид. */
function _renderBannerSlides(banners) {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track || !dots || !window.BannerRender) return;
    _activeBanners = banners;
    track.innerHTML = '';
    banners.forEach(b => {
        const el = BannerRender.buildBannerSlideElement(b, document.documentElement);
        if (b.linkType && b.linkType !== 'none') {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => openBannerTarget(b.linkType, b.linkId));
        }
        track.appendChild(el);
    });
    dots.innerHTML = banners.length > 1 ? banners.map(() => `<span></span>`).join('') : '';
    _bannerIndex = 0;
    _bannerGoTo(0);
    _bannerStart();
}

function _renderBannerSkeleton() {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track) return;
    clearInterval(_bannerTimer);
    track.style.transform = 'translateX(0)';
    track.innerHTML = '<div class="banner-slide banner-slide--skeleton" aria-hidden="true"></div>';
    if (dots) dots.innerHTML = '';
}

/* Независимый от каталога stale-while-revalidate-цикл (тот же приём,
   что у loadCatalogCache/saveCatalogCache) — поэтому вызывается ровно
   один раз, в начале init(), а не привязан к двухфазной загрузке
   каталога. Нет кэша вообще (первый визит) -> скелетон, а не нейтральные
   баннеры и не пустота. Нейтральные HOME_BANNERS показываются только
   после того, как запрос реально завершился пустым ответом или упал —
   не как стартовое состояние. */
async function initBanner() {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    // catalog.js общий для index.html и catalog.html; bannerRender.js
    // подключён только в index.html (на catalog.html нет #bannerTrack —
    // первая проверка уже выходит раньше; вторая — на случай будущих
    // правок разметки, когда контейнер появится, а скрипт ещё нет).
    if (!track || !dots || !window.BannerRender) return;

    const cached = loadBannersCache();
    if (cached !== undefined) {
        _renderBannerSlides(cached.length ? cached : _resolveFallbackBanners());
    } else {
        _renderBannerSkeleton();
    }

    try {
        const banners = await apiFetch('/api/banners');
        saveBannersCache(banners);
        _renderBannerSlides(banners.length ? banners : _resolveFallbackBanners());
    } catch (e) {
        if (cached === undefined) _renderBannerSlides(_resolveFallbackBanners());
        // иначе на экране уже что-то из кэша — оставляем как есть
    }

    track.addEventListener('touchstart', _bannerPause, { passive: true });
    track.addEventListener('touchend',   _bannerStart,  { passive: true });
    track.addEventListener('mousedown',  _bannerPause);
    window.addEventListener('mouseup',   _bannerStart);
}

/* ─── Home: hits rail (товары с isHit, рельса под баннером) ──────── */
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

function openCategoryDrilldown(catId, subId, restoreOpts) {
    if (subId != null && !Number.isNaN(subId)) { openPairProducts(catId, subId, restoreOpts); return; }
    const subs = _subcategories.filter(s => s.categoryId === catId);
    if (subs.length) openSubcatsScreen(catId);
    else openPairProducts(catId, null, restoreOpts);
}

function openSubcatsScreen(catId) {
    const grid = document.getElementById('subcatGrid');
    const titleEl = document.getElementById('subcatsTitle');
    if (!grid || !titleEl) return;
    const cat  = catById(catId);
    _activeCatId = catId;
    _activeSubId = null;
    titleEl.textContent = cat.name;
    const crumb = document.getElementById('subcatsBreadcrumb');
    if (crumb) crumb.textContent = cat.name;
    const subs = _subcategories.filter(s => s.categoryId === catId);
    grid.innerHTML = subs.map(s => `
        <button class="subcat-tile" onclick="openPairProducts(${catId},${s.id})">
            <span class="subcat-tile__ic">${categoryIconSvg(cat, 22)}</span>
            <span>${s.name}</span>
        </button>`).join('')
        + `<button class="subcat-tile subcat-tile--all" onclick="openPairProducts(${catId},null)">
            <span class="subcat-tile__ic">${iconSvg('grid', 22)}</span>
            <span>Все товары</span>
        </button>`;
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

/* Сортировка на экране товаров (категория/подкатегория) — отдельная от
   фильтров ось: не считается в счётчике на кнопке «Фильтры», но живёт в
   той же шторке (см. sortSection() ниже) и в том же URL (см. syncPairUrl). */
let pairSort      = 'default'; // 'default' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc'
let draftPairSort = 'default';

function sortPairList(list, sort) {
    if (sort === 'price_asc')  return [...list].sort((a, b) => displayPriceFor(a) - displayPriceFor(b));
    if (sort === 'price_desc') return [...list].sort((a, b) => displayPriceFor(b) - displayPriceFor(a));
    if (sort === 'name_asc')   return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (sort === 'name_desc')  return [...list].sort((a, b) => b.name.localeCompare(a.name, 'ru'));
    return list;
}

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

/* restoreOpts — только при восстановлении состояния из URL при загрузке
   страницы (см. init()): { brand:[...], priceMin, priceMax, sort }.
   Обычный тап по категории/подкатегории его не передаёт — фильтры и
   сортировка сбрасываются, как и раньше. */
function openPairProducts(catId, subId, restoreOpts) {
    _activeCatId = catId;
    _activeSubId = (subId == null) ? null : subId;
    if (restoreOpts) {
        pairFilters = { brand: new Set(restoreOpts.brand || []), price: [restoreOpts.priceMin ?? null, restoreOpts.priceMax ?? null] };
        pairSort    = restoreOpts.sort || 'default';
    } else {
        pairFilters = emptyPairFilters();
        pairSort    = 'default';
    }
    updateFilterBadge();

    const titleEl = document.getElementById('pairTitle');
    const crumb   = document.getElementById('pairBreadcrumb');
    if (titleEl) {
        if (catId === 'sale') {
            titleEl.textContent = 'Акции';
            if (crumb) crumb.textContent = '';
        } else {
            const cat = catById(catId);
            const sub = _activeSubId != null ? subById(_activeSubId) : null;
            titleEl.textContent = sub ? sub.name : cat.name;
            if (crumb) crumb.textContent = sub ? `${cat.name} › ${sub.name}` : cat.name;
        }
    }

    syncPairUrl();
    renderPairProducts();
    showCatalogScreen('pair');
}

/* Отражает категорию/подкатегорию + применённые (не черновые) фильтры и
   сортировку экрана товаров в URL — чтобы «Назад» в Max и обновление
   страницы восстанавливали ровно то же состояние (см. init()). */
function syncPairUrl() {
    const params = new URLSearchParams();
    params.set('category', _activeCatId);
    // sub=all различает «показать все товары категории» (кнопка в
    // openSubcatsScreen) от обычного «?category=ID без sub», который
    // openCategoryDrilldown/init() трактуют как «открыть подкатегории,
    // если они есть» — иначе оба случая давали бы один и тот же URL.
    if (_activeSubId != null) params.set('sub', _activeSubId);
    else if (_activeCatId !== 'sale') params.set('sub', 'all');
    if (pairFilters.brand.size) params.set('brand', [...pairFilters.brand].join(','));
    if (pairFilters.price[0] != null) params.set('priceMin', pairFilters.price[0]);
    if (pairFilters.price[1] != null) params.set('priceMax', pairFilters.price[1]);
    if (pairSort && pairSort !== 'default') params.set('sort', pairSort);
    history.replaceState(null, '', 'catalog.html?' + params.toString());
}

function closePairScreen() {
    // Категория с подкатегориями -> назад на экран подкатегорий (в том
    // числе из «Показать все товары», где _activeSubId сам null, но
    // подкатегории у категории всё равно есть). Категория без подкатегорий
    // (или «Акции») -> у неё никогда не было экрана подкатегорий, назад на корень.
    const subs = _subcategories.filter(s => s.categoryId === _activeCatId);
    if (subs.length) { openSubcatsScreen(_activeCatId); return; }
    history.replaceState(null, '', 'catalog.html');
    showCatalogScreen('root');
}

function renderPairChips() {
    const wrap  = document.getElementById('chipsRow');
    const outer = document.getElementById('chipsRowWrap');
    if (!wrap || !outer) return;
    wrap.innerHTML = '';
    let any = false;

    // Бренд — текст из админки (не наш контент), поэтому только
    // createTextNode/textContent, никогда innerHTML с его значением.
    pairFilters.brand.forEach(b => {
        any = true;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-chip';
        btn.appendChild(document.createTextNode(b + ' '));
        const x = document.createElement('span');
        x.setAttribute('aria-hidden', 'true');
        x.textContent = '✕';
        btn.appendChild(x);
        btn.addEventListener('click', () => { pairFilters.brand.delete(b); renderPairProducts(); updateFilterBadge(); syncPairUrl(); });
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
        btn.addEventListener('click', () => { pairFilters.price = [null, null]; renderPairProducts(); updateFilterBadge(); syncPairUrl(); });
        wrap.appendChild(btn);
    }
    outer.classList.toggle('hidden', !any);
}

function renderPairProducts() {
    const all   = pairProductsList();
    const list  = sortPairList(all.filter(p => matchesPairFilters(p, pairFilters)), pairSort);
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

// options (бренды) — текст из админки, не наш контент: строится через
// DOM/textContent, а не через innerHTML-интерполяцию (XSS-защита).
function checkSection(label, key, options) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-sect';
    const labelEl = document.createElement('p');
    labelEl.className = 'sheet-sect__label';
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    const list = document.createElement('div');
    list.className = 'check-list';
    options.forEach(o => {
        const row = document.createElement('label');
        row.className = 'check-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o;
        cb.checked = draftPairFilters[key].has(o);
        cb.addEventListener('change', () => {
            if (cb.checked) draftPairFilters[key].add(cb.value); else draftPairFilters[key].delete(cb.value);
            updateShowBtn();
        });
        const span = document.createElement('span');
        span.textContent = o;
        row.appendChild(cb);
        row.appendChild(span);
        list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
}

const PAIR_SORT_OPTIONS = [
    ['default',    'По умолчанию'],
    ['price_asc',  'Сначала дешевле'],
    ['price_desc', 'Сначала дороже'],
    ['name_asc',   'По названию, А→Я'],
];

function sortSection() {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-sect';
    const labelEl = document.createElement('p');
    labelEl.className = 'sheet-sect__label';
    labelEl.textContent = 'Сортировка';
    wrap.appendChild(labelEl);

    const list = document.createElement('div');
    list.className = 'check-list';
    PAIR_SORT_OPTIONS.forEach(([val, label]) => {
        const row = document.createElement('label');
        row.className = 'check-row';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'pairSort';
        radio.value = val;
        radio.checked = draftPairSort === val;
        radio.addEventListener('change', () => { if (radio.checked) draftPairSort = val; });
        const span = document.createElement('span');
        span.textContent = label;
        row.appendChild(radio);
        row.appendChild(span);
        list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
}

function buildSheetBody() {
    const body = document.getElementById('sheetBody');
    if (!body) return;
    body.innerHTML = '';
    const all = pairProductsList();

    const prices = all.map(displayPriceFor).filter(v => v > 0);
    const priceRange = prices.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0];
    body.appendChild(sortSection());
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
    draftPairSort    = pairSort;
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
    pairSort    = draftPairSort;
    renderPairProducts();
    updateFilterBadge();
    syncPairUrl();
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
        draftPairSort    = 'default';
        buildSheetBody();
        updateShowBtn();
    });
    const emptyResetBtn = document.getElementById('pairEmptyResetBtn');
    if (emptyResetBtn) emptyResetBtn.addEventListener('click', () => {
        pairFilters = emptyPairFilters();
        pairSort    = 'default';
        renderPairProducts();
        updateFilterBadge();
        syncPairUrl();
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
/* На Каталоге (screen-root существует) поиск параметризованным
   запросом уходит на сервер (GET /api/products?q=, см. products.js) —
   с задержкой ввода и заменой категорий результатами, см.
   performCatalogSearch() ниже. На Главной (тот же HTML/JS, без
   screen-root) поведение не меняется: как и раньше, фильтрует уже
   загруженный локальный список товаров через render()/getFiltered(). */
function handleSearch() {
    const input = document.getElementById('searchInput');
    const onCatalogPage = !!document.getElementById('screen-root');
    clearTimeout(_searchTimer);
    if (onCatalogPage) {
        state.query = input.value.trim();
        document.getElementById('searchClear').classList.toggle('hidden', !state.query);
        _searchTimer = setTimeout(performCatalogSearch, CATALOG_SEARCH_DEBOUNCE_MS);
    } else {
        state.query = input.value.trim().toLowerCase();
        document.getElementById('searchClear').classList.toggle('hidden', !state.query);
        _searchTimer = setTimeout(render, 250);
    }
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.query = '';
    document.getElementById('searchClear').classList.add('hidden');
    if (document.getElementById('screen-root')) {
        showCategoriesView();
        history.replaceState(null, '', 'catalog.html');
    } else {
        render();
    }
}

/* ─── Catalog root search: server-side, debounced ──────────────────
   Пустой запрос -> список категорий (см. ТЗ); непустой -> запрос на
   сервер (параметризованный, экранирование %/_ и лимиты — на сервере,
   см. GET /api/products в server/routes/products.js), результаты
   заменяют список категорий на экране. */
const CATALOG_SEARCH_DEBOUNCE_MS = 300;
let _searchSeq = 0; // против гонки: показываем только самый свежий ответ

function showCategoriesView() {
    const catSection    = document.getElementById('catRailSection');
    const searchSection = document.getElementById('searchResultsSection');
    if (catSection)    catSection.classList.remove('hidden');
    if (searchSection) searchSection.classList.add('hidden');
}

function showSearchResultsView() {
    const catSection    = document.getElementById('catRailSection');
    const searchSection = document.getElementById('searchResultsSection');
    if (catSection)    catSection.classList.add('hidden');
    if (searchSection) searchSection.classList.remove('hidden');
}

async function performCatalogSearch() {
    const q = state.query;
    if (!q) { showCategoriesView(); history.replaceState(null, '', 'catalog.html'); return; }

    showSearchResultsView();
    history.replaceState(null, '', 'catalog.html?q=' + encodeURIComponent(q));

    const seq   = ++_searchSeq;
    const grid  = document.getElementById('searchResultsGrid');
    const empty = document.getElementById('searchEmptyState');
    const count = document.getElementById('searchResultsCount');
    try {
        const results = await apiFetch('/api/products?q=' + encodeURIComponent(q));
        if (seq !== _searchSeq) return; // устарело — пришёл более новый запрос, этот ответ игнорируем
        if (count) count.textContent = results.length ? plural(results.length, 'товар', 'товара', 'товаров') : '';
        if (!results.length) {
            if (grid) grid.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
        } else {
            if (empty) empty.classList.add('hidden');
            if (grid) grid.innerHTML = results.map(productCardHTML).join('');
        }
    } catch (e) {
        if (seq !== _searchSeq) return;
        if (grid) grid.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        if (count) count.textContent = 'Ошибка загрузки';
    }
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

/* ─── Home "Популярные товары": seeded per-session shuffle ───────
   Same seed + same input order/length ⇒ same shuffled order, so a
   background cache refresh (render() called again with fresh data)
   doesn't visibly reshuffle the grid mid-session. A new session (no
   sessionStorage entry) gets a fresh seed ⇒ a new order. ─────────── */
function _getPopularSeed() {
    let seed = sessionStorage.getItem('catalog_popular_seed');
    if (!seed) {
        seed = String(Math.floor(Math.random() * 2 ** 31));
        sessionStorage.setItem('catalog_popular_seed', seed);
    }
    return Number(seed);
}

function _seededShuffle(arr, seed) {
    const a = arr.slice();
    let s = seed >>> 0;
    function rand() {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    }
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function loadMorePopular() {
    _popularVisibleCount += 24;
    render();
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
            ? `<img class="product-card__photo" src="${p.image}" alt="${p.name}" loading="lazy" decoding="async">`
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
    const grid      = document.getElementById('productsGrid');
    if (!grid) return; // Каталог больше не показывает общий список товаров на корне (см. performCatalogSearch) — это теперь только для Главной
    const empty     = document.getElementById('emptyState');
    const count     = document.getElementById('resultsCount');
    const loadMore  = document.getElementById('popularLoadMore');

    // "Популярные товары" (все товары вперемешку, без исключения хитов) —
    // только на Главной и только когда нет активного поиска/категории;
    // поиск и переход по категории на Главной ведут себя как раньше.
    const isHomePage       = !document.getElementById('screen-root');
    const isPopularContext = isHomePage && state.categoryId === null && !state.query;
    if (!isPopularContext) _popularVisibleCount = 24;

    let list = getFiltered();
    if (isPopularContext) list = _seededShuffle(list, _getPopularSeed());

    if (count) count.textContent = list.length ? plural(list.length, 'товар', 'товара', 'товаров') : '';

    if (!list.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        if (loadMore) loadMore.classList.add('hidden');
        return;
    }
    empty.classList.add('hidden');

    const visibleList = isPopularContext ? list.slice(0, _popularVisibleCount) : list;
    grid.innerHTML = visibleList.map(productCardHTML).join('');

    if (loadMore) loadMore.classList.toggle('hidden', !(isPopularContext && list.length > visibleList.length));
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

    // Баннер живёт по собственному stale-while-revalidate циклу, независимо
    // от каталога (см. initBanner) — поэтому запускается один раз здесь,
    // а не на каждой из двух фаз загрузки каталога ниже.
    initBanner();

    // Stale-while-revalidate: кэш показываем мгновенно (без ожидания сети),
    // ниже эти же данные обновляются свежим запросом и перерисовываются.
    const cached = loadCatalogCache();
    if (cached) {
        _categories    = cached.categories;
        _subcategories = cached.subcategories;
        _products      = cached.products;
        renderCategoryRail();
        renderHitsRail();
        render();
    }

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
        saveCatalogCache(cats, subs, prods);
    } catch (e) {
        console.error('Ошибка загрузки каталога:', e);
        // Фоновое обновление упало, но на экране уже валидный кэш — не
        // перекрываем его сообщением об ошибке, просто остаёмся на нём.
        if (!cached) {
            // emptyState/resultsCount — только на Главной (там общий список
            // товаров всё ещё есть); на Каталоге такого списка на корне
            // больше нет (см. catalog.html), поэтому там просто тост.
            const emptyEl = document.getElementById('emptyState');
            const countEl = document.getElementById('resultsCount');
            if (emptyEl) emptyEl.classList.remove('hidden');
            if (countEl) countEl.textContent = 'Ошибка загрузки';
            if (!emptyEl) showToast('Ошибка загрузки каталога');
        }
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
    render();
    updateBadges();
    _startPolling();

    if (isBack && backScreen === 'pair' && backCatId != null) {
        // Returning from a product page opened inside the pair-products screen
        openPairProducts(backCatId, backSubId);
    } else if (!isBack) {
        // Coming from a Home/Catalog rail tile (?category=ID[&sub=ID][&brand=&priceMin=&priceMax=&sort=],
        // ?category=sale, or a search ?q=...) — restore the matching screen
        // once data is ready, so "Назад" in Max and a page refresh land back
        // on the same place (see syncPairUrl()/performCatalogSearch()).
        const params = new URLSearchParams(location.search);
        const urlQ   = params.get('q');
        const urlCat = params.get('category');
        const urlSub = params.get('sub');
        if (urlQ) {
            const input = document.getElementById('searchInput');
            if (input) {
                input.value = urlQ;
                state.query = urlQ.trim();
                document.getElementById('searchClear')?.classList.toggle('hidden', !state.query);
                performCatalogSearch();
            }
        } else if (urlCat === 'sale') {
            openPairProducts('sale', null);
        } else {
            const catNum = urlCat ? Number(urlCat) : NaN;
            if (!Number.isNaN(catNum)) {
                const restoreOpts = {
                    brand:    (params.get('brand') || '').split(',').filter(Boolean),
                    priceMin: params.has('priceMin') ? Number(params.get('priceMin')) : null,
                    priceMax: params.has('priceMax') ? Number(params.get('priceMax')) : null,
                    sort:     params.get('sort') || 'default',
                };
                if (urlSub === 'all') {
                    // «Показать все товары категории» — минуя экран подкатегорий,
                    // даже если они у категории есть (см. syncPairUrl()).
                    openPairProducts(catNum, null, restoreOpts);
                } else {
                    const subNum = urlSub ? Number(urlSub) : NaN;
                    openCategoryDrilldown(catNum, Number.isNaN(subNum) ? undefined : subNum, restoreOpts);
                }
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

/* ─── Prefetch neighbouring Home/Catalog page ─────────────────────
   Home and Catalog are full (non-SPA) navigations, so the next page
   normally starts completely cold. Since users bounce between these two
   constantly, warm the browser's HTTP cache for whichever of the two the
   current page is NOT, either as soon as its bottom-nav link scrolls into
   view, or immediately on press (pointerdown fires before click/navigation,
   buying a head start on touch devices). */
function setupNavPrefetch() {
    const prefetched = new Set();
    function prefetch(url) {
        if (prefetched.has(url)) return;
        prefetched.add(url);
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        document.head.appendChild(link);
    }
    document.querySelectorAll('.bottom-nav a[href="index.html"], .bottom-nav a[href="catalog.html"]').forEach(a => {
        const href = a.getAttribute('href');
        if (location.pathname.endsWith(href)) return; // already on that page
        a.addEventListener('pointerdown', () => prefetch(href), { once: true });
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(entries => {
                if (entries.some(e => e.isIntersecting)) { prefetch(href); io.disconnect(); }
            });
            io.observe(a);
        } else {
            prefetch(href);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderCityList('');
    initFilterSheet();
    setupNavPrefetch();
    if (detectCity()) init();
});

window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return; // обычная загрузка — init() уже сам сходил за свежими данными
    // bfcache restore: JS state (incl. scroll + screen) already preserved,
    // но данные с сервера могли устареть за время в bfcache — обновим их.
    sessionStorage.removeItem('catalog_back');
    sessionStorage.removeItem('catalog_screen');
    sessionStorage.removeItem('catalog_cat');
    sessionStorage.removeItem('catalog_sub');
    sessionStorage.removeItem('catalog_scroll');
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
