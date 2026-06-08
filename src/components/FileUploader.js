/* ─── FileUploader: загрузка XLSX-файлов в seller-cabinet (admin) ───
   Рендерит пять секций загрузки + таблицу истории.
   Зависит от глобальных apiAdmin()/getToken()/showToast() из admin.js. */

const UPLOAD_SECTIONS = [
    {
        key:         'competitors',
        endpoint:    '/api/uploads/competitors',
        title:       'Конкуренты Ozon',
        description: 'Файл из раздела Аналитика → Товары на Ozon. Обновлять еженедельно.',
    },
    {
        key:         'cost-price',
        endpoint:    '/api/uploads/cost-price',
        title:       'Себестоимость товаров',
        description: 'Файл себестоимостей из Ozon Seller. Обновлять при изменении закупочных цен.',
    },
    {
        key:         'transactions',
        endpoint:    '/api/uploads/transactions',
        title:       'Начисления',
        description: 'Финансовые начисления по каждому аккаунту. Загружай по одному файлу.',
    },
    {
        key:         'unit-economics',
        endpoint:    '/api/uploads/unit-economics',
        title:       'Юнит-экономика',
        description: 'Юнит-экономика из Ozon Seller. Загружай по одному файлу на аккаунт.',
    },
    {
        key:         'financial',
        endpoint:    '/api/uploads/financial',
        title:       'Финансовые отчёты',
        description: 'Финансовые отчёты из Точка банка.',
    },
    {
        key:         'products',
        endpoint:    '/api/uploads/products',
        title:       'Товары по аккаунтам',
        description: 'Файлы товаров из Ozon Seller. Загружай по одному файлу на аккаунт: товары_БМ, товары_FIX, товары_Деталькин.',
    },
    {
        key:         'category',
        endpoint:    '/api/uploads/category',
        title:       'Категория и объём рынка',
        description: 'Файл из раздела Аналитика → Что продавать на Ozon → категория пистолетов за 28 дней. Обновлять еженедельно вместе с конкурентами.',
    },
];

const STATUS_LABELS = {
    success: 'Успешно',
    error:   'Ошибка',
};

function fmtUploadDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/* ─── Разметка ───────────────────────────────────────────── */
function renderFileUploader() {
    const root = document.getElementById('sectionUploads');
    if (!root) return;

    root.innerHTML = `
        <div class="uploader-list">
            ${UPLOAD_SECTIONS.map(renderSection).join('')}
        </div>
        <div class="uploader-history">
            <div class="uploader-history__header">
                <h3 class="uploader-history__title">История загрузок</h3>
                <button type="button" class="uploader-btn uploader-btn--danger" id="clearAllUploadsBtn">Очистить все загрузки</button>
            </div>
            <div class="uploader-history__table" id="uploadHistoryTable">
                <div class="uploader-history__row uploader-history__row--head">
                    <span>Дата</span>
                    <span>Тип файла</span>
                    <span>Имя файла</span>
                    <span>Строк</span>
                    <span>Статус</span>
                </div>
            </div>
        </div>
    `;

    UPLOAD_SECTIONS.forEach(section => {
        const input = document.getElementById(`uploadInput-${section.key}`);
        if (input) input.addEventListener('change', () => handleUpload(section, input));
    });

    const clearBtn = document.getElementById('clearAllUploadsBtn');
    if (clearBtn) clearBtn.addEventListener('click', handleClearAllUploads);

    refreshUploadHistory();
}

/* ─── Очистка всех загруженных данных ────────────────────── */
async function handleClearAllUploads() {
    if (!confirm('Удалить все загруженные данные (конкуренты, себестоимость, начисления, юнит-экономика, финансовые отчёты и историю загрузок)? Действие необратимо.')) return;

    const btn = document.getElementById('clearAllUploadsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Очистка…'; }

    try {
        const res = await fetch('/api/uploads/clear-all', {
            method:  'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || 'Не удалось очистить данные');

        if (typeof showToast === 'function') showToast('✅ Все загруженные данные удалены');
        UPLOAD_SECTIONS.forEach(section => {
            const resultEl = document.getElementById(`uploaderResult-${section.key}`);
            if (resultEl) resultEl.innerHTML = '';
        });
        refreshUploadHistory();
    } catch (err) {
        if (typeof showToast === 'function') showToast(`❌ ${err.message || 'Ошибка очистки данных'}`);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Очистить все загрузки'; }
    }
}

function renderSection(section) {
    return `
        <div class="uploader-card" id="uploaderCard-${section.key}">
            <div class="uploader-card__header">
                <h3 class="uploader-card__title">${section.title}</h3>
                <p class="uploader-card__desc">${section.description}</p>
            </div>
            <div class="uploader-card__body">
                <label class="uploader-btn" for="uploadInput-${section.key}">
                    Выбрать файл
                    <input type="file" id="uploadInput-${section.key}" accept=".xlsx,.xls" hidden>
                </label>
                <div class="uploader-result" id="uploaderResult-${section.key}"></div>
            </div>
        </div>
    `;
}

/* ─── Загрузка файла ─────────────────────────────────────── */
async function handleUpload(section, input) {
    const file = input.files[0];
    if (!file) return;

    const resultEl = document.getElementById(`uploaderResult-${section.key}`);
    resultEl.innerHTML = `<span class="uploader-result__pending">⏳ Загрузка…</span>`;

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch(section.endpoint, {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` },
            body:    formData,
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Не удалось обработать файл');
        }

        resultEl.innerHTML = `
            <span class="uploader-result__ok">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Загружено ${data.rows_imported} строк
            </span>`;

        if (typeof showToast === 'function') showToast(`✅ ${section.title}: загружено ${data.rows_imported} строк`);
        refreshUploadHistory();
    } catch (err) {
        resultEl.innerHTML = `<span class="uploader-result__error">${(err.message || 'Ошибка загрузки файла')}</span>`;
    } finally {
        input.value = '';
    }
}

/* ─── История загрузок ───────────────────────────────────── */
async function refreshUploadHistory() {
    const table = document.getElementById('uploadHistoryTable');
    if (!table) return;

    try {
        const rows = await apiAdmin('/api/uploads/history');
        const head = `
            <div class="uploader-history__row uploader-history__row--head">
                <span>Дата</span>
                <span>Тип файла</span>
                <span>Имя файла</span>
                <span>Строк</span>
                <span>Статус</span>
            </div>`;

        if (!rows || !rows.length) {
            table.innerHTML = head + `<div class="uploader-history__empty">Загрузок пока не было</div>`;
            return;
        }

        table.innerHTML = head + rows.map(r => `
            <div class="uploader-history__row">
                <span>${fmtUploadDate(r.uploaded_at)}</span>
                <span>${r.file_type}</span>
                <span class="uploader-history__filename" title="${r.filename || ''}">${r.filename || '—'}</span>
                <span>${r.rows_imported ?? 0}</span>
                <span class="uploader-history__status uploader-history__status--${r.status}">
                    ${STATUS_LABELS[r.status] || r.status}
                </span>
            </div>
        `).join('');
    } catch (e) {
        table.innerHTML = `<div class="uploader-history__empty">Не удалось загрузить историю</div>`;
    }
}
