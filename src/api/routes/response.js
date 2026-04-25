/**
 * /api/v1/response — OCHA Humanitarian Programme Cycle (HPC) data.
 *
 * Combines:
 *   - Response Plan projects (hrp-projects-pse: HRP/Flash projects per year)
 *   - Humanitarian needs assessments (opt-humanitarian-needs: PiN by sector × year)
 *
 * UN FTS funding flows are NOT here — those live in the existing
 * /unified/funding pipeline (richer per-flow data via the FTS API).
 *
 * Endpoints (public):
 *   GET /response                      — index of available files
 *   GET /response/projects/:code       — HRP/Flash projects for one plan
 *                                        code (hpse23/hpse22/fpse21/…)
 *       ?cluster=&limit=&offset=
 *   GET /response/needs/:year          — Humanitarian Needs sheets for a year
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/response');

const router = express.Router();

const cache = new Map();
let manifestCache = null;

async function loadFile(name) {
    const target = path.join(DATA_DIR, name);
    let stat;
    try { stat = await fs.stat(target); } catch { return null; }
    const cached = cache.get(name);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(target, 'utf8'));
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
    res.json({
        attribution: m?.attribution ||
            'OCHA Humanitarian Programme Cycle Tools (HPC Tools) via HDX.',
        last_refreshed: m?.fetched_at,
        projects: (m?.hrp_projects || []).map(p => ({
            code: p.file.replace(/^hrp-projects-|\.json$/g, ''),
            year: p.year,
            rows: p.rows,
            endpoint: `/api/v1/response/projects/${p.file.replace(/^hrp-projects-|\.json$/g, '')}`,
        })),
        needs: (m?.humanitarian_needs || []).map(n => ({
            year: n.year,
            sheets: n.sheets,
            rows: n.rows,
            endpoint: `/api/v1/response/needs/${n.year}`,
        })),
    });
});

router.get('/projects/:code', async (req, res) => {
    const code = String(req.params.code || '').toLowerCase();
    const data = await loadFile(`hrp-projects-${code}.json`);
    if (!data) {
        return res.status(404).json({
            error: 'unknown_plan_code',
            hint: 'List codes via /api/v1/response',
        });
    }
    let rows = data.rows || [];
    const cluster = String(req.query.cluster || '').toLowerCase();
    if (cluster) {
        rows = rows.filter(r =>
            String(r.globalClusters || '').toLowerCase().includes(cluster)
        );
    }
    const total = rows.length;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 5000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json({
        code,
        year: data.year,
        attribution: data.attribution,
        source_url: data.source_url,
        total, limit, offset,
        projects: rows.slice(offset, offset + limit),
    });
});

router.get('/needs/:year', async (req, res) => {
    const year = String(req.params.year || '');
    const data = await loadFile(`humanitarian-needs-${year}.json`);
    if (!data) {
        return res.status(404).json({
            error: 'unknown_year',
            hint: 'List years via /api/v1/response',
        });
    }
    res.json({
        year: data.year,
        attribution: data.attribution,
        source_url: data.source_url,
        sheet_count: data.sheet_count,
        row_count: data.row_count,
        sheets: data.sheets,
    });
});

export default router;
