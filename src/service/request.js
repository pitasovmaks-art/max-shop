const MAX_TOOLS = 10;
let _toolCount = 0;
let _submitting = false;

/* ─── Auth gate — та же логика, что renderAuthRequired() в src/orders/
   orders.js: getTgId() здесь не доказательство личности (его легко
   подделать), только чтобы не показывать форму человеку, открывшему
   страницу не из Max — реальная проверка всё равно на сервере
   (requireUser, см. server/middleware/requireUser.js). */
function checkAuth() {
    if (getTgId()) return true;
    document.getElementById('authRequired').classList.remove('hidden');
    document.getElementById('requestForm').classList.add('hidden');
    document.querySelector('.submit-footer').classList.add('hidden');
    return false;
}

/* ─── Tool rows ──────────────────────────────────────────── */
function buildToolRow(index, removable) {
    const row = document.createElement('div');
    row.className = 'tool-row';
    row.dataset.index = String(index);

    if (removable) {
        const head = document.createElement('div');
        head.className = 'tool-row__head';
        const label = document.createElement('span');
        label.className = 'tool-row__label';
        label.textContent = 'Инструмент';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'tool-row__remove';
        removeBtn.setAttribute('aria-label', 'Удалить инструмент');
        removeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        removeBtn.addEventListener('click', () => removeToolRow(row));
        head.appendChild(label);
        head.appendChild(removeBtn);
        row.appendChild(head);
    }

    const nameField = document.createElement('div');
    nameField.className = 'field';
    nameField.innerHTML = `
        <label class="field__label">Название / модель *</label>
        <input class="field__input tool-name" type="text" placeholder="Например: Toua NTC57C3" maxlength="120">
        <span class="field__error"></span>`;

    const problemField = document.createElement('div');
    problemField.className = 'field';
    problemField.innerHTML = `
        <label class="field__label">Описание проблемы <span class="section__optional">необязательно</span></label>
        <textarea class="field__textarea tool-problem" rows="2" maxlength="500" placeholder="Что случилось с инструментом"></textarea>
        <span class="field__error"></span>`;

    row.appendChild(nameField);
    row.appendChild(problemField);
    return row;
}

function addToolRow() {
    if (_toolCount >= MAX_TOOLS) return;
    const list = document.getElementById('toolsList');
    const row = buildToolRow(_toolCount, _toolCount > 0);
    list.appendChild(row);
    _toolCount++;
    updateToolsUi();
}

function removeToolRow(rowEl) {
    rowEl.remove();
    _toolCount--;
    updateToolsUi();
}

function updateToolsUi() {
    const addBtn = document.getElementById('addToolBtn');
    const hint   = document.getElementById('toolsHint');
    addBtn.disabled = _toolCount >= MAX_TOOLS;
    hint.textContent = _toolCount >= MAX_TOOLS ? `Максимум ${MAX_TOOLS} инструментов` : '';
}

/* ─── Delivery toggle ────────────────────────────────────── */
function handleDeliveryToggle() {
    const checked = document.getElementById('inputDeliveryNeeded').checked;
    const field = document.getElementById('fieldAddress');
    field.classList.toggle('hidden', !checked);
    if (!checked) clearError('fieldAddress');
}

/* ─── Legal consent ──────────────────────────────────────── */
function handleLegalCheck() {
    const btn = document.getElementById('submitBtn');
    const checked = document.getElementById('agreePolicy').checked;
    btn.disabled = !checked || _submitting;
    btn.classList.toggle('submit-btn--disabled', !checked || _submitting);
}

/* ─── Phone mask — тот же код, что formatPhoneDigits/handlePhone/
   handlePhoneKeydown в src/cart/checkout.js, чтобы маска вела себя
   одинаково во всём приложении. ─────────────────────────────── */
function formatPhoneDigits(input, raw) {
    let digits = raw;
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    else if (!digits.startsWith('7')) digits = '7' + digits;
    digits = digits.slice(0, 11);

    let result = '+7';
    if (digits.length > 1) result += ' (' + digits.slice(1, 4);
    if (digits.length >= 4) result += ') ' + digits.slice(4, 7);
    if (digits.length >= 7) result += '-' + digits.slice(7, 9);
    if (digits.length >= 9) result += '-' + digits.slice(9, 11);

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

function getDigits(phone) { return (phone || '').replace(/\D/g, ''); }

/* ─── Field errors ───────────────────────────────────────── */
function showError(fieldId, msg) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.classList.add('field--error');
    const err = field.querySelector('.field__error');
    if (err) err.textContent = msg;
}

function clearError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.classList.remove('field--error');
    const err = field.querySelector('.field__error');
    if (err) err.textContent = '';
}

/* ─── Validate + collect ─────────────────────────────────── */
function validateAndCollect() {
    let ok = true;
    clearError('fieldName');
    clearError('fieldPhone');
    clearError('fieldAddress');
    document.getElementById('submitError').classList.add('hidden');

    const name = document.getElementById('inputName').value.trim();
    if (!name) { showError('fieldName', 'Введите имя'); ok = false; }

    const phone = document.getElementById('inputPhone').value;
    if (!phone || getDigits(phone).length < 11) { showError('fieldPhone', 'Введите полный номер телефона'); ok = false; }

    const rows = Array.from(document.querySelectorAll('#toolsList .tool-row'));
    const items = [];
    rows.forEach(row => {
        const nameInput = row.querySelector('.tool-name');
        const problemInput = row.querySelector('.tool-problem');
        const toolName = nameInput.value.trim();
        const problem  = problemInput.value.trim();
        const nameField = nameInput.closest('.field');
        if (!toolName) {
            nameField.classList.add('field--error');
            nameField.querySelector('.field__error').textContent = 'Укажите название инструмента';
            ok = false;
        } else {
            nameField.classList.remove('field--error');
            nameField.querySelector('.field__error').textContent = '';
        }
        items.push({ toolName, problem });
    });

    const deliveryNeeded = document.getElementById('inputDeliveryNeeded').checked;
    const address = document.getElementById('inputAddress').value.trim();
    if (deliveryNeeded && !address) { showError('fieldAddress', 'Укажите адрес забора'); ok = false; }

    const comment = document.getElementById('inputComment').value.trim();
    const consent = document.getElementById('agreePolicy').checked;
    if (!consent) ok = false;

    if (!ok) return null;
    return { name, phone, items, deliveryNeeded, address: deliveryNeeded ? address : undefined, comment: comment || undefined, consent };
}

/* ─── Submit ──────────────────────────────────────────────── */
async function submitRequest() {
    if (_submitting) return; // защита от двойного нажатия
    const payload = validateAndCollect();
    if (!payload) return;

    _submitting = true;
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.classList.add('submit-btn--disabled');
    const prevText = btn.textContent;
    btn.textContent = 'Отправляем...';

    try {
        const r = await authFetch('/api/service-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            const errEl = document.getElementById('submitError');
            errEl.textContent = data.error || 'Не удалось отправить заявку, попробуйте ещё раз';
            errEl.classList.remove('hidden');
            return;
        }
        document.getElementById('successTitle').textContent = `Заявка ${data.number || ''} принята`.trim();
        document.getElementById('successScreen').classList.remove('hidden');
    } catch (e) {
        const errEl = document.getElementById('submitError');
        errEl.textContent = 'Не удалось отправить заявку, проверьте соединение и попробуйте ещё раз';
        errEl.classList.remove('hidden');
    } finally {
        _submitting = false;
        btn.textContent = prevText;
        handleLegalCheck();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    addToolRow(); // одна строка по умолчанию
});
