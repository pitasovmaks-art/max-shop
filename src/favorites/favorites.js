const _tgId = getTgId() || '';
const _city = localStorage.getItem('city') || '';

function goBack() {
    const tgId = getTgId();
    window.location.href = tgId ? `/index.html?tg_id=${tgId}` : '/index.html';
}

/* ─── Helpers ───────────────────────────────────────────── */
function fmt(n) { return n.toLocaleString('ru-RU') + ' ₽'; }

function getCart() {
    try { return JSON.parse(localStorage.getItem('cart') || '[]').map(i => ({ ...i, key: i.key || String(i.id) })); }
    catch { return []; }
}
function saveCart(c) { localStorage.setItem('cart', JSON.stringify(c)); }

function updateCartBadge() {
    try {
        const qty = getCart().reduce((s, i) => s + i.qty, 0);
        const b   = document.getElementById('cartBadge');
        if (!b) return;
        if (qty > 0) { b.textContent = qty > 99 ? '99+' : qty; b.classList.remove('hidden'); }
        else b.classList.add('hidden');
    } catch {}
}

function _effectiveVariant(p) {
    const vars = p.variants || [];
    if (_city === 'krd') return vars.find(v => v.isKrd && v.priceKrdPickup > 0) || null;
    return vars.find(v => !v.isKrd && v.priceMskPickup > 0) || null;
}

function getPrice(p) {
    const v = _effectiveVariant(p);
    if (v) return _city === 'krd' ? v.priceKrdPickup : v.priceMskPickup;
    return _city === 'krd' ? (p.priceKrd || p.price || 0) : (p.priceMsk || p.price || 0);
}

/* ─── Add to cart ───────────────────────────────────────── */
function addToCart(productId, products) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const variant = _effectiveVariant(product);
    const key     = variant ? `${productId}_v${variant.id}` : String(productId);

    let priceKrdPickup, priceMskPickup, priceMskDelivery;
    if (variant) {
        priceKrdPickup   = variant.priceKrdPickup   || 0;
        priceMskPickup   = variant.priceMskPickup   || 0;
        priceMskDelivery = variant.priceMskDelivery || 0;
    } else {
        priceKrdPickup   = product.priceKrd      || product.price || 0;
        priceMskPickup   = product.priceMsk      || product.price || 0;
        priceMskDelivery = product.priceDelivery || product.price || 0;
    }
    const price = _city === 'krd' ? priceKrdPickup : priceMskPickup;

    const cart     = getCart();
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
        if (variant) { item.variantId = variant.id; item.variantLabel = variant.label; }
        cart.push(item);
    }
    saveCart(cart);
    updateCartBadge();
    showToast('✓ Добавлено в корзину');
}

/* ─── Remove from favorites ─────────────────────────────── */
async function removeFav(productId, products) {
    if (!_tgId) return;
    await fetch('/api/favorites', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tgId: _tgId, productId }),
    }).catch(() => {});
    localStorage.setItem('favorites_changed', Date.now().toString());
    renderFavorites(products.filter(p => p.id !== productId));
}

/* ─── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
    let toast = document.getElementById('favToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'favToast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.9);backdrop-filter:blur(10px);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;white-space:nowrap';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

/* ─── Render ─────────────────────────────────────────────── */
function renderFavorites(products) {
    const main = document.getElementById('main');

    if (!products.length) {
        main.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">🤍</div>
                <p class="empty-state__title">В избранном пока ничего нет</p>
                <p class="empty-state__sub">Добавляйте товары через ♡ на карточке</p>
                <a href="../../index.html" class="empty-state__btn">Перейти в каталог</a>
            </div>`;
        return;
    }

    main.innerHTML = `<div class="products-grid">${products.map(p => {
        const hasVariants   = p.variants && p.variants.length > 0;
        const effectiveVar  = _effectiveVariant(p);
        const unavailable   = hasVariants && !effectiveVar;   // variants exist but none for current city

        const price    = unavailable ? 0 : getPrice(p);
        const imgBg    = p.image ? '' : 'img-bg--default';
        const imgIcon  = p.image ? `<img class="product-card__photo" src="${p.image}" alt="${p.name}">` : '📦';
        const priceStr = unavailable
            ? `<span style="display:flex;flex-direction:column;gap:2px">
                <span style="color:rgba(255,255,255,0.5);font-size:11px;font-weight:500">Доступен в другом городе</span>
                <span style="color:rgba(255,255,255,0.35);font-size:10px;font-weight:400">Смените город, чтобы заказать</span>
               </span>`
            : (price > 0 ? fmt(price) : (p.priceLabel || fmt(p.price || 0)));
        const addBtn   = (!unavailable && p.inStock)
            ? `<button class="add-btn" onclick="event.stopPropagation();_addToCart(${p.id})" aria-label="В корзину">+</button>`
            : `<button class="add-btn add-btn--disabled" disabled>+</button>`;
        return `
        <div class="product-card" id="fcard-${p.id}" onclick="location.href='../catalog/product.html?id=${p.id}'">
            <div class="product-card__img ${imgBg}">
                ${imgIcon}
                <button class="fav-btn fav-btn--active" onclick="event.stopPropagation();_removeFav(${p.id})" aria-label="Убрать из избранного">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF3B30" stroke="#FF3B30" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
                    </svg>
                </button>
            </div>
            <div class="product-card__body">
                <div class="product-card__name">${p.name}</div>
                <div class="product-card__footer">
                    <span class="product-card__price">${priceStr}</span>
                    ${addBtn}
                </div>
            </div>
        </div>`;
    }).join('')}</div>`;

    // Bind handlers after innerHTML (closure over products array)
    window._addToCart = id => addToCart(id, products);
    window._removeFav = id => removeFav(id, products);
}

/* ─── Init ──────────────────────────────────────────────── */
async function init() {
    const loading = document.getElementById('loading');
    const main    = document.getElementById('main');

    if (!_tgId) {
        loading.style.display = 'none';
        main.style.display    = '';
        main.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">🤍</div>
                <p class="empty-state__title">Избранное недоступно</p>
                <p class="empty-state__sub">Откройте магазин через бота в Max Messenger</p>
                <a href="../../index.html" class="empty-state__btn">В каталог</a>
            </div>`;
        return;
    }

    try {
        const r = await fetch(`/api/favorites?tg_id=${encodeURIComponent(_tgId)}`);
        if (!r.ok) throw new Error(r.status);
        const products = await r.json();
        loading.style.display = 'none';
        main.style.display    = '';
        renderFavorites(products);
    } catch {
        loading.style.display = 'none';
        main.style.display    = '';
        main.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">⚠️</div>
                <p class="empty-state__title">Ошибка загрузки</p>
                <p class="empty-state__sub">Попробуйте открыть страницу снова</p>
            </div>`;
    }

    updateCartBadge();
}

document.addEventListener('DOMContentLoaded', init);
