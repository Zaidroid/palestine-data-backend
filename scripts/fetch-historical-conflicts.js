#!/usr/bin/env node

/**
 * Historical Conflict Data Fetcher
 * 
 * Fetches historical conflict data (Gaza wars, Intifadas) from multiple sources.
 * Sources:
 * - TechForPalestine (API)
 * - B'Tselem (Scraping/API)
 * - PCHR (Reports/Scraping)
 * - OCHA (HDX/Reports)
 * 
 * Usage: node scripts/fetch-historical-conflicts.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from './utils/fetch-with-retry.js';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/historical');
const TECH_FOR_PALESTINE_BASE = 'https://data.techforpalestine.org/api/v2';

// Initialize logger
const logger = createLogger({
    context: 'Historical-Fetcher',
    logLevel: 'INFO',
});

const ensureDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
};

const writeJSON = async (filePath, data) => {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        await logger.debug(`Wrote file: ${filePath}`);
    } catch (error) {
        await logger.error(`Failed to write file: ${filePath}`, error);
        throw error;
    }
};

// Fetch from TechForPalestine
async function fetchTechForPalestineData() {
    await logger.info('Fetching data from TechForPalestine...');

    const endpoints = [
        { name: 'casualties_daily', url: `${TECH_FOR_PALESTINE_BASE}/casualties_daily.json` },
        { name: 'west_bank_daily', url: `${TECH_FOR_PALESTINE_BASE}/west_bank_daily.json` },
        // Add more if discovered
    ];

    const results = {};

    for (const endpoint of endpoints) {
        try {
            await logger.info(`Fetching ${endpoint.name}...`);
            const data = await fetchJSONWithRetry(endpoint.url, {}, { maxRetries: 3 });
            results[endpoint.name] = data;
            await logger.success(`Fetched ${data.length} records for ${endpoint.name}`);

            // Save raw data
            await writeJSON(path.join(DATA_DIR, `tfp_${endpoint.name}.json`), data);
        } catch (error) {
            await logger.error(`Failed to fetch ${endpoint.name}`, error);
        }
    }

    return results;
}

// Placeholder for B'Tselem
async function fetchBTselemData() {
    await logger.info('Fetching data from B\'Tselem (Not implemented yet)...');
    // TODO: Implement scraping or API reverse engineering
    return [];
}

// Placeholder for PCHR
async function fetchPCHRData() {
    await logger.info('Fetching data from PCHR (Not implemented yet)...');
    // TODO: Implement report parsing
    return [];
}

async function main() {
    try {
        await ensureDir(DATA_DIR);

        await logger.info('Starting historical data collection...');

        const tfpData = await fetchTechForPalestineData();
        // const btselemData = await fetchBTselemData();
        // const pchrData = await fetchPCHRData();

        await logger.success('Historical data collection completed.');

    } catch (error) {
        await logger.error('Fatal error in historical fetcher', error);
        process.exit(1);
    }
}

main();
