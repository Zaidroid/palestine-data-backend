/**
 * /api/v1/hapi — HDX HAPI (Humanitarian API) for State of Palestine.
 *
 * 9 thematic datasets normalized into one schema with admin1/admin2
 * codes:
 *   refugees, returnees, funding, conflict-events, national-risk,
 *   food-security, food-prices, poverty-rate, baseline-population
 * + metadata (HAPI's own data-availability table).
 *
 * Backed by public/data/hapi/<dataset>.json refreshed nightly by
 * scripts/sources/hdx-hapi-pse.js. Public reads.
 *
 * Endpoints:
 *   GET /hapi               — index of available datasets
 *   GET /hapi/:dataset      — paged rows for one dataset
 *       ?admin1=&admin2=&limit=&offset=
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/hapi');

const router = express.Router();

const ALLOWED = new Set([
    'refugees', 'returnees', 'funding', 'conflict-events', 'national-risk',
    'food-security', 'food-prices', 'poverty-rate', 'baseline-population',
    'metadata',
]);

const cache = new Map();
let manifestCache = null;

async function loadDataset(name) {
    if (!ALLOWED.has(name)) return null;
    const file = path.join(DATA_DIR, `${name}.json`);
    let stat;
    try { stat = await fs.stat(file); } catch { return null; }
    const cached = cache.get(name);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    cache.set(name, { mtimeMs: stat.mtimeMs, data });
    return data;
}

async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
        manifestCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8')
        );
    } catch { manifestCache = null; }
    return manifestCache;
}

router.get('/', async (_req, res) => {
    const m = await loadManifest();
    const datasets = await Promise.all(
        [...ALLOWED].map(async name => {
            const d = await loadDataset(name);
            return {
                dataset: name,
                rows: d?.row_count ?? d?.rows?.length ?? 0,
                endpoint: `/api/v1/hapi/${name}`,
            };
        })
    );
    res.json({
        attribution: m?.attribution || 'HDX HAPI (Humanitarian API) via HDX.',
        source_landing: m?.source_landing,
        last_refreshed: m?.fetched_at,
        datasets,
        notes:
            'HDX HAPI normalizes upstream humanitarian data (UNHCR, ' +
            'ACLED, WFP, IPC, OCHA…) into one schema with admin1/admin2 ' +
            'codes. Per-dataset endpoints accept admin1=, admin2=, ' +
            'limit=, offset= filters.',
    });
});

router.get('/:dataset', async (req, res) => {
    const name = String(req.params.dataset || '').toLowerCase();
    const data = await loadDataset(name);
    if (!data) {
        return res.status(404).json({
            error: 'unknown_dataset',
            available: [...ALLOWED],
        });
    }
    let rows = data.rows || [];
    const admin1 = String(req.query.admin1 || '').toLowerCase();
    const admin2 = String(req.query.admin2 || '').toLowerCase();
    if (admin1) {
        rows = rows.filter(r =>
            String(r.admin1_name || '').toLowerCase().includes(admin1) ||
            String(r.admin1_code || '').toLowerCase() === admin1
        );
    }
    if (admin2) {
        rows = rows.filter(r =>
            String(r.admin2_name || '').toLowerCase().includes(admin2) ||
            String(r.admin2_code || '').toLowerCase() === admin2
        );
    }
    const total = rows.length;
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 10000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json({
        dataset: name,
        attribution: data.attribution,
        source_dataset: data.source_dataset,
        source_url: data.source_url,
        total, limit, offset,
        rows: rows.slice(offset, offset + limit),
    });
});

export default router;
