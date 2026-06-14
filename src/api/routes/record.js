import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUnifiedData, categoryExists } from '../utils/fileService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../../../public/data/unified');

const router = express.Router();
const cache = apicache.middleware;

// In-process cache for stable-id indexes. Indexes are static per pipeline run
// and small (O(record_count) 32-char keys) — one-time load per category.
const indexCache = new Map();

async function loadStableIdIndex(category) {
    if (indexCache.has(category)) return indexCache.get(category);
    try {
        const raw = await fs.readFile(
            path.join(UNIFIED_DIR, category, 'stable-id-index.json'),
            'utf-8'
        );
        const parsed = JSON.parse(raw);
        indexCache.set(category, parsed);
        return parsed;
    } catch {
        indexCache.set(category, null);
        return null;
    }
}

// In-process cache for the event-cluster member index (stable_id → cluster ids).
const EVENTS_DIR = path.resolve(__dirname, '../../../public/data/events');
let memberIndexCache = null;
let memberIndexMtime = 0;

async function loadMemberIndex() {
    try {
        const p = path.join(EVENTS_DIR, 'member-index.json');
        const stat = await fs.stat(p);
        if (memberIndexCache && stat.mtimeMs === memberIndexMtime) return memberIndexCache;
        memberIndexCache = JSON.parse(await fs.readFile(p, 'utf-8'));
        memberIndexMtime = stat.mtimeMs;
        return memberIndexCache;
    } catch {
        return null;
    }
}

/**
 * GET /api/v1/record/:category/:id/related
 * Event clusters containing this record, with their sibling member refs —
 * "what else happened at the same place in the same week".
 */
router.get('/:category/:id/related', cache('5 minutes'), async (req, res) => {
    const { category, id } = req.params;

    const memberIndex = await loadMemberIndex();
    if (!memberIndex) {
        return res.status(503).json({ error: 'Event clusters not generated yet — run scripts/build-events.js' });
    }

    const clusterIds = memberIndex[id] || [];
    if (clusterIds.length === 0) {
        return res.json({ category, id, clusters: [], related_records: [] });
    }

    let eventsDoc = null;
    try {
        eventsDoc = JSON.parse(await fs.readFile(path.join(EVENTS_DIR, 'events.json'), 'utf-8'));
    } catch {
        return res.status(503).json({ error: 'Event clusters unreadable' });
    }

    const clusters = eventsDoc.data.filter((c) => clusterIds.includes(c.cluster_id));
    const related = [];
    for (const c of clusters) {
        for (const [cat, members] of Object.entries(c.members)) {
            for (const m of members) {
                if (m.stable_id === id) continue;
                related.push({ ...m, category: cat, cluster_id: c.cluster_id });
            }
        }
    }

    res.json({ category, id, clusters, related_records: related });
});

router.get('/:category/:id', cache('5 minutes'), async (req, res) => {
    const { category, id } = req.params;

    if (!await categoryExists(category)) {
        return res.status(404).json({ error: 'Category not found' });
    }

    const result = await getUnifiedData(category);
    const records = result?.data || [];

    // Prefer stable_id lookup (O(1)). Fall back to legacy scan by `id` for
    // records written before stable IDs were attached, and finally to
    // `stable_id` field match when the index file isn't present.
    let found = null;
    let lookupMode = null;

    const idx = await loadStableIdIndex(category);
    if (idx && idx.index && Object.prototype.hasOwnProperty.call(idx.index, id)) {
        const pos = idx.index[id];
        if (records[pos] && records[pos].stable_id === id) {
            found = records[pos];
            lookupMode = 'stable_id';
        }
    }

    if (!found) {
        found = records.find((r) => r.stable_id === id) || null;
        if (found) lookupMode = 'stable_id_scan';
    }

    if (!found) {
        found = records.find((r) => String(r.id) === String(id)) || null;
        if (found) lookupMode = 'legacy_id';
    }

    if (!found) {
        return res.status(404).json({ error: 'Record not found', category, id });
    }

    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const canonicalId = found.stable_id || id;
    const canonical_url = `${proto}://${host}/api/v1/record/${encodeURIComponent(category)}/${encodeURIComponent(canonicalId)}`;

    res.json({
        canonical_url,
        category,
        record: found,
        lookup: lookupMode,
    });
});

export default router;
