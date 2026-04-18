import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUALITY_PATH = path.resolve(__dirname, '../../../public/data/unified/quality.json');

const router = express.Router();
const cache = apicache.middleware;

router.get('/', cache('1 hour'), async (req, res) => {
    try {
        const raw = await fs.readFile(QUALITY_PATH, 'utf8');
        const snap = JSON.parse(raw);
        // Add per-call staleness so consumers know how stale the snapshot itself is.
        const generatedAt = snap.generated_at;
        if (generatedAt) {
            const ageSeconds = Math.max(
                0,
                Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000)
            );
            for (const cat of Object.values(snap.categories || {})) {
                if (cat.last_fetch_success_at) {
                    cat.staleness_seconds = Math.max(
                        0,
                        Math.floor(
                            (Date.now() - new Date(cat.last_fetch_success_at).getTime()) / 1000
                        )
                    );
                }
            }
            snap.snapshot_age_seconds = ageSeconds;
        }
        res.json(snap);
    } catch (e) {
        if (e.code === 'ENOENT') {
            return res.status(503).json({
                error: 'quality_snapshot_missing',
                hint: 'Run `node scripts/generate-quality-snapshot.js` to populate public/data/unified/quality.json.',
            });
        }
        (req.log || console).error({ err: e }, 'quality_snapshot_failed');
        res.status(503).json({ error: 'quality_snapshot_failed', detail: e.message });
    }
});

export default router;
