import express from 'express';
import apicache from 'apicache';
import { listSnapshots } from '../utils/fileService.js';

const router = express.Router();
const cache = apicache.middleware;

router.get('/', cache('5 minutes'), async (_req, res) => {
    const snapshots = await listSnapshots();
    res.json({
        count: snapshots.length,
        snapshots,
        usage: 'Append ?as_of=YYYY-MM-DD to /unified/:category (and /summary, /metadata, /timeseries) to pin a response to a retained snapshot. The closest snapshot on or before the requested date is used.',
    });
});

export default router;
