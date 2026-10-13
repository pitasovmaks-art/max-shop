/* ─── Диагностика свайпа баннера (включается скрытым жестом) ────────────
   Подгружается динамически ТОЛЬКО когда localStorage.bannerDebug==='1' —
   см. _bannerDebugTapHook()/initBanner() в src/catalog/catalog.js (7
   нажатий за 3с на пустой фон шапки). По умолчанию этот файл вообще не
   запрашивается и ничего не показывает.

   Намеренно НЕ использует ничего из приватного состояния карусели
   (_bannerState, _bannerDrag и т.п. в catalog.js) — весь лог собирается
   независимо, через свои слушатели на document (capture, passive) и
   прямые замеры DOM #bannerTrack. Это и проще, и не даёт диагностике
   как-то повлиять на саму карусель (слушатели ничего не предотвращают).

   Плашка внизу экрана: pointer-events:none (никогда не перехватывает
   нажатия/свайпы, которые сама же логирует), только textContent (без
   innerHTML), мелкий монослейс — рассчитана на то, что её сфотографируют
   скриншотом с телефона, а не читают в живом виде построчно. */
(function () {
    const MAX_LINES = 20;

    const panel = document.createElement('div');
    panel.id = 'bannerDebugPanel';
    panel.style.cssText = [
        'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:999999',
        'max-height:46vh', 'overflow:hidden', 'pointer-events:none',
        'background:rgba(0,0,0,.82)', 'color:#3CE66D',
        'font:9px/1.35 ui-monospace,Menlo,Consolas,monospace',
        'padding:6px 8px', 'white-space:pre-wrap', 'word-break:break-all',
    ].join(';');
    document.body.appendChild(panel);

    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'color:#FFD60A;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:3px;';
    panel.appendChild(statusLine);

    const logWrap = document.createElement('div');
    panel.appendChild(logWrap);

    const lines = []; // DOM-строки лога, старые уводятся при переполнении

    function elInfo(el) {
        if (!el || !el.tagName) return String(el);
        const cls = el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : '';
        const parent = el.parentElement;
        const pCls = parent && parent.className ? '.' + String(parent.className).trim().replace(/\s+/g, '.') : '';
        const pTag = parent ? parent.tagName : '?';
        return el.tagName + cls + ' в ' + pTag + pCls;
    }

    function trimLines() {
        while (lines.length > MAX_LINES) lines.shift().remove();
    }

    function pushLine(text) {
        const row = document.createElement('div');
        row.textContent = text;
        logWrap.appendChild(row);
        lines.push(row);
        trimLines();
        renderStatus();
        return row;
    }

    function renderStatus() {
        const track = document.getElementById('bannerTrack');
        if (!track) { statusLine.textContent = 'bannerDebug: #bannerTrack не найден на странице'; return; }
        const vp = track.parentElement.getBoundingClientRect();
        const children = [...track.children];
        const activeIdx = children.findIndex((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && Math.abs(r.left - vp.left) < 2;
        });
        const active = activeIdx >= 0 ? children[activeIdx] : null;
        const logicalIdx = active ? active.dataset.slideIndex : '?';
        statusLine.textContent =
            'transform=' + (track.style.transform || '(нет)') +
            ' width=' + Math.round(vp.width) + 'px' +
            ' слайдов(с клонами)=' + children.length +
            ' видимый#=' + activeIdx +
            ' data-slide-index=' + logicalIdx;
    }

    function ts() { return performance.now().toFixed(0) + 'мс'; }

    // pointerdown/pointerup/pointercancel — по одной строке на событие;
    // pointerdown показывает, какой именно элемент получил нажатие.
    ['pointerdown', 'pointerup', 'pointercancel'].forEach((type) => {
        document.addEventListener(type, (e) => {
            if (type === 'pointerdown') moveState.delete(e.pointerId);
            let text = ts() + ' ' + type + ' x=' + Math.round(e.clientX) + ',y=' + Math.round(e.clientY) +
                ' id=' + e.pointerId + ' pointerType=' + e.pointerType;
            if (type === 'pointerdown') text += ' -> ' + elInfo(e.target);
            pushLine(text);
        }, { capture: true, passive: true });
    });

    // pointermove — только первое и последнее за жест (ТЗ): первое —
    // отдельная неизменяемая строка; последнее — ОДНА строка, которую на
    // каждый следующий move просто обновляем на месте, не плодя лог.
    const moveState = new Map(); // pointerId -> { lastRow }
    document.addEventListener('pointermove', (e) => {
        const text = ts() + ' pointermove x=' + Math.round(e.clientX) + ',y=' + Math.round(e.clientY) + ' id=' + e.pointerId;
        let st = moveState.get(e.pointerId);
        if (!st) {
            pushLine(text.replace('pointermove', 'pointermove(первое)'));
            const lastRow = pushLine(text.replace('pointermove', 'pointermove(последнее)'));
            moveState.set(e.pointerId, { lastRow });
        } else {
            st.lastRow.textContent = text.replace('pointermove', 'pointermove(последнее)');
            renderStatus();
        }
    }, { capture: true, passive: true });

    ['touchstart', 'touchend', 'touchcancel'].forEach((type) => {
        document.addEventListener(type, (e) => {
            let text = ts() + ' ' + type;
            if (type === 'touchstart') text += ' -> ' + elInfo(e.target);
            pushLine(text);
        }, { capture: true, passive: true });
    });

    function bindTrackTransitionEnd() {
        const track = document.getElementById('bannerTrack');
        if (!track || track.dataset.bannerDebugBound) return;
        track.dataset.bannerDebugBound = '1';
        track.addEventListener('transitionend', (e) => {
            pushLine(ts() + ' transitionend prop=' + e.propertyName + ' target=' + (e.target === track ? 'track' : (e.target.tagName || '?')));
        });
    }
    bindTrackTransitionEnd(); // #bannerTrack — статичная разметка, уже в DOM к этому моменту

    renderStatus();
})();
