#!/usr/bin/env node

/**
 * Infrastructure Data Fetcher
 * 
 * Fetches infrastructure damage data from TechForPalestine API.
 * Provides daily updates on damaged housing, public buildings, and critical infrastructure in Gaza.
 * 
 * Usage: node scripts/fetch-infrastructure-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import { InfrastructureTransformer } from './utils/infrastructure-transformer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/infrastructure');
const RATE_LIMIT_DELAY = 1000;

// TechForPalestine API
const API_URL = 'https://data.techforpalestine.org/api/v3/infrastructure-damaged.json';

// Create rate-limited fetcher
const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

// Simple logger
const logger = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg, data) => console.log(`✅ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`⚠️  ${msg}`, data || ''),
    error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
};

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
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.success(`Written: ${path.basename(filePath)}`);
    } catch (error) {
        logger.error(`Failed to write ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Fetch data from TechForPalestine
 */
async function fetchInfrastructureData() {
    logger.info('Fetching infrastructure data from TechForPalestine...');

    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const rawData = await response.json();
        logger.success(`Fetched ${rawData.length} daily reports`);

        return rawData;

    } catch (error) {
        logger.error('Failed to fetch from TechForPalestine:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        logger.info('Starting Infrastructure data fetch...');
        await ensureDir(DATA_DIR);

        // Fetch data
        const rawRecords = await fetchInfrastructureData();

        // Save RAW data for the pipeline to process
        await writeJSON(path.join(DATA_DIR, 'raw-damage-reports.json'), {
            metadata: {
                source: 'TechForPalestine',
                fetched_at: new Date().toISOString(),
                count: rawRecords.length,
            },
            data: rawRecords
        });

        // We can still output a summary or transformed version for quick access if needed,
        // but the pipeline expects raw data.
        const transformer = new InfrastructureTransformer();
        const transformedData = transformer.transform(rawRecords, {
            source: 'TechForPalestine',
            organization: 'Government Media Office (Gaza)',
            url: API_URL
        });

        // Save summary
        const latestReport = transformedData[transformedData.length - 1];
        if (latestReport) {
            await writeJSON(path.join(DATA_DIR, 'summary.json'), {
                date: latestReport.date,
                housing: latestReport.metrics.housing,
                public_buildings: latestReport.metrics.public_buildings,
                infrastructure: latestReport.metrics.infrastructure,
                last_updated: new Date().toISOString()
            });
        }

        logger.success('✅ Infrastructure data fetch completed!');

    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchInfrastructureData };
