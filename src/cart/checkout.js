/* ─── Stores ────────────────────────────────────────────── */
const STORES = {
    krd1: { city: 'Краснодар', address: 'ул. Селезнева, 4/10' },
    krd2: { city: 'Краснодар', address: 'ул. Котлярова, 21' },
    msk1: { city: 'Москва',    address: 'Аллея Первой Маевки, 15 стр3' },
};

/* ─── Cart ──────────────────────────────────────────────── */
function getCart() {
    try { return JSON.parse(localStorage.getItem('cart') || '[]'); }
    catch { return []; }
}

/* ─── Format ────────────────────────────────────────────── */
function fmt(price) { return price.toLocaleString('ru-RU') + ' ₽'; }

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ─── Render order summary ──────────────────────────────── */
function renderSummary() {
    const cart       = getCart();
    const total      = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const totalQty   = cart.reduce((s, i) => s + i.qty, 0);

    document.getElementById('orderItems').innerHTML = cart.map(item => `
        <div class="order-item">
            <span class="order-item__name">${item.name}</span>
            <span class="order-item__qty">× ${item.qty}</span>
            <span class="order-item__price">${fmt(item.price * item.qty)}</span>
        </div>
    `).join('');

    document.getElementById('totalLabel').textContent = plural(totalQty, 'товар', 'товара', 'товаров');
    document.getElementById('totalPrice').textContent  = fmt(total);
    document.getElementById('footerPrice').textContent = fmt(total);
}

/* ─── Store selection ───────────────────────────────────── */
function initStoreCards() {
    const labels = document.querySelectorAll('.store-card');
    labels.forEach(label => {
        const radio = label.querySelector('.store-radio');
        if (radio.checked) label.classList.add('store-card--selected');
        label.addEventListener('click', () => {
            labels.forEach(l => l.classList.remove('store-card--selected'));
            label.classList.add('store-card--selected');
        });
    });
}

function getSelectedStore() {
    const radio = document.querySelector('.store-radio:checked');
    return radio ? radio.value : null;
}

/* ─── Phone mask ────────────────────────────────────────── */
function handlePhone(input) {
    const raw = input.value.replace(/\D/g, '');
    let digits = raw;
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (!digits.startsWith('7')) digits = '7' + digits;
    digits = digits.slice(0, 11);

    let result = '+7';
    if (digits.length > 1)  result += ' (' + digits.slice(1, 4);
    if (digits.length >= 4)  result += ') ' + digits.slice(4, 7);
    if (digits.length >= 7)  result += '-' + digits.slice(7, 9);
    if (digits.length >= 9)  result += '-' + digits.slice(9, 11);

    input.value = result;
    clearError('fieldPhone');
}

function getDigits(phone) { return phone.replace(/\D/g, ''); }

/* ─── Validation ────────────────────────────────────────── */
function showError(fieldId, msg) {
    const field = document.getElementById(fieldId);
    field.classList.add('field--error');
    field.querySelector('.field__error').textContent = msg;
}

function clearError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.classList.remove('field--error');
    field.querySelector('.field__error').textContent = '';
}

function validate() {
    let ok = true;
    const name = document.getElementById('inputName').value.trim();
    if (!name) { showError('fieldName', 'Введите ваше имя'); ok = false; }
    else if (name.length < 2) { showError('fieldName', 'Слишком короткое имя'); ok = false; }

    const phone = document.getElementById('inputPhone').value;
    if (!phone) { showError('fieldPhone', 'Введите номер телефона'); ok = false; }
    else if (getDigits(phone).length < 11) { showError('fieldPhone', 'Введите полный номер телефона'); ok = false; }

    return ok;
}

/* ─── Submit ────────────────────────────────────────────── */
async function submitOrder() {
    if (!validate()) return;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Оформляем...';

    const storeKey = getSelectedStore();
    const store    = STORES[storeKey];
    const cart     = getCart();
    const total    = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const phone    = document.getElementById('inputPhone').value;
    const name     = document.getElementById('inputName').value.trim();
    const comment  = (document.getElementById('inputComment')?.value || '').trim();

    try {
        const r = await fetch('/api/orders', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                phone,
                store: `${store.city}, ${store.address}`,
                comment: comment || undefined,
                items:   cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
                total,
            }),
        });

        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();

        document.getElementById('successOrder').textContent = `Заказ #${data.id}`;
        document.getElementById('successStore').textContent = `${store.city}, ${store.address}`;
        document.getElementById('successPhone').textContent = phone;
        document.getElementById('successScreen').classList.remove('hidden');

        localStorage.removeItem('cart');
    } catch (e) {
        console.error('Order error:', e);
        btn.disabled = false;
        btn.textContent = 'Оформить заказ';
        alert('Ошибка при оформлении заказа. Попробуйте ещё раз.');
    }
}

/* ─── Redirect if cart empty ────────────────────────────── */
function checkCart() {
    if (!getCart().length) location.href = 'index.html';
}

/* ─── Init ──────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    checkCart();
    renderSummary();
    initStoreCards();
});
