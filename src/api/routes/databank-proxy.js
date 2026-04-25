/**
 * Databank Proxy Routes
 *
 * Forwards GET /api/v1/databank/* to the alerts service at /databank/*.
 * Single passthrough — the alerts service owns the schema, query
 * validation, and GeoJSON projection. Node API only handles transport.
 */

import express from 'express';
import http from 'http';
import { URL } from 'url';

const router = express.Router();
const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

// Catch-all GET middleware. `req.path` is what came after /api/v1/databank,
// e.g. "/people_killed" or "/people_killed/summary". Express 5 dropped
// support for `router.get('*')` so we use middleware form instead.
router.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const upstreamPath = '/databank' + req.path;
    const qs = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    const url = new URL(upstreamPath + qs, ALERTS_API);

    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeout: 15000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        res.status(proxyRes.statusCode);
        if (proxyRes.headers['content-type']) {
            res.setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
        res.status(502).json({ error: 'Databank service unavailable', detail: err.message });
    });
    proxyReq.on('timeout', () => {
        proxyReq.destroy();
        res.status(504).json({ error: 'Databank service timeout' });
    });
    proxyReq.end();
});

export default router;
