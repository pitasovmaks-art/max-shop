/* getTgId() — только для некритичного UI (показать сердечко, скрыть кнопку
   «уведомить о поступлении» и т.п.), НИКОГДА как доказательство личности
   для сервера: это просто клиентский парсинг, который легко подделать
   через devtools. Для запросов, которым нужна настоящая личность, сервер
   сам проверяет подпись initData (см. server/middleware/requireUser.js,
   src/utils/authFetch.js) — tg_id в query/body игнорируется.

   Раньше здесь был фолбэк на ?tg_id= в URL и на localStorage с TTL — это
   и было дырой: tg_id из адресной строки/хранилища ничем не подтверждён,
   а ссылки с ?tg_id= расходятся (шаринг, история браузера). shopGuard.js
   уже проверяет window.WebApp.initData при каждой загрузке каждой
   страницы, так что оно и так свежее на каждой странице — пробрасывать
   tg_id дальше через URL/localStorage не нужно. */
function getTgId() {
    try {
        if (window.WebApp?.initDataUnsafe?.user?.id) {
            return String(window.WebApp.initDataUnsafe.user.id);
        }
        if (window.WebApp?.initData) {
            const params = new URLSearchParams(window.WebApp.initData);
            const userStr = params.get('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user?.id) return String(user.id);
            }
        }
    } catch (e) {
        console.error('[tgid] SDK error:', e);
    }
    return null;
}

window.getTgId = getTgId;
