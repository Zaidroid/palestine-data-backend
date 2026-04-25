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
    const [registry, quality] = await Promise.all([
        loadJsonSafe(SOURCES_PATH),
        loadJsonSafe(QUALITY_PATH),
    ]);
    return { registry, quality };
}

function annotateSource(id, entry, quality) {
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
    return {
        id,
        ...entry,
        live_status: {
            categories_total_records: totalRecords,
            freshest_record_at: bestLatest,
            freshest_in_category: bestCategory,
        },
    };
}

router.get('/', async (req, res) => {
    const { registry, quality } = await loadRegistry();
    if (!registry) {
        return res.status(503).json({ error: 'sources_registry_unavailable' });
    }
    const sources = Object.entries(registry.sources).map(([id, entry]) =>
        annotateSource(id, entry, quality)
    );
    sources.sort((a, b) => a.id.localeCompare(b.id));

    res.json({
        notice:
            'Authoritative registry of every upstream source. live_status is computed from quality.json on each request. ' +
            'For per-category coverage see /api/v1/quality; for headline numbers see /api/v1/databank/totals.',
        generated_at: registry.generated_at,
        schema_version: registry.$schema_version,
        count: sources.length,
        sources,
        category_index: registry.category_index,
        planned_additions: registry.planned_additions,
    });
});

router.get('/:id', async (req, res) => {
    const { registry, quality } = await loadRegistry();
    if (!registry) {
        return res.status(503).json({ error: 'sources_registry_unavailable' });
    }
    const entry = registry.sources?.[req.params.id];
    if (!entry) {
        return res.status(404).json({ error: 'unknown_source', id: req.params.id });
    }
    res.json(annotateSource(req.params.id, entry, quality));
});

export default router;
