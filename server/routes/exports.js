const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');

const EXPORTS_DIR = process.env.EXPORT_DIR || '/tmp/exports';

/* GET /api/exports/list */
router.get('/list', (req, res) => {
    try {
        if (!fs.existsSync(EXPORTS_DIR)) return res.json([]);
        const files = fs.readdirSync(EXPORTS_DIR)
            .filter(name => !name.startsWith('.'))
            .map(name => {
                const stat = fs.statSync(path.join(EXPORTS_DIR, name));
                return { name, size: stat.size, createdAt: stat.birthtime, modifiedAt: stat.mtime };
            })
            .sort((a, b) => b.modifiedAt - a.modifiedAt);
        res.json(files);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
