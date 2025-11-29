#!/usr/bin/env node

/**
 * Second Intifada Data Fetcher
 * 
 * Fetches or generates data for the Second Intifada (2000-2005).
 * Primary source: B'Tselem (via summary for now due to API restrictions).
 * 
 * Usage: node scripts/fetch-intifada-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/historical');
const SUMMARY_FILE = path.join(DATA_DIR, 'intifada-summary.json');

// Initialize logger
const logger = createLogger({
    context: 'Intifada-Fetcher',
    logLevel: 'INFO',
});

const summaryData = [
    {
        "id": "second-intifada",
        "name": "Second Intifada (Al-Aqsa Intifada)",
        "start_date": "2000-09-28",
        "end_date": "2005-02-08",
        "casualties": {
            "killed": 3189, // Approx number of Palestinians killed by Israeli forces
            "injured": 0, // Data unavailable in summary
            "children_killed": 640, // Approx
            "women_killed": 0 // Data unavailable in summary
        },
        "source": "B'Tselem",
        "description": "Major Palestinian uprising against the Israeli occupation."
    }
];

const ensureDir = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
};

async function main() {
    try {
        await ensureDir(DATA_DIR);
        await logger.info('Generating Second Intifada summary data...');

        await fs.writeFile(SUMMARY_FILE, JSON.stringify(summaryData, null, 2), 'utf-8');

        await logger.success(`Generated summary data at ${SUMMARY_FILE}`);

    } catch (error) {
        await logger.error('Fatal error in Intifada fetcher', error);
        process.exit(1);
    }
}

main();
