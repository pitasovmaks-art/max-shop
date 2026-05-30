function saveTgId(id) {
    if (!id) return;
    sessionStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id_ts', Date.now().toString());
}

function getTgId() {
    const urlParam = new URLSearchParams(location.search).get('tg_id');
    if (urlParam) { saveTgId(urlParam); return urlParam; }

    const startapp = new URLSearchParams(location.search).get('startapp');
    if (startapp && startapp.startsWith('tg_id_')) {
        const idFromStartapp = startapp.replace('tg_id_', '');
        saveTgId(idFromStartapp);
        return idFromStartapp;
    }

    try {
        if (window.WebApp?.initDataUnsafe) {
            const unsafe = window.WebApp.initDataUnsafe;
            // start_param из payload кнопки — это chat_id переданный ботом
            if (unsafe.start_param) {
                console.log('[tgid] from start_param:', unsafe.start_param);
                saveTgId(unsafe.start_param);
                return String(unsafe.start_param);
            }
            // user.id как запасной вариант
            if (unsafe.user?.id) {
                console.log('[tgid] from user.id:', unsafe.user.id);
                saveTgId(unsafe.user.id);
                return String(unsafe.user.id);
            }
        }
        if (window.WebApp?.initData) {
            const params = new URLSearchParams(window.WebApp.initData);
            const userStr = params.get('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user?.id) {
                    saveTgId(user.id);
                    return String(user.id);
                }
            }
        }
    } catch(e) { console.error('[tgid] SDK error:', e); }

    const session = sessionStorage.getItem('tg_id');
    if (session) return session;

    const v = localStorage.getItem('tg_id');
    const ts = parseInt(localStorage.getItem('tg_id_ts') || '0');
    if (v && (Date.now() - ts < 15552000000)) return v;

    return null;
}

window.getTgId = getTgId;
window.saveTgId = saveTgId;
