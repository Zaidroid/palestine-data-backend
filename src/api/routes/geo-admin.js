/**
 * /api/v1/geo/admin — OCHA admin boundaries for Palestine.
 *
 * Backed by public/data/admin/admin{0,1,2}.geojson (OCHA FISS via HDX,
 * refreshed nightly by scripts/sources/cod-ab.js).
 *
 * Endpoints (all public):
 *   GET /geo/admin                       — index of available levels
 *   GET /geo/admin/:level                — return GeoJSON FeatureCollection
 *                                          (level ∈ admin0|admin1|admin2|
 *                                           adminlines|adminpoints)
 *   GET /geo/admin/lookup?lat=&lng=      — point-in-polygon reverse geocode
 *                                          (returns admin1 + admin2 hit)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/admin');

const router = express.Router();

const ALLOWED_LAYERS = new Set([
    'admin0', 'admin1', 'admin2', 'adminlines', 'adminpoints',
]);

// Cache parsed GeoJSON in memory keyed by (layer, mtimeMs). Polygons are
// small (16 features for admin2) so loading once and reusing is fine.
const cache = new Map();

async function loadLayer(layer) {
    if (!ALLOWED_LAYERS.has(layer)) return null;
    const file = path.join(DATA_DIR, `${layer}.geojson`);
    let stat;
    try { stat = await fs.stat(file); } catch { return null; }
    const cached = cache.get(layer);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    cache.set(layer, { mtimeMs: stat.mtimeMs, data });
    return data;
}

let manifestCache = null;
async function loadManifest() {
    if (manifestCache) return manifestCache;
    try {
        manifestCache = JSON.parse(
            await fs.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf8')
        );
    } catch { manifestCache = null; }
    return manifestCache;
}

// ── Point-in-polygon (ray casting) ───────────────────────────────────────────
//
// Walks a single ring of [lng, lat] coords; returns true if (lng, lat) is
// inside. Edges-on-boundary count as inside. Standard algorithm — adequate
// for 16-feature admin2 lookups; if we ever need admin3 with thousands of
// polygons we'll bolt on an R-tree.
function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi || 1e-12) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function pointInFeature(lng, lat, feature) {
    const g = feature.geometry;
    if (!g) return false;
    if (g.type === 'Polygon') {
        if (!pointInRing(lng, lat, g.coordinates[0])) return false;
        // Subtract holes
        for (let i = 1; i < g.coordinates.length; i++) {
            if (pointInRing(lng, lat, g.coordinates[i])) return false;
        }
        return true;
    }
    if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
            if (!pointInRing(lng, lat, poly[0])) continue;
            let inHole = false;
            for (let i = 1; i < poly.length; i++) {
                if (pointInRing(lng, lat, poly[i])) { inHole = true; break; }
            }
            if (!inHole) return true;
        }
        return false;
    }
    return false;
}

function compactProps(props, level) {
    // Trim the OCHA properties down to the useful ones; the full props
    // are still in the layer file for clients that need them.
    const out = {};
    if (level === 'admin0') {
        out.name = props.adm0_name;
        out.pcode = props.adm0_pcode;
    } else if (level === 'admin1') {
        out.name = props.adm1_name;
        out.pcode = props.adm1_pcode;
    } else if (level === 'admin2') {
        out.name = props.adm2_name;
        out.pcode = props.adm2_pcode;
        out.parent_admin1 = props.adm1_name;
        out.parent_pcode = props.adm1_pcode;
    }
    return out;
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/', async (_req, res) => {
    const manifest = await loadManifest();
    const levels = await Promise.all(
        [...ALLOWED_LAYERS].map(async l => {
            const d = await loadLayer(l);
            return { level: l, features: d?.features?.length ?? 0,
                     endpoint: `/api/v1/geo/admin/${l}` };
        })
    );
    res.json({
        attribution: manifest?.attribution || 'OCHA FISS via HDX (CC-BY-IGO)',
        source_landing: manifest?.source_landing,
        last_refreshed: manifest?.fetched_at,
        levels,
        lookup_endpoint: '/api/v1/geo/admin/lookup?lat=&lng=',
        notes: 'Official OCHA Common Operational Datasets — Subnational ' +
               'Administrative Boundaries for Palestine. Use /lookup for ' +
               'reverse-geocoding a coordinate to its containing admin ' +
               'units; use /:level for raw GeoJSON polygons.',
    });
});

router.get('/lookup', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'lat and lng required' });
    }
    const [a1, a2] = await Promise.all([loadLayer('admin1'), loadLayer('admin2')]);
    const hit1 = (a1?.features || []).find(f => pointInFeature(lng, lat, f));
    const hit2 = (a2?.features || []).find(f => pointInFeature(lng, lat, f));
    res.json({
        query: { lat, lng },
        admin1: hit1 ? compactProps(hit1.properties, 'admin1') : null,
        admin2: hit2 ? compactProps(hit2.properties, 'admin2') : null,
    });
});

router.get('/:level', async (req, res) => {
    const level = String(req.params.level || '').toLowerCase();
    const data = await loadLayer(level);
    if (!data) {
        return res.status(404).json({
            error: 'unknown_level',
            available: [...ALLOWED_LAYERS],
        });
    }
    res.json(data);
});

export default router;
