/**
 * Cross-category event clusters (built by scripts/build-events.js).
 *
 * GET /api/v1/events
 *   ?admin2=jenin            governorate filter (case-insensitive exact)
 *   ?place_key=jenin         gazetteer key or "admin2:<name>" cluster key
 *   ?start_date=&end_date=   overlap with the cluster's ISO-week period
 *   ?category=conflict       only clusters containing this category
 *   ?min_categories=2        only clusters spanning N+ categories
 *   ?min_records=3           only clusters with N+ member records
 *   ?page=&limit=            pagination (default 20, max 100)
 *
 * GET /api/v1/events/:cluster_id      one cluster (ev-<16 hex>)
 *
 * Members are {category, stable_id, date, event_type} references — hydrate
 * via the citable permalink GET /api/v1/record/:category/:stable_id.
 */
import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVENTS_PATH = path.resolve(__dirname, '../../../public/data/events/events.json');

const router = express.Router();
const cache = apicache.middleware;

let eventsCache = null;
let eventsCacheMtime = 0;

async function loadEvents() {
    try {
        const stat = await fs.stat(EVENTS_PATH);
        if (eventsCache && stat.mtimeMs === eventsCacheMtime) return eventsCache;
        eventsCache = JSON.parse(await fs.readFile(EVENTS_PATH, 'utf-8'));
        eventsCacheMtime = stat.mtimeMs;
        return eventsCache;
    } catch {
        return null;
    }
}

router.get('/', cache('5 minutes'), async (req, res) => {
    const doc = await loadEvents();
    if (!doc) {
        return res.status(503).json({ error: 'Event clusters not generated yet — run scripts/build-events.js' });
    }

    const {
        admin2,
        place_key,
        start_date,
        end_date,
        category,
        min_categories,
        min_records,
        page = 1,
        limit = 20,
    } = req.query;

    let data = doc.data;

    if (admin2) {
        const a = String(admin2).toLowerCase();
        data = data.filter((c) => (c.admin2 || '').toLowerCase() === a);
    }
    if (place_key) {
        data = data.filter((c) => c.place_key === place_key);
    }
    if (category) {
        data = data.filter((c) => c.categories.includes(category));
    }
    if (min_categories) {
        const n = parseInt(min_categories, 10) || 1;
        data = data.filter((c) => c.categories.length >= n);
    }
    if (min_records) {
        const n = parseInt(min_records, 10) || 1;
        data = data.filter((c) => c.record_count >= n);
    }
    if (start_date) {
        data = data.filter((c) => c.period.end >= start_date);
    }
    if (end_date) {
        data = data.filter((c) => c.period.start <= end_date);
    }

    const lim = Math.min(parseInt(limit, 10) || 20, 100);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const total = data.length;
    const pageData = data.slice((pg - 1) * lim, pg * lim);

    res.json({
        data: pageData,
        pagination: { total, page: pg, limit: lim, pages: Math.ceil(total / lim) },
        metadata: {
            generated_at: doc.generated_at,
            total_clusters: doc.total,
            records_placed: doc.records_placed,
            records_skipped_unplaceable: doc.records_skipped_unplaceable,
            participating_categories: doc.categories,
        },
    });
});

router.get('/:id', cache('5 minutes'), async (req, res) => {
    // Express 5 dropped inline regex params — validate the shape here.
    if (!/^ev-[0-9a-f]{16}$/.test(req.params.id)) {
        return res.status(404).json({ error: 'Invalid cluster id (expected ev-<16 hex chars>)' });
    }
    const doc = await loadEvents();
    if (!doc) {
        return res.status(503).json({ error: 'Event clusters not generated yet' });
    }
    const cluster = doc.data.find((c) => c.cluster_id === req.params.id);
    if (!cluster) {
        return res.status(404).json({ error: 'Cluster not found' });
    }
    res.json({ data: cluster, metadata: { generated_at: doc.generated_at } });
});

export default router;
