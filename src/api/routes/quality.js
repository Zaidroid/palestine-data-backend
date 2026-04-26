import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { URL } from 'url';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUALITY_PATH = path.resolve(__dirname, '../../../public/data/unified/quality.json');
const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

const router = express.Router();
const cache = apicache.middleware;

// /api/v1/quality/corroboration — live tracker corroboration stats
// (per-type boost rate from Insecurity Insight + ACLED). Proxied to the
// alerts service which owns the alerts.db read.
router.get('/corroboration', cache('5 minutes'), (req, res) => {
    const days = req.query.days ? `?days=${encodeURIComponent(req.query.days)}` : '';
    const url = new URL('/quality/corroboration' + days, ALERTS_API);
    const proxyReq = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 10000,
    }, (proxyRes) => {
        res.status(proxyRes.statusCode);
        if (proxyRes.headers['content-type']) {
            res.setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) =>
        res.status(502).json({ error: 'corroboration_unavailable', detail: err.message }));
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.status(504).json({ error: 'corroboration_timeout' });
    });
    proxyReq.end();
});

router.get('/', cache('1 hour'), async (req, res) => {
    try {
        const raw = await fs.readFile(QUALITY_PATH, 'utf8');
        const snap = JSON.parse(raw);
        // Add per-call staleness so consumers know how stale the snapshot itself is.
        const generatedAt = snap.generated_at;
        if (generatedAt) {
            const ageSeconds = Math.max(
                0,
                Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000)
            );
            for (const cat of Object.values(snap.categories || {})) {
                if (cat.last_fetch_success_at) {
                    cat.staleness_seconds = Math.max(
                        0,
                        Math.floor(
                            (Date.now() - new Date(cat.last_fetch_success_at).getTime()) / 1000
                        )
                    );
                }
            }
            snap.snapshot_age_seconds = ageSeconds;
        }
        res.json(snap);
    } catch (e) {
        if (e.code === 'ENOENT') {
            return res.status(503).json({
                error: 'quality_snapshot_missing',
                hint: 'Run `node scripts/generate-quality-snapshot.js` to populate public/data/unified/quality.json.',
            });
        }
        (req.log || console).error({ err: e }, 'quality_snapshot_failed');
        res.status(503).json({ error: 'quality_snapshot_failed', detail: e.message });
    }
});

export default router;
