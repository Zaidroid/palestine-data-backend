import express from 'express';
import apicache from 'apicache';
import unifiedRoutes from './unified.js';
import searchRoutes from './search.js';
import alertsProxy from './alerts-proxy.js';
import { getCategories, getStats } from '../controllers/statsController.js';

const router = express.Router();
const cache = apicache.middleware;

router.use('/unified', unifiedRoutes);
router.use('/search', searchRoutes);

// Westbank-alerts proxy (checkpoints, alerts, weather, market, etc.)
router.use('/live', alertsProxy);

router.get('/categories', cache('10 minutes'), getCategories);
router.get('/stats', cache('10 minutes'), getStats);

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALERTS_API = process.env.ALERTS_API_URL || 'http://alerts:8080';

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
