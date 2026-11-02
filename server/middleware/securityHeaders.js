function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.path === '/admin' || req.path.startsWith('/admin/')) {
        res.setHeader('X-Frame-Options', 'DENY');
        // Existing admin uses inline handlers/styles. Block third-party scripts,
        // embedding, plugins and base URL changes without breaking those handlers.
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    } else {
        // Max embeds the storefront. Do not narrow its ancestors without device QA.
        res.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors *");
    }
    if (req.path.startsWith('/api/') && (req.headers.authorization || req.headers['x-init-data'] || req.headers['x-internal-secret'] || req.path.startsWith('/api/auth'))) {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
}
module.exports = { securityHeaders };
