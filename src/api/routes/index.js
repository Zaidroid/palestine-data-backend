import express from 'express';
import apicache from 'apicache';
import unifiedRoutes from './unified.js';
import searchRoutes from './search.js';
import alertsProxy from './alerts-proxy.js';
import newsRoutes from './news.js';
import { getCategories, getStats } from '../controllers/statsController.js';

const router = express.Router();
const cache = apicache.middleware;

router.use('/unified', unifiedRoutes);
router.use('/search', searchRoutes);

// Westbank-alerts proxy (checkpoints, alerts, weather, market, etc.)
router.use('/live', alertsProxy);

// News feed (RSS + scheduled fetcher → news.db)
router.use('/news', newsRoutes);

router.get('/categories', cache('10 minutes'), getCategories);
router.get('/stats', cache('10 minutes'), getStats);

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

// Gaza daily casualty bulletin (demographic breakdown + daily deltas)
router.get('/gaza/daily', cache('10 minutes'), async (req, res) => {
    try {
        const p = path.join(__dirname, '../../../public/data/gaza/daily.json');
        const content = JSON.parse(await fs.readFile(p, 'utf8'));
        const since = req.query.since;
        if (since) {
            content.data = content.data.filter(r => r.date >= since);
            content.metadata.record_count = content.data.length;
        }
        res.json(content);
    } catch (e) {
        res.status(503).json({ error: 'Gaza daily data unavailable', detail: e.message });
    }
});

router.get('/gaza/summary', cache('10 minutes'), async (req, res) => {
    try {
        const p = path.join(__dirname, '../../../public/data/gaza/summary.json');
        res.json(JSON.parse(await fs.readFile(p, 'utf8')));
    } catch (e) {
        res.status(503).json({ error: 'Gaza summary unavailable', detail: e.message });
    }
});

router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), schema_version: '3.0.0' });
});

router.get('/health-deep', async (req, res) => {
    const health = { status: 'ok', components: {} };

    // 1. Pipeline Freshness check
    try {
        const manifestPath = path.join(__dirname, '../../../public/data/unified/unified-manifest.json');
        const content = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const generatedAt = new Date(content.generated_at);
        const hoursStale = (new Date() - generatedAt) / (1000 * 60 * 60);

        health.components.pipeline = {
            status: hoursStale < 48 ? 'ok' : 'degraded',
            last_run: content.generated_at,
            total_records: content.total_records
        };
        if (hoursStale >= 48) health.status = 'degraded';
    } catch (e) {
        health.components.pipeline = { status: 'down', error: e.message };
        health.status = 'degraded';
    }

    // 2. Python Live Alerts Layer check
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${ALERTS_API}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        health.components.alerts_layer = {
            status: response.ok ? 'ok' : 'down',
            http_code: response.status
        };
        if (!response.ok) health.status = 'degraded';
    } catch (e) {
        health.components.alerts_layer = { status: 'down', error: e.message };
        health.status = 'degraded';
    }

    res.status(health.status === 'ok' ? 200 : 207).json(health);
});

export default router;
