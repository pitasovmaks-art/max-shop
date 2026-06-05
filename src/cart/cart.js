/* ─── Category icons ────────────────────────────────────── */
const CAT_META = {
    'mounting-guns':  { icon: '🔨', bg: 'img-bg--guns' },
    'battery-tools':  { icon: '⚡',  bg: 'img-bg--battery' },
    'consumables':    { icon: '📦', bg: 'img-bg--consumables' },
    'services':       { icon: '🔧', bg: 'img-bg--services' },
};

/* ─── Cart storage ──────────────────────────────────────── */
function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem('cart') || '[]');
        return cart.map(i => ({ ...i, key: i.key || String(i.id) }));
    }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}

/* ─── Mutations ─────────────────────────────────────────── */
function updateQty(key, delta) {
    const cart = getCart();
    const item = cart.find(i => i.key === key);
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        removeItem(key);
        return;
    }
    saveCart(cart);
    render();
}

function removeItem(key) {
    const el = document.getElementById(`item-${key}`);
    if (el) {
        el.classList.add('removing');
        setTimeout(() => {
            saveCart(getCart().filter(i => i.key !== key));
            render();
        }, 200);
    } else {
        saveCart(getCart().filter(i => i.key !== key));
        render();
    }
}

function clearCart() {
    saveCart([]);
    closeDialog();
    render();
}

/* ─── Format price ──────────────────────────────────────── */
function fmt(price) {
    return price.toLocaleString('ru-RU') + ' ₽';
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ─── Effective price for current city ─────────────────── */
function effectiveItemPrice(item, city, deliveryMethod) {
    if (deliveryMethod === 'russia') {
        const delivery = item.priceMskDelivery || item.priceDelivery || 0;
        if (!delivery) return null;
        const sale   = item.salePriceMsk || 0;
        const pickup = item.priceMskPickup || item.priceMsk || 0;
        if (sale > 0 && pickup > 0) {
            const surcharge    = delivery - pickup;
            const saleDelivery = sale + (surcharge > 0 ? surcharge : 0);
            return Math.min(saleDelivery, delivery);
        }
        return delivery;
    }
    if (city === 'krd') {
        const base = item.priceKrdPickup || item.priceKrd || 0;
        const sale = item.salePriceKrd || 0;
        return base ? (sale > 0 ? sale : base) : null;
    }
    const base = item.priceMskPickup || item.priceMsk || 0;
    const sale = item.salePriceMsk || 0;
    return base ? (sale > 0 ? sale : base) : null;
}

/* ─── Render ────────────────────────────────────────────── */
function render() {
    const cart = getCart();
    const list     = document.getElementById('cartList');
    const empty    = document.getElementById('emptyState');
    const footer   = document.getElementById('cartFooter');
    const clearBtn = document.getElementById('clearBtn');
    const navBadge = document.getElementById('navBadge');
    const itemsLabel = document.getElementById('itemsLabel');
    const totalPrice = document.getElementById('totalPrice');

    if (!cart.length) {
        list.classList.add('hidden');
        footer.classList.add('hidden');
        clearBtn.classList.add('hidden');
        empty.classList.remove('hidden');
        navBadge.classList.add('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.classList.remove('hidden');
    footer.classList.remove('hidden');
    clearBtn.classList.remove('hidden');

    const city = localStorage.getItem('city') || 'msk';
    // compute effective price per item; null = unavailable in current city
    const priced = cart.map(item => ({
        item,
        ep: effectiveItemPrice(item, city, null),
    }));
    const hasUnavailable = priced.some(({ ep }) => ep === null);

    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const total    = priced.reduce((s, { item, ep }) => s + (ep ?? 0) * item.qty, 0);

    itemsLabel.textContent = plural(totalQty, 'товар', 'товара', 'товаров');
    totalPrice.textContent = fmt(total);

    navBadge.textContent = totalQty > 99 ? '99+' : totalQty;
    navBadge.classList.remove('hidden');

    // disable checkout button if any item is unavailable
    const checkoutBtn = document.querySelector('.checkout-btn');
    if (checkoutBtn) {
        checkoutBtn.disabled = hasUnavailable;
        checkoutBtn.style.opacity = hasUnavailable ? '0.45' : '';
    }

    list.innerHTML = priced.map(({ item, ep }) => {
        const meta    = CAT_META[item.category] || { icon: '📦', bg: 'img-bg--default' };
        const safeKey = item.key.replace(/'/g, "\\'");

        if (ep === null) {
            return `
            <div class="cart-item cart-item--unavailable" id="item-${item.key}">
                ${item.image
                    ? `<div class="cart-item__img"><img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;opacity:.4"></div>`
                    : `<div class="cart-item__img ${meta.bg}" style="opacity:.4">${meta.icon}</div>`}
                <div class="cart-item__info">
                    <div class="cart-item__name">${item.name}</div>
                    ${item.variantLabel ? `<div class="cart-item__variant">${item.variantLabel}</div>` : ''}
                    <div class="cart-item__unit" style="color:#FF3B30;font-size:12px">Недоступен в выбранном городе</div>
                </div>
                <button class="remove-btn" onclick="removeItem('${safeKey}')" aria-label="Удалить">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>`;
        }

        const baseForDisplay = city === 'krd'
            ? (item.priceKrdPickup || item.priceKrd || 0)
            : (item.priceMskPickup || item.priceMsk || 0);
        const isOnSale  = ep < baseForDisplay && baseForDisplay > 0;
        const unitHtml  = isOnSale
            ? `<s class="price-old">${fmt(baseForDisplay)}</s><span class="price-sale">${fmt(ep)}</span>`
            : fmt(ep);
        const lineTotal = fmt(ep * item.qty);

        return `
        <div class="cart-item" id="item-${item.key}">
            ${item.image
                ? `<div class="cart-item__img"><img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"></div>`
                : `<div class="cart-item__img ${meta.bg}">${meta.icon}</div>`}
            <div class="cart-item__info">
                <div class="cart-item__name">${item.name}</div>
                ${item.variantLabel ? `<div class="cart-item__variant">${item.variantLabel}</div>` : ''}
                <div class="cart-item__unit">${unitHtml}&nbsp;/ шт</div>
                <div class="cart-item__controls">
                    <button class="qty-btn qty-btn--dec" onclick="updateQty('${safeKey}', -1)" aria-label="Уменьшить">−</button>
                    <span class="qty-value">${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty('${safeKey}', 1)" aria-label="Увеличить">+</button>
                    <span class="cart-item__line-total">${lineTotal}</span>
                </div>
            </div>
            <button class="remove-btn" onclick="removeItem('${safeKey}')" aria-label="Удалить">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
        </div>`;
    }).join('');
}

/* ─── Confirm clear dialog ──────────────────────────────── */
function confirmClear() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.id = 'overlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Очистить корзину?</p>
            <p class="dialog__sub">Все добавленные товары будут удалены</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="clearCart()">Очистить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="closeDialog()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDialog(); });
    document.body.appendChild(overlay);
}

function closeDialog() {
    const el = document.getElementById('overlay');
    if (el) el.remove();
}

/* ─── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', render);
