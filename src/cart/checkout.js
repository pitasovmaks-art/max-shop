/* ─── Stores ────────────────────────────────────────────── */
let _stores = [];

async function loadAndRenderStores() {
    try {
        _stores = await fetch('/api/stores').then(r => r.json());
    } catch {
        _stores = [];
    }
    renderStoreList();
}

const PIN_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/>
    <circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/>
</svg>`;

const CHECK_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <polyline points="20,6 9,17 4,12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function renderStoreList() {
    const list = document.getElementById('storeList');
    if (!list) return;

    if (!_stores.length) {
        list.innerHTML = '<p style="padding:16px;color:#6B7280;font-size:14px">Нет доступных магазинов</p>';
        return;
    }

    list.innerHTML = _stores.map((s, i) => `
        <label class="store-card" for="store-${s.id}">
            <input class="store-radio" type="radio" name="store" id="store-${s.id}" value="${s.id}" ${i === 0 ? 'checked' : ''}>
            <div class="store-card__content">
                <div class="store-card__city">${PIN_SVG}${escHtml(s.city)}</div>
                <div class="store-card__address">${escHtml(s.address)}</div>
                ${s.hours      ? `<div class="store-card__hours">${escHtml(s.hours)}</div>` : ''}
                ${s.phone      ? `<div class="store-card__hours">📞 ${escHtml(s.phone)}</div>` : ''}
                ${s.directions ? `<div class="store-card__directions">${escHtml(s.directions)}</div>` : ''}
            </div>
            <div class="store-card__check">${CHECK_SVG}</div>
        </label>
    `).join('');

    initStoreCards();
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ─── Cart ──────────────────────────────────────────────── */
function getCart() {
    try {
        const cart = JSON.parse(localStorage.getItem('cart') || '[]');
        return cart.map(i => ({ ...i, key: i.key || String(i.id) }));
    }
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
            <span class="order-item__name">
                ${item.name}${item.variantLabel ? `<span class="order-item__variant"> · ${item.variantLabel}</span>` : ''}
            </span>
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

function getSelectedStoreObj() {
    const id = getSelectedStore();
    return _stores.find(s => String(s.id) === String(id)) || null;
}

/* ─── Phone mask ────────────────────────────────────────── */
function formatPhoneDigits(input, raw) {
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
}

function handlePhone(input) {
    const digits = input.value.replace(/\D/g, '');
    if (!digits) { input.value = ''; return; }
    formatPhoneDigits(input, digits);
    clearError('fieldPhone');
}

function handlePhoneKeydown(input, e) {
    if (e.key !== 'Backspace') return;
    e.preventDefault();
    const digits = input.value.replace(/\D/g, '');
    if (digits.length <= 1) {
        input.value = '';
        clearError('fieldPhone');
        return;
    }
    formatPhoneDigits(input, digits.slice(0, -1));
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

    if (!document.getElementById('consentCheck')?.checked) {
        document.getElementById('consentWrap')?.classList.add('consent-wrap--error');
        document.getElementById('consentError')?.classList.remove('hidden');
        ok = false;
    }

    return ok;
}

/* ─── Consent checkbox ──────────────────────────────────── */
function handleConsentChange() {
    const checked = document.getElementById('consentCheck').checked;
    const btn     = document.getElementById('submitBtn');
    const wrap    = document.getElementById('consentWrap');
    const err     = document.getElementById('consentError');

    if (checked) {
        btn.disabled = false;
        btn.classList.remove('submit-btn--disabled');
        wrap?.classList.remove('consent-wrap--error');
        err?.classList.add('hidden');
    } else {
        btn.disabled = true;
        btn.classList.add('submit-btn--disabled');
    }
}

/* ─── Submit ────────────────────────────────────────────── */
async function submitOrder() {
    if (!validate()) return;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Оформляем...';

    const storeId  = getSelectedStore();
    const store    = _stores.find(s => String(s.id) === String(storeId));
    const cart     = getCart();
    const total    = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const phone    = document.getElementById('inputPhone').value;
    const name     = document.getElementById('inputName').value.trim();
    const comment  = (document.getElementById('inputComment')?.value || '').trim();

    if (!store) {
        btn.disabled = false;
        btn.classList.remove('submit-btn--disabled');
        btn.textContent = 'Подтвердить заказ';
        alert('Выберите магазин для самовывоза');
        return;
    }

    try {
        const r = await fetch('/api/orders', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                phone,
                store: `${store.city}, ${store.address}`,
                comment: comment || undefined,
                items:   cart.map(i => ({
                    id:    i.id,
                    name:  i.name + (i.variantLabel ? ` (${i.variantLabel})` : ''),
                    price: i.price,
                    qty:   i.qty,
                })),
                total,
            }),
        });

        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();

        document.getElementById('successOrder').textContent = `Заказ #${data.id}`;
        document.getElementById('successStore').textContent = `${store.city}, ${store.address}`;
        document.getElementById('successScreen').classList.remove('hidden');

        localStorage.removeItem('cart');
    } catch (e) {
        console.error('Order error:', e);
        btn.disabled = false;
        btn.classList.remove('submit-btn--disabled');
        btn.textContent = 'Подтвердить заказ';
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
    loadAndRenderStores();
});
