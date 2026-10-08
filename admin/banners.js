/* ─── Banners admin ──────────────────────────────────────── */
let _banners = [];

/* ─── Оформление: состояние формы (текстовые блоки + фон) ──────────
   Белый список значений и их проверка — на сервере (server/routes/
   banners.js, sanitizeBannerStyle); здесь — только сбор формы и живое
   превью через общий src/shared/bannerRender.js. */
const BG_STYLE_LABELS = { brand: 'Бренд', dark: 'Тёмный', light: 'Светлый', warm: 'Тёплый', cool: 'Холодный', steel: 'Сталь', custom: 'Свой' };
const OVERLAY_LABELS  = { none: 'Нет', light: 'Лёгкое', medium: 'Среднее', strong: 'Сильное' };
const TEXT_POS_LABELS = { 'bottom-left': 'Внизу слева', 'center': 'По центру', 'top-left': 'Вверху слева' };

let _bannerFormBlocks  = []; // [{text,size,weight,italic,color,customColor,align,x,y}], максимум 4; x/y — позиция блока в % (null, если блок не перетаскивали — тогда выравнивается по text_pos)
let _bannerFormBgStyle = 'brand';
let _bannerFormBgColor = '#0E7C6B';
let _bannerFormOverlay = 'medium';
let _bannerFormTextPos = 'bottom-left';
let _emojiTargetIndex  = null;

/* ~175 эмодзи по категориям — без CDN/библиотек, статический список. */
const EMOJI_CATEGORIES = [
    { title: 'Инструменты и стройка', items: '🔧 🔨 🪛 🪚 🧰 🛠️ 🏗️ 🔩 ⚙️ 🪜 🧱 🪣 🧯 🔌 🪝 📐 📏 ✂️ 🪓 ⛏️ 🔦 💡 🧲 ⚒️ 🗜️ 🪡 🧵 🪠 🚰 🚿 🧹 🧺 🪞 🪟 🚪 🏠 🏚️ 🏢 🏭 🪵 🪨'.split(' ') },
    { title: 'Символы',               items: '✅ ❌ ⭐ 🔥 ⚡ 💯 ❗ ❓ ‼️ ⁉️ ✔️ ☑️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚪ ⚫ 🔶 🔷 🔺 🔻 💥 ✨ 🎯 🏆 🥇 🎉 🎊 📢 📣 🔔 🔕 ⏰ ⏳ 🆕 🆒 🆓 🔝'.split(' ') },
    { title: 'Жесты',                 items: '👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👋 🤝 💪 ✋ 🖐️ 🤚 👆 👇 👈 👉 ☝️ 🤙 ✊ 👊 🙏'.split(' ') },
    { title: 'Лица',                  items: '😀 😃 😄 😁 😊 🙂 😉 😍 🥰 😎 🤩 🥳 😢 😭 😡 🤔 🧐 🤗 😴 😮 😲 🙄 😏'.split(' ') },
    { title: 'Общее',                 items: '🚗 🚚 🚛 🏍️ 🚲 📦 📬 📮 💰 💵 💳 🏷️ 🛒 🛍️ 📱 ☎️ 📧 📅 🗓️ 📍 🗺️ 🌍 ☀️ 🌧️ ❄️ 🌈 🎁 🎄 🎈 ☕ 🔑 🧾 📝 ✏️ 📌 📎 🔒 🔓'.split(' ') },
];

const BANNER_LINK_LABELS = {
    none: 'Никуда', product: 'Товар', category: 'Категория',
    subcategory: 'Подкатегория', service: 'Услуга',
};

/* Список баннеров рендерится через innerHTML (как и весь остальной
   список-UI в админке) — title/subtitle здесь экранируются на вставке
   в текстовый узел, в отличие от Главной (там — textContent напрямую,
   см. src/shared/bannerRender.js). Без этого админ, сохранивший в
   заголовке что-то вроде `<img onerror=...>`, выполнил бы его у любого
   админа, открывшего список баннеров. */
function _escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
                <div class="banner-row__title">${_escHtml(b.title)}</div>
                ${b.subtitle ? `<div class="banner-row__subtitle">${_escHtml(b.subtitle)}</div>` : ''}
                <div class="banner-row__meta">${_escHtml(bannerLinkMeta(b))}</div>
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
    renderBannerPreview();
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
    renderBannerPreview();
}

function removeBannerPhoto(e) { e.stopPropagation(); clearBannerPhotoPreview(); }

/* ─── Живое превью ────────────────────────────────────────────────
   Собирает временный объект-баннер из текущего состояния формы и
   рисует его ЧЕРЕЗ ОБЩИЙ src/shared/bannerRender.js — ту же функцию,
   что рисует Главная, так что превью не может незаметно разойтись с
   тем, что увидит покупатель. scopeEl — #bannerPreview, уже вставлен в
   DOM (css-переменные читаются из .banner-preview-scope, см. admin.css). */
function currentBannerFormState() {
    return {
        title:      document.getElementById('bf-title')?.value || '',
        subtitle:   document.getElementById('bf-subtitle')?.value || '',
        imageUrl:   _bannerFormImageUrl,
        textBlocks: _bannerFormBlocks.length ? _bannerFormBlocks : null,
        bgStyle:    _bannerFormBgStyle,
        bgColor:    _bannerFormBgColor,
        overlay:    _bannerFormOverlay,
        textPos:    _bannerFormTextPos,
    };
}

function renderBannerPreview() {
    const scope = document.getElementById('bannerPreview');
    if (!scope || typeof BannerRender === 'undefined') return;
    const banner = currentBannerFormState();
    scope.innerHTML = '';
    scope.appendChild(BannerRender.buildBannerSlideElement(banner, scope, { interactive: true }));
    renderBannerBlocksWarnings(banner, scope);
    initBannerBlockDrag(scope);
    applySelectedBlockClass(scope);
    checkBannerBlockOverlap(scope);
}

/* ─── Оформление: фон / затемнение / положение ──────────────────── */
function renderBgTiles() {
    const el = document.getElementById('bgTiles');
    if (!el) return;
    const presets = ['brand', 'dark', 'light', 'warm', 'cool', 'steel'];
    el.innerHTML = presets.map(key =>
        `<div class="bg-tile bg-tile--${key} ${_bannerFormBgStyle === key ? 'bg-tile--active' : ''}" title="${BG_STYLE_LABELS[key]}" onclick="selectBgStyle('${key}')"></div>`
    ).join('') + `<div class="bg-tile bg-tile--custom ${_bannerFormBgStyle === 'custom' ? 'bg-tile--active' : ''}" onclick="selectBgStyle('custom')">Свой<br>цвет</div>`;
    document.getElementById('bgCustomRow')?.classList.toggle('hidden', _bannerFormBgStyle !== 'custom');
}

function selectBgStyle(key) {
    _bannerFormBgStyle = key;
    renderBgTiles();
    renderBannerPreview();
}

function handleBgCustomColorInput() {
    _bannerFormBgColor = document.getElementById('bf-bg-color').value;
    renderBannerPreview();
}

function renderOverlayChoices() {
    const el = document.getElementById('overlayChoices');
    if (!el) return;
    el.innerHTML = Object.keys(OVERLAY_LABELS).map(key =>
        `<button type="button" class="choice-btn ${_bannerFormOverlay === key ? 'choice-btn--active' : ''}" onclick="selectOverlay('${key}')">${OVERLAY_LABELS[key]}</button>`
    ).join('');
}
function selectOverlay(key) { _bannerFormOverlay = key; renderOverlayChoices(); renderBannerPreview(); }

function renderTextPosChoices() {
    const el = document.getElementById('textPosChoices');
    if (!el) return;
    el.innerHTML = Object.keys(TEXT_POS_LABELS).map(key =>
        `<button type="button" class="choice-btn ${_bannerFormTextPos === key ? 'choice-btn--active' : ''}" onclick="selectTextPos('${key}')">${TEXT_POS_LABELS[key]}</button>`
    ).join('');
}
function selectTextPos(key) { _bannerFormTextPos = key; renderTextPosChoices(); renderBannerPreview(); }

/* ─── Текстовые блоки (до 4) ─────────────────────────────────────── */
function newBannerBlock() {
    return { text: '', size: 'm', weight: 'regular', italic: false, color: 'auto', customColor: null, align: 'left', x: null, y: null };
}

function renderBannerBlocksEditor() {
    const el = document.getElementById('bannerBlocksList');
    if (!el) return;
    el.innerHTML = _bannerFormBlocks.map((b, i) => `
        <div class="banner-block-row" id="block-row-${i}">
            <div class="banner-block-row__top">
                <input class="ff__input banner-block-row__text" type="text" maxlength="120"
                    placeholder="Текст строки" value="${_escAttr(b.text)}"
                    oninput="updateBannerBlock(${i}, 'text', this.value)">
                <button type="button" class="banner-block-row__emoji-btn" onclick="openEmojiPicker(${i})" aria-label="Эмодзи">😀</button>
                <button type="button" class="banner-block-row__del" onclick="removeBannerBlock(${i})" aria-label="Удалить строку">✕</button>
            </div>
            <div class="banner-block-row__controls">
                <select onchange="updateBannerBlock(${i}, 'size', this.value)">
                    ${['s','m','l','xl'].map(s => `<option value="${s}" ${b.size===s?'selected':''}>${s.toUpperCase()}</option>`).join('')}
                </select>
                <button type="button" class="banner-block-row__toggle ${b.weight==='bold'?'banner-block-row__toggle--active':''}" title="Жирный" onclick="updateBannerBlock(${i}, 'weight', '${b.weight==='bold'?'regular':'bold'}')"><b>Ж</b></button>
                <button type="button" class="banner-block-row__toggle ${b.italic?'banner-block-row__toggle--active':''}" title="Курсив" onclick="updateBannerBlock(${i}, 'italic', ${!b.italic})"><i>К</i></button>
                <select onchange="updateBannerBlock(${i}, 'color', this.value)">
                    ${['auto','light','dark','accent','custom'].map(c => `<option value="${c}" ${b.color===c?'selected':''}>${c}</option>`).join('')}
                </select>
                ${b.color === 'custom' ? `<input class="banner-block-row__custom-color" type="color" value="${b.customColor || '#FFFFFF'}" oninput="updateBannerBlock(${i}, 'customColor', this.value)">` : ''}
                <select onchange="updateBannerBlock(${i}, 'align', this.value)">
                    ${['left','center','right'].map(a => `<option value="${a}" ${b.align===a?'selected':''}>${a}</option>`).join('')}
                </select>
                <div class="banner-block-row__order">
                    <button type="button" class="banner-block-row__toggle" ${i===0?'disabled':''} onclick="moveBannerBlock(${i},-1)" aria-label="Выше">▲</button>
                    <button type="button" class="banner-block-row__toggle" ${i===_bannerFormBlocks.length-1?'disabled':''} onclick="moveBannerBlock(${i},1)" aria-label="Ниже">▼</button>
                </div>
            </div>
            <div class="banner-block-row__pos">
                ${typeof b.x === 'number' && typeof b.y === 'number' ? `<span>Позиция: X ${b.x}% · Y ${b.y}%</span>` : `<span>Позиция: авто (по положению текста)</span>`}
                <button type="button" class="banner-block-row__pos-reset" ${typeof b.x !== 'number' ? 'disabled' : ''} onclick="resetBannerBlockPosition(${i})">Сбросить позицию</button>
            </div>
            <div class="banner-block-row__warning hidden" id="block-warning-${i}"></div>
        </div>
    `).join('');
    const addBtn = document.getElementById('addBlockBtn');
    if (addBtn) addBtn.disabled = _bannerFormBlocks.length >= 4;
    renderBannerPreview();
}

function addBannerBlock() {
    if (_bannerFormBlocks.length >= 4) return;
    _bannerFormBlocks.push(newBannerBlock());
    renderBannerBlocksEditor();
}

function removeBannerBlock(i) {
    _bannerFormBlocks.splice(i, 1);
    renderBannerBlocksEditor();
}

function moveBannerBlock(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= _bannerFormBlocks.length) return;
    [_bannerFormBlocks[i], _bannerFormBlocks[j]] = [_bannerFormBlocks[j], _bannerFormBlocks[i]];
    renderBannerBlocksEditor();
}

function updateBannerBlock(i, field, value) {
    if (!_bannerFormBlocks[i]) return;
    _bannerFormBlocks[i][field] = value;
    // Смена size/weight/italic/color/align/customColor может сдвинуть
    // контраст и требует перерисовать варианты (напр. поле выбора
    // своего цвета появляется только при color='custom') — полная
    // перерисовка редактора дешева (максимум 4 строки), а не точечный
    // патч одного <select>.
    if (field === 'color') { renderBannerBlocksEditor(); return; }
    if (field === 'weight' || field === 'italic') { renderBannerBlocksEditor(); return; }
    renderBannerPreview();
}

/* Предупреждение о низком контрасте — та же формула яркости, что и у
   рендера (src/shared/bannerRender.js), чтобы оценка совпадала 1-в-1
   с тем, что реально покажется на экране. */
function renderBannerBlocksWarnings(banner, scopeEl) {
    if (typeof BannerRender === 'undefined') return;
    const bgHexes = BannerRender.getBgStopHexes(banner, scopeEl);
    const bgLum = bgHexes.length
        ? bgHexes.reduce((s, h) => s + BannerRender.hexLuminance(h), 0) / bgHexes.length
        : (banner.imageUrl ? 60 : 255); // фото считаем тёмным по умолчанию (затемнение всё равно накладывается)
    (banner.textBlocks || []).forEach((block, i) => {
        const warnEl = document.getElementById(`block-warning-${i}`);
        if (!warnEl) return;
        const textHex = BannerRender.resolveBlockColorHex(block, banner, scopeEl);
        const diff = Math.abs(BannerRender.hexLuminance(textHex) - bgLum);
        if (diff < 60) {
            warnEl.textContent = '⚠ Текст и фон слишком похожи по яркости — на экране будет плохо видно';
            warnEl.classList.remove('hidden');
        } else {
            warnEl.classList.add('hidden');
        }
    });
}

/* ─── Текстовые блоки: перетаскивание на превью (мышь/палец) ────────────
   x/y блока — % от баннера (0–100, левый верхний угол блока), необязательные
   поля text_blocks (см. server/routes/banners.js: sanitizeTextBlock). Блок
   без x/y остаётся в обычном потоке (text_pos), как раньше — ничего не
   ломается у уже сохранённых баннеров (ТЗ, п.7).
   Pointer Events — один код для мыши и пальца; touch-action:none стоит
   ТОЛЬКО на самом блоке (.banner-slide__block[data-block-index] в
   admin.css), не на всём превью — скролл страницы на телефоне не блокируется
   нигде, кроме как при реальном хватании блока (п.4 ТЗ). */
const DRAG_MARGIN_PCT = 4; // безопасные поля от краёв баннера — показались разумным балансом между "не прилипает к самому краю" и "не отъедает слишком много места на маленьком баннере"
let _selectedBlockIndex = null;
let _dragState  = null; // { index, el, slide, pointerId, startClientX, startClientY, startLeftPx, startTopPx, moved }
let _dragHintEl = null;

function round1(n) { return Math.round(n * 10) / 10; }

function initBannerBlockDrag(scope) {
    const slide = scope.querySelector('.banner-slide');
    if (!slide) return;
    slide.querySelectorAll('[data-block-index]').forEach(el => {
        el.addEventListener('pointerdown', onBannerBlockPointerDown);
        el.addEventListener('keydown', onBannerBlockKeyDown);
    });
}

function onBannerBlockPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return; // только левая кнопка/касание
    const el = e.currentTarget;
    const index = +el.dataset.blockIndex;
    const slide = el.closest('.banner-slide');
    if (!slide) return;

    selectBannerBlock(index, { focus: true });

    const slideRect = slide.getBoundingClientRect();
    const blockRect = el.getBoundingClientRect();
    _dragState = {
        index, el, slide,
        pointerId: e.pointerId,
        startClientX: e.clientX, startClientY: e.clientY,
        startLeftPx: blockRect.left - slideRect.left,
        startTopPx:  blockRect.top  - slideRect.top,
        // Ширина/высота баннера на момент начала жеста — переиспользуются
        // на pointerup вместо повторного getBoundingClientRect() (см. lastLeftPx
        // ниже): на некоторых кадрах, прямо на границе смены position:static→
        // absolute у блока с container-relative (cqw) шрифтом, повторный замер
        // геометрии ловил «призрачный» layout (высота блока временно в разы
        // больше настоящей) — координата получалась в разы смещена. Баннер
        // сам не меняет размер во время перетаскивания одного блока, поэтому
        // переиспользовать исходные значения безопасно и даёт стабильный результат.
        slideWidthPx:  slideRect.width,
        slideHeightPx: slideRect.height,
        lastLeftPx: blockRect.left - slideRect.left,
        lastTopPx:  blockRect.top  - slideRect.top,
        moved: false,
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener('pointermove', onBannerBlockPointerMove);
    el.addEventListener('pointerup', onBannerBlockPointerUp);
    el.addEventListener('pointercancel', onBannerBlockPointerUp);
    e.preventDefault();
}

function onBannerBlockPointerMove(e) {
    if (!_dragState || e.pointerId !== _dragState.pointerId) return;
    const { el, slide, startClientX, startClientY, startLeftPx, startTopPx } = _dragState;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    if (!_dragState.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return; // порог — не путать клик с микро-дрожанием пальца
    _dragState.moved = true;

    const slideRect = slide.getBoundingClientRect();
    const blockRect = el.getBoundingClientRect();
    const marginXPx = slideRect.width  * DRAG_MARGIN_PCT / 100;
    const marginYPx = slideRect.height * DRAG_MARGIN_PCT / 100;

    let left = startLeftPx + dx;
    let top  = startTopPx  + dy;
    left = Math.max(marginXPx, Math.min(left, Math.max(marginXPx, slideRect.width  - marginXPx - blockRect.width)));
    top  = Math.max(marginYPx, Math.min(top,  Math.max(marginYPx, slideRect.height - marginYPx - blockRect.height)));

    el.classList.add('banner-slide__block--positioned', 'banner-slide__block--dragging');
    el.style.position = 'absolute';
    el.style.left = `${left}px`;
    el.style.top  = `${top}px`;
    _dragState.lastLeftPx = left;
    _dragState.lastTopPx  = top;

    updateBannerDragHint(slide, left, top, slideRect);
}

function onBannerBlockPointerUp(e) {
    if (!_dragState || e.pointerId !== _dragState.pointerId) return;
    const { el, index, moved, lastLeftPx, lastTopPx, slideWidthPx, slideHeightPx } = _dragState;
    el.removeEventListener('pointermove', onBannerBlockPointerMove);
    el.removeEventListener('pointerup', onBannerBlockPointerUp);
    el.removeEventListener('pointercancel', onBannerBlockPointerUp);
    el.classList.remove('banner-slide__block--dragging');
    removeBannerDragHint();

    if (moved && _bannerFormBlocks[index]) {
        // Намеренно НЕ перечитываем geometry через getBoundingClientRect() здесь
        // ещё раз — берём px, уже посчитанные и применённые в последнем
        // pointermove (см. его комментарий про «призрачный» layout-кадр).
        _bannerFormBlocks[index].x = round1(lastLeftPx / slideWidthPx  * 100);
        _bannerFormBlocks[index].y = round1(lastTopPx  / slideHeightPx * 100);
        renderBannerBlocksEditor(); // перерисует превью+редактор, пересчитает предупреждения/наложение
    }
    _dragState = null;
}

function updateBannerDragHint(slide, leftPx, topPx, slideRect) {
    if (!_dragHintEl) {
        _dragHintEl = document.createElement('div');
        _dragHintEl.className = 'banner-drag-hint';
        slide.appendChild(_dragHintEl);
    }
    const xPct = round1(leftPx / slideRect.width  * 100);
    const yPct = round1(topPx  / slideRect.height * 100);
    _dragHintEl.textContent = `X ${xPct}% · Y ${yPct}%`;
    _dragHintEl.style.left = `${leftPx}px`;
    _dragHintEl.style.top  = `${topPx > 22 ? topPx - 20 : topPx + 4}px`;
}

function removeBannerDragHint() {
    if (_dragHintEl) { _dragHintEl.remove(); _dragHintEl = null; }
}

/* Стрелки клавиатуры двигают выделенный блок на 1% (Shift — на 5%, ТЗ п.6).
   Реагирует, только когда фокус реально на самом блоке (tabindex=0, см.
   bannerRender.js) — не перехватывает стрелки, когда админ печатает в
   текстовом поле или где-либо ещё. */
function onBannerBlockKeyDown(e) {
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = ARROWS[e.key];
    if (!delta) return;
    e.preventDefault();

    const el = e.currentTarget;
    const index = +el.dataset.blockIndex;
    const block = _bannerFormBlocks[index];
    const slide = el.closest('.banner-slide');
    if (!block || !slide) return;

    const step = e.shiftKey ? 5 : 1;
    const slideRect = slide.getBoundingClientRect();
    const blockRect = el.getBoundingClientRect();

    // Если блок ещё ни разу не двигали (x/y нет) — берём его ТЕКУЩУЮ
    // отрисованную позицию (по text_pos) как стартовую, чтобы первое
    // нажатие стрелки сдвигало от места, где блок реально виден, а не
    // «телепортировало» его откуда-то с нуля.
    const curX = typeof block.x === 'number' ? block.x : round1((blockRect.left - slideRect.left) / slideRect.width  * 100);
    const curY = typeof block.y === 'number' ? block.y : round1((blockRect.top  - slideRect.top)  / slideRect.height * 100);

    const blockWPct = blockRect.width  / slideRect.width  * 100;
    const blockHPct = blockRect.height / slideRect.height * 100;
    const maxX = Math.max(DRAG_MARGIN_PCT, 100 - DRAG_MARGIN_PCT - blockWPct);
    const maxY = Math.max(DRAG_MARGIN_PCT, 100 - DRAG_MARGIN_PCT - blockHPct);

    block.x = round1(Math.max(DRAG_MARGIN_PCT, Math.min(curX + delta[0] * step, maxX)));
    block.y = round1(Math.max(DRAG_MARGIN_PCT, Math.min(curY + delta[1] * step, maxY)));

    renderBannerBlocksEditor();
    const scope = document.getElementById('bannerPreview');
    const newEl = scope && scope.querySelector(`[data-block-index="${index}"]`);
    if (newEl) newEl.focus({ preventScroll: true }); // перерисовка уничтожает старый узел — фокус нужно вернуть явно
}

/* Клик/тап по блоку без реального перетаскивания (см. moved в
   onBannerBlockPointerUp) — просто выделение, чтобы стрелками на
   клавиатуре двигать именно его. focus:true — только из настоящего
   пользовательского жеста (pointerdown/клавиатура), НИКОГДА из обычной
   перерисовки превью (иначе фокус воровался бы у текстового поля при
   каждом нажатии клавиши во время ввода текста блока). */
function selectBannerBlock(index, opts) {
    _selectedBlockIndex = index;
    const scope = document.getElementById('bannerPreview');
    if (!scope) return;
    applySelectedBlockClass(scope);
    if (opts && opts.focus) {
        const el = scope.querySelector(`[data-block-index="${index}"]`);
        if (el) el.focus({ preventScroll: true });
    }
}

function applySelectedBlockClass(scope) {
    scope.querySelectorAll('.banner-slide__block--selected').forEach(el => el.classList.remove('banner-slide__block--selected'));
    if (_selectedBlockIndex == null) return;
    const el = scope.querySelector(`[data-block-index="${_selectedBlockIndex}"]`);
    if (el) el.classList.add('banner-slide__block--selected');
}

/* Кнопка «Сбросить позицию» у блока (ТЗ п.6) — убирает x/y, блок
   возвращается в обычный поток и выравнивается по text_pos, как раньше. */
function resetBannerBlockPosition(i) {
    if (!_bannerFormBlocks[i]) return;
    _bannerFormBlocks[i].x = null;
    _bannerFormBlocks[i].y = null;
    if (_selectedBlockIndex === i) _selectedBlockIndex = null;
    renderBannerBlocksEditor();
}

/* Предупреждение о наложении блоков (ТЗ п.5) — не блокирует сохранение,
   просто текст рядом с превью. Сравнивает реальные отрисованные
   прямоугольники всех блоков (и позиционированных, и обычных) попарно —
   общий случай, без допущений о том, кто где должен быть. */
function checkBannerBlockOverlap(scope) {
    const warnEl = document.getElementById('bannerOverlapWarning');
    if (!warnEl) return;
    const blocks = [...scope.querySelectorAll('[data-block-index]')];
    let overlap = false;
    outer:
    for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i].getBoundingClientRect();
            const b = blocks[j].getBoundingClientRect();
            if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
                overlap = true;
                break outer;
            }
        }
    }
    warnEl.classList.toggle('hidden', !overlap);
}

/* ─── Эмодзи ──────────────────────────────────────────────────────── */
function renderEmojiPickerBody() {
    const el = document.getElementById('emojiPickerBody');
    if (!el) return;
    el.innerHTML = EMOJI_CATEGORIES.map(cat => `
        <div class="emoji-category-title">${cat.title}</div>
        <div class="emoji-grid">${cat.items.map(e => `<button type="button" onclick="insertEmoji('${e}')">${e}</button>`).join('')}</div>
    `).join('');
}

function openEmojiPicker(blockIndex) {
    _emojiTargetIndex = blockIndex;
    renderEmojiPickerBody();
    document.getElementById('emojiPickerOverlay').classList.remove('hidden');
}

function closeEmojiPicker() {
    document.getElementById('emojiPickerOverlay').classList.add('hidden');
    _emojiTargetIndex = null;
}

function handleEmojiOverlayClick(e) {
    if (e.target === document.getElementById('emojiPickerOverlay')) closeEmojiPicker();
}

/* Вставка в позицию курсора активного поля (setRangeText — стандартный
   DOM-метод, без contenteditable и сторонних библиотек). */
function insertEmoji(emoji) {
    if (_emojiTargetIndex === null) return;
    const input = document.querySelector(`#block-row-${_emojiTargetIndex} .banner-block-row__text`);
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end   = input.selectionEnd ?? input.value.length;
    input.setRangeText(emoji, start, end, 'end');
    input.focus();
    updateBannerBlock(_emojiTargetIndex, 'text', input.value.slice(0, 120));
    renderBannerPreview();
}

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

    // Оформление: текстовые блоки + фон/затемнение/положение
    _bannerFormBlocks  = b && b.textBlocks ? b.textBlocks.map(x => ({ ...x })) : [];
    _bannerFormBgStyle = b ? (b.bgStyle || 'brand') : 'brand';
    _bannerFormBgColor = (b && b.bgColor) || '#0E7C6B';
    _bannerFormOverlay = b ? (b.overlay || 'medium') : 'medium';
    _bannerFormTextPos = b ? (b.textPos || 'bottom-left') : 'bottom-left';
    document.getElementById('bf-bg-color').value = _bannerFormBgColor;
    renderBgTiles();
    renderOverlayChoices();
    renderTextPosChoices();
    renderBannerBlocksEditor(); // сам вызовет renderBannerPreview()

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
        title:      b.title,
        subtitle:   b.subtitle || null,
        imageUrl:   b.imageUrl || null,
        linkType:   b.linkType || 'none',
        linkId:     b.linkType && b.linkType !== 'none' ? (b.linkId ?? null) : null,
        isActive:   b.isActive !== false,
        startsAt:   b.startsAt || null,
        endsAt:     b.endsAt   || null,
        textBlocks: b.textBlocks && b.textBlocks.length ? b.textBlocks : null,
        bgStyle:    b.bgStyle || 'brand',
        bgColor:    b.bgColor || null,
        overlay:    b.overlay || 'medium',
        textPos:    b.textPos || 'bottom-left',
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
        textBlocks: _bannerFormBlocks,
        bgStyle:    _bannerFormBgStyle,
        bgColor:    _bannerFormBgColor,
        overlay:    _bannerFormOverlay,
        textPos:    _bannerFormTextPos,
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
