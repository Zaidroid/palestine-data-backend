/**
 * /api/v1/humanitarian — humanitarian severity layers.
 *
 * Currently surfaces IPC Acute Food Insecurity polygons (1=Minimal …
 * 5=Famine) for State of Palestine. Backed by
 * public/data/humanitarian/ipc-food-insecurity.geojson, refreshed by
 * scripts/sources/ipc-food-insecurity.js.
 *
 * Endpoints (public):
 *   GET /humanitarian                          — index
 *   GET /humanitarian/food-insecurity          — IPC GeoJSON FeatureCollection
 *   GET /humanitarian/food-insecurity/summary  — phase counts + population
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/humanitarian');

const router = express.Router();

const PHASE_LABELS = {
    1: 'Minimal/None',
    2: 'Stressed',
    3: 'Crisis',
    4: 'Emergency',
    5: 'Catastrophe/Famine',
};

let geoCache = null;
let manifestCache = null;

async function loadGeo() {
    const file = path.join(DATA_DIR, 'ipc-food-insecurity.geojson');
    let stat;
    try { stat = await fs.stat(file); } catch { return null; }
    if (geoCache && geoCache.mtimeMs === stat.mtimeMs) return geoCache.data;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    geoCache = { mtimeMs: stat.mtimeMs, data };
    return data;
}

async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
        manifestCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'ipc-manifest.json'), 'utf8')
        );
    } catch { manifestCache = null; }
    return manifestCache;
}

router.get('/', async (_req, res) => {
    const m = await loadManifest();
    const g = await loadGeo();
    res.json({
        layers: [{
            layer: 'food-insecurity',
            source: 'IPC',
            features: g?.features?.length ?? 0,
            attribution: m?.attribution
                || 'Integrated Food Security Phase Classification (IPC) via HDX.',
            last_refreshed: m?.fetched_at,
            endpoint: '/api/v1/humanitarian/food-insecurity',
            summary_endpoint: '/api/v1/humanitarian/food-insecurity/summary',
        }],
    });
});

router.get('/food-insecurity/summary', async (_req, res) => {
    const g = await loadGeo();
    if (!g) return res.status(503).json({ error: 'data_unavailable' });
    const phases = {};
    let popInPhase3plus = 0;
    for (const f of g.features) {
        const p = f.properties || {};
        const phase = Number(p.overall_phase);
        const pop = Number(p.population_min) || 0;
        phases[phase] = phases[phase] || {
            phase, label: PHASE_LABELS[phase] || 'Unknown',
            areas: [], total_pop_min: 0,
        };
        phases[phase].areas.push({ title: p.title, population_min: pop });
        phases[phase].total_pop_min += pop;
        if (phase >= 3) popInPhase3plus += pop;
    }
    const m = await loadManifest();
    res.json({
        attribution: m?.attribution
            || 'Integrated Food Security Phase Classification (IPC) via HDX.',
        last_refreshed: m?.fetched_at,
        // Note: per-region IPC analyses cover only the part of population
        // actually classified — there's no single "denominator" to compute
        // a cleanly comparable national total here. Use population_in_
        // crisis_or_worse as the headline humanitarian number.
        population_in_crisis_or_worse: popInPhase3plus,
        phases: Object.values(phases).sort((a, b) => a.phase - b.phase),
    });
});

router.get('/food-insecurity', async (_req, res) => {
    const g = await loadGeo();
    if (!g) return res.status(503).json({ error: 'data_unavailable' });
    res.json(g);
});

export default router;
