#!/usr/bin/env node

/**
 * Analytics Generator
 *
 * Pre-calculates analytics from unified data and writes:
 *   - /public/data/unified/<category>/analytics.json   (per-category stats)
 *   - /public/data/unified/dashboard-summary.json      (global summary)
 *   - /public/data/analytics/conflict-trends.json      (detailed conflict trends)
 *   - /public/data/analytics/martyrs-stats.json        (martyrs demographics)
 *
 * Uses metrics.killed / metrics.injured (canonical schema v3) with fallback
 * to top-level fatalities/injuries for backward compatibility.
 *
 * Usage: node scripts/generate-analytics.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger({ context: 'Analytics', logLevel: 'INFO' });

const UNIFIED_DIR = path.join(__dirname, '../public/data/unified');
const ANALYTICS_DIR = path.join(__dirname, '../public/data/analytics');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}

async function writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJSON(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
}

async function loadCategoryData(categoryName) {
    const data = await readJSON(path.join(UNIFIED_DIR, categoryName, 'all-data.json'));
    if (!data) return [];
    return data.data || data.records || [];
}

/** Extract metric from a record — canonical schema first, then legacy fallback. */
function getKilled(r) { return r.metrics?.killed || r.fatalities || 0; }
function getInjured(r) { return r.metrics?.injured || r.injuries || 0; }
function getMetric(r, name) { return r.metrics?.[name] || 0; }

function groupByPeriod(records, period = 'monthly') {
    const grouped = {};
    for (const r of records) {
        const date = r.date || r.pubDate;
        if (!date) continue;
        let key;
        try {
            const d = new Date(date);
            if (period === 'daily') key = d.toISOString().split('T')[0];
            else if (period === 'yearly') key = String(d.getFullYear());
            else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } catch { continue; }
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    }
    return grouped;
}

// ---------------------------------------------------------------------------
// Per-category analytics.json
//
// Matches the frontend's CategoryAnalytics interface:
//   { records, killed, injured, displaced, demolished, detained,
//     date_range, by_region, by_event_type, timeseries }
// ---------------------------------------------------------------------------

async function generateCategoryAnalytics(category, records) {
    const isCumulative = category === 'conflict';

    // Date range
    const dates = records.map(r => r.date).filter(Boolean).sort();
    const date_range = {
        start: dates[0] || null,
        end: dates[dates.length - 1] || null,
    };

    // Group-bys
    const by_region = {};
    const by_event_type = {};

    // Metric totals (handle cumulative conflict data same as statsController)
    let killed = 0, injured = 0, displaced = 0, demolished = 0, detained = 0;
    const maxByRegion = {}; // for cumulative conflict de-duplication

    for (const r of records) {
        const k = getKilled(r);
        const i = getInjured(r);

        if (isCumulative) {
            const region = r.location?.region || 'Unknown';
            if (!maxByRegion[region]) maxByRegion[region] = { killed: 0, injured: 0 };
            maxByRegion[region].killed = Math.max(maxByRegion[region].killed, k);
            maxByRegion[region].injured = Math.max(maxByRegion[region].injured, i);
        } else {
            killed += k;
            injured += i;
        }

        displaced += getMetric(r, 'displaced');
        demolished += getMetric(r, 'demolished');
        detained += getMetric(r, 'detained');

        const region = r.location?.region || r.location?.name || 'Unknown';
        by_region[region] = (by_region[region] || 0) + 1;

        const et = r.event_type || 'unknown';
        by_event_type[et] = (by_event_type[et] || 0) + 1;
    }

    if (isCumulative) {
        for (const v of Object.values(maxByRegion)) {
            killed += v.killed;
            injured += v.injured;
        }
    }

    // Monthly timeseries (matches frontend: { date, killed, injured, count })
    const monthly = groupByPeriod(records, 'monthly');
    const monthKeys = Object.keys(monthly).sort();

    let timeseries;
    if (isCumulative) {
        // For cumulative data: same delta approach as unifiedController timeseries
        const regionBuckets = {};
        for (const r of records) {
            if (!r.date) continue;
            const d = new Date(r.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const region = r.location?.region || 'Unknown';
            if (!regionBuckets[region]) regionBuckets[region] = {};
            regionBuckets[region][key] = Math.max(
                regionBuckets[region][key] || 0,
                getKilled(r)
            );
        }
        // Sum max per region per month, then compute deltas
        const cumulativeByMonth = {};
        for (const key of monthKeys) {
            let total = 0;
            for (const region of Object.keys(regionBuckets)) {
                total += regionBuckets[region][key] || 0;
            }
            cumulativeByMonth[key] = total;
        }
        timeseries = monthKeys.map((key, idx) => ({
            date: key,
            killed: idx === 0
                ? cumulativeByMonth[key]
                : Math.max(0, cumulativeByMonth[key] - cumulativeByMonth[monthKeys[idx - 1]]),
            injured: 0, // injured delta computation would be similar; keep simple for now
            count: monthly[key]?.length || 0,
        }));
    } else {
        timeseries = monthKeys.map(key => {
            const items = monthly[key];
            return {
                date: key,
                killed: items.reduce((s, r) => s + getKilled(r), 0),
                injured: items.reduce((s, r) => s + getInjured(r), 0),
                count: items.length,
            };
        });
    }

    return {
        records: records.length,
        killed,
        injured,
        displaced,
        demolished,
        detained,
        date_range,
        by_region,
        by_event_type,
        timeseries,
    };
}

// ---------------------------------------------------------------------------
// Detailed conflict trends (for /public/data/analytics/)
// ---------------------------------------------------------------------------

async function calculateConflictTrends(records) {
    if (!records.length) return null;

    const daily = groupByPeriod(records, 'daily');
    const monthly = groupByPeriod(records, 'monthly');

    const dailyTrends = Object.entries(daily).map(([date, items]) => ({
        date,
        total_events: items.length,
        killed: items.reduce((s, r) => s + getKilled(r), 0),
        injured: items.reduce((s, r) => s + getInjured(r), 0),
        event_types: [...new Set(items.map(r => r.event_type))],
    })).sort((a, b) => a.date.localeCompare(b.date));

    const monthlyTrends = Object.entries(monthly).map(([month, items]) => ({
        month,
        total_events: items.length,
        killed: items.reduce((s, r) => s + getKilled(r), 0),
        injured: items.reduce((s, r) => s + getInjured(r), 0),
    })).sort((a, b) => a.month.localeCompare(b.month));

    let cumKilled = 0, cumInjured = 0;
    const cumulative = dailyTrends.map(day => {
        cumKilled += day.killed;
        cumInjured += day.injured;
        return { date: day.date, cumulative_killed: cumKilled, cumulative_injured: cumInjured };
    });

    return {
        daily: dailyTrends,
        monthly: monthlyTrends,
        cumulative,
        summary: {
            total_events: records.length,
            total_killed: cumKilled,
            total_injured: cumInjured,
            date_range: {
                start: dailyTrends[0]?.date,
                end: dailyTrends.at(-1)?.date,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Martyrs demographics (for /public/data/analytics/)
// ---------------------------------------------------------------------------

async function calculateMartyrsStats(records) {
    if (!records.length) return null;

    const byGender = {};
    const byAge = { children: 0, adults: 0, elderly: 0, unknown: 0 };
    const byLocation = {};

    for (const r of records) {
        const gender = r.gender || 'unknown';
        byGender[gender] = (byGender[gender] || 0) + 1;

        const age = r.age;
        if (age == null) byAge.unknown++;
        else if (age < 18) byAge.children++;
        else if (age < 60) byAge.adults++;
        else byAge.elderly++;

        const loc = r.location?.region || r.location?.name || 'unknown';
        byLocation[loc] = (byLocation[loc] || 0) + 1;
    }

    return {
        total: records.length,
        by_gender: byGender,
        by_age_group: byAge,
        by_location: byLocation,
        demographics: {
            children_percentage: ((byAge.children / records.length) * 100).toFixed(2),
            women_percentage: (((byGender.female || 0) / records.length) * 100).toFixed(2),
        },
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function generateAnalytics() {
    await logger.info('========================================');
    await logger.info('Analytics Generator');
    await logger.info('========================================');

    await ensureDir(ANALYTICS_DIR);

    // ── 1. Per-category analytics.json ──────────────────────────────────────

    const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
    const categories = entries.filter(e => e.isDirectory()).map(e => e.name);

    const allAnalytics = {};  // category → analytics object (for dashboard-summary)

    for (const category of categories) {
        const records = await loadCategoryData(category);
        if (!records.length) {
            await logger.info(`  skip ${category} (0 records)`);
            allAnalytics[category] = { records: 0, empty: true };
            continue;
        }

        const analytics = await generateCategoryAnalytics(category, records);
        allAnalytics[category] = analytics;

        // Write per-category analytics.json
        const outPath = path.join(UNIFIED_DIR, category, 'analytics.json');
        await writeJSON(outPath, analytics);
        await logger.info(`  ✓ ${category}: ${analytics.records} records, killed=${analytics.killed}, injured=${analytics.injured}`);
    }

    // ── 2. dashboard-summary.json ──────────────────────────────────────────

    const totals = { records: 0, killed: 0, injured: 0, displaced: 0, demolished: 0, detained: 0 };
    for (const cat of Object.values(allAnalytics)) {
        totals.records += cat.records || 0;
        totals.killed += cat.killed || 0;
        totals.injured += cat.injured || 0;
        totals.displaced += cat.displaced || 0;
        totals.demolished += cat.demolished || 0;
        totals.detained += cat.detained || 0;
    }

    const dashboardSummary = {
        generated_at: new Date().toISOString(),
        categories: allAnalytics,
        totals,
    };

    await writeJSON(path.join(UNIFIED_DIR, 'dashboard-summary.json'), dashboardSummary);
    await logger.success(`Dashboard summary: ${totals.records} records, killed=${totals.killed}, injured=${totals.injured}`);

    // ── 3. Detailed analytics files (conflict trends, martyrs stats) ───────

    const conflictRecords = await loadCategoryData('conflict');
    const conflictTrends = await calculateConflictTrends(conflictRecords);
    if (conflictTrends) {
        await writeJSON(path.join(ANALYTICS_DIR, 'conflict-trends.json'), conflictTrends);
        await logger.success('Saved conflict-trends.json');
    }

    const martyrsRecords = await loadCategoryData('martyrs');
    const martyrsStats = await calculateMartyrsStats(martyrsRecords);
    if (martyrsStats) {
        await writeJSON(path.join(ANALYTICS_DIR, 'martyrs-stats.json'), martyrsStats);
        await logger.success('Saved martyrs-stats.json');
    }

    await logger.info('========================================');
    await logger.info(`Done. ${categories.length} categories processed.`);
    await logger.info('========================================');
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
    generateAnalytics()
        .then(async () => {
            await logger.success('Analytics generation completed');
            process.exit(0);
        })
        .catch(async (error) => {
            await logger.error('Analytics generation failed', error);
            process.exit(1);
        });
}

export { generateAnalytics };
