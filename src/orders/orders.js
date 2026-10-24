const _tgId = getTgId() || '';

const STATUS_CONFIG = {
    new:         { label: 'Новый',           cls: 'badge-new' },
    in_progress: { label: 'В работе',        cls: 'badge-in_progress' },
    ready:       { label: 'Готов к выдаче',  cls: 'badge-shipped' },
    shipped:     { label: 'Отправлен',       cls: 'badge-shipped' },
    completed:   { label: 'Получен',         cls: 'badge-completed' },
    cancelled:   { label: 'Отменён',         cls: 'badge-cancelled' },
};

/* Заявки на ремонт (service_requests) — свои 4 статуса, цветовые классы
   переиспользуются из STATUS_CONFIG выше (тот же токен-язык, см.
   src/orders/orders.html): accepted≈new (нейтральный), ready≈shipped
   («готово к выдаче» по смыслу то же самое, что «готово к отправке»). */
const SERVICE_STATUS_CONFIG = {
    accepted:    { label: 'Принята',          cls: 'badge-new' },
    in_progress: { label: 'В работе',         cls: 'badge-in_progress' },
    ready:       { label: 'Готова к выдаче',  cls: 'badge-shipped' },
    issued:      { label: 'Выдана',           cls: 'badge-completed' },
};

function fmt(n) { return n.toLocaleString('ru-RU') + ' ₽'; }

/* Карточка заявки на ремонт — через textContent/createElement, а не
   шаблонную строку с innerHTML (как у заказов ниже): здесь показываются
   данные, которые ввёл сам покупатель (имя инструмента, описание
   проблемы), значит потенциально содержат произвольный текст — не HTML,
   см. требование п.4 ТЗ. Возвращает DOM-узел, вставляется напрямую. */
function buildServiceRequestCard(r) {
    const st = SERVICE_STATUS_CONFIG[r.status] || { label: r.status, cls: 'badge-new' };
    const date = new Date(r.createdAt).toLocaleString('ru-RU', {
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });

    const card = document.createElement('div');
    card.className = 'order-card';

    const type = document.createElement('span');
    type.className = 'order-card__type';
    type.textContent = 'Ремонт';
    card.appendChild(type);

    const header = document.createElement('div');
    header.className = 'order-card__header';
    const num = document.createElement('span');
    num.className = 'order-card__num';
    num.textContent = r.number;
    const badge = document.createElement('span');
    badge.className = 'order-badge ' + st.cls;
    badge.textContent = st.label;
    header.appendChild(num);
    header.appendChild(badge);
    card.appendChild(header);

    const dateEl = document.createElement('div');
    dateEl.className = 'order-card__date';
    dateEl.textContent = date;
    card.appendChild(dateEl);

    const tools = document.createElement('div');
    tools.className = 'order-card__tools';
    r.items.forEach((item, i) => {
        if (i > 0) tools.appendChild(document.createElement('br'));
        tools.appendChild(document.createTextNode(item.toolName));
        if (item.problem) {
            const problem = document.createElement('span');
            problem.className = 'order-card__tool-problem';
            problem.textContent = ' — ' + item.problem;
            tools.appendChild(problem);
        }
    });
    card.appendChild(tools);

    const store = document.createElement('div');
    store.className = 'order-card__store';
    store.textContent = '📍 ' + r.storeLabel;
    card.appendChild(store);

    if (r.deliveryNeeded && r.address) {
        const addr = document.createElement('div');
        addr.className = 'order-card__address';
        addr.textContent = '🚗 Адрес забора: ' + r.address;
        card.appendChild(addr);
    }

    if (r.comment) {
        const comment = document.createElement('div');
        comment.className = 'order-card__store';
        comment.textContent = '💬 ' + r.comment;
        card.appendChild(comment);
    }

    // Стоимость/комментарий мастера — пока на этапе 1 некому заполнять
    // (нет экрана в админке), но отображение уже готово: как только
    // появятся cost/adminComment, карточка покажет их без правок здесь.
    if (r.adminComment) {
        const adminComment = document.createElement('div');
        adminComment.className = 'order-card__admin-comment';
        adminComment.textContent = '🔧 Комментарий мастера: ' + r.adminComment;
        card.appendChild(adminComment);
    }
    if (r.cost != null) {
        const cost = document.createElement('div');
        cost.className = 'order-card__cost';
        cost.textContent = fmt(r.cost);
        card.appendChild(cost);
    }

    return card;
}

function renderOrders(orders, serviceRequests) {
    serviceRequests = serviceRequests || [];
    const content = document.getElementById('content');
    if (!orders.length && !serviceRequests.length) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">${iconSvg('orders', 48)}</div>
                <p class="empty-state__title">Заказов пока нет</p>
                <p class="empty-state__sub">Ваши заказы появятся здесь после оформления</p>
                <a href="../../catalog.html" class="empty-state__btn">Перейти в каталог</a>
            </div>`;
        return;
    }

    // Общий список, отсортирован по дате (новые сверху) — заказы и заявки
    // на ремонт вперемешку, как попросили («в том же списке»).
    const combined = [
        ...orders.map(o => ({ type: 'order', createdAt: o.createdAt, data: o })),
        ...serviceRequests.map(r => ({ type: 'service', createdAt: r.createdAt, data: r })),
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    content.innerHTML = '';

    // Заказы по-прежнему строкой (innerHTML) — код не трогался, см.
    // orderCardHtml() ниже (1-в-1 то, что раньше было инлайн в renderOrders).
    // Оборачиваем каждую карточку по отдельности (а не весь список разом),
    // чтобы потом переставить узлы в общем порядке combined без повторного
    // парсинга HTML.
    const orderWrapper = document.createElement('div');
    const orderNodes = new Map();
    orders.forEach(o => {
        orderWrapper.innerHTML = orderCardHtml(o);
        orderNodes.set(o.id, orderWrapper.firstElementChild);
    });

    combined.forEach(entry => {
        if (entry.type === 'order') {
            content.appendChild(orderNodes.get(entry.data.id));
        } else {
            content.appendChild(buildServiceRequestCard(entry.data));
        }
    });

    attachReorderHandlers(content);
}

// o.store/address/trackingNumber/items[].name — server/routes/orders.js
// не валидирует их содержимое (только присутствие полей), поэтому в
// заказ можно отправить произвольный текст в этих полях (не только
// name/phone/comment, которых здесь даже нет) — КАЖДУЮ такую вставку в
// innerHTML пропускаем через escHtml() (аудит безопасности, находка K;
// src/shared/escHtml.js, подключён в orders.html перед этим файлом).
function orderCardHtml(o) {
        const st   = STATUS_CONFIG[o.status] || { label: o.status, cls: 'badge-new' };
        const date = new Date(o.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        });
        const itemsText  = o.items.map(i => `${escHtml(i.name)} × ${Number(i.qty) || 0}`).join(', ');
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
            <div class="order-card__store">📍 ${escHtml(o.store)}</div>
            ${o.delivery === 'russia' && o.address ? `<div class="order-card__address">📦 Пункт СДЭК: ${escHtml(o.address)}</div>` : ''}
            ${o.delivery === 'city'   && o.address ? `<div class="order-card__address">🚗 Адрес доставки: ${escHtml(o.address)}</div>` : ''}
            ${o.trackingNumber ? `<div class="order-card__tracking">🔖 Трек-номер: ${escHtml(o.trackingNumber)}</div>` : ''}
            ${trackBtn}
            <div class="order-card__total">${fmt(o.total)}</div>
            <button class="reorder-btn" data-items="${itemsData}">🔄 Заказать снова</button>
        </div>`;
}

function attachReorderHandlers(content) {
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

/* Раньше при !_tgId страница молча рендерила пустой список («Заказов
   пока нет» — тот же текст, что у покупателя, у которого правда нет
   заказов), а 401 от /api/orders/my ловился в общий catch с «Ошибка
   загрузки, попробуйте открыть страницу снова» — оба сообщения не
   объясняют, что страница вообще не может узнать, кто покупатель.
   requireUser на сервере (см. server/middleware/requireUser.js) отвечает
   401 именно тогда, когда initData отсутствуют/невалидны — то есть
   страница открыта не из Max. Оба случая — один и тот же текст. */
function renderAuthRequired() {
    document.getElementById('content').innerHTML = `
        <div class="empty-state">
            <div class="empty-state__icon">${iconSvg('alert', 48)}</div>
            <p class="empty-state__title">Доступно только в Max</p>
            <p class="empty-state__sub">Откройте магазин через бота в Max Messenger, чтобы увидеть свои заказы</p>
        </div>`;
}

/* ─── Переключатель «Акции и скидки» ─────────────────────────────────
   Независим от основной загрузки заказов/заявок ниже — сбой чтения
   статуса подписки не должен прятать уже загруженный список заказов
   (поэтому своя функция, свой try/catch, не часть Promise.all в init()). */
async function initPromoToggle() {
    const wrap = document.getElementById('promoToggleWrap');
    const input = document.getElementById('promoToggleInput');
    const hint = document.getElementById('promoToggleHint');
    if (!wrap || !input) return;
    if (hint) hint.textContent = window.PROMO_CONSENT_TEXT || '';
    try {
        const res = await authFetch('/api/promo/status');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        input.checked = !!data.subscribed;
        wrap.classList.remove('hidden');
    } catch {
        // Статус не загрузился — оставляем переключатель скрытым, а не
        // показываем его в заведомо неопределённом состоянии.
    }
}

async function handlePromoToggle(input) {
    const wantSubscribed = input.checked;
    const errorEl = document.getElementById('promoToggleError');
    if (errorEl) errorEl.classList.add('hidden');
    input.disabled = true;
    try {
        const res = wantSubscribed
            ? await authFetch('/api/promo/subscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ source: 'toggle', consentTextVersion: window.PROMO_CONSENT_VERSION }),
              })
            : await authFetch('/api/promo/unsubscribe-me', { method: 'POST' });
        if (!res.ok) throw new Error(String(res.status));
    } catch {
        input.checked = !wantSubscribed; // откат переключателя к состоянию до клика
        if (errorEl) errorEl.classList.remove('hidden');
    } finally {
        input.disabled = false;
    }
}

async function init() {
    const content = document.getElementById('content');

    if (!_tgId) {
        renderAuthRequired();
        return;
    }

    initPromoToggle();

    try {
        const [ordersRes, serviceRes] = await Promise.all([
            authFetch('/api/orders/my'),
            authFetch('/api/service-requests/my'),
        ]);
        if (ordersRes.status === 401 || serviceRes.status === 401) { renderAuthRequired(); return; }
        if (!ordersRes.ok) throw new Error(ordersRes.status);
        const orders = await ordersRes.json();
        // Заявки на ремонт — тем же списком, но их отсутствие/ошибка не
        // должна прятать уже загруженные заказы: при сбое просто ничего
        // не добавляем, не роняем всю страницу (как при !serviceRes.ok).
        const serviceRequests = serviceRes.ok ? await serviceRes.json() : [];
        renderOrders(orders, serviceRequests);
    } catch {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">${iconSvg('alert', 48)}</div>
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
    if (window.syncCartToServer) syncCartToServer(cart);

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
    updateCartBadge();
    init();
});
