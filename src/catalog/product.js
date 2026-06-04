const productId = +new URLSearchParams(location.search).get('id');

let _product   = null;
let _allImages = [];
let _currentImgIdx = 0;

let _touchStartX = 0;
let _touchStartY = 0;

/* ─── Cart (mirrors catalog.js) ─────────────────────────────── */
function getCart() {
    try {
        const c = JSON.parse(localStorage.getItem('cart') || '[]');
        return c.map(i => ({ ...i, key: i.key || String(i.id) }));
    } catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
    updateBadges();
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
        const text = qty > 99 ? '99+' : String(qty);
        badge.textContent = text;
        badge.classList.remove('hidden');
        if (navBadge) { navBadge.textContent = text; navBadge.classList.remove('hidden'); }
    } else {
        badge.classList.add('hidden');
        if (navBadge) navBadge.classList.add('hidden');
    }
}

/* ─── Helpers ───────────────────────────────────────────────── */
function fmt(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

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

/* ─── City-aware price ──────────────────────────────────────── */
function effectivePrice(variant) {
    if (!variant) return 0;
    const city = localStorage.getItem('city');
    if (city === 'krd') return variant.priceKrdPickup || 0;
    return variant.priceMskPickup || 0;
}

/* ─── Variant selection ─────────────────────────────────────── */
let _selectedVariantId = null;

function _cityVariants(variants) {
    const city = localStorage.getItem('city');
    if (!variants || !variants.length) return [];
    if (city === 'krd') return variants.filter(v => v.isKrd && v.priceKrdPickup > 0);
    return variants.filter(v => !v.isKrd && (v.priceMskPickup > 0 || v.priceMskDelivery > 0));
}

function effectiveVariant() {
    if (!_product?.variants?.length) return null;
    const cv = _cityVariants(_product.variants);
    if (!cv.length) return null;
    return cv.find(v => v.id === _selectedVariantId) || cv.find(v => v.isDefault) || cv[0];
}

function selectVariant(variantId) {
    _selectedVariantId = variantId;
    document.querySelectorAll('.variant-pill').forEach(pill => {
        pill.classList.toggle('variant-pill--active', +pill.dataset.vid === variantId);
    });
    updatePrice();
}

function updatePrice() {
    const el   = document.getElementById('productPrice');
    const city = localStorage.getItem('city');
    if (_product.isService) {
        el.className = 'product-price product-price--service';
        el.textContent = _product.priceLabel || fmt(_product.price);
    } else {
        el.className = 'product-price';
        const ev        = effectiveVariant();
        const basePrice = ev
            ? effectivePrice(ev)
            : (city === 'krd' ? (_product.priceKrd || _product.price || 0) : (_product.priceMsk || _product.price || 0));
        const salePrice = ev?.salePrice || 0;
        el.innerHTML    = salePrice > 0
            ? `<s class="price-old">${fmt(basePrice)}</s><span class="price-sale">${fmt(salePrice)}</span>`
            : fmt(basePrice);
    }
}

/* ─── Gallery arrows ────────────────────────────────────────── */
function updateArrow() {
    const prev = document.getElementById('galleryArrowPrev');
    const next = document.getElementById('galleryArrowNext');
    if (!prev || !next) return;
    const multi = _allImages.length > 1;
    prev.classList.toggle('hidden', !multi || _currentImgIdx === 0);
    next.classList.toggle('hidden', !multi || _currentImgIdx === _allImages.length - 1);
}

function prevImage() {
    if (_currentImgIdx > 0) setMainImage(_currentImgIdx - 1);
}

function nextImage() {
    if (_currentImgIdx < _allImages.length - 1) setMainImage(_currentImgIdx + 1);
}

/* ─── Gallery ───────────────────────────────────────────────── */
function renderGallery() {
    const mainEl  = document.getElementById('galleryMain');
    const wrapEl  = document.getElementById('galleryStripWrap');
    const stripEl = document.getElementById('galleryStrip');

    if (!_allImages.length) {
        mainEl.className = `gallery__main cat-bg-${_product.categoryId || 1}`;
        mainEl.innerHTML = '<span style="font-size:72px">📦</span>';
        if (!_product.inStock) {
            mainEl.innerHTML += '<span class="badge-out">Нет в наличии</span>';
        }
        wrapEl.classList.add('hidden');
        updateArrow();
        return;
    }

    setMainImage(0);

    if (_allImages.length > 1) {
        stripEl.innerHTML = _allImages.map((img, i) => `
            <div class="gallery__thumb${i === 0 ? ' gallery__thumb--active' : ''}"
                 id="thumb-${i}" onclick="setMainImage(${i})">
                <img src="${img.url}" alt="">
            </div>`).join('');
        wrapEl.classList.remove('hidden');
    } else {
        wrapEl.classList.add('hidden');
    }

}

function setMainImage(idx) {
    _currentImgIdx = idx;
    const mainEl = document.getElementById('galleryMain');
    mainEl.className = 'gallery__main';
    mainEl.innerHTML = `<img src="${_allImages[idx].url}" alt="${_product.name}">`;
    if (!_product.inStock) {
        mainEl.innerHTML += '<span class="badge-out">Нет в наличии</span>';
    }
    document.querySelectorAll('.gallery__thumb').forEach((el, i) => {
        el.classList.toggle('gallery__thumb--active', i === idx);
    });
    updateArrow();
}

/* ─── Swipe ─────────────────────────────────────────────────── */
function initSwipe() {
    const mainEl = document.getElementById('galleryMain');
    if (!mainEl) return;

    mainEl.addEventListener('touchstart', e => {
        _touchStartX = e.touches[0].clientX;
        _touchStartY = e.touches[0].clientY;
    }, { passive: true });

    mainEl.addEventListener('touchend', e => {
        if (!_allImages.length) return;
        const dx = e.changedTouches[0].clientX - _touchStartX;
        const dy = e.changedTouches[0].clientY - _touchStartY;
        if (Math.abs(dy) > Math.abs(dx)) return;
        if (Math.abs(dx) < 50) return;
        if (dx < 0 && _currentImgIdx < _allImages.length - 1) {
            setMainImage(_currentImgIdx + 1);
        } else if (dx > 0 && _currentImgIdx > 0) {
            setMainImage(_currentImgIdx - 1);
        }
    }, { passive: true });
}

/* ─── Render product info ───────────────────────────────────── */
function renderInfo() {
    document.title = `${_product.name} — Точка Монтажа`;
    document.getElementById('pageTitle').textContent = _product.name;
    document.getElementById('productName').textContent = _product.name;

    const descEl = document.getElementById('productDesc');
    if (_product.desc) {
        descEl.innerHTML = (_product.desc || '').replace(/\n/g, '<br>');
        descEl.classList.remove('hidden');
    }

    const varSection = document.getElementById('variantSection');
    const pillsEl    = document.getElementById('variantPills');
    const cityVars   = _cityVariants(_product.variants || []);
    if (cityVars.length) {
        const def = cityVars.find(v => v.isDefault) || cityVars[0];
        _selectedVariantId = def.id;
        pillsEl.innerHTML = cityVars.map(v => `
            <button class="variant-pill${v.id === _selectedVariantId ? ' variant-pill--active' : ''}"
                    data-vid="${v.id}"
                    onclick="selectVariant(${v.id})">${v.label}</button>`
        ).join('');
        varSection.classList.remove('hidden');
    }

    updatePrice();

    const btn = document.getElementById('addToCartBtn');
    if (!_product.inStock) {
        const tgId = getTgId();
        if (tgId) {
            btn.textContent = '🔔 Сообщить о поступлении';
            btn.onclick = subscribeNotifyProduct;
            setupNotifyBtn();  // async: replaces to "✓ Вы подписаны" if already subscribed
        } else {
            btn.classList.add('add-to-cart-btn--disabled');
            btn.disabled = true;
            btn.textContent = 'Нет в наличии';
        }
    } else {
        btn.textContent = _product.isService ? 'Записаться' : 'В корзину';
        btn.onclick = addToCart;
    }
}

/* ─── Add to cart ───────────────────────────────────────────── */
function addToCart() {
    const variant = effectiveVariant();
    const city    = localStorage.getItem('city');
    const isKrd   = city === 'krd';

    let priceKrdPickup, priceMskPickup, priceMskDelivery, salePrice;
    if (variant) {
        priceKrdPickup   = variant.priceKrdPickup   || 0;
        priceMskPickup   = variant.priceMskPickup   || 0;
        priceMskDelivery = variant.priceMskDelivery || 0;
        salePrice        = variant.salePrice        || 0;
    } else {
        priceKrdPickup   = _product.priceKrd      || _product.price || 0;
        priceMskPickup   = _product.priceMsk      || _product.price || 0;
        priceMskDelivery = _product.priceDelivery || _product.price || 0;
        salePrice        = 0;
    }
    const basePrice = isKrd ? priceKrdPickup : priceMskPickup;
    const price     = salePrice > 0 ? salePrice : basePrice;
    const key       = variant ? `${_product.id}_v${variant.id}` : String(_product.id);

    const cart     = getCart();
    const existing = cart.find(i => i.key === key);
    if (existing) {
        existing.qty += 1;
    } else {
        const item = {
            key, id: _product.id, name: _product.name,
            price, priceKrdPickup, priceMskPickup, priceMskDelivery,
            priceDelivery: priceMskDelivery,
            qty: 1, categoryId: _product.categoryId,
        };
        if (salePrice > 0) item.salePrice = salePrice;
        if (variant) { item.variantId = variant.id; item.variantLabel = variant.label; }
        cart.push(item);
    }
    saveCart(cart);
    showToast('✓ Добавлено в корзину');
}

/* ─── Stock notify ───────────────────────────────────────────── */
async function setupNotifyBtn() {
    const tgId = getTgId();
    if (!tgId || !_product || _product.inStock) return;
    try {
        const r = await fetch(`/api/stock-notify/check?tg_id=${encodeURIComponent(tgId)}&product_id=${_product.id}`);
        const data = await r.json();
        if (data.subscribed) applySubscribedState();
    } catch {}
}

function applySubscribedState() {
    const btn = document.getElementById('addToCartBtn');
    if (!btn) return;
    btn.classList.remove('add-to-cart-btn--disabled');
    btn.classList.add('add-to-cart-btn--subscribed');
    btn.disabled = true;
    btn.textContent = '🔔 Вы подписаны';
    btn.onclick = null;
}

async function subscribeNotifyProduct() {
    const tgId = getTgId();
    if (!tgId) { showToast('Откройте магазин через бота в Max Messenger'); return; }
    try {
        await fetch('/api/stock-notify', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ tgId, productId: _product.id }),
        });
        applySubscribedState();
        showToast('🔔 Уведомим когда товар появится');
    } catch { showToast('Ошибка. Попробуйте снова'); }
}

/* ─── Init ──────────────────────────────────────────────────── */
async function init() {
    if (!productId) { location.href = '../../index.html'; return; }

    try {
        const [product, extraImages] = await Promise.all([
            fetch(`/api/products/${productId}`).then(r => {
                if (!r.ok) throw new Error('not found');
                return r.json();
            }),
            fetch(`/api/products/${productId}/images`).then(r => r.json()).catch(() => []),
        ]);

        _product = product;

        _allImages = [];
        if (product.image) _allImages.push({ url: product.image });
        (Array.isArray(extraImages) ? extraImages : [])
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .forEach(img => _allImages.push({ url: img.url }));

        renderGallery();
        renderInfo();
        updateBadges();
    } catch {
        document.getElementById('pageTitle').textContent = 'Товар не найден';
        document.getElementById('productName').textContent = 'Товар не найден';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initSwipe();
    init();
});
