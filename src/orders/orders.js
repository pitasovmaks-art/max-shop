const _tgId = getTgId() || '';

const STATUS_CONFIG = {
    new:         { label: 'Новый',           cls: 'badge-new' },
    in_progress: { label: 'В работе',        cls: 'badge-in_progress' },
    ready:       { label: 'Готов к выдаче',  cls: 'badge-shipped' },
    shipped:     { label: 'Отправлен',       cls: 'badge-shipped' },
    completed:   { label: 'Получен',         cls: 'badge-completed' },
    cancelled:   { label: 'Отменён',         cls: 'badge-cancelled' },
};

function fmt(n) { return n.toLocaleString('ru-RU') + ' ₽'; }

function renderOrders(orders) {
    const content = document.getElementById('content');
    if (!orders.length) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">📋</div>
                <p class="empty-state__title">Заказов пока нет</p>
                <p class="empty-state__sub">Ваши заказы появятся здесь после оформления</p>
                <div style="color:rgba(28,28,30,0.5);padding:8px;font-size:11px;white-space:pre-line;margin:20px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;text-align:left">WebApp: ${typeof window.WebApp}
platform: ${window.WebApp?.platform || '?'}
version: ${window.WebApp?.version || '?'}
initData: ${window.WebApp?.initData ? 'есть' : 'нет'}
initDataUnsafe: ${window.WebApp?.initDataUnsafe ? 'есть' : 'нет'}
user.id: ${window.WebApp?.initDataUnsafe?.user?.id || '?'}
chat.id: ${window.WebApp?.initDataUnsafe?.chat?.id || '?'}
tg_id: ${_tgId || 'НЕТ'}</div>
                <a href="../../index.html" class="empty-state__btn">Перейти в каталог</a>
            </div>`;
        return;
    }

    content.innerHTML = `<div style="color:rgba(28,28,30,0.5);padding:8px 16px;font-size:12px">ID: ${_tgId || 'нет'}</div>` + orders.map(o => {
        const st   = STATUS_CONFIG[o.status] || { label: o.status, cls: 'badge-new' };
        const date = new Date(o.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        });
        const itemsText  = o.items.map(i => `${i.name} × ${i.qty}`).join(', ');
        const itemsData  = encodeURIComponent(JSON.stringify(o.items));
        const trackBtn   = o.trackingNumber
            ? `<a class="track-btn" href="https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(o.trackingNumber)}" target="_blank">
                   📦 Отследить посылку
               </a>`
            : '';

        return `
        <div class="order-card">
            <div class="order-card__header">
                <span class="order-card__num">Заказ #${o.id}</span>
                <span class="order-badge ${st.cls}">${st.label}</span>
            </div>
            <div class="order-card__date">${date}</div>
            <div class="order-card__items">${itemsText}</div>
            <div class="order-card__store">📍 ${o.store}</div>
            ${o.delivery === 'russia' && o.address ? `<div class="order-card__address">📦 Пункт СДЭК: ${o.address}</div>` : ''}
            ${o.delivery === 'city'   && o.address ? `<div class="order-card__address">🚗 Адрес доставки: ${o.address}</div>` : ''}
            ${o.trackingNumber ? `<div class="order-card__tracking">🔖 Трек-номер: ${o.trackingNumber}</div>` : ''}
            ${trackBtn}
            <div class="order-card__total">${fmt(o.total)}</div>
            <button class="reorder-btn" data-items="${itemsData}">🔄 Заказать снова</button>
        </div>`;
    }).join('');

    content.querySelectorAll('.reorder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.disabled) return;
            let items;
            try { items = JSON.parse(decodeURIComponent(btn.dataset.items)); }
            catch (e) { console.error('reorder parse error:', e); return; }
            btn.disabled = true;
            btn.textContent = '⏳ Загружаем...';
            reorderItems(items).finally(() => {
                btn.disabled = false;
                btn.textContent = '🔄 Заказать снова';
            });
        });
    });
}

async function init() {
    const content = document.getElementById('content');

    if (!_tgId) {
        content.innerHTML = '<div style="color:rgba(28,28,30,0.5);padding:8px 16px;font-size:12px">ID: нет</div>';
        renderOrders([]);
        return;
    }

    try {
        const r = await fetch(`/api/orders/my?tg_id=${encodeURIComponent(_tgId)}`);
        if (!r.ok) throw new Error(r.status);
        const orders = await r.json();
        renderOrders(orders);
    } catch {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">⚠️</div>
                <p class="empty-state__title">Ошибка загрузки</p>
                <p class="empty-state__sub">Попробуйте открыть страницу снова</p>
            </div>`;
    }
}

/* ─── Cart badge ─────────────────────────────────────────── */
function updateCartBadge() {
    try {
        const qty = JSON.parse(localStorage.getItem('cart') || '[]').reduce((s, i) => s + i.qty, 0);
        const badge = document.getElementById('navBadge');
        if (!badge) return;
        if (qty > 0) { badge.textContent = qty > 99 ? '99+' : qty; badge.classList.remove('hidden'); }
        else badge.classList.add('hidden');
    } catch {}
}

/* ─── Support ────────────────────────────────────────────── */
let _supportBotUsername = 'id635009278943_1_bot';
fetch('/api/config').then(r => r.json()).then(cfg => { _supportBotUsername = cfg.supportBotUsername || 'id635009278943_1_bot'; }).catch(() => {});
function openSupport() {
    const url = `https://max.ru/${_supportBotUsername}`;
    if (window.WebApp?.openLink) window.WebApp.openLink(url);
    else window.location.href = url;
}

/* ─── Nav tg_id links ────────────────────────────────────── */
function updateNavLinks() {
    if (!_tgId) return;
    const navCatalog = document.getElementById('navCatalog');
    if (navCatalog) navCatalog.href = `../../index.html?tg_id=${_tgId}`;
    const navCart = document.getElementById('navCart');
    if (navCart) navCart.href = `../../cart.html?tg_id=${_tgId}`;
}

/* ─── Reorder ────────────────────────────────────────────── */
async function reorderItems(orderItems) {
    const city = localStorage.getItem('city');
    const cart = JSON.parse(localStorage.getItem('cart') || '[]')
        .map(i => ({ ...i, key: i.key || String(i.id) }));

    let added = 0, skipped = 0;

    for (const orderItem of orderItems) {
        // Fetch actual product data (includes variants, image, actual prices)
        let product;
        try {
            const r = await fetch(`/api/products/${orderItem.id}`);
            if (!r.ok) { skipped++; continue; }
            product = await r.json();
        } catch { skipped++; continue; }

        if (!product.inStock) { skipped++; continue; }

        // Select variant: city first, then label match within city variants
        let variant = null;
        if (product.variants && product.variants.length) {
            // Step 1: filter to variants valid for current city
            const cityVariants = city === 'krd'
                ? product.variants.filter(v => v.isKrd  && v.priceKrdPickup  > 0)
                : product.variants.filter(v => !v.isKrd && v.priceMskPickup  > 0);

            // No variants for this city → skip as unavailable
            if (!cityVariants.length) { skipped++; continue; }

            // Step 2: among city variants try to match the original label
            const prefix = product.name + ' (';
            let label = null;
            if (orderItem.name.startsWith(prefix) && orderItem.name.endsWith(')')) {
                label = orderItem.name.slice(prefix.length, -1);
            }
            variant = (label && cityVariants.find(v => v.label === label)) || cityVariants[0];
        }

        const key = variant ? `${product.id}_v${variant.id}` : String(product.id);

        // Build prices — mirrors catalog.js addToCart exactly
        let priceKrdPickup, priceMskPickup, priceMskDelivery;
        if (variant) {
            priceKrdPickup   = variant.priceKrdPickup   || 0;
            priceMskPickup   = variant.priceMskPickup   || 0;
            priceMskDelivery = variant.priceMskDelivery || 0;
        } else {
            // Only reached when product has no variants at all
            priceKrdPickup   = product.priceKrd      || product.price || 0;
            priceMskPickup   = product.priceMsk      || product.price || 0;
            priceMskDelivery = product.priceDelivery || product.price || 0;
        }
        const price = city === 'krd' ? priceKrdPickup : priceMskPickup;

        const existing = cart.find(i => i.key === key);
        if (existing) {
            existing.qty += orderItem.qty;
        } else {
            const cartItem = {
                key, id: product.id, name: product.name,
                price, priceKrdPickup, priceMskPickup, priceMskDelivery,
                priceDelivery: priceMskDelivery,
                qty:        orderItem.qty,
                categoryId: product.categoryId,
                image:      product.image || undefined,
            };
            if (variant) { cartItem.variantId = variant.id; cartItem.variantLabel = variant.label; }
            cart.push(cartItem);
        }
        added++;
    }

    localStorage.setItem('cart', JSON.stringify(cart));
    updateCartBadge();

    if (skipped === 0) {
        showReorderToast('✓ Товары добавлены в корзину');
    } else if (added > 0) {
        showReorderToast(`✓ Добавлено: ${added}. ⚠️ Недоступно: ${skipped}`);
    } else {
        showReorderToast('⚠️ Товары из этого заказа больше недоступны');
    }
}

function showReorderToast(msg) {
    let toast = document.getElementById('reorderToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'reorderToast';
        toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(30,30,30,0.9);backdrop-filter:blur(10px);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;white-space:nowrap';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

document.addEventListener('DOMContentLoaded', () => {
    updateNavLinks();
    updateCartBadge();
    init();
});
