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
