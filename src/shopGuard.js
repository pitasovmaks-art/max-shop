/* ─── Shop guard ──────────────────────────────────────────────
   Подключается сразу после max-web-app.js, до остальных скриптов страницы.
   Блокирует синхронным XHR парсинг остальной страницы, пока initData
   не проверена сервером (/api/auth/verify). Если подписи нет/неверна
   или пользователь не подписан на канал — страница заменяется заглушкой.
─────────────────────────────────────────────────────────────── */
(function () {
    var CHANNEL_URL = 'https://max.ru/id635009278943_biz';

    function hasCookie(name) {
        return document.cookie.split(';').some(function (c) {
            return c.trim().indexOf(name + '=') === 0;
        });
    }

    function writeStub(html) {
        document.open();
        document.write(
            '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
            '<title>Точка Монтажа</title></head>' +
            '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
            'font-family:-apple-system,system-ui,sans-serif;background:linear-gradient(160deg,#DCEEFF 0%,#B9D9F7 100%);' +
            'color:#1C1C1E;text-align:center;padding:24px;">' + html + '</body></html>'
        );
        document.close();
    }

    function showAccessDenied() {
        document.open();
        document.write(
            '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<title>404</title></head>' +
            '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
            'font-family:sans-serif;background:#fff;color:#000;text-align:center;">' +
            '<div><h1>404</h1><p>Not Found</p></div>' +
            '</body></html>'
        );
        document.close();
    }

    function showSubscribeStub() {
        writeStub(
            '<div style="max-width:320px">' +
            '<div style="font-size:48px;margin-bottom:16px">📢</div>' +
            '<div style="font-size:18px;font-weight:700;margin-bottom:12px;color:#0C447C">Только для подписчиков</div>' +
            '<div style="font-size:15px;line-height:1.6;color:rgba(28,28,30,0.7);margin-bottom:24px">' +
            'Подпишитесь на канал «Точка монтажа», чтобы пользоваться приложением</div>' +
            '<button onclick="window.open(\'' + CHANNEL_URL + '\',\'_blank\')" ' +
            'style="width:100%;height:52px;background:#F85800;border:none;border-radius:16px;color:#fff;' +
            'font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px">Подписаться на канал</button>' +
            '<button onclick="location.reload()" ' +
            'style="width:100%;height:52px;background:rgba(255,255,255,0.85);border:1px solid rgba(0,0,0,0.12);' +
            'border-radius:16px;color:#1C1C1E;font-size:15px;font-weight:600;cursor:pointer">Я подписался ✓</button>' +
            '</div>'
        );
    }

    if (hasCookie('shop_session')) return; // уже проверены в этой сессии

    var initData = (window.WebApp && window.WebApp.initData) || '';
    if (!initData) {
        showAccessDenied();
        return;
    }

    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/auth/verify', false); /* синхронно — блокирует парсинг страницы до ответа */
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ initData: initData }));

        var data = JSON.parse(xhr.responseText || '{}');
        if (!data.ok) {
            if (data.reason === 'not_subscribed') showSubscribeStub();
            else showAccessDenied();
        }
    } catch (e) {
        showAccessDenied();
    }
})();
