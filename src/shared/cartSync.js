/* Синхронизация корзины с сервером (usd-pricing, см. PROGRESS.md) — нужна
   только для уведомлений о смене цены при смене курса доллара (товар
   price_seen на сервере). Сама корзина остаётся localStorage-only, цены
   в ней НЕ пересчитываются (так и задумано) — эта функция просто
   отправляет серверу текущий снимок состава корзины.

   Вызывается рядом с КАЖДЫМ местом, где корзина пишется в localStorage
   (catalog.js, product.js, favorites.js, orders.js "Повторить заказ",
   cart.js, checkout.js после оформления заказа) — одна функция вместо
   шести копий. Требует authFetch.js (подписанная initData, requireUser
   на сервере) — подключается на тех же страницах.

   Fire-and-forget: ошибка синхронизации не должна мешать работе с
   корзиной на клиенте. */
function syncCartToServer(cart) {
    try {
        const city = localStorage.getItem('city') || '';
        const items = (cart || []).map(i => ({
            productId:    i.id,
            variantLabel: i.variantLabel || '',
            qty:          i.qty,
        }));
        authFetch('/api/cart-sync', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ items, city }),
        }).catch(() => {});
    } catch (e) { /* не блокируем работу с корзиной из-за ошибки синка */ }
}

window.syncCartToServer = syncCartToServer;
