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
    const SIZE_PX = { s: 12, m: 15, l: 19, xl: 25 };

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

    function buildBlockNode(block, banner, scopeEl) {
        const p = document.createElement('p');
        p.className = 'banner-slide__block';
        p.style.fontSize   = `${SIZE_PX[block.size] || SIZE_PX.m}px`;
        p.style.fontWeight = block.weight === 'bold' ? '800' : '500';
        p.style.fontStyle  = block.italic ? 'italic' : 'normal';
        p.style.textAlign  = block.align || 'left';
        p.style.color      = resolveBlockColorHex(block, banner, scopeEl);
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

    /* Реальный баннер без text_blocks (title/subtitle) — тоже через
       общий путь оформления фона/затемнения/положения (их админ мог
       настроить даже не переходя на блоки), но текст — заголовок
       крупным + подзаголовок мельче, как сейчас выглядит title/subtitle. */
    function buildTitleSubtitleBlocks(banner, scopeEl) {
        const blocks = [];
        if (banner.title) {
            blocks.push(buildBlockNode(
                { text: banner.title, size: 'm', weight: 'bold', italic: false, color: 'auto', align: 'left' },
                banner, scopeEl
            ));
        }
        if (banner.subtitle) {
            const sub = buildBlockNode(
                { text: banner.subtitle, size: 's', weight: 'regular', italic: false, color: 'auto', align: 'left' },
                banner, scopeEl
            );
            sub.style.opacity = '.9';
            blocks.push(sub);
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
    function buildBannerSlideElement(banner, scopeEl) {
        scopeEl = scopeEl || document.documentElement;
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

        const blocks = (banner.textBlocks && banner.textBlocks.length)
            ? banner.textBlocks.map(b => buildBlockNode(b, banner, scopeEl))
            : buildTitleSubtitleBlocks(banner, scopeEl);

        blocks.forEach(node => blocksWrap.appendChild(node));
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
