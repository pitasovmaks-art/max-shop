function saveTgId(id) {
    if (!id) return;
    sessionStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id', String(id));
    localStorage.setItem('tg_id_ts', Date.now().toString());
}

function getTgId() {
    console.log('[tgid] start, location.search:', location.search);
    try {
        console.log('[tgid] window.WebApp:', typeof window.WebApp, window.WebApp ? Object.keys(window.WebApp).join(',') : 'нет');
    } catch(e) {}

    const urlParam = new URLSearchParams(location.search).get('tg_id');
    if (urlParam) { saveTgId(urlParam); return urlParam; }

    const startapp = new URLSearchParams(location.search).get('startapp');
    if (startapp && startapp.startsWith('tg_id_')) {
        const idFromStartapp = startapp.replace('tg_id_', '');
        saveTgId(idFromStartapp);
        return idFromStartapp;
    }

    const session = sessionStorage.getItem('tg_id');
    if (session) return session;

    const v = localStorage.getItem('tg_id');
    const ts = parseInt(localStorage.getItem('tg_id_ts') || '0');
    if (v && (Date.now() - ts < 15552000000)) return v;

    console.log('[tgid] returning null, ничего не нашёл');
    return null;
}

window.getTgId = getTgId;
window.saveTgId = saveTgId;
