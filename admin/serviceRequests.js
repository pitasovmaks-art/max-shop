/* ─── Service requests admin (заявки на ремонт, вкладка «Сервис») ─────
   Этап 2 (см. PROGRESS.md). Зависит от глобальных apiAdmin()/showToast()
   из admin.js.

   Данные заявки — имя, телефон, названия инструментов, описание
   проблемы, адрес, комментарий клиента, комментарий мастера — вводит
   клиент или мастер, а не админ разметки. Поэтому ВЕСЬ вывод этих
   значений идёт через createElement/textContent, никогда innerHTML
   (то же правило, что у src/orders/orders.js для карточек заявок в
   «Мои заказы» — см. PROGRESS.md). Статические подписи (лейблы статуса,
   названия магазинов из фиксированного списка) можно было бы оставить в
   шаблонных строках, но ради единообразия всего файла — тоже textContent. */

let _srRequests    = [];
let _srFilter      = { status: '', store: '' };
let _srSearch      = '';
let _srDetailId    = null;

const SR_STATUS_LABELS = {
    accepted:    'Принята',
    in_progress: 'В работе',
    ready:       'Готова к выдаче',
    issued:      'Выдана',
};

function srText(tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
}

/* ─── Загрузка списка ────────────────────────────────────── */
async function renderServiceRequests() {
    const listEl = document.getElementById('srList');
    if (listEl) listEl.replaceChildren(srText('div', 'Загрузка...', 'empty-state'));
    try {
        _srRequests = await apiAdmin('/api/service-requests/admin') || [];
        renderSrFilters();
        renderSrList();
    } catch (e) {
        if (listEl) listEl.replaceChildren(srText('div', 'Ошибка загрузки заявок', 'empty-state'));
    }
}

/* ─── Фильтры (статус/магазин — фиксированные списки, не текст от
   пользователя) ──────────────────────────────────────────── */
function renderSrFilters() {
    const el = document.getElementById('srFilters');
    if (!el) return;

    const stores = [...new Map(_srRequests.map(r => [r.store, r.storeLabel])).entries()];

    el.replaceChildren();
    const wrap = srText('div');
    wrap.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:12px 16px 4px;';

    const statusSel = document.createElement('select');
    statusSel.className = 'order-filter-sel';
    const allStatusOpt = srText('option', 'Все статусы');
    allStatusOpt.value = '';
    statusSel.appendChild(allStatusOpt);
    Object.entries(SR_STATUS_LABELS).forEach(([k, label]) => {
        const opt = srText('option', label);
        opt.value = k;
        if (_srFilter.status === k) opt.selected = true;
        statusSel.appendChild(opt);
    });
    statusSel.addEventListener('change', () => srSetFilter('status', statusSel.value));

    const storeSel = document.createElement('select');
    storeSel.className = 'order-filter-sel';
    const allOpt = srText('option', 'Все магазины', null);
    allOpt.value = '';
    storeSel.appendChild(allOpt);
    stores.forEach(([code, label]) => {
        const opt = srText('option', label || code);
        opt.value = code;
        if (_srFilter.store === code) opt.selected = true;
        storeSel.appendChild(opt);
    });
    storeSel.addEventListener('change', () => srSetFilter('store', storeSel.value));

    wrap.appendChild(statusSel);
    wrap.appendChild(storeSel);
    el.appendChild(wrap);
}

function srSetFilter(key, val) {
    _srFilter[key] = val;
    renderSrList();
}

function srSetSearch(val) {
    _srSearch = (val || '').trim();
    renderSrList();
}

/* ─── Список карточек ────────────────────────────────────── */
function renderSrList() {
    const el = document.getElementById('srList');
    if (!el) return;

    let rows = _srRequests;
    if (_srFilter.status) rows = rows.filter(r => r.status === _srFilter.status);
    if (_srFilter.store)  rows = rows.filter(r => r.store === _srFilter.store);
    if (_srSearch) {
        const q = _srSearch.toLowerCase();
        const qDigits = _srSearch.replace(/\D/g, '');
        rows = rows.filter(r => {
            if (r.number.toLowerCase().includes(q)) return true;
            if (String(r.id).includes(q)) return true;
            if (qDigits && r.phone.replace(/\D/g, '').includes(qDigits)) return true;
            return false;
        });
    }

    el.replaceChildren();
    if (!rows.length) {
        const empty = srText('div', null, 'empty-state');
        empty.appendChild(srText('div', '🔧', 'empty-state__icon'));
        empty.appendChild(srText('p', 'Нет заявок', 'empty-state__title'));
        empty.appendChild(srText('p', 'По выбранным фильтрам заявок на ремонт нет', 'empty-state__sub'));
        el.appendChild(empty);
        return;
    }

    rows.forEach(r => el.appendChild(srCardElement(r)));
}

function srCardElement(r) {
    const card = srText('div', null, 'order-card');
    card.id = `srCard-${r.id}`;
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => openSrDetail(r.id));

    const header = srText('div', null, 'order-card__header');
    header.appendChild(srText('span', r.number, 'order-card__num'));
    header.appendChild(srText('span', SR_STATUS_LABELS[r.status] || r.status, `order-status sr-status--${r.status}`));
    card.appendChild(header);

    const meta = srText('div', null, 'order-card__meta');
    meta.appendChild(srText('span', `${r.name} · ${r.phone}`, 'order-card__client'));
    const date = new Date(r.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    meta.appendChild(srText('span', date, 'order-card__date'));
    card.appendChild(meta);

    card.appendChild(srText('div', r.storeLabel, 'order-card__store'));

    const toolsText = r.items.map(i => i.toolName).join(', ');
    card.appendChild(srText('div', toolsText, 'sr-card__tools'));

    if (r.cost != null) {
        card.appendChild(srText('div', `Стоимость: ${r.cost.toLocaleString('ru-RU')} ₽`, 'order-card__store'));
    }

    return card;
}

/* ─── Детальная карточка / редактирование ────────────────── */
async function openSrDetail(id) {
    _srDetailId = id;
    const overlay = document.getElementById('srDetailOverlay');
    const titleEl = document.getElementById('srDetailTitle');
    const infoEl  = document.getElementById('srDetailInfo');
    const historyEl = document.getElementById('srDetailHistory');

    titleEl.textContent = 'Загрузка...';
    infoEl.replaceChildren();
    historyEl.replaceChildren();
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    let r;
    try {
        r = await apiAdmin(`/api/service-requests/admin/${id}`);
    } catch (e) {
        titleEl.textContent = 'Ошибка загрузки';
        return;
    }

    titleEl.textContent = r.number;

    const row = (label, value) => {
        if (value === undefined || value === null || value === '') return null;
        const el = srText('div', null, 'sr-detail-row');
        el.appendChild(srText('span', label + ':', 'sr-detail-row__label'));
        el.appendChild(srText('span', value, 'sr-detail-row__value'));
        return el;
    };

    [
        row('Клиент', `${r.name} · ${r.phone}`),
        row('Магазин', r.storeLabel),
        row('Доставка', r.deliveryNeeded ? `нужна, адрес забора: ${r.address || 'не указан'}` : 'не нужна, принесёт сам'),
        row('Комментарий клиента', r.comment),
    ].forEach(el => { if (el) infoEl.appendChild(el); });

    const toolsWrap = srText('div', null, 'sr-detail-tools');
    toolsWrap.appendChild(srText('div', 'Инструменты:', 'sr-detail-row__label'));
    r.items.forEach(item => {
        const line = srText('div');
        line.appendChild(srText('span', '• ' + item.toolName));
        if (item.problem) line.appendChild(srText('span', ' — ' + item.problem, 'sr-card__tool-problem'));
        toolsWrap.appendChild(line);
    });
    infoEl.appendChild(toolsWrap);

    document.getElementById('sr-status').value = r.status;
    document.getElementById('sr-cost').value = r.cost ?? '';
    document.getElementById('sr-admin-comment').value = r.adminComment || '';

    historyEl.replaceChildren();
    if (!r.events || !r.events.length) {
        historyEl.appendChild(srText('div', 'Нет истории', 'sr-detail-history__empty'));
    } else {
        r.events.forEach(ev => {
            const line = srText('div');
            const when = new Date(ev.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            line.textContent = `${when} — ${SR_STATUS_LABELS[ev.status] || ev.status} (${ev.changed_by === 'admin' ? 'админ' : 'система'})`;
            historyEl.appendChild(line);
        });
    }
}

function closeSrDetail() {
    document.getElementById('srDetailOverlay').classList.add('hidden');
    document.body.style.overflow = '';
    _srDetailId = null;
}

function handleSrDetailOverlayClick(e) {
    if (e.target === document.getElementById('srDetailOverlay')) closeSrDetail();
}

async function saveSrDetail() {
    if (!_srDetailId) return;
    const status = document.getElementById('sr-status').value;
    const costRaw = document.getElementById('sr-cost').value;
    const adminComment = document.getElementById('sr-admin-comment').value;

    const body = {
        status,
        cost: costRaw === '' ? null : Number(costRaw),
        adminComment,
    };

    try {
        await apiAdmin(`/api/service-requests/admin/${_srDetailId}`, 'PUT', body);
        showToast('✓ Заявка обновлена');
        closeSrDetail();
        renderServiceRequests();
    } catch (e) {
        showToast('Ошибка: ' + e.message);
    }
}
