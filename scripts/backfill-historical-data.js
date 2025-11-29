#!/usr/bin/env node

/**
 * Historical Data Backfill Orchestrator
 * 
 * 1. Runs fetchers for historical conflict data.
 * 2. Enriches data with geolocation and confidence scores.
 * 3. Validates data against schema.
 * 4. Merges into unified historical dataset.
 * 
 * Usage: node scripts/backfill-historical-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';
import { enrichDataset } from './utils/data-enricher.js';
import { validateDataset } from './utils/data-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/historical');
const UNIFIED_FILE = path.join(DATA_DIR, 'unified-historical-data.json');

// Initialize logger
const logger = createLogger({
    context: 'Backfill-Orchestrator',
    logLevel: 'INFO',
});

async function readJSON(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function mapConflictToUnified(record) {
    return {
        id: record.id,
        date: record.start_date || record.report_date,
        category: 'conflict',
        event_type: record.name ? 'war' : 'incident',
        location: record.location || { governorate: 'Palestine' }, // Default if missing
        metrics: {
            killed: record.casualties?.killed || record.killed || 0,
            injured: record.casualties?.injured || record.injured || 0,
            displaced: record.casualties?.displaced || 0,
            children_killed: record.casualties?.children_killed || record.killed_children || 0,
            women_killed: record.casualties?.women_killed || record.killed_women || 0
        },
        details: record.description || record.name || 'Historical conflict event',
        source_link: record.source || 'TechForPalestine',
        confidence: record.confidence || 0.8
    };
}

async function main() {
    try {
        await logger.info('Starting historical data backfill...');

        // 1. Load existing unified data
        let unifiedData = await readJSON(UNIFIED_FILE);
        if (!unifiedData) {
            unifiedData = { source: 'Unified Historical', data: [] };
        }

        // 2. Load and process Gaza Wars Summary
        const gazaWars = await readJSON(path.join(DATA_DIR, 'gaza-wars-summary.json'));
        if (gazaWars) {
            const enrichedWars = enrichDataset(gazaWars);
            const mappedWars = enrichedWars.map(mapConflictToUnified);

            // Merge (avoid duplicates by ID)
            for (const war of mappedWars) {
                const index = unifiedData.data.findIndex(d => d.id === war.id);
                if (index >= 0) {
                    unifiedData.data[index] = war;
                } else {
                    unifiedData.data.push(war);
                }
            }
            await logger.success(`Merged ${mappedWars.length} Gaza War records.`);
        }

        // 3. Load and process Intifada Summary
        const intifada = await readJSON(path.join(DATA_DIR, 'intifada-summary.json'));
        if (intifada) {
            const enrichedIntifada = enrichDataset(intifada);
            const mappedIntifada = enrichedIntifada.map(mapConflictToUnified);

            for (const event of mappedIntifada) {
                const index = unifiedData.data.findIndex(d => d.id === event.id);
                if (index >= 0) {
                    unifiedData.data[index] = event;
                } else {
                    unifiedData.data.push(event);
                }
            }
            await logger.success(`Merged ${mappedIntifada.length} Intifada records.`);
        }

        // 4. Validate Final Dataset
        const validationReport = validateDataset(unifiedData.data);
        await logger.info(`Validation Results: ${validationReport.valid} valid, ${validationReport.invalid} invalid.`);

        if (validationReport.invalid > 0) {
            await logger.warn('Some records failed validation. Check logs.');
            // Optionally log specific errors
        }

        // 5. Save Unified Data
        unifiedData.record_count = unifiedData.data.length;
        unifiedData.transformed_at = new Date().toISOString();

        await writeJSON(UNIFIED_FILE, unifiedData);
        await logger.success(`Successfully updated ${UNIFIED_FILE} with ${unifiedData.record_count} records.`);

    } catch (error) {
        await logger.error('Fatal error in backfill orchestrator', error);
        process.exit(1);
    }
}

main();
