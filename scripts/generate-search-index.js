#!/usr/bin/env node

/**
 * Search Index Generator
 * 
 * Creates a searchable index from all unified data categories.
 * Enables fast client-side search across martyrs, locations, events, etc.
 * 
 * Usage: node scripts/generate-search-index.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
    context: 'Search-Index',
    logLevel: 'INFO',
});

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data/unified');
const OUTPUT_DIR = path.join(__dirname, '../public/data');

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
 * Extract searchable text from a record
 */
function extractSearchableText(record, category) {
    const tokens = [];

    // Common fields
    if (record.name) tokens.push(record.name);
    if (record.title) tokens.push(record.title);
    if (record.location) tokens.push(record.location);
    if (record.description) tokens.push(record.description);
    if (record.event_type) tokens.push(record.event_type);

    // Category-specific fields
    switch (category) {
        case 'martyrs':
            if (record.name_ar) tokens.push(record.name_ar);
            if (record.name_en) tokens.push(record.name_en);
            if (record.age) tokens.push(`age ${record.age}`);
            if (record.gender) tokens.push(record.gender);
            break;

        case 'news':
            if (record.source) tokens.push(record.source);
            if (record.category) tokens.push(record.category);
            break;

        case 'conflict':
            if (record.actor1) tokens.push(record.actor1);
            if (record.actor2) tokens.push(record.actor2);
            break;

        case 'infrastructure':
            if (record.type) tokens.push(record.type);
            if (record.status) tokens.push(record.status);
            break;
    }

    return tokens.join(' ').toLowerCase();
}

/**
 * Create search index entry
 */
function createIndexEntry(record, category, index) {
    const searchText = extractSearchableText(record, category);

    return {
        id: record.id || `${category}-${index}`,
        category,
        text: searchText,
        // Store minimal data for preview
        preview: {
            title: record.name || record.title || record.event_type || 'Untitled',
            date: record.date || record.pubDate || null,
            location: record.location || null,
        },
        // Store reference to full record
        ref: {
            category,
            id: record.id,
        }
    };
}

/**
 * Load all data from a category
 */
async function loadCategoryData(categoryName) {
    const categoryDir = path.join(DATA_DIR, categoryName);
    const allDataPath = path.join(categoryDir, 'all-data.json');

    try {
        const data = await readJSON(allDataPath);
        if (!data) return [];

        return data.data || data.records || [];
    } catch (error) {
        await logger.debug(`Could not load ${categoryName}: ${error.message}`);
        return [];
    }
}

/**
 * Generate search index
 */
async function generateSearchIndex() {
    await logger.info('========================================');
    await logger.info('Search Index Generator');
    await logger.info('========================================');

    await ensureDir(OUTPUT_DIR);

    const categories = [
        'martyrs',
        'conflict',
        'news',
        'infrastructure',
        'health',
        'education',
        'water',
        'humanitarian',
        'refugees',
        'economic',
    ];

    const searchIndex = [];
    const stats = {
        total_entries: 0,
        by_category: {},
    };

    for (const category of categories) {
        await logger.info(`Processing ${category}...`);

        const records = await loadCategoryData(category);

        if (records.length === 0) {
            await logger.warn(`No data found for ${category}`);
            continue;
        }

        let indexed = 0;
        records.forEach((record, index) => {
            const entry = createIndexEntry(record, category, index);

            // Only index if there's meaningful searchable text
            if (entry.text && entry.text.trim().length > 0) {
                searchIndex.push(entry);
                indexed++;
            }
        });

        stats.by_category[category] = indexed;
        stats.total_entries += indexed;

        await logger.success(`Indexed ${indexed}/${records.length} records`);
    }

    // Save full search index
    const indexPath = path.join(OUTPUT_DIR, 'search-index.json');
    console.log('Writing index to:', indexPath);
    await writeJSON(indexPath, {
        generated_at: new Date().toISOString(),
        total_entries: stats.total_entries,
        categories: Object.keys(stats.by_category),
        index: searchIndex,
    });

    await logger.success(`Saved search index: ${stats.total_entries} entries`);

    // Generate category-specific indexes for faster loading
    for (const category of Object.keys(stats.by_category)) {
        const categoryIndex = searchIndex.filter(e => e.category === category);
        const categoryIndexPath = path.join(OUTPUT_DIR, `search-index-${category}.json`);

        await writeJSON(categoryIndexPath, {
            category,
            total_entries: categoryIndex.length,
            index: categoryIndex,
        });
    }

    // Save summary
    const summaryPath = path.join(OUTPUT_DIR, 'search-summary.json');
    await writeJSON(summaryPath, {
        generated_at: new Date().toISOString(),
        total_entries: stats.total_entries,
        by_category: stats.by_category,
        categories: Object.keys(stats.by_category),
    });

    // Print summary
    await logger.info('========================================');
    await logger.info('Index Summary');
    await logger.info('========================================');
    await logger.info(`Total entries: ${stats.total_entries}`);
    await logger.info('By category:');
    for (const [cat, count] of Object.entries(stats.by_category)) {
        await logger.info(`  ${cat}: ${count}`);
    }
    await logger.info('========================================');

    return stats;
}

// Run
// Run
generateSearchIndex()
    .then(async () => {
        await logger.success('Search index generation completed successfully');
        process.exit(0);
    })
    .catch(async (error) => {
        await logger.error('Search index generation failed', error);
        process.exit(1);
    });

export { generateSearchIndex };
