/* ─── Banners admin ──────────────────────────────────────── */
let _banners = [];

const BANNER_LINK_LABELS = {
    none: 'Никуда', product: 'Товар', category: 'Категория',
    subcategory: 'Подкатегория', service: 'Услуга',
};

function bannerLinkMeta(b) {
    if (!b.linkType || b.linkType === 'none') return 'Никуда не ведёт';
    const label = BANNER_LINK_LABELS[b.linkType] || b.linkType;
    let name = '';
    if (b.linkType === 'category') {
        name = (_categories.find(c => c.id === b.linkId) || {}).name;
    } else if (b.linkType === 'subcategory') {
        const sub = _subcategories.find(s => s.id === b.linkId);
        if (sub) name = `${catById(sub.categoryId).name} → ${sub.name}`;
    } else if (b.linkType === 'product' || b.linkType === 'service') {
        name = (_products.find(p => p.id === b.linkId) || {}).name;
    }
    return name ? `${label}: ${name}` : `${label} (id ${b.linkId} не найден)`;
}

/* ─── Render list ────────────────────────────────────────── */
function renderBanners() {
    const el = document.getElementById('bannersList');
    if (!el) return;

    if (!_banners.length) {
        el.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">🖼️</div>
                <p class="empty-state__title">Нет баннеров</p>
                <p class="empty-state__sub">Добавьте первый баннер кнопкой ниже — пока на Главной показываются нейтральные плашки по умолчанию</p>
            </div>`;
        return;
    }

    const sorted = [..._banners].sort((a, b) => a.sortOrder - b.sortOrder);

    el.innerHTML = sorted.map((b, i) => `
        <div class="banner-row">
            ${b.imageUrl
                ? `<img class="banner-row__thumb" src="${b.imageUrl}" alt="">`
                : `<div class="banner-row__thumb banner-row__thumb--placeholder">🖼️</div>`}
            <div class="banner-row__info">
                <div class="banner-row__title">${b.title}</div>
                ${b.subtitle ? `<div class="banner-row__subtitle">${b.subtitle}</div>` : ''}
                <div class="banner-row__meta">${bannerLinkMeta(b)}</div>
            </div>
            <div class="banner-row__order">
                <button class="banner-order-btn" onclick="moveBannerUp(${b.id})" ${i === 0 ? 'disabled' : ''} aria-label="Выше">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
                <button class="banner-order-btn" onclick="moveBannerDown(${b.id})" ${i === sorted.length - 1 ? 'disabled' : ''} aria-label="Ниже">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            </div>
            <label class="toggle" title="Показывать">
                <input type="checkbox" ${b.isActive ? 'checked' : ''} onchange="toggleBannerActive(${b.id})">
                <span class="toggle__slider"></span>
            </label>
            <div class="banner-row__actions">
                <button class="action-btn action-btn--edit" onclick="openBannerForm(${b.id})" aria-label="Редактировать">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button class="action-btn action-btn--delete" onclick="confirmDeleteBanner(${b.id})" aria-label="Удалить">
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

/* ─── Instant toggle (как quickToggleStock у товаров) ───────── */
async function toggleBannerActive(id) {
    const b = _banners.find(x => x.id === id);
    if (!b) return;
    const newActive = !b.isActive;
    try {
        const updated = await apiAdmin(`/api/banners/${id}`, 'PUT', bannerPayload({ ...b, isActive: newActive }));
        const idx = _banners.findIndex(x => x.id === id);
        if (idx !== -1) _banners[idx] = updated;
        renderBanners();
        showToast(newActive ? '✓ Баннер показывается' : '✓ Баннер скрыт');
    } catch (e) {
        showToast('Ошибка: ' + e.message);
    }
}

/* ─── Reorder: кнопки вверх/вниз меняют местами соседей в
   локальном массиве и шлют весь новый порядок одним запросом
   (PUT /api/banners/reorder, { order: [...ids] }). ─────────── */
async function _swapBannerOrder(id, direction) {
    const sorted = [..._banners].sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex(b => b.id === id);
    const swapWith = idx + direction;
    if (idx === -1 || swapWith < 0 || swapWith >= sorted.length) return;
    [sorted[idx], sorted[swapWith]] = [sorted[swapWith], sorted[idx]];
    const order = sorted.map(b => b.id);
    try {
        await apiAdmin('/api/banners/reorder', 'PUT', { order });
        await loadBanners();
        renderBanners();
    } catch (e) {
        showToast('Ошибка изменения порядка: ' + e.message);
    }
}
function moveBannerUp(id)   { _swapBannerOrder(id, -1); }
function moveBannerDown(id) { _swapBannerOrder(id, 1); }

/* ─── Load ───────────────────────────────────────────────── */
async function loadBanners() {
    const data = await apiAdmin('/api/banners/all');
    _banners = data || [];
}

/* ─── Form: link type -> target picker ──────────────────── */
function handleBannerLinkTypeChange() {
    const type = document.getElementById('bf-link-type').value;
    const wrap = document.getElementById('ff-bf-link-target');
    if (type === 'none') { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    populateBannerLinkTargetOptions(type);
}

function populateBannerLinkTargetOptions(type, selectedId) {
    const select = document.getElementById('bf-link-target');
    let options = [];
    if (type === 'category') {
        options = _categories.map(c => ({ value: c.id, label: c.name }));
    } else if (type === 'subcategory') {
        options = _subcategories.map(s => ({ value: s.id, label: `${catById(s.categoryId).name} → ${s.name}` }));
    } else if (type === 'product') {
        options = _products.filter(p => !p.isService).map(p => ({ value: p.id, label: p.name }));
    } else if (type === 'service') {
        options = _products.filter(p => p.isService).map(p => ({ value: p.id, label: p.name }));
    }
    select.innerHTML = '<option value="">— выберите —</option>'
        + options.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    if (selectedId != null) select.value = String(selectedId);
}

/* ─── Form: photo upload (копия паттерна handlePhotoSelect у
   товаров, только на /api/banners/upload) ──────────────────── */
let _bannerFormImageUrl = null;

function triggerBannerPhotoInput() { document.getElementById('bannerPhotoInput').click(); }

async function handleBannerPhotoSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const area = document.getElementById('bannerPhotoUpload');
    if (area) { area.style.opacity = '0.5'; area.style.pointerEvents = 'none'; }

    try {
        const formData = new FormData();
        formData.append('file', file);
        const res  = await fetch('/api/banners/upload', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body:    formData,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Upload failed');
        setBannerPhotoPreview(data.url);
    } catch (err) {
        showToast('Ошибка загрузки фото: ' + err.message);
    } finally {
        if (area) { area.style.opacity = ''; area.style.pointerEvents = ''; }
    }
}

function setBannerPhotoPreview(url) {
    _bannerFormImageUrl = url;
    document.getElementById('bannerPhotoPreview').src = url;
    document.getElementById('bannerPhotoPreview').classList.remove('hidden');
    document.getElementById('bannerPhotoPlaceholder').classList.add('hidden');
    document.getElementById('bannerPhotoRemove').classList.remove('hidden');
    document.getElementById('bannerPhotoUpload').classList.add('photo-upload--filled');
}

function clearBannerPhotoPreview() {
    _bannerFormImageUrl = null;
    const preview = document.getElementById('bannerPhotoPreview');
    if (!preview) return;
    preview.src = '';
    preview.classList.add('hidden');
    document.getElementById('bannerPhotoPlaceholder').classList.remove('hidden');
    document.getElementById('bannerPhotoRemove').classList.add('hidden');
    document.getElementById('bannerPhotoUpload').classList.remove('photo-upload--filled');
}

function removeBannerPhoto(e) { e.stopPropagation(); clearBannerPhotoPreview(); }

/* ─── Form: open / close / save ─────────────────────────── */
let _bannerFormEditId = null;

function openBannerForm(id = null) {
    _bannerFormEditId = id;
    document.getElementById('bannerFormTitle').textContent = id ? 'Редактировать баннер' : 'Новый баннер';

    const b = id ? _banners.find(x => x.id === id) : null;

    document.getElementById('bf-title').value    = b ? b.title    : '';
    document.getElementById('bf-subtitle').value = b ? (b.subtitle || '') : '';
    document.getElementById('bf-link-type').value = b ? b.linkType : 'none';
    document.getElementById('bf-starts').value   = b && b.startsAt ? b.startsAt.slice(0, 10) : '';
    document.getElementById('bf-ends').value     = b && b.endsAt   ? b.endsAt.slice(0, 10)   : '';

    handleBannerLinkTypeChange();
    if (b && b.linkType && b.linkType !== 'none') populateBannerLinkTargetOptions(b.linkType, b.linkId);

    if (b && b.imageUrl) setBannerPhotoPreview(b.imageUrl);
    else clearBannerPhotoPreview();

    document.getElementById('bannerFormOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeBannerForm() {
    document.getElementById('bannerFormOverlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleBannerFormOverlayClick(e) {
    if (e.target === document.getElementById('bannerFormOverlay')) closeBannerForm();
}

function bannerPayload(b) {
    return {
        title:    b.title,
        subtitle: b.subtitle || null,
        imageUrl: b.imageUrl || null,
        linkType: b.linkType || 'none',
        linkId:   b.linkType && b.linkType !== 'none' ? (b.linkId ?? null) : null,
        isActive: b.isActive !== false,
        startsAt: b.startsAt || null,
        endsAt:   b.endsAt   || null,
    };
}

async function saveBannerForm() {
    const title = document.getElementById('bf-title').value.trim();
    if (!title) { document.getElementById('bf-title').focus(); return; }

    const linkType = document.getElementById('bf-link-type').value;
    const linkTargetRaw = document.getElementById('bf-link-target').value;

    const payload = bannerPayload({
        title,
        subtitle: document.getElementById('bf-subtitle').value.trim(),
        imageUrl: _bannerFormImageUrl,
        linkType,
        linkId:   linkTargetRaw ? +linkTargetRaw : null,
        isActive: _bannerFormEditId ? _banners.find(b => b.id === _bannerFormEditId)?.isActive : true,
        startsAt: document.getElementById('bf-starts').value || null,
        endsAt:   document.getElementById('bf-ends').value   || null,
    });

    try {
        if (_bannerFormEditId) {
            await apiAdmin(`/api/banners/${_bannerFormEditId}`, 'PUT', payload);
        } else {
            await apiAdmin('/api/banners', 'POST', payload);
        }
        await loadBanners();
        closeBannerForm();
        renderBanners();
        showToast(_bannerFormEditId ? '✓ Баннер обновлён' : '✓ Баннер добавлен');
    } catch (e) {
        showToast('Ошибка сохранения баннера: ' + e.message);
    }
}

/* ─── Delete ─────────────────────────────────────────────── */
function confirmDeleteBanner(id) {
    const b = _banners.find(x => x.id === id);
    if (!b) return;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Удалить баннер?</p>
            <p class="dialog__sub">«${b.title}»</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="_doDeleteBanner(${id})">Удалить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="this.closest('.dialog-overlay').remove()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function _doDeleteBanner(id) {
    document.querySelector('.dialog-overlay')?.remove();
    try {
        await apiAdmin(`/api/banners/${id}`, 'DELETE');
        await loadBanners();
        renderBanners();
        showToast('Баннер удалён');
    } catch (e) {
        showToast('Ошибка удаления: ' + e.message);
    }
}
