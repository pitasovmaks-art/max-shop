/* ─── Shared line-icon set ───────────────────────────────────────
   Line icons (stroke, currentColor) in the "Классика маркетплейса"
   style, used in place of emoji for category tiles, neutral product
   placeholders and empty states. One source of truth so every page
   (catalog, cart, favorites, orders, product) draws the same set.
   ──────────────────────────────────────────────────────────────── */
const ICON_PATHS = {
    bolt:    '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    gun:     '<rect x="3" y="9" width="13" height="6" rx="1.5" stroke="currentColor" stroke-width="2"/><path d="M16 11h4v2h-4z" stroke="currentColor" stroke-width="2"/><path d="M7 15v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
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

function categoryIconSvg(cat, size) {
    const key = (cat && CATEGORY_ICON_MAP[cat.icon]) || DEFAULT_CATEGORY_ICON;
    return iconSvg(key, size);
}
