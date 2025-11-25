#!/usr/bin/env node

/**
 * Analytics Generator
 * 
 * Pre-calculates analytics, trends, and statistics from unified data.
 * Offloads heavy computation from the frontend.
 * 
 * Generates:
 * - Daily/Monthly aggregated trends
 * - Cumulative totals over time
 * - Category breakdowns
 * - Correlations between metrics
 * 
 * Usage: node scripts/generate-analytics.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
    context: 'Analytics',
    logLevel: 'INFO',
});

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data/unified');
const OUTPUT_DIR = path.join(__dirname, '../public/data/analytics');

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
        return [];
    }
}

/**
 * Group data by time period
 */
function groupByPeriod(records, period = 'daily') {
    const grouped = {};

    records.forEach(record => {
        const date = record.date || record.pubDate;
        if (!date) return;

        let key;
        try {
            const d = new Date(date);
            if (period === 'daily') {
                key = d.toISOString().split('T')[0]; // YYYY-MM-DD
            } else if (period === 'monthly') {
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
            } else if (period === 'yearly') {
                key = String(d.getFullYear()); // YYYY
            }
        } catch {
            return;
        }

        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(record);
    });

    return grouped;
}

/**
 * Calculate trends for conflict data
 */
async function calculateConflictTrends() {
    await logger.info('Calculating conflict trends...');

    const records = await loadCategoryData('conflict');
    if (records.length === 0) return null;

    const daily = groupByPeriod(records, 'daily');
    const monthly = groupByPeriod(records, 'monthly');

    const dailyTrends = Object.entries(daily).map(([date, items]) => ({
        date,
        total_events: items.length,
        fatalities: items.reduce((sum, r) => sum + (r.fatalities || 0), 0),
        injuries: items.reduce((sum, r) => sum + (r.injuries || 0), 0),
        event_types: [...new Set(items.map(r => r.event_type))],
    })).sort((a, b) => a.date.localeCompare(b.date));

    const monthlyTrends = Object.entries(monthly).map(([month, items]) => ({
        month,
        total_events: items.length,
        fatalities: items.reduce((sum, r) => sum + (r.fatalities || 0), 0),
        injuries: items.reduce((sum, r) => sum + (r.injuries || 0), 0),
    })).sort((a, b) => a.month.localeCompare(b.month));

    // Calculate cumulative totals
    let cumulativeFatalities = 0;
    let cumulativeInjuries = 0;
    const cumulative = dailyTrends.map(day => {
        cumulativeFatalities += day.fatalities;
        cumulativeInjuries += day.injuries;
        return {
            date: day.date,
            cumulative_fatalities: cumulativeFatalities,
            cumulative_injuries: cumulativeInjuries,
        };
    });

    await logger.success(`Processed ${records.length} conflict records`);

    return {
        daily: dailyTrends,
        monthly: monthlyTrends,
        cumulative,
        summary: {
            total_events: records.length,
            total_fatalities: cumulativeFatalities,
            total_injuries: cumulativeInjuries,
            date_range: {
                start: dailyTrends[0]?.date,
                end: dailyTrends[dailyTrends.length - 1]?.date,
            },
        },
    };
}

/**
 * Calculate martyrs statistics
 */
async function calculateMartyrsStats() {
    await logger.info('Calculating martyrs statistics...');

    const records = await loadCategoryData('martyrs');
    if (records.length === 0) return null;

    // Demographics
    const byGender = {};
    const byAge = { children: 0, adults: 0, elderly: 0, unknown: 0 };
    const byLocation = {};

    records.forEach(record => {
        // Gender
        const gender = record.gender || 'unknown';
        byGender[gender] = (byGender[gender] || 0) + 1;

        // Age groups
        const age = record.age;
        if (age === null || age === undefined) {
            byAge.unknown++;
        } else if (age < 18) {
            byAge.children++;
        } else if (age < 60) {
            byAge.adults++;
        } else {
            byAge.elderly++;
        }

        // Location
        const location = record.location || 'unknown';
        byLocation[location] = (byLocation[location] || 0) + 1;
    });

    await logger.success(`Processed ${records.length} martyr records`);

    return {
        total: records.length,
        by_gender: byGender,
        by_age_group: byAge,
        by_location: byLocation,
        demographics: {
            children_percentage: ((byAge.children / records.length) * 100).toFixed(2),
            women_percentage: ((byGender.female || 0) / records.length * 100).toFixed(2),
        },
    };
}

/**
 * Calculate news trends
 */
async function calculateNewsTrends() {
    await logger.info('Calculating news trends...');

    const records = await loadCategoryData('news');
    if (records.length === 0) return null;

    const daily = groupByPeriod(records, 'daily');
    const byCategory = {};
    const bySource = {};

    records.forEach(record => {
        const cat = record.category || 'general';
        byCategory[cat] = (byCategory[cat] || 0) + 1;

        const source = record.source || 'unknown';
        bySource[source] = (bySource[source] || 0) + 1;
    });

    const dailyTrends = Object.entries(daily).map(([date, items]) => ({
        date,
        article_count: items.length,
    })).sort((a, b) => a.date.localeCompare(b.date));

    await logger.success(`Processed ${records.length} news articles`);

    return {
        daily: dailyTrends,
        by_category: byCategory,
        by_source: bySource,
        total_articles: records.length,
    };
}

/**
 * Calculate infrastructure damage stats
 */
async function calculateInfrastructureStats() {
    await logger.info('Calculating infrastructure statistics...');

    const records = await loadCategoryData('infrastructure');
    if (records.length === 0) return null;

    const byType = {};
    const byDamageLevel = {};

    records.forEach(record => {
        const type = record.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;

        const damage = record.damage_level || record.status || 'unknown';
        byDamageLevel[damage] = (byDamageLevel[damage] || 0) + 1;
    });

    await logger.success(`Processed ${records.length} infrastructure records`);

    return {
        total: records.length,
        by_type: byType,
        by_damage_level: byDamageLevel,
    };
}

/**
 * Main function
 */
async function generateAnalytics() {
    await logger.info('========================================');
    await logger.info('Analytics Generator');
    await logger.info('========================================');

    await ensureDir(OUTPUT_DIR);

    // Generate analytics for each category
    const conflictTrends = await calculateConflictTrends();
    const martyrsStats = await calculateMartyrsStats();
    const newsTrends = await calculateNewsTrends();
    const infrastructureStats = await calculateInfrastructureStats();

    // Save individual analytics
    if (conflictTrends) {
        await writeJSON(path.join(OUTPUT_DIR, 'conflict-trends.json'), conflictTrends);
        await logger.success('Saved conflict trends');
    }

    if (martyrsStats) {
        await writeJSON(path.join(OUTPUT_DIR, 'martyrs-stats.json'), martyrsStats);
        await logger.success('Saved martyrs statistics');
    }

    if (newsTrends) {
        await writeJSON(path.join(OUTPUT_DIR, 'news-trends.json'), newsTrends);
        await logger.success('Saved news trends');
    }

    if (infrastructureStats) {
        await writeJSON(path.join(OUTPUT_DIR, 'infrastructure-stats.json'), infrastructureStats);
        await logger.success('Saved infrastructure statistics');
    }

    // Generate summary
    const summary = {
        generated_at: new Date().toISOString(),
        available_analytics: [],
    };

    if (conflictTrends) summary.available_analytics.push('conflict-trends');
    if (martyrsStats) summary.available_analytics.push('martyrs-stats');
    if (newsTrends) summary.available_analytics.push('news-trends');
    if (infrastructureStats) summary.available_analytics.push('infrastructure-stats');

    await writeJSON(path.join(OUTPUT_DIR, 'summary.json'), summary);

    // Print summary
    await logger.info('========================================');
    await logger.info('Analytics Summary');
    await logger.info('========================================');
    await logger.info(`Generated ${summary.available_analytics.length} analytics files`);
    for (const analytic of summary.available_analytics) {
        await logger.info(`  ✓ ${analytic}`);
    }
    await logger.info('========================================');

    return summary;
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
    generateAnalytics()
        .then(async () => {
            await logger.success('Analytics generation completed successfully');
            process.exit(0);
        })
        .catch(async (error) => {
            await logger.error('Analytics generation failed', error);
            process.exit(1);
        });
}

export { generateAnalytics };
