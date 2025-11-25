import express from 'express';
import unifiedRoutes from './unified.js';
import searchRoutes from './search.js';

const router = express.Router();

router.use('/unified', unifiedRoutes);
router.use('/search', searchRoutes);

router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
