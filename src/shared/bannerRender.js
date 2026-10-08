/* ─── Общий рендер баннера главной (window.BannerRender) ─────────────
   Используется и Главной (src/catalog/catalog.js), и живым превью в
   админке (admin/banners.js) — ОДНОЙ функцией, чтобы они не могли
   разойтись по мелочи (особенно расчёт авто-цвета текста). Чистый DOM,
   без зависимостей: текст баннера попадает в документ только через
   textContent/createTextNode, никогда через innerHTML — это и есть
   защита от XSS для text_blocks (сервер их не санитайзит как HTML,
   см. server/routes/banners.js, это осознанно не его слой).

   Подключается только там, где баннер реально рисуется: index.html
   (Главная) и admin/index.html (превью формы). На catalog.html этого
   скрипта нет — там нет #bannerTrack, и initBanner() в catalog.js
   выходит раньше, чем обратился бы к window.BannerRender (двойная
   проверка — см. catalog.js).

   CSS-классы (.banner-slide, .banner-bg--*, .banner-slide--pos-*,
   .banner-slide--overlay-*) определены в src/catalog/catalog.css
   (Главная) и зеркально — под .banner-preview-scope — в admin/admin.css
   (почему зеркально, а не общий файл: админка не может подключить
   catalog.css целиком, он сломал бы разметку админки своим ресетом/
   раскладкой; переменные --accent/--banner-* тоже зеркалятся отдельно
   в .banner-preview-scope, см. комментарий там). */
(function (global) {
    'use strict';

    const VALID_BG_STYLES = new Set(['brand', 'dark', 'light', 'warm', 'cool', 'steel', 'custom']);
    // Опорные px-значения — при ширине баннера ~390px (типичный телефон).
    // Сам шрифт рендерится НЕ в px, а в cqw (container query width: 1cqw =
    // 1% ширины .banner-slide, см. container-type:inline-size в catalog.css/
    // admin.css) — иначе на узком превью в админке (может быть любой
    // ширины, вплоть до широкого десктопа) и на Главной (320–430px) один
    // и тот же размер 'm' выглядел бы по-разному КРУПНЫМ относительно
    // баннера. clamp() не даёт тексту стать нечитаемо мелким/огромным на
    // совсем уж экстремальных ширинах контейнера.
    const SIZE_PX = { s: 12, m: 15, l: 19, xl: 25 };
    const FONT_REFERENCE_WIDTH = 390;
    function fontSizeFor(sizeKey) {
        const px  = SIZE_PX[sizeKey] || SIZE_PX.m;
        const cqw = (px / FONT_REFERENCE_WIDTH * 100).toFixed(2);
        const minPx = Math.round(px * 0.72);
        const maxPx = Math.round(px * 1.35);
        return `clamp(${minPx}px, ${cqw}cqw, ${maxPx}px)`;
    }

    function hexLuminance(hex) {
        const n = String(hex || '').replace('#', '').trim();
        if (n.length !== 6) return 255; // неизвестный/пустой цвет — считаем светлым (безопасный дефолт: тёмный текст)
        const r = parseInt(n.slice(0, 2), 16);
        const g = parseInt(n.slice(2, 4), 16);
        const b = parseInt(n.slice(4, 6), 16);
        if ([r, g, b].some(Number.isNaN)) return 255;
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    function cssVar(scopeEl, name) {
        const v = getComputedStyle(scopeEl).getPropertyValue(name);
        return (v || '').trim();
    }

    /* Реальные (посчитанные) hex-цвета фона — нужно и для авто-контраста,
       и для админского предупреждения о низком контрасте. */
    function getBgStopHexes(banner, scopeEl) {
        if (banner.bgStyle === 'custom' && banner.bgColor) return [banner.bgColor];
        const key = VALID_BG_STYLES.has(banner.bgStyle) ? banner.bgStyle : 'brand';
        if (key === 'brand') return [cssVar(scopeEl, '--accent'), cssVar(scopeEl, '--accent-press')].filter(Boolean);
        return [cssVar(scopeEl, `--banner-${key}-1`), cssVar(scopeEl, `--banner-${key}-2`)].filter(Boolean);
    }

    /* 'auto': с фото — всегда светлый текст (читаемость даёт затемнение,
       а не анализ пикселей фото, см. ТЗ). Без фото — по яркости фона. */
    function getAutoTextTone(banner, scopeEl) {
        if (banner.imageUrl) return 'light';
        const hexes = getBgStopHexes(banner, scopeEl);
        if (!hexes.length) return 'light';
        const avg = hexes.reduce((s, h) => s + hexLuminance(h), 0) / hexes.length;
        return avg > 150 ? 'dark' : 'light';
    }

    /* Итоговый hex текста одного блока — используется и при рендере, и
       админкой для предупреждения о контрасте. */
    function resolveBlockColorHex(block, banner, scopeEl) {
        switch (block.color) {
            case 'light':  return '#FFFFFF';
            case 'dark':   return cssVar(scopeEl, '--text-primary') || '#132420';
            case 'accent': return cssVar(scopeEl, '--accent') || '#0E7C6B';
            case 'custom': return block.customColor || '#FFFFFF';
            case 'auto':
            default: {
                const tone = getAutoTextTone(banner, scopeEl);
                return tone === 'dark' ? (cssVar(scopeEl, '--text-primary') || '#132420') : '#FFFFFF';
            }
        }
    }

    function applyBackground(el, banner) {
        if (banner.imageUrl) {
            el.classList.add('banner-slide--photo');
            el.style.backgroundImage = `url(${JSON.stringify(banner.imageUrl)})`;
            return;
        }
        if (banner.cls) { el.classList.add(banner.cls); return; } // легаси HOME_BANNERS-фолбэк — без изменений
        const key = VALID_BG_STYLES.has(banner.bgStyle) ? banner.bgStyle : 'brand';
        if (key === 'custom' && banner.bgColor) {
            el.style.background = banner.bgColor;
        } else {
            el.classList.add(`banner-bg--${key === 'custom' ? 'brand' : key}`);
        }
    }

    function applyOverlay(el, banner) {
        if (banner.cls) return; // легаси-фолбэк без фото никогда не затемняется
        const overlay = banner.overlay || 'medium';
        if (overlay !== 'none') el.classList.add(`banner-slide--overlay-${overlay}`);
    }

    function applyTextPos(el, banner) {
        if (banner.cls) return; // легаси-фолбэк — исходная вёрстка (по центру), не трогаем
        const pos = banner.textPos || 'bottom-left';
        el.classList.add(`banner-slide--pos-${pos}`);
    }

    /* index/interactive — только для интерактивного превью в админке (см.
       admin/banners.js): data-block-index + tabindex нужны ТОЛЬКО там, где
       реально есть что перетаскивать/двигать стрелками (настоящие
       text_blocks, не синтетические title/subtitle-блоки ниже, и не
       Главная — там interactive вообще не передаётся, см. catalog.js). */
    function buildBlockNode(block, banner, scopeEl, index, interactive) {
        const p = document.createElement('p');
        p.className = 'banner-slide__block';
        p.style.fontSize   = fontSizeFor(block.size);
        p.style.fontWeight = block.weight === 'bold' ? '800' : '500';
        p.style.fontStyle  = block.italic ? 'italic' : 'normal';
        p.style.textAlign  = block.align || 'left';
        p.style.color      = resolveBlockColorHex(block, banner, scopeEl);
        // x/y — опциональная позиция блока в % от баннера (0–100, левый
        // верхний угол блока), см. server/routes/banners.js. Блок БЕЗ них
        // остаётся в обычном потоке .banner-slide__blocks — выравнивается
        // через text_pos, как и раньше (обратная совместимость, см. ТЗ).
        if (typeof block.x === 'number' && typeof block.y === 'number') {
            p.classList.add('banner-slide__block--positioned');
            p.style.left = `${block.x}%`;
            p.style.top  = `${block.y}%`;
        }
        if (interactive && typeof index === 'number') {
            p.dataset.blockIndex = String(index);
            p.tabIndex = 0;
        }
        p.appendChild(document.createTextNode(block.text)); // textContent-эквивалент — никогда innerHTML
        return p;
    }

    /* Легаси-рендер (HOME_BANNERS-фолбэк с полем cls, см. catalog.js) —
       буквально как было до этой сессии: <b>/<span>, без оформления. */
    function buildLegacyTextNode(banner) {
        // DocumentFragment, а не обёртка-<span>: при вставке остаются
        // только дочерние узлы как есть, без лишнего обёрточного
        // элемента — разметка 1-в-1 как была (<b>/<span> напрямую
        // внутри .banner-slide), без зависимости от display:contents.
        const frag = document.createDocumentFragment();
        const b = document.createElement('b');
        b.appendChild(document.createTextNode(banner.title || ''));
        frag.appendChild(b);
        const sub = banner.subtitle ?? banner.sub;
        if (sub) {
            const span = document.createElement('span');
            span.appendChild(document.createTextNode(sub));
            frag.appendChild(span);
        }
        return frag;
    }

    /* Реальный баннер без text_blocks (title/subtitle) — тоже через общий
       путь оформления фона/затемнения/положения (их админ мог настроить
       даже не переходя на блоки), но текст — заголовок крупным + подзаголовок
       мельче, как сейчас выглядит title/subtitle. Возвращает ДАННЫЕ (как
       настоящие text_blocks), а не готовые DOM-узлы — buildBannerSlideElement
       строит из них узлы той же функцией buildBlockNode, что и для настоящих
       блоков, так что опечатка/расхождение в оформлении исключены. У этих
       синтетических блоков x/y никогда не бывает (title/subtitle — не
       перетаскиваемые data-блоки, см. admin/banners.js), поэтому они всегда
       остаются в обычном потоке .banner-slide__blocks. */
    function buildTitleSubtitleBlocksData(banner) {
        const blocks = [];
        if (banner.title) {
            blocks.push({ text: banner.title, size: 'm', weight: 'bold', italic: false, color: 'auto', align: 'left' });
        }
        if (banner.subtitle) {
            blocks.push({ text: banner.subtitle, size: 's', weight: 'regular', italic: false, color: 'auto', align: 'left', _opacity: '.9' });
        }
        return blocks;
    }

    /* Главная точка входа. scopeEl — элемент, из которого читаются
       CSS-переменные --accent/--banner-* (document.documentElement на
       Главной, где они объявлены на :root в theme.css; на превью в
       админке — уже вставленный в DOM .banner-preview-scope, где те же
       переменные объявлены локально, см. admin/admin.css). Должен быть
       УЖЕ в документе на момент вызова — иначе getComputedStyle не
       сможет унаследовать переменные (на оторванном от DOM узле
       наследования нет). */
    function buildBannerSlideElement(banner, scopeEl, options) {
        scopeEl = scopeEl || document.documentElement;
        const interactive = !!(options && options.interactive); // только admin/banners.js
        const el = document.createElement('div');
        el.className = 'banner-slide';

        applyBackground(el, banner);

        if (banner.cls) {
            applyTextPos(el, banner); // no-op, оставлено для симметрии
            el.appendChild(buildLegacyTextNode(banner));
            return el;
        }

        applyOverlay(el, banner);
        applyTextPos(el, banner);

        const blocksWrap = document.createElement('div');
        blocksWrap.className = 'banner-slide__blocks';

        // interactive (data-block-index/tabindex, см. buildBlockNode) —
        // только для настоящих text_blocks, никогда для синтетических
        // title/subtitle-блоков (их не существует как отдельных записей,
        // двигать там нечего — см. комментарий у buildTitleSubtitleBlocksData).
        const isRealBlocks = !!(banner.textBlocks && banner.textBlocks.length);
        const blockData    = isRealBlocks ? banner.textBlocks : buildTitleSubtitleBlocksData(banner);
        const canInteract  = interactive && isRealBlocks;

        blockData.forEach((b, i) => {
            const node = buildBlockNode(b, banner, scopeEl, i, canInteract);
            if (b._opacity) node.style.opacity = b._opacity;
            // Позиционированные блоки (x/y) — прямо в .banner-slide (их
            // position:absolute считается от него, см. catalog.css/admin.css),
            // обычные — в .banner-slide__blocks, выравниваются через text_pos,
            // как раньше.
            if (node.classList.contains('banner-slide__block--positioned')) el.appendChild(node);
            else blocksWrap.appendChild(node);
        });

        el.appendChild(blocksWrap);
        return el;
    }

    global.BannerRender = {
        buildBannerSlideElement,
        getAutoTextTone,
        resolveBlockColorHex,
        getBgStopHexes,
        hexLuminance,
        SIZE_PX,
    };
})(window);
