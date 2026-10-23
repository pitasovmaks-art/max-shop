/* ─── Shop guard ──────────────────────────────────────────────
   Первый скрипт после max-web-app.js на каждой странице — выполняется
   до любых компонентов и роутинга приложения. Синхронным XHR блокирует
   парсинг остальной страницы, пока initData не проверена сервером
   (/api/auth/verify), на каждой загрузке страницы (без кэширования
   результата).

   Важно: т.к. этот скрипт выполняется самим HTML-парсером документа
   (script nesting level > 0), document.open() в этот момент — no-op
   по спецификации, и document.write() сам по себе НЕ останавливает
   разбор остального документа — браузер продолжит парсить и выполнять
   все последующие теги. Поэтому при провале проверки документ сначала
   заменяется через documentElement.innerHTML, затем вызывается
   window.stop() (прерывает парсер страницы) и throw (останавливает
   само выполнение этого скрипта) — без этой связки заглушка просто
   рисуется "под" продолжающим грузиться магазином.

   Экран ошибки (showErrorCode) показывает короткий код причины вместо
   голого "404 Not Found" — был случай, когда сотрудник (не админ, не в
   ADMIN_IDS) видел эту заглушку, а в логах сервера не было вообще
   ничего: похоже, initData на его стороне была пустой — запрос к
   /api/auth/verify в этом случае не уходит вовсе, см. no_initdata ниже
   — поэтому и не было видно в server-side логах. Код на экране даёт
   возможность сразу увидеть, какая именно причина, без доступа к
   логам (достаточно скриншота от пользователя).
─────────────────────────────────────────────────────────────── */
(function () {
    var CHANNEL_URL = 'https://max.ru/id635009278943_biz';

    function lockdown(bodyHtml) {
        try {
            document.documentElement.innerHTML = '<head></head><body>' + bodyHtml + '</body>';
        } catch (e) {}
        try {
            document.open();
            document.write(bodyHtml);
            document.close();
        } catch (e) {}
        try {
            window.stop();
        } catch (e) {}
        throw new Error('shopGuard: access denied');
    }

    function escHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* Общий CSS для обеих заглушек ниже — рисуются ДО того, как
       успевает загрузиться theme.css (см. комментарий в начале файла),
       поэтому цвета не могут читать переменные темы, только собственный
       @media (prefers-color-scheme: dark) прямо здесь. Светлая ветка —
       те же значения, что были всегда; тёмная подобрана под те же
       --bg-page/--text-primary/teal, что использует остальное
       приложение, см. отчёт по диагностике тёмной темы, сессия
       14.10.2026 dark-theme-fix. */
    var STUB_CSS =
        '<style>' +
        '.sg-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;' +
        'font-family:-apple-system,system-ui,sans-serif;background:#EEF3F1;' +
        'color:#1C1C1E;text-align:center;padding:24px;margin:0;}' +
        '.sg-title{color:#0E7C6B;}' +
        '.sg-text{color:rgba(28,28,30,0.7);}' +
        '.sg-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;' +
        'color:rgba(28,28,30,0.5);word-break:break-all;margin-top:8px;}' +
        '.sg-btn-primary{background:#0E7C6B;color:#fff;}' +
        '.sg-btn-secondary{background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);color:#1C1C1E;}' +
        '@media (prefers-color-scheme: dark) {' +
        '.sg-wrap{background:#141210;color:#F3EFE4;}' +
        '.sg-title{color:#4FD3B8;}' +
        '.sg-text{color:rgba(243,239,228,0.7);}' +
        '.sg-code{color:rgba(243,239,228,0.5);}' +
        '.sg-btn-primary{background:#0E7C6B;color:#fff;}' +
        '.sg-btn-secondary{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#F3EFE4;}' +
        '}' +
        '</style>';

    function showErrorCode(code) {
        lockdown(
            STUB_CSS +
            '<div class="sg-wrap"><div style="max-width:320px">' +
            '<div style="font-size:48px;margin-bottom:16px">⚠️</div>' +
            '<div class="sg-title" style="font-size:18px;font-weight:700;margin-bottom:12px;">Ошибка входа</div>' +
            '<div class="sg-text" style="font-size:15px;line-height:1.6">' +
            'Сделайте скриншот этого экрана и отправьте администратору</div>' +
            '<div class="sg-code">' + escHtml(code) + '</div>' +
            '</div></div>'
        );
    }

    function showSubscribeStub() {
        lockdown(
            STUB_CSS +
            '<div class="sg-wrap">' +
            '<div style="max-width:320px">' +
            '<div style="font-size:48px;margin-bottom:16px">📢</div>' +
            '<div class="sg-title" style="font-size:18px;font-weight:700;margin-bottom:12px;">Только для подписчиков</div>' +
            '<div class="sg-text" style="font-size:15px;line-height:1.6;margin-bottom:24px">' +
            'Подпишитесь на канал «Точка монтажа», чтобы пользоваться приложением</div>' +
            '<button class="sg-btn-primary" onclick="window.open(\'' + CHANNEL_URL + '\',\'_blank\')" ' +
            'style="width:100%;height:52px;border:none;border-radius:16px;' +
            'font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px">Подписаться на канал</button>' +
            '<button class="sg-btn-secondary" onclick="location.reload()" ' +
            'style="width:100%;height:52px;border-radius:16px;font-size:15px;font-weight:600;cursor:pointer">Я подписался ✓</button>' +
            '</div></div>'
        );
    }

    var initData = (window.WebApp && window.WebApp.initData) || '';
    if (!initData) {
        showErrorCode('no_initdata'); /* throws — ничего после этой строки не выполнится */
    }

    var xhr = new XMLHttpRequest();
    var data;
    try {
        xhr.open('POST', '/api/auth/verify', false); /* синхронно — блокирует парсинг страницы до ответа */
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ initData: initData }));
        data = JSON.parse(xhr.responseText || '{}');
    } catch (e) {
        /* xhr.status === 0 обычно значит, что ответ вообще не пришёл
           (сеть упала/оборвалась/WebView прервал синхронный запрос) —
           практически то же самое, что таймаут. Непустой status —
           ответ дошёл, но тело не разобралось как JSON. Синхронный XHR
           не поддерживает xhr.timeout (большинство движков либо
           игнорирует его, либо бросает при попытке установить), поэтому
           отдельного кода "таймаут" нет — xhr_error:0 и есть его
           практический эквивалент. */
        showErrorCode('xhr_error:' + (xhr && typeof xhr.status === 'number' ? xhr.status : '?'));
    }

    if (!data.ok) {
        if (data.reason === 'not_subscribed') showSubscribeStub();
        else showErrorCode(data.reason || ('server_error:' + xhr.status));
    }
})();
