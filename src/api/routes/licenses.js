import express from 'express';
import apicache from 'apicache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LICENSES_PATH = path.resolve(__dirname, '../data/licenses.json');

const router = express.Router();
const cache = apicache.middleware;

router.get('/', cache('1 hour'), async (req, res) => {
    try {
        const raw = await fs.readFile(LICENSES_PATH, 'utf8');
        res.json(JSON.parse(raw));
    } catch (e) {
        res.status(503).json({ error: 'License registry unavailable', detail: e.message });
    }
});

router.get('/:sourceId', async (req, res) => {
    try {
        const raw = await fs.readFile(LICENSES_PATH, 'utf8');
        const doc = JSON.parse(raw);
        const entry = doc.sources?.[req.params.sourceId];
        if (!entry) return res.status(404).json({ error: 'Unknown source_id', source_id: req.params.sourceId });
        res.json({ source_id: req.params.sourceId, ...entry });
    } catch (e) {
        res.status(503).json({ error: 'License registry unavailable', detail: e.message });
    }
});

export default router;
