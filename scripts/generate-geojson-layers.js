#!/usr/bin/env node

/**
 * Generate GeoJSON Layers
 * 
 * Converts unified data to GeoJSON format for map visualizations.
 * Creates separate layers by category (conflict, health, infrastructure, etc.)
 * 
 * Usage: node scripts/generate-geojson-layers.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';
import {
    createFeatureCollection,
    filterByBoundingBox,
    generateStatistics,
    PALESTINE_BBOX,
} from './utils/geojson-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
    context: 'GeoJSON-Generator',
    logLevel: 'INFO',
});

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data/unified');
const GEOJSON_DIR = path.join(__dirname, '../public/data/geojson');

// Categories to process
const CATEGORIES = [
    { name: 'conflict', description: 'Conflict and violence incidents' },
    { name: 'health', description: 'Health facilities and services' },
    { name: 'infrastructure', description: 'Infrastructure and damage assessment' },
    { name: 'education', description: 'Education facilities' },
    { name: 'water', description: 'Water and sanitation facilities' },
    { name: 'humanitarian', description: 'Humanitarian aid and assistance' },
    { name: 'refugees', description: 'Refugee and displacement data' },
    { name: 'economic', description: 'Economic indicators' },
    { name: 'culture', description: 'Cultural heritage sites' },
    { name: 'land', description: 'Settlements, checkpoints, and land status' },
];

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read JSON file
 */
async function readJSON(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Find all JSON files in a directory recursively
 */
async function findJSONFiles(dirPath) {
    const files = [];

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                const subFiles = await findJSONFiles(fullPath);
                files.push(...subFiles);
            } else if (entry.isFile() && entry.name.endsWith('.json')) {
                files.push(fullPath);
            }
        }
    } catch (error) {
        // Directory doesn't exist, return empty array
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    return files;
}

/**
 * Load all data from a category
 */
async function loadCategoryData(categoryName) {
    const categoryDir = path.join(DATA_DIR, categoryName);
    const jsonFiles = await findJSONFiles(categoryDir);

    let allRecords = [];
    let skippedFiles = 0;

    for (const filePath of jsonFiles) {
        try {
            const data = await readJSON(filePath);

            if (!data) continue;

            // Handle different data structures
            let records = [];

            if (Array.isArray(data)) {
                records = data;
            } else if (data.data && Array.isArray(data.data)) {
                records = data.data;
            } else if (data.records && Array.isArray(data.records)) {
                records = data.records;
            } else if (typeof data === 'object') {
                // Single record
                records = [data];
            }

            allRecords.push(...records);
        } catch (error) {
            // Skip files that can't be parsed as JSON
            await logger.debug(`Skipping ${path.basename(filePath)}: ${error.message}`);
            skippedFiles++;
        }
    }

    if (skippedFiles > 0) {
        await logger.debug(`Skipped ${skippedFiles} invalid JSON files`);
    }

    return allRecords;
}

/**
 * Process a category and generate GeoJSON
 */
async function processCategoryToGeoJSON(category) {
    await logger.info(`Processing ${category.name}...`);

    try {
        // Load data
        const records = await loadCategoryData(category.name);

        if (records.length === 0) {
            await logger.warn(`No data found for ${category.name}`);
            return null;
        }

        await logger.info(`Loaded ${records.length} records`);

        // Create feature collection
        const featureCollection = createFeatureCollection(records, {
            name: category.name,
            description: category.description,
            additionalProperties: {
                category: category.name,
            },
        });

        const featureCount = featureCollection.features.length;
        const skippedCount = featureCollection.metadata.skippedCount;

        if (featureCount === 0) {
            await logger.warn(`No features with valid coordinates for ${category.name}`);
            return null;
        }

        await logger.success(`Created ${featureCount} features (${skippedCount} skipped)`);

        // Generate statistics
        const stats = generateStatistics(featureCollection);
        await logger.debug(`Geometry types: ${JSON.stringify(stats.geometryTypes)}`);

        // Save full layer
        const categoryDir = path.join(GEOJSON_DIR, category.name);
        await ensureDir(categoryDir);

        const fullLayerPath = path.join(categoryDir, 'all.geojson');
        await writeJSON(fullLayerPath, featureCollection);
        await logger.success(`Saved to ${path.relative(process.cwd(), fullLayerPath)}`);

        // Create filtered versions (Gaza only, West Bank only)
        const gazaLayer = filterByBoundingBox(featureCollection, PALESTINE_BBOX.gaza);
        if (gazaLayer.features.length > 0) {
            const gazaPath = path.join(categoryDir, 'gaza.geojson');
            await writeJSON(gazaPath, gazaLayer);
            await logger.info(`Gaza layer: ${gazaLayer.features.length} features`);
        }

        const westBankLayer = filterByBoundingBox(featureCollection, PALESTINE_BBOX.westBank);
        if (westBankLayer.features.length > 0) {
            const westBankPath = path.join(categoryDir, 'west-bank.geojson');
            await writeJSON(westBankPath, westBankLayer);
            await logger.info(`West Bank layer: ${westBankLayer.features.length} features`);
        }

        return {
            category: category.name,
            totalRecords: records.length,
            features: featureCount,
            skipped: skippedCount,
            geometryTypes: stats.geometryTypes,
        };

    } catch (error) {
        await logger.error(`Failed to process ${category.name}`, error);
        return null;
    }
}

/**
 * Main function
 */
async function generateGeoJSONLayers() {
    await logger.info('========================================');
    await logger.info('GeoJSON Layer Generator');
    await logger.info('========================================');

    await ensureDir(GEOJSON_DIR);

    const results = [];

    for (const category of CATEGORIES) {
        const result = await processCategoryToGeoJSON(category);
        if (result) {
            results.push(result);
        }
    }

    // Generate summary
    const summary = {
        generatedAt: new Date().toISOString(),
        totalCategories: results.length,
        categories: results,
        totalFeatures: results.reduce((sum, r) => sum + r.features, 0),
        totalRecords: results.reduce((sum, r) => sum + r.totalRecords, 0),
        totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
    };

    // Save summary
    const summaryPath = path.join(GEOJSON_DIR, 'summary.json');
    await writeJSON(summaryPath, summary);

    // Print summary
    await logger.info('========================================');
    await logger.info('Generation Summary');
    await logger.info('========================================');
    await logger.info(`Categories processed: ${summary.totalCategories}`);
    await logger.info(`Total records: ${summary.totalRecords}`);
    await logger.info(`Total features: ${summary.totalFeatures}`);
    await logger.info(`Total skipped: ${summary.totalSkipped}`);
    await logger.info('');

    for (const result of results) {
        await logger.info(`${result.category}: ${result.features} features`);
    }

    await logger.info('========================================');
    await logger.success(`GeoJSON layers saved to: ${path.relative(process.cwd(), GEOJSON_DIR)}`);

    return summary;
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
    generateGeoJSONLayers()
        .then(async () => {
            await logger.success('GeoJSON generation completed successfully');
            process.exit(0);
        })
        .catch(async (error) => {
            await logger.error('GeoJSON generation failed', error);
            process.exit(1);
        });
}

export { generateGeoJSONLayers };
