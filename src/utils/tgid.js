function saveTgId(id) {
    if (!id) return;
    sessionStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id_ts', Date.now().toString());
}

function getTgId() {
    const urlParam = new URLSearchParams(location.search).get('tg_id');
    if (urlParam) { saveTgId(urlParam); return urlParam; }

    try {
        if (window.WebApp && window.WebApp.initData) {
            const params = new URLSearchParams(window.WebApp.initData);
            const userStr = params.get('user');
            if (userStr) {
                const user = JSON.parse(userStr);
                if (user && user.id) { saveTgId(user.id); return String(user.id); }
            }
        }
    } catch(e) {}

    const session = sessionStorage.getItem('tg_id');
    if (session) return session;

    const v = localStorage.getItem('tg_id');
    const ts = parseInt(localStorage.getItem('tg_id_ts') || '0');
    if (v && (Date.now() - ts < 86400000)) return v;

    return null;
}

window.getTgId = getTgId;
window.saveTgId = saveTgId;
