/**
 * /api/v1/displacement — Palestinian displacement time series.
 *
 * Combines:
 *   - UNHCR Population Data for PSE (POC stocks, demographics, asylum)
 *   - IDMC IDP new-displacements (conflict + disaster) for PSE
 *
 * Public reads. Backed by public/data/displacement/*.json refreshed
 * nightly by scripts/sources/{unhcr-pop,idmc-stocks}-pse.js.
 *
 * Endpoints:
 *   GET /displacement                     — index of available datasets
 *   GET /displacement/unhcr/stocks        — POC year-end stocks by country
 *   GET /displacement/unhcr/demographics  — demographics breakdown
 *   GET /displacement/unhcr/asylum        — asylum applications
 *   GET /displacement/idmc/conflict       — IDMC new conflict-driven IDPs
 *   GET /displacement/idmc/disasters      — IDMC new disaster-driven IDPs
 *
 * Each leaf endpoint accepts ?since=YYYY&until=YYYY&limit=&offset=.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/displacement');

const router = express.Router();

const FILES = {
    'unhcr/stocks':       'unhcr-pse-stocks.json',
    'unhcr/demographics': 'unhcr-pse-demographics-originating.json',
    'unhcr/asylum':       'unhcr-pse-asylum-applications.json',
    'idmc/conflict':      'idmc-pse-stocks.json',
    'idmc/disasters':     'idmc-pse-disasters.json',
};

const cache = new Map();

async function loadFile(file) {
    const target = path.join(DATA_DIR, file);
    let stat;
    try { stat = await fs.stat(target); } catch { return null; }
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(target, 'utf8'));
    cache.set(file, { mtimeMs: stat.mtimeMs, data });
    return data;
}

router.get('/', async (_req, res) => {
    const datasets = [];
    for (const [endpoint, file] of Object.entries(FILES)) {
        const d = await loadFile(file);
        datasets.push({
            dataset: endpoint,
            rows: d?.row_count ?? d?.rows?.length ?? 0,
            attribution: d?.attribution || null,
            endpoint: `/api/v1/displacement/${endpoint}`,
        });
    }
    res.json({
        notes: 'Palestinian displacement time series — UNHCR (POC stocks, ' +
               'demographics, asylum) and IDMC (new-displacement IDP). ' +
               'Each leaf endpoint accepts ?since=YYYY&until=YYYY&limit=&offset=.',
        datasets,
    });
});

function applyFilters(rows, q) {
    let r = rows;
    const since = parseInt(q.since, 10);
    const until = parseInt(q.until, 10);
    if (Number.isFinite(since)) r = r.filter(x => (x.Year || x.year || 0) >= since);
    if (Number.isFinite(until)) r = r.filter(x => (x.Year || x.year || 0) <= until);
    const limit = Math.min(parseInt(q.limit, 10) || 1000, 10000);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    const total = r.length;
    return { rows: r.slice(offset, offset + limit), total, limit, offset };
}

for (const [endpoint, file] of Object.entries(FILES)) {
    router.get('/' + endpoint, async (req, res) => {
        const d = await loadFile(file);
        if (!d) return res.status(404).json({ error: 'data_unavailable', file });
        const { rows, total, limit, offset } = applyFilters(d.rows || [], req.query);
        res.json({
            dataset: endpoint,
            attribution: d.attribution || null,
            source_dataset: d.source_dataset || null,
            source_url: d.source_url || null,
            total, limit, offset,
            rows,
        });
    });
}

export default router;
