import express from 'express';
import { searchController } from '../controllers/searchController.js';

const router = express.Router();

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Search across all data
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Search query
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max results
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *     responses:
 *       200:
 *         description: Search results
 */
router.get('/', searchController);

export default router;
