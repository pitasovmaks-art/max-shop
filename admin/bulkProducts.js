const BULK_COLUMNS = [
    ['name', 'Название'], ['category', 'Категория'], ['subcategory', 'Подкатегория'],
    ['brand', 'Бренд'], ['article', 'Артикул'], ['desc', 'Описание'],
    ['variantLabel', 'Вариант'], ['priceKrdPickup', 'Цена КРД'], ['priceMskPickup', 'Цена МСК'],
    ['priceMskDelivery', 'Цена доставка'], ['priceKrdPickupUsd', 'Цена КРД $'],
    ['priceMskPickupUsd', 'Цена МСК $'], ['deliverySurchargeRub', 'Наценка доставка ₽'],
    ['salePriceUsd', 'Скидка $'], ['inStock', 'Наличие (0/1)'], ['isDefault', 'По умолчанию (0/1)'],
];
let bulkPreview = null;
let bulkBusy = false;

function initBulkProducts() {
    const header = document.getElementById('bulkHeaders');
    if (header.children.length) return;
    for (const label of ['Строка', ...BULK_COLUMNS.map(([, label]) => label), 'Действие']) {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = label;
        header.append(th);
    }
    document.getElementById('bulkRows').addEventListener('input', () => {
        numberBulkRows();
        invalidateBulkPreview();
    });
    document.getElementById('bulkPaste').addEventListener('input', invalidateBulkPreview);
    addBulkRow();
}

function invalidateBulkPreview() {
    bulkPreview = null;
    document.getElementById('bulkApply').classList.add('hidden');
    document.getElementById('bulkStatus').textContent = '';
    document.getElementById('bulkDetails').replaceChildren();
}

function numberBulkRows() {
    let number = 2;
    for (const row of document.getElementById('bulkRows').rows) {
        const filled = Array.from(row.querySelectorAll('[data-field]')).some(field => field.value.trim());
        row.cells[0].textContent = filled ? number++ : '—';
    }
}

function addBulkRow(values = {}, deferUpdate = false) {
    const body = document.getElementById('bulkRows');
    const row = body.insertRow();
    row.insertCell().className = 'bulk-row-number';
    for (const [key, label] of BULK_COLUMNS) {
        const input = document.createElement(key === 'desc' ? 'textarea' : 'input');
        input.className = 'ff__input';
        input.setAttribute('aria-label', label);
        input.dataset.field = key;
        input.value = values[key] ?? '';
        row.insertCell().append(input);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'exports-refresh-btn';
    remove.textContent = 'Удалить';
    remove.onclick = () => { row.remove(); numberBulkRows(); invalidateBulkPreview(); };
    row.insertCell().append(remove);
    if (!deferUpdate) {
        numberBulkRows();
        invalidateBulkPreview();
    }
}

function bulkRawRows() {
    return Array.from(document.getElementById('bulkRows').rows, row =>
        Array.from(row.querySelectorAll('[data-field]'), field => field.value.trim()));
}

function pasteBulkProducts() {
    const input = document.getElementById('bulkPaste');
    try {
        if (!input.value.trim()) throw new Error('Вставьте строки вместе с заголовками.');
        if (input.value.length > 10 * 1024 * 1024) throw new Error('Слишком большой объём вставки.');
        const book = XLSX.read(input.value, { type: 'string', FS: '\t', raw: true });
        const raw = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
        const rows = readImportRows(raw);
        if (!rows.length) throw new Error('Под заголовками нет товаров.');
        if (rows.some(row => Object.values(row).some(Number.isNaN))) throw new Error('Проверьте числовые поля в скопированных строках.');
        const body = document.getElementById('bulkRows');
        const filled = bulkRawRows().filter(row => row.some(value => value.trim())).length;
        if (filled + rows.length > 5000) throw new Error('За раз можно проверить до 5000 строк.');
        for (const row of Array.from(body.rows)) {
            if (![...row.querySelectorAll('[data-field]')].some(field => field.value.trim())) row.remove();
        }
        for (const row of rows) addBulkRow(row, true);
        numberBulkRows();
        invalidateBulkPreview();
        input.value = '';
        document.getElementById('bulkStatus').textContent = `Перенесено строк: ${rows.length}. Проверьте таблицу перед добавлением.`;
    } catch (error) {
        document.getElementById('bulkStatus').textContent = error.message;
    }
}

function displayBulkResult(result, preview) {
    const status = document.getElementById('bulkStatus');
    status.textContent = `${preview ? 'Готово к добавлению' : 'Добавлено'}: ${result.created}. Пропущено товаров: ${result.skipped}.`;
    const details = document.getElementById('bulkDetails');
    details.replaceChildren();
    for (const entry of [...(result.errors || []).map(e => `Строка ${e.row}: ${e.reason}`),
        ...(result.products || []).map(p => `${p.name} · ${p.category}`)]) {
        const li = document.createElement('li');
        li.textContent = entry;
        details.append(li);
    }
}

async function submitBulkProducts(apply) {
    if (bulkBusy || (apply && !bulkPreview)) return;
    const status = document.getElementById('bulkStatus');
    const applyButton = document.getElementById('bulkApply');
    const fields = document.getElementById('bulkFields');
    bulkBusy = fields.disabled = true;
    try {
        if (document.getElementById('bulkPaste').value.trim()) throw new Error('Сначала перенесите вставленные данные в таблицу.');
        const rows = apply ? bulkPreview : readImportRows([BULK_COLUMNS.map(([key]) => key), ...bulkRawRows()]);
        invalidateBulkPreview();
        if (!rows.length) throw new Error('Добавьте хотя бы одну заполненную строку.');
        if (rows.length > 5000) throw new Error('За раз можно проверить до 5000 строк.');
        if (rows.some(row => Object.values(row).some(Number.isNaN))) throw new Error('Проверьте числовые поля в таблице.');
        const seen = new Map();
        rows.forEach((row, index) => {
            const key = JSON.stringify(row);
            if (seen.has(key)) throw new Error(`Строка ${index + 2} повторяет строку ${seen.get(key)}. Удалите повтор.`);
            seen.set(key, index + 2);
        });
        status.textContent = apply ? 'Добавляем товары…' : 'Проверяем товары…';
        const result = await apiAdmin('/api/products/import' + (apply ? '' : '?preview=1'), 'POST', rows);
        displayBulkResult(result, !apply);
        if (!apply && result.created) {
            bulkPreview = rows;
            applyButton.classList.remove('hidden');
        }
        if (apply && result.created) {
            try {
                await refreshData();
                render();
            } catch {
                status.textContent += ' Обновите страницу, чтобы увидеть изменения в каталоге.';
            }
        }
    } catch (error) {
        status.textContent = error.message || 'Не удалось обработать товары. Повторите проверку.';
    } finally {
        bulkBusy = fields.disabled = false;
    }
}
