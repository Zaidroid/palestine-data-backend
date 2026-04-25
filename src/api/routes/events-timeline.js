/**
 * Cross-category event timeline.
 *
 * GET /api/v1/events/timeline?from=&to=&bbox=&categories=&limit=
 *   Unified time-ordered feed across:
 *     - /unified/conflict (UCDP + Tech4Palestine + B'Tselem)
 *     - /unified/refugees (UNHCR + IDMC displacement)
 *     - /unified/health (Gaza MoH health-impact)
 *     - /unified/land
 *     - the live alerts stream (proxied from alerts service)
 *
 *   Powers:
 *     - Dashboard timeline scrub
 *     - Interactive timeline-map: drop pins on a map for the requested window
 *     - Event-history queries for any consumer that wants "what happened
 *       between A and B in this region"
 *
 *   Each item is a normalized envelope:
 *     { source_category, id, date, lat, lng, region, type, severity,
 *       title, description, attribution }
 *
 *   No pagination yet — capped at `limit` (default 500, max 5000) to keep
 *   responses bounded. Frontends scrub by narrowing the date window.
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../../../public/data/unified');

const router = express.Router();

const DEFAULT_CATEGORIES = ['conflict', 'refugees', 'health', 'land', 'infrastructure', 'westbank'];

async function readJsonSafe(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

function inBbox(lat, lng, bbox) {
    if (!bbox) return true;
    if (lat == null || lng == null) return false;
    return lat >= bbox[0] && lat <= bbox[2] && lng >= bbox[1] && lng <= bbox[3];
}

function normalize(record, sourceCategory) {
    const loc = record.location || {};
    const lat = loc.lat ?? (loc.coordinates ? loc.coordinates[1] : null);
    const lng = loc.lon ?? loc.lng ?? (loc.coordinates ? loc.coordinates[0] : null);
    const sources = record.sources || [];
    const attribution = sources.map((s) => (typeof s === 'string' ? s : s.name)).filter(Boolean);
    return {
        source_category: sourceCategory,
        id: record.id || record.stable_id,
        date: record.date,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        region: loc.region || null,
        place_name: loc.name || null,
        type: record.event_type || record.displacement_type || record.health_metric || null,
        severity: record.severity_index ?? null,
        killed: record.metrics?.killed ?? null,
        injured: record.metrics?.injured ?? null,
        displaced: record.metrics?.displaced ?? null,
        title: record.description?.slice(0, 200) || record.event_name || null,
        attribution,
    };
}

router.get('/', async (req, res) => {
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const categoriesRaw = req.query.categories ? String(req.query.categories).split(',') : DEFAULT_CATEGORIES;
    const categories = categoriesRaw.filter((c) => DEFAULT_CATEGORIES.includes(c));

    let bbox = null;
    if (req.query.bbox) {
        const parts = String(req.query.bbox).split(',').map(Number);
        if (parts.length !== 4 || parts.some((x) => !Number.isFinite(x))) {
            return res.status(400).json({ error: 'invalid bbox; expected minLat,minLng,maxLat,maxLng' });
        }
        bbox = parts;
    }

    // Pull each requested category's all-data.json, filter, normalize.
    const events = [];
    const sourceCounts = {};
    for (const cat of categories) {
        const filePath = path.join(UNIFIED_DIR, cat, 'all-data.json');
        const doc = await readJsonSafe(filePath);
        if (!doc || !Array.isArray(doc.data)) continue;
        let kept = 0;
        for (const r of doc.data) {
            const date = r.date;
            if (from && (!date || date < from)) continue;
            if (to && (!date || date > to)) continue;
            const norm = normalize(r, cat);
            if (bbox && !inBbox(norm.lat, norm.lng, bbox)) continue;
            events.push(norm);
            kept += 1;
            if (events.length >= limit * 4) break;  // hard cap on category contribution
        }
        sourceCounts[cat] = kept;
    }

    // Newest first; frontends can reverse if they prefer chronological.
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const truncated = events.length > limit;
    const out = events.slice(0, limit);

    res.json({
        meta: {
            from, to, bbox, categories,
            requested_limit: limit,
            total_events: out.length,
            truncated,
            per_category_kept: sourceCounts,
        },
        events: out,
    });
});

export default router;
