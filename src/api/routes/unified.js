import express from 'express';
import apicache from 'apicache';
import { getData, getMetadata, getSummary, getTimeseries } from '../controllers/unifiedController.js';

const router = express.Router();
const cache = apicache.middleware;

/**
 * @swagger
 * /unified/{category}:
 *   get:
 *     summary: Get unified data for a category
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of records
 */
router.get('/:category', cache('5 minutes'), getData);

/**
 * @swagger
 * /unified/{category}/summary:
 *   get:
 *     summary: Get aggregated summary for a category
 */
router.get('/:category/summary', cache('10 minutes'), getSummary);

/**
 * @swagger
 * /unified/{category}/timeseries:
 *   get:
 *     summary: Get time-series aggregation for a category
 *     parameters:
 *       - in: query
 *         name: metric
 *         schema: { type: string }
 *         description: Metric to aggregate (default killed)
 *       - in: query
 *         name: interval
 *         schema: { type: string, enum: [day, week, month, year] }
 *       - in: query
 *         name: region
 *         schema: { type: string }
 */
router.get('/:category/timeseries', cache('10 minutes'), getTimeseries);

/**
 * @swagger
 * /unified/{category}/metadata:
 *   get:
 *     summary: Get metadata for a category
 */
router.get('/:category/metadata', cache('1 hour'), getMetadata);

export default router;
