/* ─── Stores & delivery ─────────────────────────────────── */
let _stores = [];
let _deliveryMethod = 'pickup'; // 'pickup' | 'city' | 'russia'
let _selectedCdekAddress = '';

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

function isStoreOpen(hours) {
    if (!hours) return false;
    const m = hours.match(/^([А-Яа-я]+)[–\-]([А-Яа-я]+)\s+(\d{1,2}):(\d{2})[–\-](\d{1,2}):(\d{2})/);
    if (!m) return false;
    const DAY = { 'Пн': 1, 'Вт': 2, 'Ср': 3, 'Чт': 4, 'Пт': 5, 'Сб': 6, 'Вс': 0 };
    const dayFrom = DAY[m[1]], dayTo = DAY[m[2]];
    if (dayFrom === undefined || dayTo === undefined) return false;
    const fromMin = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    const toMin   = parseInt(m[5], 10) * 60 + parseInt(m[6], 10);
    // Moscow time (UTC+3)
    const now = new Date();
    const msk = new Date(now.getTime() + (now.getTimezoneOffset() + 180) * 60000);
    const day = msk.getDay();
    const cur = msk.getHours() * 60 + msk.getMinutes();
    const inDay = dayFrom <= dayTo ? (day >= dayFrom && day <= dayTo) : (day >= dayFrom || day <= dayTo);
    return inDay && cur >= fromMin && cur < toMin;
}

function renderStoreList() {
    const list = document.getElementById('storeList');
    if (!list) return;

    const cityCode = localStorage.getItem('city');
    const filtered = _stores.filter(s => {
        if (cityCode === 'krd') return s.city === 'Краснодар';
        if (cityCode === 'msk') return s.city === 'Москва';
        return true;
    });

    if (!filtered.length) {
        list.innerHTML = '<p style="padding:16px;color:rgba(255,255,255,0.5);font-size:14px">Нет доступных магазинов</p>';
        return;
    }

    list.innerHTML = filtered.map((s, i) => {
        const open = s.hours ? isStoreOpen(s.hours) : null;
        const badge = open !== null
            ? `<span style="font-size:11px;font-weight:600;color:${open ? '#22c55e' : '#ef4444'}">${open ? '🟢 Открыто' : '🔴 Закрыто'}</span>`
            : '';
        return `
        <label class="store-card" for="store-${s.id}">
            <input class="store-radio" type="radio" name="store" id="store-${s.id}" value="${s.id}" ${i === 0 ? 'checked' : ''}>
            <div class="store-card__content">
                <div class="store-card__city">${PIN_SVG}${escHtml(s.city)}</div>
                <div class="store-card__address">${escHtml(s.address)}</div>
                ${s.hours      ? `<div class="store-card__hours">${escHtml(s.hours)} ${badge}</div>` : ''}
                ${s.phone      ? `<div class="store-card__hours">📞 ${escHtml(s.phone)}</div>` : ''}
                ${s.directions ? `<div class="store-card__directions">${escHtml(s.directions)}</div>` : ''}
            </div>
            <div class="store-card__check">${CHECK_SVG}</div>
        </label>`;
    }).join('');

    initStoreCards();
}

/* ─── Price change modal ────────────────────────────────── */
function showPriceChangeModal(prevMethod) {
    const cart    = getCart();
    const changes = cart.filter(item => {
        const prev    = _itemPriceFor(item, prevMethod);
        const newPr   = _itemPriceFor(item, 'russia');
        return newPr > 0 && newPr !== prev;
    });

    if (!changes.length) { applyDelivery('russia'); return; }

    const list = document.getElementById('priceChangeList');
    if (list) {
        list.innerHTML = changes.map(item => {
            const prev  = _itemPriceFor(item, prevMethod);
            const newPr = _itemPriceFor(item, 'russia');
            const name  = item.name + (item.variantLabel ? ` · ${item.variantLabel}` : '');
            return `<div class="pchange-row">
                <span class="pchange-name">${name}</span>
                <span class="pchange-prices">${fmtStrike(prev)} → <b>${newPr.toLocaleString('ru-RU')} ₽</b></span>
            </div>`;
        }).join('');
    }

    document.getElementById('priceChangeModal')?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    document.getElementById('priceChangeConfirm')?.addEventListener('click', () => {
        closePriceModal();
        applyDelivery('russia');
    }, { once: true });

    document.getElementById('priceChangeCancel')?.addEventListener('click', () => {
        closePriceModal();
        applyDelivery(prevMethod);
    }, { once: true });
}

function closePriceModal() {
    document.getElementById('priceChangeModal')?.classList.add('hidden');
    document.body.style.overflow = '';
}

function _itemPriceFor(item, method) {
    const city = localStorage.getItem('city');
    if (method === 'russia') return item.priceMskDelivery || item.priceDelivery || item.price;
    if (city === 'krd') return item.priceKrdPickup || item.priceKrd || item.price;
    return item.priceMskPickup || item.priceMsk || item.price;
}

/* ─── Delivery method ───────────────────────────────────── */
function setDelivery(method) {
    if (method === 'russia' && _deliveryMethod !== 'russia') {
        showPriceChangeModal(_deliveryMethod);
        return;
    }
    applyDelivery(method);
}

function applyDelivery(method) {
    _deliveryMethod = method;

    ['pickup', 'city', 'russia'].forEach(m => {
        document.getElementById(`tab-${m}`)?.classList.toggle('delivery-tab--active', m === method);
        const sec = document.getElementById(`delivery-${m}`);
        if (sec) sec.classList.toggle('hidden', m !== method);
    });

    if (method === 'russia') loadCdekOfficesForCurrentCity();

    renderSummary();
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

function fmtStrike(price) { return `<s style="opacity:.55">${price.toLocaleString('ru-RU')} ₽</s>`; }

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
    return `${n} ${many}`;
}

/* ─── Render order summary ──────────────────────────────── */
function itemPrice(item) {
    const city = localStorage.getItem('city');
    if (_deliveryMethod === 'russia') return item.priceMskDelivery || item.priceDelivery || item.price;
    if (city === 'krd') return item.priceKrdPickup || item.priceKrd || item.price;
    return item.priceMskPickup || item.priceMsk || item.price;
}

function renderSummary() {
    const cart     = getCart();
    const totalQty = cart.reduce((s, i) => s + i.qty, 0);
    const total    = cart.reduce((s, i) => s + itemPrice(i) * i.qty, 0);

    document.getElementById('orderItems').innerHTML = cart.map(item => `
        <div class="order-item">
            <span class="order-item__name">
                ${item.name}${item.variantLabel ? `<span class="order-item__variant"> · ${item.variantLabel}</span>` : ''}
            </span>
            <span class="order-item__qty">× ${item.qty}</span>
            <span class="order-item__price">${fmt(itemPrice(item) * item.qty)}</span>
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

    if (_deliveryMethod === 'city') {
        const addr = document.getElementById('inputAddress').value.trim();
        if (!addr) { showError('fieldAddress', 'Введите адрес доставки'); ok = false; }
    }
    if (_deliveryMethod === 'russia') {
        if (!_selectedCdekAddress) {
            const err = document.getElementById('cdekError');
            if (err) err.classList.remove('hidden');
            ok = false;
        }
    }

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

    const cart    = getCart();
    const total   = cart.reduce((s, i) => s + itemPrice(i) * i.qty, 0);
    const phone   = document.getElementById('inputPhone').value;
    const name    = document.getElementById('inputName').value.trim();
    const comment = (document.getElementById('inputComment')?.value || '').trim();
    const city    = localStorage.getItem('city') || undefined;
    const tgId    = new URLSearchParams(location.search).get('tg_id') || undefined;

    let storeLabel = '';
    let address    = '';

    if (_deliveryMethod === 'pickup') {
        const storeId = getSelectedStore();
        const store   = _stores.find(s => String(s.id) === String(storeId));
        if (!store) {
            btn.disabled = false;
            btn.classList.remove('submit-btn--disabled');
            btn.textContent = 'Подтвердить заказ';
            alert('Выберите магазин для самовывоза');
            return;
        }
        storeLabel = `${store.city}, ${store.address}`;
    } else if (_deliveryMethod === 'city') {
        address    = document.getElementById('inputAddress').value.trim();
        storeLabel = city === 'krd' ? 'Краснодар' : city === 'msk' ? 'Москва' : 'Доставка по городу';
    } else {
        address    = _selectedCdekAddress;
        storeLabel = 'Доставка по России';
    }

    try {
        const r = await fetch('/api/orders', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                phone,
                store:    storeLabel,
                delivery: _deliveryMethod,
                address:  address || undefined,
                city:     city    || undefined,
                tgId:     tgId     || undefined,
                comment:  comment || undefined,
                items: cart.map(i => ({
                    id:    i.id,
                    name:  i.name + (i.variantLabel ? ` (${i.variantLabel})` : ''),
                    price: itemPrice(i),
                    qty:   i.qty,
                })),
                total,
            }),
        });

        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();

        document.getElementById('successOrder').textContent = `Заказ #${data.id}`;

        const DELIVERY_LABELS = { pickup: 'Магазин самовывоза', city: 'Адрес доставки', russia: 'Адрес доставки' };
        const DELIVERY_ICONS  = { pickup: '🏪', city: '🚗', russia: '📦' };
        document.getElementById('successIcon2').textContent  = DELIVERY_ICONS[_deliveryMethod];
        document.getElementById('successLabel').textContent  = DELIVERY_LABELS[_deliveryMethod];
        document.getElementById('successStore').textContent  = _deliveryMethod === 'pickup' ? storeLabel : address;

        if (_deliveryMethod === 'pickup') {
            document.getElementById('successNote').textContent = 'Мы перезвоним для подтверждения заказа и уточним время, когда товар будет готов к выдаче';
        } else {
            document.getElementById('successNote').textContent = 'Мы перезвоним для подтверждения заказа и уточнения деталей доставки';
        }

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

/* ─── CDEK office search ────────────────────────────────── */
let _cdekOffices     = [];
let _cdekOfficeQuery = '';

async function loadCdekOfficesForCurrentCity() {
    const cityName = localStorage.getItem('cityName')
        || (localStorage.getItem('city') === 'krd' ? 'Краснодар' : 'Москва');
    await fetchCdekOffices(cityName);
}

async function fetchCdekOffices(cityName) {
    const list = document.getElementById('cdekOfficesList');
    if (!list) return;
    list.innerHTML = '<div class="cdek-loading">Загружаем отделения...</div>';
    try {
        const r = await fetch(`/api/cdek/offices?city=${encodeURIComponent(cityName)}`);
        if (!r.ok) throw new Error(r.status);
        _cdekOffices = await r.json();
        _cdekOfficeQuery = '';
        _selectedCdekAddress = '';
        renderCdekOffices();
    } catch {
        list.innerHTML = '<div class="cdek-loading cdek-error">Не удалось загрузить отделения. Введите адрес вручную.</div>';
    }
}

function handleCdekOfficeSearch(val) {
    _cdekOfficeQuery = val.toLowerCase();
    renderCdekOffices();
}

function renderCdekOffices() {
    const list = document.getElementById('cdekOfficesList');
    if (!list) return;
    const filtered = _cdekOfficeQuery
        ? _cdekOffices.filter(o =>
            (o.name + o.address).toLowerCase().includes(_cdekOfficeQuery))
        : _cdekOffices;

    if (!filtered.length) {
        list.innerHTML = '<div class="cdek-loading">Отделения не найдены</div>';
        return;
    }
    list.innerHTML = filtered.map(o => {
        const data = JSON.stringify(o).replace(/"/g, '&quot;');
        const isSelected = _selectedCdekAddress === `СДЭК: ${o.name}, ${o.address}`;
        return `<button class="cdek-office-item${isSelected ? ' cdek-office-item--selected' : ''}" onclick="selectCdekOffice(${data},this)">
            <div class="cdek-office-name">${o.name}</div>
            <div class="cdek-office-addr">${o.address}</div>
            ${o.work_time ? `<div class="cdek-office-hours">${o.work_time}</div>` : ''}
        </button>`;
    }).join('');
}

function selectCdekOffice(office, btn) {
    _selectedCdekAddress = `СДЭК: ${office.name}, ${office.address}`;
    document.querySelectorAll('.cdek-office-item').forEach(el => el.classList.remove('cdek-office-item--selected'));
    if (btn) btn.classList.add('cdek-office-item--selected');
    const err = document.getElementById('cdekError');
    if (err) err.classList.add('hidden');
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
