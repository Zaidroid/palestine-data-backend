/**
 * Alerts Proxy Routes
 * 
 * Proxies requests to the westbank-alerts FastAPI backend running on the local network.
 * This allows the frontend to use a single API origin for all data.
 */

import express from 'express';
import http from 'http';
import { URL } from 'url';
import { LiveTransformer } from '../utils/live-transformer.js';

const router = express.Router();

// The westbank-alerts backend URL - configurable via env
const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

/**
 * Generic proxy handler that forwards requests to the alerts backend
 */
function proxyRequest(targetPath, transformFn = null) {
    return async (req, res) => {
        try {
            const url = new URL(targetPath + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''), ALERTS_API);
            
            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: req.method,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                timeout: 10000,
            };
            
            const proxyReq = http.request(options, (proxyRes) => {
                if (!transformFn || proxyRes.statusCode >= 400) {
                    res.status(proxyRes.statusCode);
                    if (proxyRes.headers['content-type']) {
                        res.setHeader('Content-Type', proxyRes.headers['content-type']);
                    }
                    proxyRes.pipe(res);
                } else {
                    let data = '';
                    proxyRes.on('data', chunk => { data += chunk; });
                    proxyRes.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            const transformed = transformFn(parsed);
                            res.status(proxyRes.statusCode).json(transformed);
                        } catch (err) {
                            res.status(500).json({ error: 'Transformation failed', detail: err.message });
                        }
                    });
                }
            });

            proxyReq.on('error', (err) => {
                console.error(`Proxy error for ${targetPath}:`, err.message);
                res.status(502).json({ 
                    error: 'Alerts service unavailable',
                    detail: err.message 
                });
            });
            
            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                res.status(504).json({ error: 'Alerts service timeout' });
            });
            
            // Forward body if present
            if (req.body && Object.keys(req.body).length > 0) {
                proxyReq.write(JSON.stringify(req.body));
            }
            
            proxyReq.end();
        } catch (err) {
            console.error(`Proxy setup error for ${targetPath}:`, err.message);
            res.status(500).json({ error: 'Internal proxy error' });
        }
    };
}

/**
 * SSE proxy handler for real-time streams
 */
function proxySSE(targetPath) {
    return (req, res) => {
        const url = new URL(targetPath, ALERTS_API);
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' },
        };

        const proxyReq = http.request(options, (proxyRes) => {
            proxyRes.on('data', (chunk) => {
                res.write(chunk);
            });

            proxyRes.on('end', () => {
                res.end();
            });
        });

        proxyReq.on('error', (err) => {
            console.error(`SSE proxy error for ${targetPath}:`, err.message);
            res.write(`data: ${JSON.stringify({ event: 'error', message: err.message })}\n\n`);
            res.end();
        });

        req.on('close', () => {
            proxyReq.destroy();
        });

        proxyReq.end();
    };
}

// ── Alert endpoints ──────────────────────────────────────────────────────────
router.get('/alerts', proxyRequest('/alerts', LiveTransformer.transformAlerts));
router.get('/alerts/latest', proxyRequest('/alerts/latest', LiveTransformer.transformAlerts));
router.get('/alerts/active', proxyRequest('/alerts/active', LiveTransformer.transformAlerts));
router.get('/alerts/:id', (req, res) => proxyRequest(`/alerts/${req.params.id}`)(req, res));
router.get('/incidents', proxyRequest('/incidents'));
router.get('/incidents/summary', proxyRequest('/incidents/summary'));
router.get('/sirens', proxyRequest('/sirens'));

// ── Checkpoint endpoints ─────────────────────────────────────────────────────
router.get('/checkpoints', proxyRequest('/checkpoints', LiveTransformer.transformCheckpoints));
router.get('/checkpoints/closed', proxyRequest('/checkpoints/closed', LiveTransformer.transformCheckpoints));
router.get('/checkpoints/stats', proxyRequest('/checkpoints/stats'));
router.get('/checkpoints/summary', proxyRequest('/checkpoints/summary'));
router.get('/checkpoints/geojson', proxyRequest('/checkpoints/geojson')); // usually geojsons don't need transformation here if structure is right, but keep it clear
router.get('/checkpoints/regions', proxyRequest('/checkpoints/regions'));
router.get('/checkpoints/updates/feed', proxyRequest('/checkpoints/updates/feed'));
router.get('/checkpoints/nearby', proxyRequest('/checkpoints/nearby'));
router.get('/checkpoints/:key', (req, res) => proxyRequest(`/checkpoints/${encodeURIComponent(req.params.key)}`)(req, res));

// ── Contextual data endpoints ────────────────────────────────────────────────
router.get('/weather', proxyRequest('/weather'));
router.get('/market', proxyRequest('/market'));
router.get('/market/currency', proxyRequest('/market/currency'));
router.get('/market/gold', proxyRequest('/market/gold'));
router.get('/market/fuel', proxyRequest('/market/fuel'));
router.get('/prayer-times', proxyRequest('/prayer-times'));
router.get('/air-quality', proxyRequest('/air-quality'));
router.get('/internet-status', proxyRequest('/internet-status'));
router.get('/conditions', proxyRequest('/conditions'));
router.get('/zones', proxyRequest('/zones'));
router.get('/stats/alerts', proxyRequest('/stats'));
router.get('/stats/today', proxyRequest('/stats/today'));

// ── Real-time streams ────────────────────────────────────────────────────────
router.get('/stream', proxySSE('/stream'));
router.get('/checkpoints/stream', proxySSE('/checkpoints/stream'));

export default router;
