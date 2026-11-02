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
    if (window.syncCartToServer) syncCartToServer(cart);
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

/* effectiveItemPrice()/resolveFreshCartItem() — общие с checkout.js,
   src/shared/cartPricing.js (подключён отдельным <script> в cart.html
   перед этим файлом, см. fix-cart-prices-city). */

/* ─── Refresh prices from server ────────────────────────────
   Раньше корзина показывала только то, что было сохранено при
   добавлении товара — если цена/скидка/курс $ поменялись после этого,
   покупатель узнавал об этом только на чекауте (409) или вообще не
   узнавал, если так и не доходил до отправки заказа. Теперь при каждом
   открытии страницы корзины (и при возврате на вкладку) цены
   пересобираются по свежим данным той же логикой, что уже использует
   чекаут (resolveFreshCartItem, src/shared/cartPricing.js).

   _priceChangeNotices — НЕ persisted (живёт в памяти вкладки): "до
   следующего открытия корзины" означает "до следующей полной загрузки
   этой страницы" — переключение вкладок (visibilitychange) её не
   сбрасывает, а свежая загрузка cart.html — сбрасывает автоматически,
   т.к. это обычная переменная модуля. */
let _priceChangeNotices = {}; // { [item.key]: { oldPrice } }

let _cartRefreshSequence = 0;

async function refreshCartPrices() {
    const sequence = ++_cartRefreshSequence;
    const cart = getCart();
    if (!cart.length) return;

    let fresh;
    try {
        const response = await fetch('/api/products');
        if (!response.ok) return;
        fresh = await response.json();
        if (!Array.isArray(fresh)) return;
    } catch {
        // Сеть/сервер недоступны — оставляем старые цены как есть,
        // оформление всё равно проверит их заново (409 при расхождении).
        return;
    }

    if (sequence !== _cartRefreshSequence) return;
    const city = localStorage.getItem('city') || 'msk';
    // Read again after await: preserve removals and quantity changes.
    const updated = getCart().map(item => {
        const result = resolveFreshCartItem(item, fresh, city, null);
        if (!result.ok) {
            // Недоступен — обнуляем ценовые поля, чтобы render() сам
            // показал серую карточку (как и раньше для ep===null);
            // баннер "цена изменилась" для недоступных не нужен.
            delete _priceChangeNotices[item.key];
            return {
                ...item,
                priceKrdPickup: 0, priceMskPickup: 0, priceMskDelivery: 0, priceDelivery: 0,
                priceKrd: 0, priceMsk: 0,
                salePriceKrd: 0, salePriceMsk: 0,
            };
        }
        // Compare with the saved price for THIS city, not item.price from
        // whichever city the item was added in.
        const previousPrice = effectiveItemPrice(item, city, null);
        if (_priceChangeNotices[item.key]?.city !== city) delete _priceChangeNotices[item.key];
        if (previousPrice !== null && result.price !== previousPrice) {
            _priceChangeNotices[item.key] = { oldPrice: previousPrice, city };
        }
        return { ...item, ...result.fields, price: result.price };
    });

    saveCart(updated);
    render();
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
        const safeKey = escHtml(JSON.stringify(String(item.key)));

        if (ep === null) {
            return `
            <div class="cart-item cart-item--unavailable" id="item-${escHtml(item.key)}">
                ${item.image
                    ? `<div class="cart-item__img"><img src="${escHtml(safeImageUrl(item.image))}" alt="${escHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;opacity:.4"></div>`
                    : `<div class="cart-item__img img-bg--default" style="opacity:.4">${iconSvg('image', 26)}</div>`}
                <div class="cart-item__info">
                    <div class="cart-item__name">${escHtml(item.name)}</div>
                    ${item.variantLabel ? `<div class="cart-item__variant">${escHtml(item.variantLabel)}</div>` : ''}
                    <div class="cart-item__unit" style="color:#FF3B30;font-size:12px">Недоступен в выбранном городе</div>
                </div>
                <button class="remove-btn" onclick="removeItem(${safeKey})" aria-label="Удалить">
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
        const notice    = _priceChangeNotices[item.key];
        const noticeHtml = notice
            ? `<div style="color:var(--warning);font-size:11px;margin-top:2px">Цена изменилась: было ${fmt(notice.oldPrice)}</div>`
            : '';

        return `
        <div class="cart-item" id="item-${escHtml(item.key)}">
            ${item.image
                ? `<div class="cart-item__img"><img src="${escHtml(safeImageUrl(item.image))}" alt="${escHtml(item.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px"></div>`
                : `<div class="cart-item__img img-bg--default">${iconSvg('image', 26)}</div>`}
            <div class="cart-item__info">
                <div class="cart-item__name">${escHtml(item.name)}</div>
                ${item.variantLabel ? `<div class="cart-item__variant">${escHtml(item.variantLabel)}</div>` : ''}
                <div class="cart-item__unit">${unitHtml}&nbsp;/ шт</div>
                ${noticeHtml}
                <div class="cart-item__controls">
                    <button class="qty-btn qty-btn--dec" onclick="updateQty(${safeKey}, -1)" aria-label="Уменьшить">−</button>
                    <span class="qty-value">${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${safeKey}, 1)" aria-label="Увеличить">+</button>
                    <span class="cart-item__line-total">${lineTotal}</span>
                </div>
            </div>
            <button class="remove-btn" onclick="removeItem(${safeKey})" aria-label="Удалить">
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
// render() сразу из localStorage (пустого экрана нет, даже если сеть
// медленная/недоступна), refreshCartPrices() — фоном поверх неё.
document.addEventListener('DOMContentLoaded', () => {
    render();
    refreshCartPrices();
});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshCartPrices();
});
