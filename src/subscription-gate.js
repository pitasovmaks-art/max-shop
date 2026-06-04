/* ─── Subscription gate ──────────────────────────────────────
   Include on index.html, catalog, cart, checkout, product pages.
   Checks Max channel membership before showing content.
   Fail-open: if no tg_id or API error → let user through.
─────────────────────────────────────────────────────────── */
(function () {
    const CHANNEL_URL = 'https://max.ru/id635009278943_biz';

    function getUserId() {
        try {
            const params = new URLSearchParams(location.search);
            if (params.get('tg_id')) return params.get('tg_id');
            const ss = sessionStorage.getItem('tg_id');
            if (ss) return ss;
            if (window.WebApp && window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.user) {
                return String(window.WebApp.initDataUnsafe.user.id);
            }
        } catch {}
        return null;
    }

    function openChannelLink() {
        try {
            if (window.WebApp && window.WebApp.openLink) {
                window.WebApp.openLink(CHANNEL_URL);
                return;
            }
        } catch {}
        window.open(CHANNEL_URL, '_blank');
    }

    function removeOverlay() {
        const el = document.getElementById('sub-gate-overlay');
        if (el) el.remove();
    }

    function showRetryMessage(msg) {
        const el = document.getElementById('sub-gate-retry-msg');
        if (el) el.textContent = msg;
    }

    async function checkAndGate(userId, onSuccess) {
        try {
            const r    = await fetch(`/api/check-subscription?user_id=${encodeURIComponent(userId)}`);
            const data = await r.json();
            if (data.subscribed) {
                onSuccess();
            }
            return data.subscribed;
        } catch {
            onSuccess(); // fail-open on network error
            return true;
        }
    }

    function showOverlay(userId) {
        const overlay = document.createElement('div');
        overlay.id    = 'sub-gate-overlay';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:99999',
            'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
            'padding:32px 24px',
            'background:linear-gradient(135deg,#1a1a2e 0%,#2d4a3e 40%,#4a3728 100%)',
            'color:#fff', 'text-align:center',
        ].join(';');

        overlay.innerHTML = `
            <div style="font-size:48px;margin-bottom:20px">📢</div>
            <h2 style="font-size:22px;font-weight:700;margin-bottom:12px;line-height:1.3">
                Только для подписчиков
            </h2>
            <p style="font-size:15px;line-height:1.6;color:rgba(255,255,255,0.8);margin-bottom:32px;max-width:320px">
                Подпишитесь на наш канал&nbsp;«Точка монтажа», чтобы пользоваться приложением
            </p>
            <button id="sub-gate-subscribe"
                style="width:100%;max-width:320px;height:52px;background:#F85800;border:none;border-radius:16px;
                       color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:12px">
                Подписаться на канал
            </button>
            <button id="sub-gate-check"
                style="width:100%;max-width:320px;height:52px;background:rgba(255,255,255,0.12);
                       border:1px solid rgba(255,255,255,0.25);border-radius:16px;
                       color:#fff;font-size:15px;font-weight:600;cursor:pointer">
                Я подписался ✓
            </button>
            <p id="sub-gate-retry-msg"
               style="margin-top:16px;font-size:13px;color:rgba(255,255,255,0.5);min-height:20px"></p>
        `;

        document.body.appendChild(overlay);

        document.getElementById('sub-gate-subscribe').addEventListener('click', openChannelLink);

        document.getElementById('sub-gate-check').addEventListener('click', async () => {
            const btn = document.getElementById('sub-gate-check');
            btn.disabled    = true;
            btn.textContent = 'Проверяем...';
            showRetryMessage('');

            // Small delay — Max membership may take a moment to propagate
            await new Promise(r => setTimeout(r, 1500));

            const ok = await checkAndGate(userId, removeOverlay);
            if (!ok) {
                btn.disabled    = false;
                btn.textContent = 'Я подписался ✓';
                showRetryMessage('Подписка не найдена. Подождите пару секунд и попробуйте снова.');
            }
        });
    }

    async function init() {
        const userId = getUserId();
        if (!userId) return; // fail-open: no user id

        try {
            const r    = await fetch(`/api/check-subscription?user_id=${encodeURIComponent(userId)}`);
            const data = await r.json();
            if (!data.subscribed) showOverlay(userId);
        } catch {
            // fail-open: network error → don't block
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
