const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'VPNAFQDEKCCG';

function requireAdmin(req, res, next) {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

module.exports = { requireAdmin, ADMIN_PASSWORD };
