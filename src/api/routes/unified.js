import express from 'express';
import apicache from 'apicache';
import { getData, getMetadata } from '../controllers/unifiedController.js';

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
 * /unified/{category}/metadata:
 *   get:
 *     summary: Get metadata for a category
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Metadata object
 */
router.get('/:category/metadata', cache('1 hour'), getMetadata);

export default router;
