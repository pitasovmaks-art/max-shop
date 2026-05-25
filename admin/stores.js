/* ─── Stores admin ───────────────────────────────────────── */
let _stores    = [];
let _storeEdit = null;

async function loadStores() {
    const data = await apiAdmin('/api/stores');
    _stores = data || [];
}

/* ─── Render stores list ─────────────────────────────────── */
function renderStores() {
    const el = document.getElementById('storesList');
    if (!el) return;

    if (!_stores.length) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">🏪</div>
                <p class="empty-state__title">Нет магазинов</p>
                <p class="empty-state__sub">Добавьте первый магазин кнопкой ниже</p>
            </div>`;
        return;
    }

    el.innerHTML = _stores.map(s => `
        <div class="store-row">
            <div class="store-row__info">
                <div class="store-row__name">${s.name}</div>
                <div class="store-row__addr">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z" stroke="currentColor" stroke-width="2"/>
                        <circle cx="12" cy="10" r="3" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    ${s.city}, ${s.address}
                </div>
                ${s.hours ? `<div class="store-row__hours">🕐 ${s.hours}</div>` : ''}
                ${s.phone ? `<div class="store-row__hours">📞 ${s.phone}</div>` : ''}
            </div>
            <div class="product-row__actions">
                <button class="action-btn action-btn--edit" onclick="openStoreForm(${s.id})" aria-label="Редактировать">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="action-btn action-btn--delete" onclick="confirmStoreDelete(${s.id})" aria-label="Удалить">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

/* ─── Form open / close ──────────────────────────────────── */
function openStoreForm(id = null) {
    _storeEdit = id;
    const overlay = document.getElementById('storeFormOverlay');
    document.getElementById('storeFormTitle').textContent = id ? 'Редактировать магазин' : 'Новый магазин';
    if (id) {
        const s = _stores.find(s => s.id === id);
        if (s) fillStoreForm(s);
    } else {
        clearStoreForm();
    }
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        const body = overlay.querySelector('.sheet__body');
        if (body) body.scrollTop = 0;
    });
}

function closeStoreForm() {
    document.getElementById('storeFormOverlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleStoreFormOverlayClick(e) {
    if (e.target === document.getElementById('storeFormOverlay')) closeStoreForm();
}

function fillStoreForm(s) {
    sv('sf-name',       s.name);
    sv('sf-city',       s.city);
    sv('sf-address',    s.address);
    sv('sf-hours',      s.hours);
    sv('sf-phone',      s.phone);
    sv('sf-directions', s.directions);
    sv('sf-sort',       s.sortOrder);
    document.querySelectorAll('.sff--error').forEach(el => el.classList.remove('sff--error'));
    document.querySelectorAll('.sff__error').forEach(el => el.textContent = '');
}

function clearStoreForm() {
    ['sf-name','sf-city','sf-address','sf-hours','sf-phone','sf-directions','sf-sort'].forEach(id => sv(id, ''));
    document.querySelectorAll('.sff--error').forEach(el => el.classList.remove('sff--error'));
    document.querySelectorAll('.sff__error').forEach(el => el.textContent = '');
}

function sv(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }

/* ─── Validation ─────────────────────────────────────────── */
function clearSFE(ffId) {
    const el = document.getElementById(ffId);
    if (!el) return;
    el.classList.remove('sff--error');
    const err = el.querySelector('.sff__error');
    if (err) err.textContent = '';
}

function setSFE(ffId, msg) {
    const el = document.getElementById(ffId);
    if (!el) return;
    el.classList.add('sff--error');
    const err = el.querySelector('.sff__error');
    if (err) err.textContent = msg;
}

function validateStoreForm() {
    let ok = true;
    if (!document.getElementById('sf-name').value.trim())    { setSFE('sff-name',    'Введите название');  ok = false; }
    if (!document.getElementById('sf-city').value.trim())    { setSFE('sff-city',    'Введите город');     ok = false; }
    if (!document.getElementById('sf-address').value.trim()) { setSFE('sff-address', 'Введите адрес');     ok = false; }
    return ok;
}

/* ─── Save ───────────────────────────────────────────────── */
async function saveStoreForm() {
    if (!validateStoreForm()) return;

    const payload = {
        name:       document.getElementById('sf-name').value.trim(),
        city:       document.getElementById('sf-city').value.trim(),
        address:    document.getElementById('sf-address').value.trim(),
        hours:      document.getElementById('sf-hours').value.trim(),
        phone:      document.getElementById('sf-phone').value.trim(),
        directions: document.getElementById('sf-directions').value.trim(),
        sortOrder:  parseInt(document.getElementById('sf-sort').value) || 0,
    };

    const btn = document.querySelector('#storeFormOverlay .save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем...'; }

    try {
        if (_storeEdit) {
            await apiAdmin(`/api/stores/${_storeEdit}`, 'PUT', payload);
        } else {
            await apiAdmin('/api/stores', 'POST', payload);
        }
        await loadStores();
        renderStores();
        closeStoreForm();
        showToast(_storeEdit ? '✓ Магазин обновлён' : '✓ Магазин добавлен');
    } catch {
        showToast('Ошибка сохранения магазина');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
    }
}

/* ─── Delete ─────────────────────────────────────────────── */
function confirmStoreDelete(id) {
    const s = _stores.find(s => s.id === id);
    if (!s) return;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.id = 'storeDeleteOverlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Удалить магазин?</p>
            <p class="dialog__sub">«${s.name}»</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="deleteStore(${id})">Удалить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="closeStoreDeleteDialog()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeStoreDeleteDialog(); });
    document.body.appendChild(overlay);
}

function closeStoreDeleteDialog() {
    document.getElementById('storeDeleteOverlay')?.remove();
}

async function deleteStore(id) {
    try {
        await apiAdmin(`/api/stores/${id}`, 'DELETE');
        await loadStores();
        closeStoreDeleteDialog();
        renderStores();
        showToast('Магазин удалён');
    } catch {
        showToast('Ошибка удаления');
    }
}
