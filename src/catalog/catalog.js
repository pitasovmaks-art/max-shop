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
    // Категории без единого товара не показываем — тапать на них всё
    // равно было бы некуда (пустой экран подкатегорий/товаров).
    const nonEmptyCats = _categories.filter(c => _products.some(p => p.categoryId === c.id));

    if (onCatalogPage) {
        // Карточки 2 колонки (не рельса, не список строк) — Главную
        // (.cat-rail/.cat-tile ниже) эта ветка не трогает. cat.icon
        // проверяем явно: если его нет в API — иконку не показываем вообще
        // (ни свою, ни дефолтную; categoryIconSvg() сама всегда возвращает
        // какую-то иконку через фолбэк на DEFAULT_CATEGORY_ICON — тут он
        // сознательно не используется, чтобы не придумывать данных).
        const saleCard = hasSale
            ? `<button class="cat-card cat-card--sale" onclick="${openTile("'sale'")}">
                <span class="cat-card__ic">${iconSvg('sale', 18)}</span>
                <span class="cat-card__label">Акции</span>
            </button>`
            : '';
        rail.innerHTML = saleCard + nonEmptyCats.map(c =>
            `<button class="cat-card" onclick="${openTile(c.id)}">
                ${c.icon ? `<span class="cat-card__ic">${categoryIconSvg(c, 18)}</span>` : ''}
                <span class="cat-card__label">${c.name}</span>
            </button>`
        ).join('');
        return;
    }

    const saleTile = hasSale
        ? `<button class="cat-tile cat-tile--sale" onclick="${openTile("'sale'")}">
            <span class="cat-tile__ic">${iconSvg('sale', 20)}</span>
            <span>Акции</span>
        </button>`
        : '';
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

/* Карусель — бесконечная по кругу (1→2→…→N→1), без «пинг-понга» на
   границе. Механизм (стандартный приём для бесшовной бесконечной
   карусели): когда баннеров >1 и анимация не отключена
   (prefers-reduced-motion), в трек ДОБАВЛЯЮТСЯ клоны — копия последнего
   слайда ПЕРЕД первым и копия первого ПОСЛЕ последнего:
   [клон-последнего, 0, 1, …, N-1, клон-первого]. _bannerTrackPos — позиция
   в этом треке (1..N — реальные слайды, 0 и N+1 — клоны); _bannerIndex —
   логический индекс реального баннера (0..N-1, то, что показывают точки).
   Переход на клон анимируется как обычно, а сразу после (transitionend)
   трек мгновенно (transition:none) телепортируется на настоящий слайд с
   тем же номером — глазу разницы не видно, но нет скачка через все N
   слайдов. При reduced-motion или N<=1 клонов нет вообще — там и так
   нечего бесшовно анимировать (переход либо мгновенный, либо его нет).

   Конечный автомат idle/dragging/animating + _bannerStepToken (см. ниже) —
   устраняет три бага, найденные стресс-тестом на предыдущей версии (без
   автомата, с отдельными булевыми _bannerBusy/_bannerDrag):
   - новый pointerdown во время ещё идущей анимации захватывал
     _bannerTrackPos, который в этот момент мог стоять на позиции КЛОНА
     (0 или N+1) — ещё не телепортированной на настоящий слайд, потому что
     teleport случается в колбэке transitionend/таймера ПОЗЖЕ. Следующий
     шаг прибавлял direction поверх этого непосредствованного значения, и
     _bannerTrackPos уходил за пределы [0, N+1] без возврата (наблюдалось
     вплоть до -6 в стресс-тесте) — баннер уезжал с экрана насовсем (баг C,
     "пропадает") и мог visуально поехать не в ту сторону при следующем
     свайпе, т.к. базовая точка жеста была в заведомо неверном месте (баг B).
   - у каждого вызова шага была СВОЯ независимая подписка на transitionend/
     таймер без отмены предыдущей — несколько параллельных «доездов»
     срабатывали по одному и тому же событию и каждый по-своему мутировал
     общее состояние.
   _bannerStepToken — счётчик поколений: при начале НОВОГО жеста/шага он
   увеличивается, и колбэки СТАРЫХ (уже отменённых) анимаций, даже если
   всё-таки сработают позже, видят чужой token и ничего не делают. */
let _bannerIndex    = 0;     // логический индекс текущего реального баннера
let _bannerTrackPos = 0;     // позиция в треке (с учётом клонов, если они есть)
let _bannerState    = 'idle'; // 'idle' | 'dragging' | 'animating'
let _bannerStepToken = 0;    // поколение текущего шага/жеста — см. комментарий выше
let _bannerAutoTimer = null; // ОДИН setTimeout на следующий автошаг, пересоздаётся заново при каждом settle (ТЗ п.1) — не setInterval
let _bannerDrag         = null; // активный свайп: { pointerId, startX, startY, dragging, baseTrackPos, trackWidth }
let _bannerSuppressClick = false; // следующий click по треку — следствие свайпа, а не тапа, игнорируем
let _activeBanners  = HOME_BANNERS;
const _bannerReducedMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
const BANNER_TRANSITION_MS = 350; // совпадает с .35s в .banner-track (catalog.css)
const BANNER_AUTO_MS       = 3000; // интервал автошага (ТЗ п.1: ровно 3с после остановки)

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

function _bannerUsesClones() {
    return _activeBanners.length > 1 && !_bannerReducedMotionMQ.matches;
}

/* pos — позиция В ТРЕКЕ (с учётом клонов). animate=false — мгновенно,
   без CSS-перехода (используется для первой отрисовки и для
   телепортации с клона на настоящий слайд). */
function _bannerSnapInstant(pos) {
    const track = document.getElementById('bannerTrack');
    if (!track) return;
    track.style.transition = 'none';
    track.style.transform  = `translateX(-${pos * 100}%)`;
    void track.offsetWidth; // форсируем reflow — иначе браузер схлопнёт это с следующим transition и анимирует и его тоже
    track.style.transition = '';
}
function _bannerAnimateTo(pos) {
    const track = document.getElementById('bannerTrack');
    if (!track) return;
    track.style.transition = ''; // вернуть CSS-переход из .banner-track (.35s ease; none — при reduced-motion, см. catalog.css)
    track.style.transform  = `translateX(-${pos * 100}%)`;
}

function _bannerUpdateDots() {
    const dots = document.getElementById('bannerDots');
    if (!dots) return;
    [...dots.children].forEach((dot, idx) => dot.classList.toggle('on', idx === _bannerIndex));
}

/* Вызывает cb один раз — либо по transitionend трека, либо (страховка,
   на случай прерванного/не случившегося transitionend — например, фоновая
   вкладка или анимация была отменена сменой transition на 'none' до
   завершения) по таймеру чуть длиннее самого перехода (ТЗ п.3: длительность
   + 50мс). cb вызывается БЕЗУСЛОВНО — актуальность своего поколения
   (_bannerStepToken) каждый вызывающий код проверяет сам, см. ниже. */
function _bannerAfterTransition(cb) {
    const track = document.getElementById('bannerTrack');
    if (!track) { cb(); return; }
    let done = false;
    let safetyTimer;
    const finish = () => {
        if (done) return;
        done = true;
        track.removeEventListener('transitionend', onEnd);
        clearTimeout(safetyTimer);
        cb();
    };
    const onEnd = (e) => { if (e.target === track && e.propertyName === 'transform') finish(); };
    track.addEventListener('transitionend', onEnd);
    safetyTimer = setTimeout(finish, BANNER_TRANSITION_MS + 50);
}

/* ОДИН шаг (direction: +1/-1), по кругу. token — поколение этого конкретного
   шага (см. _bannerStepToken выше): колбэк проверяет его перед тем, как
   трогать общее состояние — если за время анимации уже начался новый
   жест/шаг (token успел измениться), колбэк молча ничего не делает, вместо
   того чтобы прибавить своё смещение поверх уже неактуальной позиции
   (это и была причина бага C/B — см. комментарий у _bannerIndex). */
function _bannerAnimateStep(direction, token, cb) {
    const N = _activeBanners.length;
    if (!N) { cb(); return; }
    _bannerIndex = ((_bannerIndex + direction) % N + N) % N;

    if (!_bannerUsesClones()) {
        _bannerTrackPos = _bannerIndex;
        _bannerSnapInstant(_bannerTrackPos);
        _bannerUpdateDots();
        cb();
        return;
    }

    _bannerTrackPos += direction;
    _bannerAnimateTo(_bannerTrackPos);
    _bannerUpdateDots();
    _bannerAfterTransition(() => {
        if (token !== _bannerStepToken) return; // устарело — см. комментарий функции
        // Нормализация — НЕ точечная проверка "===0/===N+1" (как было),
        // а общая: если трек-позиция в итоге не совпадает с ожидаемой для
        // текущего _bannerIndex (клон или ЛЮБОЙ больший перелёт), приводим
        // к настоящему эквиваленту. _bannerIndex — источник истины, он
        // обновляется синхронно в начале шага и не зависит от анимации.
        const expected = _bannerIndex + 1; // 1..N — позиция настоящего слайда в треке с клонами
        if (_bannerTrackPos !== expected) {
            _bannerTrackPos = expected;
            _bannerSnapInstant(_bannerTrackPos);
        }
        cb();
    });
}

/* Один самостоятельный шаг (автошаг/подтверждённый свайп) — от начала
   жеста/тика до полного settle (idle + запланированный следующий автошаг). */
function _bannerStepTo(direction) {
    _bannerClearAutoTimer();
    _bannerState = 'animating';
    const token = ++_bannerStepToken;
    _bannerAnimateStep(direction, token, () => {
        if (token !== _bannerStepToken) return;
        _bannerSettle(token);
    });
}

/* Цепочка шагов в одну сторону (клик по точке на несколько слайдов сразу) —
   один token на всю цепочку: если жест прервёт её на середине, оставшиеся
   шаги сами увидят чужой token и не выполнятся (см. _bannerForceSettleNow). */
function _bannerQueueSteps(direction, steps, token) {
    if (token !== _bannerStepToken) return;
    if (steps <= 0) { _bannerSettle(token); return; }
    _bannerAnimateStep(direction, token, () => _bannerQueueSteps(direction, steps - 1, token));
}

/* Переход на конкретный логический индекс (клик по точке) — кратчайшим
   путём по кругу, тем же механизмом _bannerAnimateStep (так что бесшовность
   на границе гарантированно та же, что у свайпа/автопрокрутки). */
function _bannerGoToLogical(targetIndex) {
    const N = _activeBanners.length;
    if (!N || _bannerState === 'dragging') return; // во время активного жеста точки не трогаем
    targetIndex = ((targetIndex % N) + N) % N;
    if (targetIndex === _bannerIndex) return;

    _bannerClearAutoTimer();
    if (_bannerState === 'animating') _bannerForceSettleNow(); // ТЗ п.2
    _bannerState = 'animating';
    const token = ++_bannerStepToken;

    if (!_bannerUsesClones()) {
        _bannerIndex    = targetIndex;
        _bannerTrackPos = targetIndex;
        _bannerSnapInstant(_bannerTrackPos);
        _bannerUpdateDots();
        _bannerSettle(token);
        return;
    }

    const forwardDist  = (targetIndex - _bannerIndex + N) % N;
    const backwardDist = N - forwardDist;
    _bannerQueueSteps(forwardDist <= backwardDist ? 1 : -1, Math.min(forwardDist, backwardDist), token);
}

function _bannerClearAutoTimer() {
    clearTimeout(_bannerAutoTimer);
    _bannerAutoTimer = null;
}

/* Планирует ОДИН следующий автошаг через ровно BANNER_AUTO_MS от текущего
   момента (ТЗ п.1) — вызывается только из _bannerSettle, то есть именно
   «через 3с после того, как карусель остановилась», а не от предыдущего
   тика (как было раньше с setInterval, из-за чего реальный интервал
   плавал). Единственный таймер — предыдущий всегда отменяется первой
   строкой _bannerClearAutoTimer. */
function _bannerScheduleAuto() {
    _bannerClearAutoTimer();
    if (document.hidden) return;              // скрытая вкладка — пауза (возобновит visibilitychange ниже)
    if (_bannerReducedMotionMQ.matches) return; // reduced-motion — без автопрокрутки вообще (ТЗ п.6)
    if (_activeBanners.length <= 1) return;
    _bannerAutoTimer = setTimeout(_bannerAutoTick, BANNER_AUTO_MS);
}

function _bannerAutoTick() {
    _bannerAutoTimer = null;
    if (_bannerState !== 'idle') return; // страховка — таймер и так всегда отменяется при выходе из idle
    _bannerStepTo(1); // автошаг всегда вперёд (ТЗ п.1)
}

/* Жест/шаг завершились — единая точка входа в состояние "можно всё":
   нормализованный индекс, активный слайд гарантированно виден (ТЗ п.5),
   запланирован следующий автошаг. */
function _bannerSettle(token) {
    if (token !== _bannerStepToken) return;
    _bannerState = 'idle';
    _bannerEnsureActiveSlideVisible();
    _bannerScheduleAuto();
}

/* ТЗ п.5 — страховка: активный слайд всегда должен быть ПОЛНОСТЬЮ виден
   во вьюпорте (.banner-viewport, overflow:hidden). Если из-за какого-то
   ещё не предусмотренного случая это не так (или _bannerTrackPos вообще
   не совпадает с ожидаемой для _bannerIndex позицией) — мгновенно
   возвращаем трек в нормализованное положение. */
function _bannerEnsureActiveSlideVisible() {
    const track = document.getElementById('bannerTrack');
    if (!track) return;
    const viewport = track.parentElement;
    if (!viewport) return;
    const vp = viewport.getBoundingClientRect();
    if (vp.width === 0) return; // баннер сейчас не на экране (display:none и т.п.) — нечего проверять
    const N = _activeBanners.length;
    if (!N) return;
    const expectedPos = _bannerUsesClones() ? _bannerIndex + 1 : _bannerIndex;
    const activeSlide = track.children[expectedPos];
    const sr = activeSlide ? activeSlide.getBoundingClientRect() : null;
    const EPS = 1; // запас на дробные px при пересчёте %→px браузером
    const visible = !!sr && sr.width > 0 && sr.left >= vp.left - EPS && sr.right <= vp.right + EPS;
    if (!visible || _bannerTrackPos !== expectedPos) {
        _bannerTrackPos = expectedPos;
        _bannerSnapInstant(_bannerTrackPos);
    }
}

/* ТЗ п.2 — новый жест начался прямо во время анимации: вместо того чтобы
   плодить параллельные колбэки (см. комментарий у _bannerIndex), сразу
   (без ожидания transitionend) доводим трек до конечной точки ТЕКУЩЕГО
   шага — _bannerIndex уже обновлён синхронно в начале шага, поэтому его
   ожидаемая позиция в треке известна прямо сейчас, ждать анимацию не
   нужно. _bannerStepToken++ обесценивает колбэк прерванной анимации —
   когда он всё же сработает (transitionend или страховочный таймер), он
   увидит чужой token и ничего не сделает. */
function _bannerForceSettleNow() {
    _bannerStepToken++;
    const N = _activeBanners.length;
    if (!N) return;
    _bannerTrackPos = _bannerUsesClones() ? _bannerIndex + 1 : _bannerIndex;
    _bannerSnapInstant(_bannerTrackPos);
}

/* ─── Свайп (Pointer Events — один код для мыши и пальца) ──────────
   touch-action:pan-y на .banner-track (catalog.css) уже отдаёт
   вертикальный скролл браузеру нативно; это — горизонтальный жест.
   Слушатели на document (не capture/setPointerCapture) — так жест не
   обрывается, если палец на миг выходит за пределы трека. */
function _bannerOnPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // только левая кнопка мыши/касание
    if (_activeBanners.length <= 1) return; // один баннер — нечего свайпать (ТЗ п.6)
    const track = document.getElementById('bannerTrack');
    if (!track) return;

    _bannerClearAutoTimer(); // касание — немедленная отмена таймера (ТЗ п.1)
    if (_bannerState === 'animating') _bannerForceSettleNow(); // ТЗ п.2 — не начинаем жест поверх недоехавшей анимации
    _bannerState = 'dragging';

    // Направление и амплитуда следующего жеста считаются только по тому,
    // что произойдёт МЕЖДУ этим down и будущим up — никакого унаследованного
    // состояния направления/скорости от прошлого свайпа или автошага не
    // переносим (ТЗ п.4): объект жеста создаётся заново целиком, а
    // baseTrackPos берётся из уже нормализованного (force-settle выше)
    // _bannerTrackPos, а не из возможно «подвисшей» клоновой позиции.
    _bannerDrag = {
        pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY,
        dragging: false,
        baseTrackPos: _bannerTrackPos,
        trackWidth: track.getBoundingClientRect().width,
    };
    document.addEventListener('pointermove', _bannerOnPointerMove);
    document.addEventListener('pointerup', _bannerOnPointerUp);
    document.addEventListener('pointercancel', _bannerOnPointerUp);
}

function _bannerOnPointerMove(e) {
    if (!_bannerDrag || e.pointerId !== _bannerDrag.pointerId) return;
    const track = document.getElementById('bannerTrack');
    const dx = e.clientX - _bannerDrag.startX;
    const dy = e.clientY - _bannerDrag.startY;
    if (!_bannerDrag.dragging) {
        // Порог ~10px (ТЗ п.6) — до него ещё не ясно, тап это или жест.
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) { // вертикальный жест — это скролл страницы, не наш
            document.removeEventListener('pointermove', _bannerOnPointerMove);
            document.removeEventListener('pointerup', _bannerOnPointerUp);
            document.removeEventListener('pointercancel', _bannerOnPointerUp);
            _bannerDrag = null;
            _bannerState = 'idle';
            _bannerScheduleAuto();
            return;
        }
        _bannerDrag.dragging = true;
        if (track) { track.style.transition = 'none'; track.classList.add('banner-track--dragging'); }
    }
    e.preventDefault(); // не даём мышью выделить текст / не мешаем жесту
    if (track) track.style.transform = `translateX(calc(-${_bannerDrag.baseTrackPos * 100}% + ${dx}px))`;
}

function _bannerOnPointerUp(e) {
    if (!_bannerDrag || e.pointerId !== _bannerDrag.pointerId) return;
    document.removeEventListener('pointermove', _bannerOnPointerMove);
    document.removeEventListener('pointerup', _bannerOnPointerUp);
    document.removeEventListener('pointercancel', _bannerOnPointerUp);

    const drag = _bannerDrag;
    _bannerDrag = null;

    if (!drag.dragging) {
        // Движение меньше ~10px — это тап, клик сработает сам по себе
        // (ссылка баннера открывается обычным DOM-событием click, ТЗ п.6).
        _bannerState = 'idle';
        _bannerScheduleAuto();
        return;
    }

    _bannerSuppressClick = true; // реальный свайп — следующий click (от тапа при отпускании) не должен открыть ссылку
    const track = document.getElementById('bannerTrack');
    if (track) track.classList.remove('banner-track--dragging');
    const dx = e.clientX - drag.startX;
    const threshold = drag.trackWidth * 0.18; // достаточно далеко утянули — считаем осознанным свайпом, не просто дрожью

    _bannerState = 'animating';
    if (Math.abs(dx) > threshold) {
        const direction = dx < 0 ? 1 : -1; // свайп влево — вперёд (следующий), вправо — назад; направление берётся ТОЛЬКО из dx этого жеста
        _bannerClearAutoTimer();
        const token = ++_bannerStepToken;
        _bannerAnimateStep(direction, token, () => {
            if (token !== _bannerStepToken) return;
            _bannerSettle(token);
        });
    } else {
        const token = ++_bannerStepToken;
        _bannerAnimateTo(_bannerTrackPos); // не дотянули — откат на текущий слайд
        _bannerAfterTransition(() => {
            if (token !== _bannerStepToken) return;
            _bannerSettle(token);
        });
    }
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
   Клик по ссылке баннера обрабатывается делегированием на #bannerTrack
   (см. initBanner) — через data-slide-index, а не addEventListener на
   каждом слайде: клоны для бесшовной карусели (см. выше) создаются через
   cloneNode и не копируют JS-обработчики, зато копируют data-атрибуты и
   инлайн-стили (включая position:absolute/left/top у x/y-блоков текста,
   см. предыдущую задачу — они переживают клонирование как есть). */
function _renderBannerSlides(banners) {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track || !dots || !window.BannerRender) return;
    _activeBanners = banners;
    track.innerHTML = '';
    track.classList.remove('banner-track--dragging');

    const slideEls = banners.map((b, i) => {
        const el = BannerRender.buildBannerSlideElement(b, document.documentElement);
        el.dataset.slideIndex = String(i);
        if (b.linkType && b.linkType !== 'none') el.style.cursor = 'pointer';
        return el;
    });

    const useClones = _bannerUsesClones();
    if (useClones) {
        const lastClone  = slideEls[slideEls.length - 1].cloneNode(true);
        const firstClone = slideEls[0].cloneNode(true);
        lastClone.setAttribute('aria-hidden', 'true');
        firstClone.setAttribute('aria-hidden', 'true');
        track.appendChild(lastClone);
        slideEls.forEach(el => track.appendChild(el));
        track.appendChild(firstClone);
    } else {
        slideEls.forEach(el => track.appendChild(el));
    }

    dots.innerHTML = banners.length > 1 ? banners.map(() => `<span></span>`).join('') : '';
    // Полный сброс автомата — _renderBannerSlides может вызываться ВТОРОЙ
    // раз (сперва кэш, потом свежий ответ /api/banners, см. initBanner),
    // и если первый рендер к этому моменту ещё анимировался/тащился,
    // нельзя унаследовать его состояние на новый набор баннеров.
    _bannerStepToken++;
    _bannerDrag  = null;
    _bannerState = 'idle';
    _bannerIndex    = 0;
    _bannerTrackPos = useClones ? 1 : 0;
    _bannerSnapInstant(_bannerTrackPos);
    _bannerUpdateDots();
    _bannerScheduleAuto();
}

function _renderBannerSkeleton() {
    const track = document.getElementById('bannerTrack');
    const dots  = document.getElementById('bannerDots');
    if (!track) return;
    _bannerStepToken++;
    _bannerClearAutoTimer();
    _bannerDrag  = null;
    _bannerState = 'idle';
    track.classList.remove('banner-track--dragging');
    track.style.transition = 'none';
    track.style.transform  = 'translateX(0)';
    void track.offsetWidth;
    track.style.transition = '';
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

    // Делегирование кликов — один раз на персистентном #bannerTrack
    // (его innerHTML переписывается при каждом _renderBannerSlides, но
    // сам элемент и слушатель на нём — нет).
    track.addEventListener('pointerdown', _bannerOnPointerDown);
    track.addEventListener('click', (e) => {
        if (_bannerSuppressClick) { _bannerSuppressClick = false; return; }
        const slide = e.target.closest('.banner-slide[data-slide-index]');
        if (!slide) return;
        const banner = _activeBanners[+slide.dataset.slideIndex];
        if (!banner || !banner.linkType || banner.linkType === 'none') return;
        openBannerTarget(banner.linkType, banner.linkId);
    });
    dots.addEventListener('click', (e) => {
        const dot = e.target.closest('span');
        if (!dot) return;
        const idx = [...dots.children].indexOf(dot);
        if (idx === -1) return;
        _bannerGoToLogical(idx); // сама отменяет автотаймер и планирует следующий через _bannerSettle
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { _bannerClearAutoTimer(); }
        else if (_bannerState === 'idle') { _bannerScheduleAuto(); }
        // если не idle — своё планирование сделает _bannerSettle, когда текущий жест/анимация завершится
    });
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
    ['root', 'subcats', 'pair', 'search'].forEach(n => {
        const el = document.getElementById('screen-' + n);
        if (el) el.classList.toggle('hidden', n !== name);
    });
    _activeScreen = name;
    window.scrollTo(0, 0);
}

/* ─── Catalog history: pushState только при переходе на более глубокий
   экран (root→subcats, subcats→pair, root→pair напрямую), чтобы системная
   «Назад» в Max/браузере поднимала на один уровень, а с корня каталога
   выходила на предыдущую страницу (история каталога не разрастается на
   плоских операциях — поиск/фильтры/сортировка всегда replaceState, см.
   requirement 4). navMode, который принимают openSubcatsScreen/
   openPairProducts/syncPairUrl/handleSearch:
     'push'    — обычный клик по категории/подкатегории/плитке (глубже);
     'replace' — восстановление состояния при первой загрузке страницы
                 (прямая ссылка/обновление) — тот же уровень, новой записи
                 в истории быть не должно;
     'none'    — реакция на popstate (реальная «Назад»/«Вперёд») — URL уже
                 выставлен браузером, трогать историю не нужно, только
                 перерисовать экран.
   _historyPushed — был ли за время жизни этой страницы хоть один pushState
   от каталога; используется собственной кнопкой «назад» в хедере (см.
   closeSubcatsScreen/closePairScreen) — see requirement 3. */
let _historyPushed = false;

/* Экран, с которого реально начали поиск (root/subcats/pair) — нужен
   closeSearchScreen() на случай фолбэка без истории (прямая ссылка
   catalog.html?q=..., ни одного pushState за эту загрузку ещё не было —
   тот же случай, что уже обрабатывают closeSubcatsScreen/closePairScreen).
   При обычном history.back() эта переменная не нужна — URL восстановит
   браузер сам. */
let _searchFromScreen = 'root';

function catalogPushOrReplace(url, navMode) {
    if (navMode === 'none') return;
    if (navMode === 'push') {
        // Пуш на URL, который и так совпадает с текущим location, не нужен —
        // он создавал бы в истории два подряд идентичных пункта (один и тот
        // же экран дважды). Баг 2: именно такой «невидимый» дубль заставлял
        // системную «Назад» срабатывать через раз — первое нажатие просто
        // перескакивало дубль молча (сам браузер меняет историю на
        // идентичный URL без видимого эффекта), а следующее уходило дальше,
        // чем ожидалось. Если место то же — ничего не делаем, не трогаем
        // ни историю, ни _historyPushed (он мог быть false, если сюда
        // попали по прямой ссылке, — это не должно стать push задним числом).
        const target = new URL(url, location.href);
        if (target.pathname === location.pathname && target.search === location.search) return;
        history.pushState(null, '', url);
        _historyPushed = true;
    } else {
        history.replaceState(null, '', url);
    }
}

/* Подкатегории без единого товара не показываем — тапать в них всё равно
   было бы некуда (та же логика, что уже применяется к пустым категориям
   в renderCategoryRail()). Единая точка, чтобы openCategoryDrilldown,
   openSubcatsScreen и closePairScreen видели один и тот же список. */
function categoryNonEmptySubs(catId) {
    return _subcategories.filter(s => s.categoryId === catId && _products.some(p => p.subId === s.id));
}

function openCategoryDrilldown(catId, subId, restoreOpts, navMode = 'push') {
    if (subId != null && !Number.isNaN(subId)) { openPairProducts(catId, subId, restoreOpts, navMode); return; }
    const subs = categoryNonEmptySubs(catId);
    // Если у категории в принципе есть товары (иначе её тайла на корне не
    // было бы), но ни одна подкатегория не непуста — подкатегории тут
    // бессмысленны, показываем товары категории напрямую (как у категорий
    // без подкатегорий вовсе), не скрывая саму категорию.
    if (subs.length) openSubcatsScreen(catId, navMode);
    else openPairProducts(catId, null, restoreOpts, navMode);
}

function openSubcatsScreen(catId, navMode = 'push') {
    const grid = document.getElementById('subcatGrid');
    const titleEl = document.getElementById('subcatsTitle');
    if (!grid || !titleEl) return;
    const cat  = catById(catId);
    _activeCatId = catId;
    _activeSubId = null;
    titleEl.textContent = cat.name;
    const crumb = document.getElementById('subcatsBreadcrumb');
    if (crumb) crumb.textContent = cat.name;
    // Правка 3: вертикальный список вместо сетки 2×N. У подкатегорий своей
    // иконки в API нет (только у категорий) — строки без иконки, только
    // название + стрелка; «Все товары» — функциональная строка, не данные
    // из API, поэтому у неё иконка остаётся (помогает отличить от обычных
    // подкатегорий на глаз).
    const chev = `<span class="subcat-list__chevron">${iconSvg('chev', 18)}</span>`;
    const subs = categoryNonEmptySubs(catId);
    grid.innerHTML = subs.map(s => `
        <button class="subcat-list__item" onclick="openPairProducts(${catId},${s.id})">
            <span class="subcat-list__label">${s.name}</span>
            ${chev}
        </button>`).join('')
        + `<button class="subcat-list__item subcat-list__item--all" onclick="openPairProducts(${catId},null)">
            <span class="subcat-list__ic">${iconSvg('grid', 18)}</span>
            <span class="subcat-list__label">Все товары</span>
            ${chev}
        </button>`;
    catalogPushOrReplace(`catalog.html?category=${catId}`, navMode);
    showCatalogScreen('subcats');
}

/* Собственная кнопка «назад» в хедере — requirement 3: если за время жизни
   страницы каталог хоть раз сделал pushState, в истории точно есть запись
   экрана-предка (её же мы туда и положили) — просто уходим на неё
   history.back(), а popstate (см. ниже) сам перерисует экран по новому URL.
   Если же пользователь попал сюда сразу по прямой ссылке/обновлением
   страницы (ни одного pushState за эту загрузку не было), в истории нет
   ничего «нашего» — history.back() увёл бы мимо каталога; вместо этого
   вручную поднимаемся на уровень выше через replaceState, как раньше. */
function closeSubcatsScreen() {
    if (_historyPushed) { history.back(); return; }
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

/* restoreOpts — только при восстановлении состояния из URL (см. init()/
   restoreScreenFromUrl()): { brand:[...], priceMin, priceMax, sort }.
   Обычный тап по категории/подкатегории его не передаёт — фильтры и
   сортировка сбрасываются, как и раньше. navMode — см. комментарий у
   catalogPushOrReplace() выше. */
function openPairProducts(catId, subId, restoreOpts, navMode = 'push') {
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

    syncPairUrl(navMode);
    renderPairProducts();
    showCatalogScreen('pair');
}

/* Отражает категорию/подкатегорию + применённые (не черновые) фильтры и
   сортировку экрана товаров в URL — чтобы «Назад» в Max и обновление
   страницы восстанавливали ровно то же состояние (см. restoreScreenFromUrl()).
   navMode по умолчанию 'replace' — так и должно быть для всех вызовов
   из смены фильтров/сортировки на том же экране (requirement 4); сам
   openPairProducts передаёт свой navMode явно. */
function syncPairUrl(navMode = 'replace') {
    const params = new URLSearchParams();
    params.set('category', _activeCatId);
    // sub=all различает «показать все товары категории» (кнопка в
    // openSubcatsScreen) от обычного «?category=ID без sub», который
    // openCategoryDrilldown/restoreScreenFromUrl() трактуют как «открыть
    // подкатегории, если они есть» — иначе оба случая давали бы один и тот же URL.
    if (_activeSubId != null) params.set('sub', _activeSubId);
    else if (_activeCatId !== 'sale') params.set('sub', 'all');
    if (pairFilters.brand.size) params.set('brand', [...pairFilters.brand].join(','));
    if (pairFilters.price[0] != null) params.set('priceMin', pairFilters.price[0]);
    if (pairFilters.price[1] != null) params.set('priceMax', pairFilters.price[1]);
    if (pairSort && pairSort !== 'default') params.set('sort', pairSort);
    catalogPushOrReplace('catalog.html?' + params.toString(), navMode);
}

function closePairScreen() {
    if (_historyPushed) { history.back(); return; }
    // Фолбэк: прямая ссылка/обновление страницы — в истории нет записи,
    // которую сделал бы каталог (ни одного pushState за эту загрузку не
    // было), поэтому history.back() увёл бы мимо каталога. Поднимаемся на
    // уровень выше вручную, как и раньше.
    // Категория с подкатегориями -> назад на экран подкатегорий (в том
    // числе из «Показать все товары», где _activeSubId сам null, но
    // подкатегории у категории всё равно есть). Категория без подкатегорий
    // (или «Акции») -> у неё никогда не было экрана подкатегорий, назад на корень.
    const subs = categoryNonEmptySubs(_activeCatId);
    if (subs.length) { openSubcatsScreen(_activeCatId, 'replace'); return; }
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

/* Два разных пустых состояния (баг 1): если в этой подкатегории/категории
   нет ни одного товара вообще — фильтры тут ни при чём, показываем
   pairNoProductsState («Назад к подкатегориям/категориям», без «Сбросить
   фильтры» — сбрасывать нечего). Если товары есть, но фильтры исключили
   все — текущее pairEmptyState («Сбросить фильтры»). */
function renderPairProducts() {
    const all   = pairProductsList();
    const list  = sortPairList(all.filter(p => matchesPairFilters(p, pairFilters)), pairSort);
    const grid        = document.getElementById('pairProductsGrid');
    const filteredOut = document.getElementById('pairEmptyState');
    const noProducts  = document.getElementById('pairNoProductsState');
    const count       = document.getElementById('pairResultsCount');
    if (!grid) return;

    if (count) count.textContent = list.length ? plural(list.length, 'товар', 'товара', 'товаров') : '';

    if (list.length) {
        grid.innerHTML = list.map(productCardHTML).join('');
        if (filteredOut) filteredOut.classList.add('hidden');
        if (noProducts)  noProducts.classList.add('hidden');
    } else {
        grid.innerHTML = '';
        if (all.length) {
            // Товары есть, но под текущие фильтры не подошёл ни один.
            if (noProducts)  noProducts.classList.add('hidden');
            if (filteredOut) filteredOut.classList.remove('hidden');
        } else {
            // Товаров нет вообще — фильтры ни при чём.
            if (filteredOut) filteredOut.classList.add('hidden');
            if (noProducts) {
                const titleEl = document.getElementById('pairNoProductsTitle');
                const backBtn = document.getElementById('pairNoProductsBackBtn');
                if (titleEl && backBtn) {
                    if (_activeCatId === 'sale') {
                        titleEl.textContent = 'Сейчас нет товаров по акции';
                        backBtn.textContent  = 'Назад';
                    } else if (_activeSubId == null) {
                        titleEl.textContent = 'В этой категории пока нет товаров';
                        backBtn.textContent  = 'Назад к категориям';
                    } else {
                        titleEl.textContent = 'В этой подкатегории пока нет товаров';
                        backBtn.textContent  = 'Назад к подкатегориям';
                    }
                }
                noProducts.classList.remove('hidden');
            }
        }
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
    const noProductsBackBtn = document.getElementById('pairNoProductsBackBtn');
    if (noProductsBackBtn) noProductsBackBtn.addEventListener('click', closePairScreen);
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
/* На Каталоге (screen-root существует) поиск — глобальный по всему
   каталогу, с любого из 3 экранов (root/subcats/pair, у каждого свой
   инпут — см. catalog.html), без учёта фильтров текущего экрана, и ведёт
   на отдельный экран результатов (#screen-search, свой инпут там тоже
   есть — для продолжения набора уже на нём). Первый введённый символ
   сразу переключает экран и делает ровно один pushState (см.
   catalogPushOrReplace); дальнейший ввод обновляет URL через
   replaceState; сам сетевой запрос — отдельно, с debounce (см.
   performCatalogSearchFetch). На Главной (тот же HTML/JS, без
   screen-root) поведение не меняется: как и раньше, фильтрует уже
   загруженный локальный список товаров через render()/getFiltered(). */
const CATALOG_SEARCH_DEBOUNCE_MS = 300;
let _searchSeq = 0; // против гонки: показываем только самый свежий ответ

/* inputEl — конкретный инпут, из которого пришёл ввод (на Каталоге их 4:
   по одному на root/subcats/pair + один на самом экране результатов,
   см. catalog.html); на Главной инпут всегда один (#searchInput),
   поэтому там он необязателен — handleSearch() без аргумента (как и
   раньше дёргает index.html) сам найдёт #searchInput. */
function handleSearch(inputEl) {
    clearTimeout(_searchTimer);
    const onCatalogPage = !!document.getElementById('screen-root');

    if (!onCatalogPage) {
        inputEl = inputEl || document.getElementById('searchInput');
        state.query = inputEl.value.trim().toLowerCase();
        document.getElementById('searchClear').classList.toggle('hidden', !state.query);
        _searchTimer = setTimeout(render, 250);
        return;
    }

    const q = inputEl.value;

    if (_activeScreen !== 'search') {
        if (!q) return; // пустой ввод на исходном экране (напр. del на и так пустом поле) — отменять нечего
        const fromScreen = _activeScreen;
        inputEl.value = ''; // поле экрана-источника не "принадлежит" поиску — остаётся пустым
        const resultsInput = document.getElementById('searchScreenInput');
        resultsInput.value = q;
        state.query = q.trim();
        _searchFromScreen = fromScreen;
        showCatalogScreen('search');
        catalogPushOrReplace('catalog.html?q=' + encodeURIComponent(state.query), 'push');
        document.getElementById('searchScreenClear')?.classList.toggle('hidden', !state.query);
        resultsInput.focus();
        const len = resultsInput.value.length;
        resultsInput.setSelectionRange(len, len); // каретка в конец — иначе на части браузеров улетает в начало
        _searchTimer = setTimeout(performCatalogSearchFetch, CATALOG_SEARCH_DEBOUNCE_MS);
        return;
    }

    // Уже на экране результатов — обычный дальнейший ввод.
    state.query = q.trim();
    document.getElementById('searchScreenClear')?.classList.toggle('hidden', !state.query);
    if (!state.query) { closeSearchScreen(); return; }
    catalogPushOrReplace('catalog.html?q=' + encodeURIComponent(state.query), 'replace');
    _searchTimer = setTimeout(performCatalogSearchFetch, CATALOG_SEARCH_DEBOUNCE_MS);
}

/* Только Главная — у Каталога больше нет своей кнопки очистки на
   root/subcats/pair (поиск сразу уводит на #screen-search, см. выше);
   там за очистку/выход отвечает closeSearchScreen(). */
function clearSearch() {
    document.getElementById('searchInput').value = '';
    state.query = '';
    document.getElementById('searchClear').classList.add('hidden');
    render();
}

/* Очистка запроса (стёрли вручную до пустого ИЛИ нажали ✕/стрелку назад
   в шапке #screen-search) — всегда возврат на исходный экран через
   history.back() (ТЗ: "без новой записи"), с теми же фильтрами и
   позицией — они не трогались всё это время, пока был активен поиск.
   Фолбэк на _historyPushed — тот же приём, что у closeSubcatsScreen()/
   closePairScreen(): прямая ссылка/обновление страницы с ?q=... в адресе
   не оставляет в истории ничего "нашего", на что можно было бы вернуться. */
function closeSearchScreen() {
    clearTimeout(_searchTimer);
    _searchSeq++; // отменяем ещё не прилетевший (или даже не отправленный) ответ
    const input = document.getElementById('searchScreenInput');
    if (input) input.value = '';
    document.getElementById('searchScreenClear')?.classList.add('hidden');
    state.query = '';

    if (_historyPushed) { history.back(); return; }

    if (_searchFromScreen === 'subcats' && _activeCatId != null) { openSubcatsScreen(_activeCatId, 'replace'); return; }
    if (_searchFromScreen === 'pair' && _activeCatId != null) { syncPairUrl('replace'); showCatalogScreen('pair'); return; }
    history.replaceState(null, '', 'catalog.html');
    showCatalogScreen('root');
}

/* Собственно сетевой запрос (GET /api/products?q=, см. products.js) —
   экранирование %/_ и лимиты на сервере. Вызывается с debounce (см.
   handleSearch) и при восстановлении состояния из URL (см.
   restoreScreenFromUrl/init). seq — та же защита от гонки устаревших
   ответов, что была и раньше. */
async function performCatalogSearchFetch() {
    const q = state.query;
    const seq   = ++_searchSeq;
    const grid  = document.getElementById('searchScreenGrid');
    const empty = document.getElementById('searchScreenEmptyState');
    const count = document.getElementById('searchScreenCount');
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
    if (!grid) return; // Каталог больше не показывает общий список товаров на корне (поиск теперь свой экран, см. handleSearch) — это теперь только для Главной
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

/* ─── Catalog: render the screen matching the current URL ─────────
   Общая логика для первой загрузки (init(), navMode='replace') и для
   реакции на popstate — системную «Назад»/«Вперёд» (navMode='none', см.
   обработчик ниже). Не делает сетевых запросов, кроме поиска (q=) —
   категории/подкатегории/товары уже в памяти (_categories/_subcategories/
   _products), просто перерисовываются. */
function restoreScreenFromUrl(navMode) {
    // Отменяем любой ещё не сработавший debounce поиска и инвалидируем
    // уже летящий запрос — иначе системная «Назад» посреди набора могла
    // бы перерисовать уже скрытый экран результатов чуть погодя (см.
    // performCatalogSearchFetch()/handleSearch()).
    clearTimeout(_searchTimer);
    _searchSeq++;

    const params = new URLSearchParams(location.search);
    const urlQ   = params.get('q');
    const urlCat = params.get('category');
    const urlSub = params.get('sub');

    if (urlQ) {
        const input = document.getElementById('searchScreenInput');
        if (input) {
            input.value = urlQ;
            state.query = urlQ.trim();
            document.getElementById('searchScreenClear')?.classList.toggle('hidden', !state.query);
            showCatalogScreen('search');
            performCatalogSearchFetch();
        }
        return;
    }

    if (urlCat === 'sale') {
        openPairProducts('sale', null, undefined, navMode);
        return;
    }

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
            openPairProducts(catNum, null, restoreOpts, navMode);
        } else {
            const subNum = urlSub ? Number(urlSub) : NaN;
            openCategoryDrilldown(catNum, Number.isNaN(subNum) ? undefined : subNum, restoreOpts, navMode);
        }
        return;
    }

    // Нет ни q=, ни category= — голый catalog.html: список категорий.
    // При первой загрузке (init()) это уже и так показано по умолчанию;
    // explicit-вызов нужен для popstate (пользователь дошёл «Назад» до
    // самого корня каталога, экран должен переключиться обратно).
    showCatalogScreen('root');
}

/* Системная «Назад»/«Вперёд» — URL уже сменил браузер (см. комментарий у
   catalogPushOrReplace), просто синхронизируем экран с ним. На Главной
   этого слушателя нет смысла вешать вообще (нет screen-root).

   Раньше здесь была защита «пропустить повторный popstate с тем же
   location.search» — убрана: она была лишней (popstate сам по себе не
   может вызвать ещё один popstate, а restoreScreenFromUrl('none') никогда
   не трогает историю — зациклиться им было физически невозможно) и из-за
   неё системная «Назад» срабатывала через раз (см. Баг 2): если
   пользователь успевал попасть на URL, который уже совпадал с тем, что
   эта защита запомнила с прошлого раза (например, после дубля в истории,
   который теперь устранён в catalogPushOrReplace), перерисовка экрана
   молча пропускалась, хотя браузер уже реально сменил позицию в истории —
   следующее нажатие «Назад» уходило на экран, который должен был открыться
   ещё предыдущим нажатием. restoreScreenFromUrl() сама по себе дешёвая
   (без сетевых запросов) — обрабатывать её на каждый popstate безопасно. */
window.addEventListener('popstate', () => {
    if (!document.getElementById('screen-root')) return;
    restoreScreenFromUrl('none');
});

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
        openPairProducts(backCatId, backSubId, undefined, 'replace');
    } else if (isBack && backScreen === 'search') {
        // Товар открывали прямо с экрана результатов поиска (ТЗ: «Назад» ->
        // те же результаты с тем же запросом) — ?q= уже сохранён в URL
        // (replaceState на каждый символ, см. handleSearch()), просто
        // перечитываем его тем же общим путём, что и обычная restore.
        restoreScreenFromUrl('replace');
    } else if (!isBack) {
        // Coming from a Home/Catalog rail tile (?category=ID[&sub=ID][&brand=&priceMin=&priceMax=&sort=],
        // ?category=sale, or a search ?q=...) — restore the matching screen
        // once data is ready, so "Назад" in Max/браузере и обновление страницы
        // восстанавливают то же состояние, не добавляя лишних записей в
        // историю (navMode='replace' — см. restoreScreenFromUrl()).
        restoreScreenFromUrl('replace');
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
