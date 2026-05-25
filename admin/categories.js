/* ─── Global cache (shared with admin.js) ─────────────────
   Declared here because categories.js loads first.           */
let _categories    = [];
let _subcategories = [];

/* ─── Sync readers from cache ───────────────────────────── */
function loadCategories()    { return _categories; }
function loadSubcategories() { return _subcategories; }

/* ─── Expanded state ────────────────────────────────────── */
const expandedCats = new Set();

function toggleCat(id) {
    if (expandedCats.has(id)) expandedCats.delete(id);
    else expandedCats.add(id);
    renderCategories();
}

/* ─── Render category list ──────────────────────────────── */
function renderCategories() {
    const cats  = _categories;
    const subs  = _subcategories;
    const prods = _products || [];
    const el    = document.getElementById('catList');
    if (!el) return;

    if (!cats.length) {
        el.innerHTML = `<div class="empty-state">
            <div class="empty-state__icon">🗂️</div>
            <p class="empty-state__title">Нет категорий</p>
            <p class="empty-state__sub">Добавьте первую категорию кнопкой ниже</p>
        </div>`;
        return;
    }

    el.innerHTML = cats.map(cat => {
        const catSubs  = subs.filter(s => s.categoryId === cat.id);
        const catProds = prods.filter(p => p.categoryId === cat.id);
        const isOpen   = expandedCats.has(cat.id);
        const metaText = `${catProds.length} тов. · ${catSubs.length} подкат.`;

        const subsHtml = isOpen ? `
        <div class="subcategory-list">
            ${catSubs.length ? catSubs.map(sub => {
                const subCount = prods.filter(p => p.subId === sub.id).length;
                return `
                <div class="subcat-item">
                    <span class="subcat-name">${sub.name} <span style="color:var(--gray);font-size:12px;">(${subCount})</span></span>
                    <div class="subcat-actions">
                        <button class="action-btn action-btn--edit" onclick="openSubcategoryForm(${sub.id},${cat.id})" aria-label="Редактировать">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="action-btn action-btn--delete" onclick="confirmDeleteSubcategory(${sub.id})" aria-label="Удалить">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                </div>`;
            }).join('') : `<p class="subcat-empty">Нет подкатегорий</p>`}
            <button class="add-sub-btn" onclick="openSubcategoryForm(null,${cat.id})">+ Добавить подкатегорию</button>
        </div>` : '';

        return `
        <div class="category-card" id="cat-card-${cat.id}">
            <div class="category-card__header" onclick="toggleCat(${cat.id})">
                <div class="cat-dot cat-bg-${cat.color}"></div>
                <span class="cat-icon">${cat.icon}</span>
                <div class="cat-info">
                    <span class="cat-name">${cat.name}</span>
                    <span class="cat-meta">${metaText}</span>
                </div>
                <div class="cat-row-actions" onclick="event.stopPropagation()">
                    <button class="action-btn action-btn--edit" onclick="openCategoryForm(${cat.id})" aria-label="Редактировать">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn action-btn--delete" onclick="confirmDeleteCategory(${cat.id})" aria-label="Удалить">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <polyline points="3,6 5,6 21,6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                            <path d="M9 6V4h6v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <svg class="cat-chevron ${isOpen ? 'cat-chevron--open' : ''}" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </div>
            ${subsHtml}
        </div>`;
    }).join('');
}

/* ─── Category form ─────────────────────────────────────── */
let _catFormEditId = null;
let _catFormColor  = 1;

function openCategoryForm(id = null) {
    _catFormEditId = id;
    if (id) {
        const cat = _categories.find(c => c.id === id);
        if (!cat) return;
        document.getElementById('cf-name').value = cat.name;
        document.getElementById('cf-icon').value = cat.icon;
        document.getElementById('catIconPreview').textContent = cat.icon;
        selectSwatch(cat.color);
    } else {
        document.getElementById('cf-name').value = '';
        document.getElementById('cf-icon').value = '';
        document.getElementById('catIconPreview').textContent = '?';
        selectSwatch(1);
    }
    document.getElementById('catFormTitle').textContent = id ? 'Редактировать категорию' : 'Новая категория';
    document.getElementById('catFormOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
        const body = document.getElementById('catFormOverlay').querySelector('.sheet__body');
        if (body) body.scrollTop = 0;
    });
}

function closeCategoryForm() {
    document.getElementById('catFormOverlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleCatFormOverlayClick(e) {
    if (e.target === document.getElementById('catFormOverlay')) closeCategoryForm();
}

function selectSwatch(n) {
    _catFormColor = n;
    document.querySelectorAll('.color-swatch').forEach(sw => {
        sw.classList.toggle('color-swatch--active', +sw.dataset.color === n);
    });
}

function handleIconInput() {
    const val = document.getElementById('cf-icon').value;
    document.getElementById('catIconPreview').textContent = val || '?';
}

async function saveCategoryForm() {
    const name = document.getElementById('cf-name').value.trim();
    const icon = document.getElementById('cf-icon').value.trim() || '📦';
    if (!name) { document.getElementById('cf-name').focus(); return; }

    try {
        if (_catFormEditId) {
            await apiAdmin(`/api/categories/${_catFormEditId}`, 'PUT', { name, icon, color: _catFormColor });
        } else {
            await apiAdmin('/api/categories', 'POST', { name, icon, color: _catFormColor });
        }
        await refreshData();
        closeCategoryForm();
        renderCategories();
        if (typeof renderFilters === 'function') renderFilters();
        showToast(_catFormEditId ? '✓ Категория обновлена' : '✓ Категория добавлена');
    } catch (e) {
        showToast('Ошибка сохранения категории');
    }
}

/* ─── Delete category ───────────────────────────────────── */
function confirmDeleteCategory(id) {
    const cat   = _categories.find(c => c.id === id);
    if (!cat) return;
    const subs  = _subcategories.filter(s => s.categoryId === id);
    const prods = (_products || []).filter(p => p.categoryId === id);
    const warnText = (prods.length || subs.length)
        ? `Будут удалены: ${prods.length} тов. и ${subs.length} подкат.`
        : `«${cat.name}»`;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Удалить категорию?</p>
            <p class="dialog__sub">${warnText}</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="_doDeleteCategory(${id})">Удалить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="this.closest('.dialog-overlay').remove()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function _doDeleteCategory(id) {
    document.querySelector('.dialog-overlay')?.remove();
    try {
        await apiAdmin(`/api/categories/${id}`, 'DELETE');
        await refreshData();
        renderCategories();
        if (typeof render === 'function') render();
        showToast('Категория удалена');
    } catch (e) {
        showToast('Ошибка удаления');
    }
}

/* ─── Subcategory form ──────────────────────────────────── */
let _subFormEditId = null;
let _subFormCatId  = null;

function openSubcategoryForm(id = null, categoryId) {
    _subFormEditId = id;
    _subFormCatId  = categoryId;

    const cat = _categories.find(c => c.id === categoryId);
    document.getElementById('subFormCatName').textContent = cat ? cat.name : '';
    document.getElementById('subFormTitle').textContent   = id ? 'Редактировать подкатегорию' : 'Новая подкатегория';

    if (id) {
        const sub = _subcategories.find(s => s.id === id);
        document.getElementById('sf-name').value = sub ? sub.name : '';
    } else {
        document.getElementById('sf-name').value = '';
    }

    document.getElementById('subFormOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => document.getElementById('sf-name').focus());
}

function closeSubcategoryForm() {
    document.getElementById('subFormOverlay').classList.add('hidden');
    document.body.style.overflow = '';
}

function handleSubFormOverlayClick(e) {
    if (e.target === document.getElementById('subFormOverlay')) closeSubcategoryForm();
}

async function saveSubcategoryForm() {
    const name = document.getElementById('sf-name').value.trim();
    if (!name) { document.getElementById('sf-name').focus(); return; }

    try {
        if (_subFormEditId) {
            await apiAdmin(`/api/subcategories/${_subFormEditId}`, 'PUT', { name });
        } else {
            await apiAdmin('/api/subcategories', 'POST', { categoryId: _subFormCatId, name });
        }
        await refreshData();
        closeSubcategoryForm();
        renderCategories();
        showToast(_subFormEditId ? '✓ Подкатегория обновлена' : '✓ Подкатегория добавлена');
    } catch (e) {
        showToast('Ошибка сохранения подкатегории');
    }
}

/* ─── Delete subcategory ────────────────────────────────── */
function confirmDeleteSubcategory(id) {
    const sub   = _subcategories.find(s => s.id === id);
    if (!sub) return;
    const count = (_products || []).filter(p => p.subId === id).length;
    const warnText = count
        ? `Используется в ${count} тов., они останутся без подкатегории`
        : `«${sub.name}»`;

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
        <div class="dialog">
            <p class="dialog__title">Удалить подкатегорию?</p>
            <p class="dialog__sub">${warnText}</p>
            <div class="dialog__actions">
                <button class="dialog__btn dialog__btn--danger" onclick="_doDeleteSubcategory(${id})">Удалить</button>
                <button class="dialog__btn dialog__btn--cancel" onclick="this.closest('.dialog-overlay').remove()">Отмена</button>
            </div>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function _doDeleteSubcategory(id) {
    document.querySelector('.dialog-overlay')?.remove();
    try {
        await apiAdmin(`/api/subcategories/${id}`, 'DELETE');
        await refreshData();
        renderCategories();
        if (typeof render === 'function') render();
        showToast('Подкатегория удалена');
    } catch (e) {
        showToast('Ошибка удаления');
    }
}
