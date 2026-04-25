/**
 * /api/v1/incidents/healthcare-attacks (and sister category endpoints).
 *
 * Surfaces the Insecurity Insight incident-level dataset (1997-2026,
 * 18,957+ unique incidents across 8 categories: healthcare, aid_worker,
 * education, food_systems, water_systems, explosive_weapons, protection,
 * sexual_violence).
 *
 * Public reads. Backed by per-category JSON shards refreshed nightly by
 * scripts/sources/insecurity-insight.js.
 *
 * Endpoints:
 *   GET /incidents                       — index (categories, totals)
 *   GET /incidents/:category             — list within one category
 *       ?since=YYYY-MM-DD&until=YYYY-MM-DD
 *       &min_killed=N&perpetrator=...&limit=&offset=
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/insecurity-insight');

const router = express.Router();

// In-memory caches keyed by category. Files are 80KB-18MB; loading
// once per process and re-using is fine. Invalidated on file mtime.
const cache = new Map();   // cat → { mtimeMs, data }
let manifestCache = null;
let byCategoryCache = null;

async function loadShard(category) {
    const file = path.join(DATA_DIR, `incidents-${category.replace(/_/g, '-')}.json`);
    let stat;
    try {
        stat = await fs.stat(file);
    } catch {
        return null;
    }
    const cached = cache.get(category);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    cache.set(category, { mtimeMs: stat.mtimeMs, data });
    return data;
}

async function loadByCategory() {
    if (byCategoryCache) return byCategoryCache;
    try {
        byCategoryCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'by-category.json'), 'utf8')
        );
    } catch {
        byCategoryCache = {};
    }
    return byCategoryCache;
}

async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
        manifestCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8')
        );
    } catch {
        manifestCache = null;
    }
    return manifestCache;
}

router.get('/', async (_req, res) => {
    const [byCat, manifest] = await Promise.all([loadByCategory(), loadManifest()]);
    const categories = Object.entries(byCat).map(([cat, info]) => ({
        category: cat,
        total_incidents: info.total,
        years: Object.keys(info.by_year).sort(),
        total_victims: info.total_victims,
        endpoint: `/api/v1/incidents/${cat}`,
    }));
    res.json({
        attribution: manifest?.attribution || 'Insecurity Insight via HDX (CC-BY-4.0)',
        source_landing: manifest?.source_landing,
        last_refreshed: manifest?.fetched_at,
        rows_total: manifest?.rows_total_kept ?? null,
        coverage: '1997-present',
        categories,
        notes:
            'Incident-level data on attacks against healthcare, aid workers, ' +
            'education, food/water systems, plus protection-in-danger and ' +
            'conflict-related sexual violence. Per-category endpoints accept ' +
            'since=, until=, min_killed=, perpetrator=, limit=, offset= filters.',
    });
});

router.get('/:category', async (req, res) => {
    const cat = String(req.params.category || '').toLowerCase().replace(/-/g, '_');
    const rows = await loadShard(cat);
    if (rows == null) {
        return res.status(404).json({
            error: 'unknown_category',
            available: Object.keys(await loadByCategory()),
        });
    }

    const since   = String(req.query.since   || '');
    const until   = String(req.query.until   || '');
    const minKilled = parseInt(req.query.min_killed, 10);
    const perpetrator = String(req.query.perpetrator || '').toLowerCase();
    const limit  = Math.min(parseInt(req.query.limit, 10) || 200, 5000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let filtered = rows;
    if (since)  filtered = filtered.filter(i => i.date && i.date >= since);
    if (until)  filtered = filtered.filter(i => i.date && i.date <= until);
    if (Number.isFinite(minKilled)) {
        filtered = filtered.filter(i => (i.victims?.killed || 0) >= minKilled);
    }
    if (perpetrator) {
        filtered = filtered.filter(i =>
            (i.perpetrator_name || '').toLowerCase().includes(perpetrator) ||
            (i.perpetrator_type || '').toLowerCase().includes(perpetrator)
        );
    }

    const total = filtered.length;
    const slice = filtered.slice(offset, offset + limit).map(i => ({
        // Strip the raw `details` from list responses to keep payloads small;
        // consumers can fetch the full row via /incidents/:category/:incident_id
        // (future endpoint) or download the public/data/insecurity-insight/
        // shard directly.
        ...i,
        details: undefined,
    }));

    const manifest = await loadManifest();
    res.json({
        category: cat,
        total,
        offset,
        limit,
        attribution: manifest?.attribution || 'Insecurity Insight via HDX (CC-BY-4.0)',
        incidents: slice,
    });
});

export default router;
