/**
 * Source registry endpoint.
 *
 * GET /api/v1/sources
 *   Lists every upstream source feeding the Palestine Data Backend with
 *   organization, license, update cadence, time coverage, the unified
 *   categories + databank tables it feeds, and a `last_known_record_at`
 *   pulled from quality.json so consumers see live freshness per source.
 *
 * GET /api/v1/sources/{id}
 *   Single source detail.
 *
 * Backed by src/api/data/sources.json — the authoritative registry.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCES_PATH = path.resolve(__dirname, '../data/sources.json');
const QUALITY_PATH = path.resolve(__dirname, '../../../public/data/unified/quality.json');
const REFRESH_STATUS_PATH = path.resolve(__dirname, '../../../public/data/refresh-status.json');

const router = express.Router();

async function loadJsonSafe(p) {
    try {
        return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
        return null;
    }
}

// Per-call cache; very small files, but we re-parse each request to pick
// up changes from the daily refresh without restarting the API.
async function loadRegistry() {
    const [registry, quality, refreshStatus] = await Promise.all([
        loadJsonSafe(SOURCES_PATH),
        loadJsonSafe(QUALITY_PATH),
        loadJsonSafe(REFRESH_STATUS_PATH),
    ]);
    return { registry, quality, refreshStatus };
}

function annotateSource(id, entry, quality, refreshStatus) {
    // Look up the freshest category this source feeds, then surface it.
    const cats = quality?.categories || {};
    let bestLatest = null;
    let bestCategory = null;
    let totalRecords = 0;
    for (const cat of (entry.feeds_categories || [])) {
        const c = cats[cat];
        if (!c) continue;
        totalRecords += c.total || 0;
        const latest = c.latest_record_at;
        if (latest && (!bestLatest || latest > bestLatest)) {
            bestLatest = latest;
            bestCategory = cat;
        }
    }
    // Phase C: cross-reference the per-fetcher health from refresh-status.json.
    let fetcherHealth = null;
    if (entry.fetcher_name && refreshStatus?.fetchers?.[entry.fetcher_name]) {
        const f = refreshStatus.fetchers[entry.fetcher_name];
        fetcherHealth = {
            health: f.health,
            latest_outcome: f.latest_outcome,
            latest_at: f.latest_at,
            latest_duration_s: f.latest_duration_s,
            success_rate_30d: f.success_rate_30d,
            consecutive_failures: f.consecutive_failures,
            total_runs_30d: f.total_runs_30d,
        };
    }
    return {
        id,
        ...entry,
        live_status: {
            categories_total_records: totalRecords,
            freshest_record_at: bestLatest,
            freshest_in_category: bestCategory,
        },
        fetcher_health: fetcherHealth,
    };
}

router.get('/', async (req, res) => {
    const { registry, quality, refreshStatus } = await loadRegistry();
    if (!registry) {
        return res.status(503).json({ error: 'sources_registry_unavailable' });
    }
    const sources = Object.entries(registry.sources).map(([id, entry]) =>
        annotateSource(id, entry, quality, refreshStatus)
    );
    sources.sort((a, b) => a.id.localeCompare(b.id));

    // Aggregate health summary across all sources with a fetcher.
    const tracked = sources.filter((s) => s.fetcher_health);
    const healthSummary = {
        tracked_fetchers: tracked.length,
        healthy: tracked.filter((s) => s.fetcher_health.health === 'healthy').length,
        flaky: tracked.filter((s) => s.fetcher_health.health === 'flaky').length,
        failing: tracked.filter((s) => s.fetcher_health.health === 'failing').length,
        last_refresh_at: refreshStatus?.generated_at || null,
    };

    res.json({
        notice:
            'Authoritative registry of every upstream source. live_status reflects quality.json; ' +
            'fetcher_health reflects per-fetcher refresh outcomes from the daily cron. ' +
            'For per-category coverage see /api/v1/quality; for headline numbers see /api/v1/databank/totals.',
        generated_at: registry.generated_at,
        schema_version: registry.$schema_version,
        count: sources.length,
        health_summary: healthSummary,
        sources,
        category_index: registry.category_index,
        planned_additions: registry.planned_additions,
    });
});

router.get('/:id', async (req, res) => {
    const { registry, quality, refreshStatus } = await loadRegistry();
    if (!registry) {
        return res.status(503).json({ error: 'sources_registry_unavailable' });
    }
    const entry = registry.sources?.[req.params.id];
    if (!entry) {
        return res.status(404).json({ error: 'unknown_source', id: req.params.id });
    }
    res.json(annotateSource(req.params.id, entry, quality, refreshStatus));
});

export default router;
