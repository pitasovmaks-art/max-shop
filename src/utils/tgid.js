function saveTgId(id) {
    if (!id) return;
    sessionStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id_ts', Date.now().toString());
}

function getTgId() {
    console.log('[tgid] window.WebApp keys:', window.WebApp ? Object.keys(window.WebApp) : 'нет SDK');
    console.log('[tgid] window.WebApp full:', JSON.stringify(window.WebApp));
    console.log('[tgid] URL tg_id:', new URLSearchParams(location.search).get('tg_id'));

    const urlParam = new URLSearchParams(location.search).get('tg_id');
    if (urlParam) { saveTgId(urlParam); return urlParam; }

    const startapp = new URLSearchParams(location.search).get('startapp');
    if (startapp && startapp.startsWith('tg_id_')) {
        const idFromStartapp = startapp.replace('tg_id_', '');
        console.log('[tgid] tg_id from startapp:', idFromStartapp);
        saveTgId(idFromStartapp);
        return idFromStartapp;
    }

    try {
        console.log('[tgid] WebApp.initData:', window.WebApp?.initData);
        if (window.WebApp && window.WebApp.initData) {
            const params = new URLSearchParams(window.WebApp.initData);
            const userStr = params.get('user');
            console.log('[tgid] parsed user:', userStr);
            if (userStr) {
                const user = JSON.parse(userStr);
                console.log('[tgid] tg_id from SDK:', user?.id);
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
