/* ─── Shared line-icon set ───────────────────────────────────────
   Line icons (stroke, currentColor) in the "Классика маркетплейса"
   style, used in place of emoji for category tiles, neutral product
   placeholders and empty states. One source of truth so every page
   (catalog, cart, favorites, orders, product) draws the same set.
   ──────────────────────────────────────────────────────────────── */
const ICON_PATHS = {
    bolt:    '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    gun: '<path d="M3 5h13v6H3zM16 7h5v2h-5M6 11l-2 9h5l2-9M11 11h5v8h-5M4 8h8M13 5V3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    drill: '<path d="M3 5h12v7H3zM15 7h5m-5 3h4M7 12l-1 7h6l-1-7M5 19h9v2H5z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    fasteners: '<path d="M3 4h6m-3 0v16l2-3M12 4h6m-3 0v16l2-3M20 9h2m-1 0v11M4 8h4m5 0h4M4 11h4m5 0h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    pouch: '<path d="M3 7h18v13H3zM3 10h18M8 10v6h8v-6M7 7V3h3v4m4 0V3h3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    toolbox: '<path d="M3 8h18v12H3zM8 8V4h8v4M3 12h18M8 11v4m8-4v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    box:     '<path d="M3 8l9-5 9 5-9 5-9-5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 8v8l9 5 9-5V8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 13v8" stroke="currentColor" stroke-width="2"/>',
    wrench:  '<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.8 2.8-2-2 2.8-2.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    search:  '<circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/><path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    heart:   '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    cart:    '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="2"/><path d="M16 10a4 4 0 01-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    orders:  '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" stroke-width="2"/><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="16" x2="13" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    filter:  '<path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    image:   '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="10.5" r="1.5" stroke="currentColor" stroke-width="2"/><path d="M21 15l-5-5-5 5-3-3-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    alert:   '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>',
    chev:    '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    sale:    '<path d="M20 12.5 12.5 20a2 2 0 01-2.83 0l-6.67-6.67a2 2 0 010-2.83L10.5 3H19a1 1 0 011 1v8.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="14.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>',
    home:    '<path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 001 1h10a1 1 0 001-1v-9" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    grid:    '<rect x="2" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="15" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="2" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="15" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/>',
};

function iconSvg(name, size) {
    size = size || 20;
    const body = ICON_PATHS[name] || ICON_PATHS.box;
    return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">${body}</svg>`;
}

/* category.icon (emoji from /api/categories) → icon key. The API has no
   dedicated icon-key field yet, so this guesses from the emoji it already
   returns; unmapped categories fall back to DEFAULT_CATEGORY_ICON. Once
   an admin can pick an icon per category, point this at that field
   instead of guessing from the emoji. */
const CATEGORY_ICON_MAP = {
    '🔨': 'gun',
    '⚡': 'bolt',
    '📦': 'box',
    '🔧': 'wrench',
};
const DEFAULT_CATEGORY_ICON = 'box';

const CATEGORY_ART = {
    sale: '<path class="category-art__accent-line" d="m12 35 24-24"/><circle cx="14" cy="14" r="5" class="category-art__accent-line"/><circle cx="34" cy="34" r="5" class="category-art__accent-line"/>',
    gun: '<path class="category-art__body" d="M4 13h7v-3h30l3 5v13l-8 2-6-2 4 12-8 2-5-15h-6l2 14h13v4H7v-4h4L8 19H1v-3h3z"/><path class="category-art__paint" d="M14 11h25v14H14z"/><path class="category-art__detail" d="M17 15h7m-7 4h7M10 21l2 17M34 14h3"/>',
    drill: '<path class="category-art__body" d="M2 13h6l2-5h11V6h19l2 5v16l-7 3-1 9h6v7H17v-7h7l-2-17H10l-2-3H2z"/><path class="category-art__paint" d="M23 8h16v17H28v-5h-5zM20 39h18v5H20zM25 27h7v10h-5z"/><path class="category-art__detail" d="M12 12v7m5-7v7m12-7h7"/>',
    fasteners: '<path class="category-art__body" d="M6 11h5v26l-2 8-3-8zM18 8h5v26l-2 8-3-8zM30 5h5v26l-2 8-3-8zM40 3h5v25l-2 8-3-8z"/><path class="category-art__paint" d="m3 13 42-9v12L3 25z"/><path class="category-art__detail" d="m14 13 1 8m11-11 1 8m10-11 1 8"/>',
    pouch: '<path class="category-art__body" d="M16 3h16l4 11 7 4 1 22-11 5-10-2-9 2-10-6 2-20 7-5z"/><path class="category-art__paint" d="M15 5h18v4H15zM8 23l12 3v14l-11-4zM23 26l16-4v15l-15 4z"/><path class="category-art__detail" d="M14 14q10 7 22 0M17 10h14M24 29v8M10 21l9 2"/>',
    toolbox: '<path class="category-art__body" d="M29 1h12v28h3v15H8V12h21z"/><path class="category-art__detail" d="M31 10V3h8v7M9 20h33M9 31h33M12 15h10m-10 10h10m-10 12h10"/><path class="category-art__paint" d="M27 15h6v3h-6zM27 25h6v3h-6zM27 36h6v3h-6z"/><circle cx="12" cy="44" r="3" class="category-art__body"/><circle cx="41" cy="44" r="3" class="category-art__body"/>',
};

function categoryIconSvg(cat, size) {
    // Known product families override legacy emoji; new categories keep their fallback.
    const name = String(cat && cat.name || '').toLowerCase();
    let key;
    if (/монтажн.*пистолет/.test(name)) key = 'gun';
    else if (/систем.*хран[еа]н|органайзер|ящик/.test(name)) key = 'toolbox';
    else if (/экипиров|подсум|перчат|сумк/.test(name)) key = 'pouch';
    else if (/расход|креп[её]ж/.test(name)) key = 'fasteners';
    else if (/инструмент/.test(name)) key = 'drill';
    else if (/акци/.test(name)) key = 'sale';
    key = key || (cat && CATEGORY_ICON_MAP[cat.icon]) || DEFAULT_CATEGORY_ICON;
    if (!CATEGORY_ART[key]) return iconSvg(key, size);
    return `<svg class="i category-art" width="${size || 26}" height="${size || 26}" viewBox="0 0 48 48" fill="none" aria-hidden="true">${CATEGORY_ART[key]}</svg>`;
}
