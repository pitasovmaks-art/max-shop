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
                <a href="../../index.html" class="empty-state__btn">Перейти в каталог</a>
            </div>`;
        return;
    }

    content.innerHTML = orders.map(o => {
        const st   = STATUS_CONFIG[o.status] || { label: o.status, cls: 'badge-new' };
        const date = new Date(o.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        });
        const itemsText = o.items.map(i => `${i.name} × ${i.qty}`).join(', ');
        const trackBtn  = o.trackingNumber
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
        </div>`;
    }).join('');
}

async function init() {
    const content = document.getElementById('content');
    content.innerHTML = `<div style="color:white;padding:20px">tg_id: ${_tgId || 'НЕТ'}</div>`;

    if (!_tgId) {
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
let _botUsername = '';
fetch('/api/config').then(r => r.json()).then(cfg => { _botUsername = cfg.botUsername || ''; }).catch(() => {});
function openSupport() {
    const url = `https://max.ru/${_botUsername || 'id635009278943_bot'}`;
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

document.addEventListener('DOMContentLoaded', () => {
    updateNavLinks();
    updateCartBadge();
    init();
});
