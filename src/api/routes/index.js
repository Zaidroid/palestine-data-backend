import express from 'express';
import apicache from 'apicache';
import unifiedRoutes from './unified.js';
import searchRoutes from './search.js';
import alertsProxy from './alerts-proxy.js';
import databankProxy from './databank-proxy.js';
import databankTotals from './databank-totals.js';
import newsRoutes from './news.js';
import licensesRoutes from './licenses.js';
import sourcesRoutes from './sources.js';
import versionRoutes from './version.js';
import qualityRoutes from './quality.js';
import recordRoutes from './record.js';
import snapshotsRoutes from './snapshots.js';
import meRoutes from './me.js';
import billingRoutes from './billing.js';
import { getCategories, getStats } from '../controllers/statsController.js';

const router = express.Router();
const cache = apicache.middleware;

router.use('/unified', unifiedRoutes);
router.use('/search', searchRoutes);

// Westbank-alerts proxy (checkpoints, alerts, weather, market, etc.)
router.use('/live', alertsProxy);

// Long-term entity databank: people_killed, people_injured, people_detained,
// structures_damaged, actor_actions. Backed by alerts service tables.
// /databank/totals is served Node-side because it reads public/data/gaza
// summary files; everything else proxies to the alerts service.
router.get('/databank/totals', databankTotals);
router.use('/databank', databankProxy);

// News feed (RSS + scheduled fetcher → news.db)
router.use('/news', newsRoutes);

// Upstream-source license registry (trust-foundation surface for NGO/journalist customers)
router.use('/licenses', licensesRoutes);

// Authoritative source registry: every upstream + its cadence, coverage,
// categories fed, live freshness. Foundation for self-aware data.
router.use('/sources', sourcesRoutes);

// Trust-foundation surfaces (A2/A3/A4): citable version, quality, per-record permalinks
router.use('/version', versionRoutes);
router.use('/quality', qualityRoutes);
router.use('/record', recordRoutes);
router.use('/snapshots', snapshotsRoutes);

// Customer surfaces (C3/C4): own-key usage stats + Stripe billing
router.use('/me', meRoutes);
router.use('/billing', billingRoutes);

router.get('/categories', cache('10 minutes'), getCategories);
router.get('/stats', cache('10 minutes'), getStats);

router.get('/', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}/api/v1`;
    const docsBase = `${req.protocol}://${req.get('host')}`;
    res.json({
        name: 'Palestine Data API',
        description: 'Unified historical datasets + live operational alerts for Palestine.',
        version: '1.0',
        repository: 'https://github.com/zaidsalem/palestine-data-backend',
        interactive_docs: `${docsBase}/api-docs/`,
        endpoints: {
            discovery: {
                [`GET ${base}/`]: 'this index',
                [`GET ${docsBase}/api-docs/`]: 'interactive Swagger UI',
                [`GET ${base}/health`]: 'liveness',
                [`GET ${base}/health-deep`]: 'pipeline + alerts connectivity',
                [`GET ${base}/version`]: 'build SHA + pipeline generated-at',
                [`GET ${base}/categories`]: 'live category list with record counts',
                [`GET ${base}/stats`]: 'cross-category aggregates',
                [`GET ${base}/quality`]: 'per-category freshness + coverage',
                [`GET ${base}/licenses`]: 'license registry for all sources',
            },
            unified_data: {
                [`GET ${base}/unified/:category`]: 'paginated records (filters: location, region, event_type, date range)',
                [`GET ${base}/unified/:category/summary`]: 'aggregated metrics',
                [`GET ${base}/unified/:category/timeseries`]: 'time-series buckets (?metric=&interval=&region=)',
                [`GET ${base}/unified/:category/metadata`]: 'schema + provenance',
                [`GET ${base}/search?q=`]: 'full-text search across categories',
                [`GET ${base}/record/:category/:id`]: 'single record by stable id',
                [`GET ${base}/snapshots`]: 'list pinned daily snapshots (?as_of=YYYY-MM-DD)',
            },
            gaza: {
                [`GET ${base}/gaza/daily`]: 'daily casualty bulletin with demographic breakdown',
                [`GET ${base}/gaza/summary`]: 'cumulative Gaza summary',
            },
            news: {
                [`GET ${base}/news`]: 'aggregated news headlines (fair-use)',
            },
            live_alerts_proxy: {
                [`GET ${base}/live/alerts/latest`]: 'most recent alerts',
                [`GET ${base}/live/alerts`]: 'paginated alerts (?since=&min_confidence=&areas=)',
                [`GET ${base}/live/alerts/export`]: 'bulk ndjson/csv export (auth)',
                [`GET ${base}/live/checkpoints`]: 'current checkpoint statuses',
                [`GET ${base}/live/checkpoints/:key/history`]: 'status transitions in window',
                [`GET ${base}/live/checkpoints/uptime`]: '% open/closed/restricted per checkpoint',
                [`WS  ${base.replace('https', 'wss').replace('http', 'ws')}/live/ws`]: 'real-time alert WebSocket',
                [`GET ${base}/live/stream`]: 'real-time alert SSE',
                'note': 'Direct alerts service: https://wb-alerts.zaidlab.xyz',
            },
            categories_available: [
                'water', 'martyrs_snapshot_2023', 'health', 'funding', 'education',
                'westbank', 'conflict', 'economic', 'infrastructure', 'refugees',
                'pcbs', 'land', 'culture', 'news',
            ],
        },
        notes: [
            'All responses include freshness metadata. Stale categories (>90 days) carry a "Warning: 299" header.',
            'License is per-source — see /licenses. Some sources are non-commercial (WHO, certain news, B\'Tselem).',
            'No auth required for discovery, health, or read endpoints. Rate-limited per IP.',
        ],
    });
});

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
