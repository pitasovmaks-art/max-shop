/* ─── Cookie consent banner ─────────────────────────────── */
(function () {
    const KEY = 'cookie_consent';

    function getConsent() { return localStorage.getItem(KEY); }
    function setConsent(val) { localStorage.setItem(KEY, val); }

    function dismiss(banner) {
        banner.classList.add('cookie-banner--hidden');
    }

    function init() {
        if (getConsent()) return; // already decided

        // Detect fixed bottom element height for positioning
        const nav = document.querySelector('.bottom-nav');
        const footer = document.querySelector('.checkout-footer');
        const navH = nav ? nav.offsetHeight : (footer ? footer.offsetHeight : 0);

        const banner = document.createElement('div');
        banner.className = 'cookie-banner';
        banner.style.setProperty('--cookie-bottom', navH + 'px');
        banner.innerHTML = `
            <div class="cookie-banner__card">
                <div class="cookie-banner__text">
                    🍪 Мы используем cookies для улучшения работы сайта.
                    <a href="privacy.html">Подробнее</a>
                </div>
                <div class="cookie-banner__actions">
                    <button class="cookie-btn cookie-btn--decline" id="cookieDecline">Отклонить</button>
                    <button class="cookie-btn cookie-btn--accept" id="cookieAccept">Принять</button>
                </div>
            </div>`;

        document.body.appendChild(banner);

        banner.querySelector('#cookieAccept').addEventListener('click', function () {
            setConsent('accepted');
            dismiss(banner);
        });

        banner.querySelector('#cookieDecline').addEventListener('click', function () {
            setConsent('declined');
            dismiss(banner);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
