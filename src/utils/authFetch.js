/* fetch-обёртка для эндпоинтов, защищённых requireUser на сервере
   (server/middleware/requireUser.js). Прикладывает raw initData Max
   (window.WebApp.initData) в заголовке X-Init-Data — то же значение,
   которое shopGuard.js уже проверяет при каждой загрузке страницы, —
   чтобы сервер сам достал личность пользователя из подписи, а не из
   query/body, которые клиент мог бы подделать чужим tg_id. */
function authFetch(url, options) {
    options = options || {};
    const headers = Object.assign({}, options.headers, {
        'X-Init-Data': (window.WebApp && window.WebApp.initData) || '',
    });
    return fetch(url, Object.assign({}, options, { headers }));
}

window.authFetch = authFetch;
