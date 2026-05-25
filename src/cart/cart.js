/* ─── Category icons ────────────────────────────────────── */
const CAT_META = {
    'mounting-guns':  { icon: '🔨', bg: 'img-bg--guns' },
    'battery-tools':  { icon: '⚡',  bg: 'img-bg--battery' },
    'consumables':    { icon: '📦', bg: 'img-bg--consumables' },
    'services':       { icon: '🔧', bg: 'img-bg--services' },
};

/* ─── Cart storage ──────────────────────────────────────── */
function getCart() {
    try { return JSON.parse(localStorage.getItem('cart') || '[]'); }
    catch { return []; }
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}

/* ─── Mutations ─────────────────────────────────────────── */
function updateQty(id, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    item.qty += delta;
    if (item.qty <= 0) {
        removeItem(id);
        return;
    }
    saveCart(cart);
    render();
}

function removeItem(id) {
    const el = document.getElementById(`item-${id}`);
    if (el) {
        el.classList.add('removing');
        setTimeout(() => {
            const cart = getCart().filter(i => i.id !== id);
            saveCart(cart);
            render();
        }, 200);
    } else {
        const cart = getCart().filter(i => i.id !== id);
        saveCart(cart);
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

    // Total qty & price
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const total    = cart.reduce((s, i) => s + i.price * i.qty, 0);

    itemsLabel.textContent = plural(totalQty, 'товар', 'товара', 'товаров');
    totalPrice.textContent = fmt(total);

    navBadge.textContent = totalQty > 99 ? '99+' : totalQty;
    navBadge.classList.remove('hidden');

    list.innerHTML = cart.map(item => {
        const meta = CAT_META[item.category] || { icon: '📦', bg: 'img-bg--default' };
        const lineTotal = fmt(item.price * item.qty);

        return `
        <div class="cart-item" id="item-${item.id}">
            <div class="cart-item__img ${meta.bg}">${meta.icon}</div>
            <div class="cart-item__info">
                <div class="cart-item__name">${item.name}</div>
                <div class="cart-item__unit">${fmt(item.price)}&nbsp;/ шт</div>
                <div class="cart-item__controls">
                    <button class="qty-btn qty-btn--dec" onclick="updateQty(${item.id}, -1)" aria-label="Уменьшить">−</button>
                    <span class="qty-value">${item.qty}</span>
                    <button class="qty-btn" onclick="updateQty(${item.id}, 1)" aria-label="Увеличить">+</button>
                    <span class="cart-item__line-total">${lineTotal}</span>
                </div>
            </div>
            <button class="remove-btn" onclick="removeItem(${item.id})" aria-label="Удалить">
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
