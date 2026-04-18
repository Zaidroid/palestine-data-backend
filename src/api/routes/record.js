import express from 'express';
import apicache from 'apicache';
import { getUnifiedData, categoryExists } from '../utils/fileService.js';

const router = express.Router();
const cache = apicache.middleware;

// NOTE: Stub. Linear-scans the category's all-data.json by `id`. Acceptable until
// stable canonical IDs land (PLAN.md Phase 2). Cached so repeated lookups for
// the same category don't re-scan on every request.
router.get('/:category/:id', cache('5 minutes'), async (req, res) => {
    const { category, id } = req.params;

    if (!await categoryExists(category)) {
        return res.status(404).json({ error: 'Category not found' });
    }

    const result = await getUnifiedData(category);
    const records = result?.data || [];
    const found = records.find((r) => String(r.id) === String(id));

    if (!found) {
        return res.status(404).json({ error: 'Record not found', category, id });
    }

    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const canonical_url = `${proto}://${host}/api/v1/record/${encodeURIComponent(category)}/${encodeURIComponent(id)}`;

    res.json({
        canonical_url,
        category,
        record: found,
        notes: 'Stub permalink. The `id` is best-effort and may change before v4 schema canonicalization.',
    });
});

export default router;
