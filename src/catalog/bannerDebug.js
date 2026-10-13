/* ─── Диагностика свайпа баннера (включается скрытым жестом) ────────────
   Подгружается динамически ТОЛЬКО когда localStorage.bannerDebug задан —
   см. _bannerDebugTapHook()/initBanner() в src/catalog/catalog.js (7
   нажатий за 3с на пустой фон шапки переключают значение '1'). По
   умолчанию этот файл вообще не запрашивается и ничего не показывает.

   Значения bannerDebug (второе и третье — только для ручной проверки из
   консоли/DevTools, жест умеет переключать лишь '1'):
     '1'         — полный режим: и плашка, и лог событий (как раньше).
     'listeners' — только слушатели, лог идёт в console.log, никакой
                   плашки на экране. Нужно, чтобы отдельно проверить,
                   чинит ли свайп именно НАЛИЧИЕ слушателей (см. гипотезу
                   у _bannerWebkitTouchHint() в catalog.js) без побочного
                   эффекта от видимого position:fixed слоя.
     'panel'     — только плашка с живым статусом #bannerTrack (transform/
                   ширина/слайды), обновляется таймером — без единого
                   своего слушателя событий. Нужно для обратной проверки:
                   чинит ли свайп именно fixed-слой/лишний reflow от
                   подгрузки скрипта, а не слушатели.

   Намеренно НЕ использует ничего из приватного состояния карусели
   (_bannerState, _bannerDrag и т.п. в catalog.js) — весь лог собирается
   независимо, через свои слушатели на document (capture, passive) и
   прямые замеры DOM #bannerTrack.

   Плашка (когда есть): pointer-events:none (никогда не перехватывает
   нажатия/свайпы, которые сама же логирует), только textContent (без
   innerHTML), мелкий монослейс — рассчитана на то, что её сфотографируют
   скриншотом с телефона, а не читают в живом виде построчно. */
(function () {
    const mode = localStorage.getItem('bannerDebug');
    const wantPanel     = mode === '1' || mode === 'panel';
    const wantListeners = mode === '1' || mode === 'listeners';
    if (!wantPanel && !wantListeners) return;

    const MAX_LINES = 20;
    let panel = null, statusLine = null, logWrap = null;
    const lines = []; // DOM-строки лога, старые уводятся при переполнении

    if (wantPanel) {
        panel = document.createElement('div');
        panel.id = 'bannerDebugPanel';
        panel.style.cssText = [
            'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:999999',
            'max-height:46vh', 'overflow:hidden', 'pointer-events:none',
            'background:rgba(0,0,0,.82)', 'color:#3CE66D',
            'font:9px/1.35 ui-monospace,Menlo,Consolas,monospace',
            'padding:6px 8px', 'white-space:pre-wrap', 'word-break:break-all',
        ].join(';');
        document.body.appendChild(panel);

        statusLine = document.createElement('div');
        statusLine.style.cssText = 'color:#FFD60A;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,.3);padding-bottom:3px;';
        panel.appendChild(statusLine);

        logWrap = document.createElement('div');
        panel.appendChild(logWrap);
    }

    function elInfo(el) {
        if (!el || !el.tagName) return String(el);
        const cls = el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : '';
        const parent = el.parentElement;
        const pCls = parent && parent.className ? '.' + String(parent.className).trim().replace(/\s+/g, '.') : '';
        const pTag = parent ? parent.tagName : '?';
        return el.tagName + cls + ' в ' + pTag + pCls;
    }

    function renderStatus() {
        if (!statusLine) return;
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

    // log(text) — пишет строку либо в плашку (если есть), либо в консоль
    // (режим 'listeners' без плашки). Используется только слушателями,
    // поэтому если !wantListeners, log() ни разу не вызывается.
    function log(text) {
        if (!wantPanel) { console.log('[bannerDebug]', text); return; }
        const row = document.createElement('div');
        row.textContent = text;
        logWrap.appendChild(row);
        lines.push(row);
        while (lines.length > MAX_LINES) lines.shift().remove();
        renderStatus();
        return row;
    }

    function ts() { return performance.now().toFixed(0) + 'мс'; }

    if (wantListeners) {
        // pointerdown/pointerup/pointercancel — по одной строке на
        // событие; pointerdown показывает, какой элемент получил нажатие.
        // moveStarted — какие pointerId уже залогировали свой первый move
        // В ЭТОМ жесте; сбрасывается на каждый новый pointerdown — общее
        // для обоих режимов (с плашкой и в консоль), чтобы "первое" было
        // первым именно за жест, а не один раз за всё время жизни страницы.
        const moveStarted = new Set();
        const lastRowByPointer = new Map(); // pointerId -> DOM-строка "последнее" (только когда есть плашка)
        ['pointerdown', 'pointerup', 'pointercancel'].forEach((type) => {
            document.addEventListener(type, (e) => {
                if (type === 'pointerdown') { moveStarted.delete(e.pointerId); lastRowByPointer.delete(e.pointerId); }
                let text = ts() + ' ' + type + ' x=' + Math.round(e.clientX) + ',y=' + Math.round(e.clientY) +
                    ' id=' + e.pointerId + ' pointerType=' + e.pointerType;
                if (type === 'pointerdown') text += ' -> ' + elInfo(e.target);
                log(text);
            }, { capture: true, passive: true });
        });

        // pointermove — только первое и последнее за жест (ТЗ): первое —
        // отдельная неизменяемая строка (или одна console.log-строка без
        // плашки); последнее — с плашкой обновляется на месте на каждый
        // move, без плашки (console.log) отдельно не дублируется — конец
        // жеста и так виден по строке pointerup/pointercancel выше.
        document.addEventListener('pointermove', (e) => {
            const text = ts() + ' pointermove x=' + Math.round(e.clientX) + ',y=' + Math.round(e.clientY) + ' id=' + e.pointerId;
            if (!moveStarted.has(e.pointerId)) {
                moveStarted.add(e.pointerId);
                log(text.replace('pointermove', 'pointermove(первое)'));
                if (wantPanel) lastRowByPointer.set(e.pointerId, log(text.replace('pointermove', 'pointermove(последнее)')));
            } else if (wantPanel) {
                const row = lastRowByPointer.get(e.pointerId);
                if (row) { row.textContent = text.replace('pointermove', 'pointermove(последнее)'); renderStatus(); }
            }
        }, { capture: true, passive: true });

        ['touchstart', 'touchend', 'touchcancel'].forEach((type) => {
            document.addEventListener(type, (e) => {
                let text = ts() + ' ' + type;
                if (type === 'touchstart') text += ' -> ' + elInfo(e.target);
                log(text);
            }, { capture: true, passive: true });
        });

        const track = document.getElementById('bannerTrack');
        if (track && !track.dataset.bannerDebugBound) {
            track.dataset.bannerDebugBound = '1';
            track.addEventListener('transitionend', (e) => {
                log(ts() + ' transitionend prop=' + e.propertyName + ' target=' + (e.target === track ? 'track' : (e.target.tagName || '?')));
            });
        }
    }

    if (wantPanel) {
        renderStatus();
        if (!wantListeners) setInterval(renderStatus, 300); // нет слушателей — обновляем статус таймером
    }
})();
