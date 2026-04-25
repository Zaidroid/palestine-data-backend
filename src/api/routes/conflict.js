/**
 * /api/v1/conflict — ACLED Palestine conflict events (monthly aggregates).
 *
 * Three event types: political-violence, civilian-targeting,
 * demonstrations. Each is a time series by Admin2 × Month-Year with
 * event count + fatalities.
 *
 * Backed by public/data/conflict/acled-pse-<type>.json refreshed
 * nightly by scripts/sources/acled-pse.js. Public reads.
 *
 * Endpoints:
 *   GET /conflict                     — index of event types
 *   GET /conflict/:type               — paged rows
 *       ?admin1=&admin2=&since=YYYY-MM&until=YYYY-MM&limit=&offset=
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/conflict');

const router = express.Router();

const ALLOWED = new Set([
    'political-violence', 'civilian-targeting', 'demonstrations',
]);

const cache = new Map();
let manifestCache = null;

async function loadType(type) {
    if (!ALLOWED.has(type)) return null;
    const file = path.join(DATA_DIR, `acled-pse-${type}.json`);
    let stat;
    try { stat = await fs.stat(file); } catch { return null; }
    const cached = cache.get(type);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    cache.set(type, { mtimeMs: stat.mtimeMs, data });
    return data;
}

async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
        manifestCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'acled-pse-manifest.json'), 'utf8')
        );
    } catch { manifestCache = null; }
    return manifestCache;
}

router.get('/', async (_req, res) => {
    const m = await loadManifest();
    const types = await Promise.all(
        [...ALLOWED].map(async t => {
            const d = await loadType(t);
            return {
                type: t,
                rows: d?.row_count ?? d?.rows?.length ?? 0,
                endpoint: `/api/v1/conflict/${t}`,
            };
        })
    );
    res.json({
        source: 'ACLED',
        attribution: m?.attribution
            || 'ACLED — Armed Conflict Location & Event Data Project, via HDX.',
        last_refreshed: m?.fetched_at,
        types,
        notes:
            'Monthly aggregates of ACLED-reported events by Admin2. ' +
            'Per-type endpoints accept admin1=, admin2=, since=YYYY-MM, ' +
            'until=YYYY-MM, limit=, offset= filters. Distinct from the ' +
            'event-level UCDP-GED already in /unified/conflict.',
    });
});

router.get('/:type', async (req, res) => {
    const type = String(req.params.type || '').toLowerCase();
    const data = await loadType(type);
    if (!data) {
        return res.status(404).json({
            error: 'unknown_type',
            available: [...ALLOWED],
        });
    }

    let rows = data.rows || [];
    const admin1 = String(req.query.admin1 || '').toLowerCase();
    const admin2 = String(req.query.admin2 || '').toLowerCase();
    const since  = String(req.query.since  || '');
    const until  = String(req.query.until  || '');

    if (admin1) rows = rows.filter(r => String(r.admin1 || '').toLowerCase().includes(admin1));
    if (admin2) rows = rows.filter(r => String(r.admin2 || '').toLowerCase().includes(admin2));
    if (since)  rows = rows.filter(r => (r.date_period || '') >= since);
    if (until)  rows = rows.filter(r => (r.date_period || '') <= until);

    const total  = rows.length;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 1000, 10000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    res.json({
        type,
        attribution: data.attribution,
        source_url: data.source_url,
        total, limit, offset,
        rows: rows.slice(offset, offset + limit),
    });
});

export default router;
