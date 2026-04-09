import express from 'express';
import apicache from 'apicache';
import unifiedRoutes from './unified.js';
import searchRoutes from './search.js';
import { getCategories, getStats } from '../controllers/statsController.js';

const router = express.Router();
const cache = apicache.middleware;

router.use('/unified', unifiedRoutes);
router.use('/search', searchRoutes);

router.get('/categories', cache('10 minutes'), getCategories);
router.get('/stats', cache('10 minutes'), getStats);

router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), schema_version: '3.0.0' });
});

export default router;
