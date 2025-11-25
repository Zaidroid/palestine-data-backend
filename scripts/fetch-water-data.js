#!/usr/bin/env node

/**
 * Water & Sanitation (WASH) Data Fetcher
 * 
 * Fetches WASH data from HDX HAPI (Humanitarian API).
 * Focuses on indicators related to water access, sanitation, and hygiene in Palestine.
 * 
 * Usage: node scripts/fetch-water-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import { WaterTransformer } from './utils/water-transformer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/water');
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// HDX HAPI Configuration
const HDX_API_BASE = 'https://hapi.humdata.org/api/v1';
const APP_IDENTIFIER = 'palestine-data-backend-v1'; // Required by HDX HAPI

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
 * Fetch data from HDX HAPI
 * Note: Since HAPI is in beta and specific endpoints might change, 
 * we'll use a search approach or specific known endpoints if available.
 * For now, we'll try to fetch datasets tagged with 'wash' for Palestine.
 */
import Papa from 'papaparse';

/**
 * Fetch and parse a resource
 */
async function fetchAndParseResource(resource, dataset) {
    try {
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error(`Failed to fetch resource: ${response.status}`);

        const text = await response.text();
        let records = [];

        if (resource.format.toLowerCase().includes('json')) {
            const json = JSON.parse(text);
            // Handle different JSON structures
            const items = Array.isArray(json) ? json : (json.data || json.records || []);
            records = items.map(item => ({
                date: item.date || item.reference_period_end || dataset.metadata_modified,
                location_name: item.admin1_name || item.location_name || 'Palestine',
                indicator_name: item.indicator_name || resource.name,
                value: item.value || item.metric_value || 0,
                unit: item.unit || 'count',
                source_dataset: dataset.title,
                resource_url: resource.url
            }));
        } else if (resource.format.toLowerCase().includes('csv')) {
            const result = Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                comments: '#' // Skip HXL tags if they are comments, but usually they are the 2nd row
            });

            // HXL Tag detection (simple heuristic)
            // If headers start with #, they are HXL tags. 
            // Often HXL tags are the second row, so header: true might use the first row as keys.
            // We'll assume standard headers for now or try to map common names.

            records = result.data.map(row => {
                // Try to find date
                const date = row['Date'] || row['date'] || row['#date'] || dataset.metadata_modified;

                // Try to find location
                const location = row['Governorate'] || row['Admin1'] || row['Location'] || row['#adm1+name'] || 'Palestine';

                // Try to find value
                let value = 0;
                const valueKeys = Object.keys(row).filter(k =>
                    k.toLowerCase().includes('value') ||
                    k.toLowerCase().includes('affected') ||
                    k.toLowerCase().includes('total')
                );
                if (valueKeys.length > 0) {
                    value = parseFloat(row[valueKeys[0]]);
                }

                // Try to find indicator name
                const indicator = row['Indicator'] || row['#indicator+name'] || resource.name;

                if (isNaN(value)) value = 0;

                return {
                    date,
                    location_name: location,
                    indicator_name: indicator,
                    value,
                    unit: 'count', // Default
                    source_dataset: dataset.title,
                    resource_url: resource.url
                };
            }).filter(r => r.value > 0); // Only keep records with values
        }

        return records;
    } catch (error) {
        logger.warn(`Failed to parse resource ${resource.name}: ${error.message}`);
        return [];
    }
}

async function fetchHDXWashData() {
    // Note: Direct HAPI integration might be complex without a client library.
    // We will use the CKAN API (standard HDX API) which is more stable for dataset discovery,
    // and then fetch the resources.

    const CKAN_API_BASE = 'https://data.humdata.org/api/3/action';

    // Search for WASH datasets in Palestine
    // Broader search: "water" OR "sanitation" OR "hygiene" in Palestine group
    const searchUrl = `${CKAN_API_BASE}/package_search?q=(water OR sanitation OR hygiene OR wash) AND groups:pse&rows=20`;

    logger.info(`Searching HDX with query: ${searchUrl}`);

    try {
        const response = await fetch(searchUrl);
        if (!response.ok) throw new Error(`HDX API error: ${response.status}`);

        const data = await response.json();
        if (!data.success) throw new Error('HDX API returned unsuccessful response');

        const datasets = data.result.results;
        logger.info(`Found ${datasets.length} WASH datasets`);

        const allRecords = [];

        for (const dataset of datasets) {
            logger.info(`Processing dataset: ${dataset.title}`);

            // Find CSV/JSON resources
            const resources = dataset.resources.filter(r =>
                r.format.toLowerCase() === 'csv' || r.format.toLowerCase() === 'json'
            );

            for (const resource of resources) {
                // Skip if file is too large (arbitrary limit 10MB)
                if (resource.size > 10 * 1024 * 1024) {
                    logger.warn(`Skipping large resource: ${resource.name}`);
                    continue;
                }

                logger.info(`  Fetching and parsing resource: ${resource.name}`);
                const records = await fetchAndParseResource(resource, dataset);

                if (records.length > 0) {
                    logger.success(`  Extracted ${records.length} records`);
                    allRecords.push(...records);
                } else {
                    // Fallback: Add metadata record if parsing failed or returned no data
                    allRecords.push({
                        indicator_name: resource.name,
                        indicator_description: resource.description || dataset.notes,
                        value: 0,
                        unit: 'dataset',
                        date: dataset.metadata_modified,
                        location_name: 'State of Palestine',
                        dataset_name: dataset.title,
                        dataset_hdx_url: dataset.url,
                        resource_url: resource.url,
                        format: resource.format
                    });
                }
            }
        }

        return allRecords;

    } catch (error) {
        logger.error('Failed to fetch from HDX:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        logger.info('Starting Water/WASH data fetch...');
        await ensureDir(DATA_DIR);

        // Fetch data
        const rawRecords = await fetchHDXWashData();

        // Save RAW data
        await writeJSON(path.join(DATA_DIR, 'raw-wash-data.json'), {
            metadata: {
                source: 'HDX',
                fetched_at: new Date().toISOString(),
                count: rawRecords.length
            },
            data: rawRecords
        });

        logger.success('✅ Water data fetch completed!');

    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { fetchHDXWashData };
