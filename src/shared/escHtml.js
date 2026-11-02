/* ─── Экранирование HTML для вставки пользовательских данных в строковые
   шаблоны (innerHTML) ────────────────────────────────────────────────
   Аудит безопасности (находка B/K, ~/security-audit.md): имя, телефон,
   адрес, комментарий покупателя и названия позиций заказа подставлялись
   в innerHTML без экранирования — в admin/admin.js (список заказов в
   админке, самое опасное место: выполнился бы в сессии администратора)
   и в src/orders/orders.js (self-XSS в «Мои заказы»).

   Раньше своя копия escHtml() была только в src/cart/checkout.js —
   вынесена сюда, чтобы не плодить копии и чтобы её же использовали
   admin/admin.js и src/orders/orders.js. Подключать отдельным
   <script src="…/shared/escHtml.js">, ПЕРЕД файлом, который её
   использует (обычный скрипт, не ES-модуль — как и весь остальной
   фронтенд в этом проекте).

   Там, где значение целиком не является доверенным (имя, телефон,
   адрес, комментарий, название позиции заказа), оборачивать КАЖДУЮ
   такую вставку в escHtml(...), а не только "подозрительные" случаи —
   это тот же принцип, что уже описан в admin/serviceRequests.js. */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Only network/relative image URLs; callers must still escape the HTML attribute.
function safeImageUrl(value) {
    if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f<>"']/.test(value)) return '';
    try {
        const url = new URL(value, 'https://shop.invalid/');
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : '';
    } catch { return ''; }
}
