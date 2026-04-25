/**
 * /api/v1/facilities — OSM/HOT-derived facility points for Palestine.
 *
 * Backed by public/data/osm/{health,education}-facilities.geojson and
 * populated-places.geojson (refreshed nightly by scripts/sources/osm-pse.js).
 *
 * Endpoints (all public, GeoJSON-compatible):
 *   GET /facilities                       — index (counts + endpoints)
 *   GET /facilities/:layer                — FeatureCollection
 *       layer ∈ health | education | populated-places
 *       Query:
 *         bbox=lng_min,lat_min,lng_max,lat_max  (optional spatial filter)
 *         type=                                 (optional substring match
 *                                                on amenity / healthcare /
 *                                                place tag)
 *         limit=                                (default 1000, max 5000)
 *         offset=
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../public/data/osm');

const router = express.Router();

// Layer → default file. Some layers accept a ?source= query for cross-
// validation; layout is { default: <file>, sources: { osm, … } }.
const LAYER_DEFS = {
    'health': {
        default: 'health-facilities.geojson',  // OSM
        sources: {
            'osm':              'health-facilities.geojson',
            'globalhealthsites':'health-facilities-globalhealthsites.geojson',
        },
    },
    'education': {
        default: 'education-facilities.geojson',
        sources: { 'osm': 'education-facilities.geojson' },
    },
    'populated-places': {
        default: 'populated-places.geojson',
        sources: { 'osm': 'populated-places.geojson' },
    },
};

const LAYER_FILES = Object.fromEntries(
    Object.entries(LAYER_DEFS).map(([k, v]) => [k, v.default])
);

const cache = new Map();
let manifestCache = null;

async function loadLayer(layer, source) {
    const def = LAYER_DEFS[layer];
    if (!def) return null;
    const file = source && def.sources?.[source]
        ? def.sources[source]
        : def.default;
    if (!file) return null;
    const target = path.join(DATA_DIR, file);
    let stat;
    try { stat = await fs.stat(target); } catch { return null; }
    const cacheKey = `${layer}|${file}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const data = JSON.parse(await fs.readFile(target, 'utf8'));
    cache.set(cacheKey, { mtimeMs: stat.mtimeMs, data });
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

function inBbox(coords, bbox) {
    const [lng, lat] = coords;
    return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

function matchesType(props, layer, typeQuery) {
    if (!typeQuery) return true;
    const q = typeQuery.toLowerCase();
    const fields = layer === 'populated-places'
        ? [props.place]
        : [props.amenity, props.healthcare, props.building];
    return fields.some(v => v && String(v).toLowerCase().includes(q));
}

router.get('/', async (_req, res) => {
    const m = await loadManifest();
    const counts = {};
    for (const k of Object.keys(LAYER_FILES)) {
        const d = await loadLayer(k);
        counts[k] = d?.features?.length ?? 0;
    }
    res.json({
        attribution: m?.attribution
            || 'OpenStreetMap contributors via Humanitarian OpenStreetMap Team (HOT) (ODbL).',
        license_id: m?.license_id || 'hdx-odc-odbl',
        last_refreshed: m?.fetched_at,
        layers: Object.entries(counts).map(([k, n]) => ({
            layer: k,
            features: n,
            endpoint: `/api/v1/facilities/${k}`,
        })),
        notes: 'OSM-derived facility points refreshed monthly upstream. ' +
               'Use bbox= for spatial filtering; type= for substring match ' +
               'on amenity/healthcare/place tags. Response shape is a ' +
               'GeoJSON FeatureCollection so mapping libs can render directly.',
    });
});

router.get('/:layer', async (req, res) => {
    const layer = String(req.params.layer || '').toLowerCase();
    const source = req.query.source ? String(req.query.source).toLowerCase() : null;
    const def = LAYER_DEFS[layer];
    if (!def) {
        return res.status(404).json({
            error: 'unknown_layer',
            available: Object.keys(LAYER_DEFS),
        });
    }
    if (source && !def.sources[source]) {
        return res.status(400).json({
            error: 'unknown_source',
            layer,
            available_sources: Object.keys(def.sources),
        });
    }
    const data = await loadLayer(layer, source);
    if (!data) {
        return res.status(404).json({ error: 'data_unavailable' });
    }

    let bbox = null;
    if (req.query.bbox) {
        const parts = String(req.query.bbox).split(',').map(parseFloat);
        if (parts.length === 4 && parts.every(Number.isFinite)) bbox = parts;
    }
    const typeQ = String(req.query.type || '');
    const limit  = Math.min(parseInt(req.query.limit, 10) || 1000, 5000);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let filtered = data.features;
    if (bbox)  filtered = filtered.filter(f => inBbox(f.geometry?.coordinates || [], bbox));
    if (typeQ) filtered = filtered.filter(f => matchesType(f.properties || {}, layer, typeQ));

    const total = filtered.length;
    const slice = filtered.slice(offset, offset + limit);

    const usedSource = source || 'osm';
    const attribution = usedSource === 'globalhealthsites'
        ? 'Global Healthsites Mapping Project via HDX (ODbL).'
        : 'OpenStreetMap contributors (ODbL) via HOT.';
    res.json({
        type: 'FeatureCollection',
        features: slice,
        meta: {
            layer,
            source: usedSource,
            total,
            offset,
            limit,
            bbox,
            type_filter: typeQ || null,
            available_sources: Object.keys(def.sources),
            attribution,
        },
    });
});

export default router;
