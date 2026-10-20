/* Проверка фикса аудита безопасности, находки B и K (~/security-audit.md):
   admin/admin.js (renderOrderList — список заказов в админке) и
   src/orders/orders.js (orderCardHtml — «Мои заказы» покупателя)
   подставляли имя/телефон/адрес/комментарий/название позиции заказа и
   трек-номер в innerHTML без экранирования. Самое опасное — админка:
   покупатель мог оформить заказ с именем вида
   <img src=x onerror="кража _adminToken из той же страницы"> и получить
   выполнение произвольного JS в сессии администратора.

   Тест запускает РЕАЛЬНЫЙ код admin/admin.js и src/orders/orders.js в
   песочнице (node:vm) с минимальными заглушками document/getTgId/fetch
   — сами функции рендера (renderOrderList, orderCardHtml) не трогаем,
   проверяем, что они делают после фикса с вредоносными данными.

   Запуск: node server/scripts/test-xss-escaping.js
*/
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function runInNewContext(files, extraGlobals) {
    const ctx = vm.createContext(Object.assign({ console }, extraGlobals));
    for (const file of files) {
        vm.runInContext(read(file), ctx, { filename: file });
    }
    return ctx;
}

function makeFakeElement() {
    const el = { _html: '' };
    Object.defineProperty(el, 'innerHTML', {
        get() { return el._html; },
        set(v) { el._html = v; },
    });
    return el;
}

const IMG_PAYLOAD   = '<img src=x onerror=alert(1)>';
const ATTR_BREAKOUT = '" onmouseover="alert(1)';

async function main() {
    let failures = 0;
    function check(label, cond) {
        console.log(`${cond ? '✅' : '❌'} ${label}`);
        if (!cond) failures++;
    }

    /* ── 1. escHtml() сам по себе ────────────────────────────────────── */
    {
        const ctx = runInNewContext(['src/shared/escHtml.js'], {});
        const escaped = vm.runInContext(`escHtml(${JSON.stringify(IMG_PAYLOAD)})`, ctx);
        check('escHtml(<img onerror=…>) не содержит сырой "<img"', !escaped.includes('<img'));
        check('escHtml(<img onerror=…>) содержит экранированный "&lt;img"', escaped.includes('&lt;img'));
        const escapedAttr = vm.runInContext(`escHtml(${JSON.stringify(ATTR_BREAKOUT)})`, ctx);
        check('escHtml() экранирует "\\"" (защита от выхода из HTML-атрибута)', !escapedAttr.includes('"'));
    }

    /* ── 2. admin/admin.js: renderOrderList() с вредоносным заказом ──── */
    {
        const fakeOrdersListInner = makeFakeElement();
        const documentStub = {
            addEventListener() {},
            getElementById(id) {
                return id === 'ordersListInner' ? fakeOrdersListInner : makeFakeElement();
            },
        };
        const ctx = runInNewContext(
            ['src/shared/escHtml.js', 'admin/admin.js'],
            { document: documentStub, window: {} }
        );

        const maliciousOrder = {
            id: 1, status: 'new', delivery: 'city', createdAt: new Date().toISOString(),
            name: IMG_PAYLOAD, phone: IMG_PAYLOAD, store: IMG_PAYLOAD,
            address: IMG_PAYLOAD, comment: IMG_PAYLOAD,
            trackingNumber: ATTR_BREAKOUT,
            items: [{ name: IMG_PAYLOAD, qty: 1 }],
            total: 1000,
        };
        // Присваивание выполняется КАК КОД внутри контекста (не через
        // ctx.свойство снаружи) — _allOrders объявлена в admin.js через
        // let, это отдельное лексическое окружение контекста, а не
        // свойство глобального объекта; присвоить ей новое значение
        // снаружи нельзя, только изнутри той же vm-песочницы.
        vm.runInContext(`_allOrders = ${JSON.stringify([maliciousOrder])}; renderOrderList();`, ctx);

        const html = fakeOrdersListInner.innerHTML;
        check('admin: renderOrderList() не вставляет живой <img> (имя/телефон/адрес/комментарий/магазин)',
            !/<img\b/i.test(html));
        check('admin: renderOrderList() не вставляет живой <img> из названия позиции заказа',
            html.split('order-card__items')[1] ? !/<img\b/i.test(html.split('order-card__items')[1].slice(0, 200)) : true);
        check('admin: экранированное имя присутствует как текст (&lt;img)', html.includes('&lt;img'));
        check('admin: трек-номер не выходит за пределы атрибута value="…" (нет сырой «"» из payload)',
            !html.includes(`value="${ATTR_BREAKOUT}"`));
    }

    /* ── 3. src/orders/orders.js: orderCardHtml() с вредоносным заказом ── */
    {
        const ctx = runInNewContext(
            ['src/shared/escHtml.js', 'src/orders/orders.js'],
            {
                document: { addEventListener() {} },
                window: {},
                getTgId: () => '123',
                fetch: () => Promise.reject(new Error('нет сети в тесте')),
            }
        );

        const maliciousOrder = {
            id: 1, status: 'new', delivery: 'city', createdAt: new Date().toISOString(),
            store: IMG_PAYLOAD, address: IMG_PAYLOAD, trackingNumber: ATTR_BREAKOUT,
            items: [{ name: IMG_PAYLOAD, qty: 1 }],
            total: 1000,
        };
        ctx._maliciousOrder = maliciousOrder;
        const html = vm.runInContext('orderCardHtml(_maliciousOrder)', ctx);

        check('orders.js: orderCardHtml() не вставляет живой <img> (магазин/адрес/позиция)',
            !/<img\b/i.test(html));
        check('orders.js: экранированный текст присутствует (&lt;img)', html.includes('&lt;img'));
        check('orders.js: трек-номер не выходит за пределы атрибута (нет сырой «"» из payload)',
            !html.includes(`Трек-номер: ${ATTR_BREAKOUT}`));
    }

    console.log(failures === 0
        ? '\nВсе проверки прошли.'
        : `\n${failures} проверок провалено.`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
