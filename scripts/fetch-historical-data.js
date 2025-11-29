#!/usr/bin/env node

/**
 * Historical Data Fetcher
 * 
 * Fetches historical baseline data (2000-2023) for Palestine from multiple sources.
 * Provides baseline comparisons for current data.
 * 
 * Sources:
 * - World Bank (2000-2023)
 * - UN Data (if available)
 * - Historical PCBS data
 * 
 * Usage: node scripts/fetch-historical-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './utils/logger.js';
import { fetchJSONWithRetry } from './utils/fetch-with-retry.js';
import { schemaUtils } from './utils/standardized-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
    context: 'Historical-Fetcher',
    logLevel: 'INFO',
});

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data/historical');
const WB_API_BASE = 'https://api.worldbank.org/v2';
const COUNTRY_CODE = 'PSE'; // Palestine
const HISTORICAL_START_YEAR = 1960; // Extended from 2000 to 1960
const HISTORICAL_END_YEAR = 2023;
const RATE_LIMIT_DELAY = 500;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Key historical indicators for baseline comparisons
 */
const HISTORICAL_INDICATORS = {
    // Core Economic
    'NY.GDP.MKTP.CD': 'GDP (current US$)',
    'NY.GDP.PCAP.CD': 'GDP per capita (current US$)',
    'NY.GDP.MKTP.KD.ZG': 'GDP growth (annual %)',
    'FP.CPI.TOTL.ZG': 'Inflation, consumer prices (annual %)',

    // Population
    'SP.POP.TOTL': 'Population, total',
    'SP.POP.GROW': 'Population growth (annual %)',
    'SP.URB.TOTL.IN.ZS': 'Urban population (% of total)',
    'SP.DYN.TFRT.IN': 'Fertility rate, total (births per woman)',
    'SP.DYN.LE00.IN': 'Life expectancy at birth, total (years)',

    // Employment
    'SL.UEM.TOTL.ZS': 'Unemployment, total (% of total labor force)',
    'SL.TLF.CACT.ZS': 'Labor force participation rate, total (%)',

    // Poverty
    'SI.POV.GINI': 'Gini index',
    'SI.POV.NAHC': 'Poverty headcount ratio at national poverty lines (%)',

    // Education
    'SE.PRM.ENRR': 'School enrollment, primary (% gross)',
    'SE.SEC.ENRR': 'School enrollment, secondary (% gross)',
    'SE.ADT.LITR.ZS': 'Literacy rate, adult total (%)',

    // Health
    'SH.DYN.MORT': 'Mortality rate, under-5 (per 1,000 live births)',
    'SH.STA.MMRT': 'Maternal mortality ratio (per 100,000 live births)',
    'SH.MED.PHYS.ZS': 'Physicians (per 1,000 people)',

    // Infrastructure
    'EG.ELC.ACCS.ZS': 'Access to electricity (% of population)',
    'IT.NET.USER.ZS': 'Individuals using the Internet (% of population)',

    // Water & Sanitation
    'SH.H2O.BASW.ZS': 'People using at least basic drinking water services (%)',
    'SH.STA.BASS.ZS': 'People using at least basic sanitation services (%)',

    // Trade
    'NE.TRD.GNFS.ZS': 'Trade (% of GDP)',
    'BX.TRF.PWKR.CD.DT': 'Personal remittances, received (current US$)',
};

/**
 * Fetch historical data for an indicator
 */
async function fetchHistoricalIndicator(indicatorCode, indicatorName) {
    await logger.info(`Fetching: ${indicatorName}`);

    try {
        const url = `${WB_API_BASE}/country/${COUNTRY_CODE}/indicator/${indicatorCode}?format=json&date=${HISTORICAL_START_YEAR}:${HISTORICAL_END_YEAR}&per_page=100`;

        const response = await fetchJSONWithRetry(url);

        if (!response || response.length < 2) {
            await logger.warn(`No data available for ${indicatorCode}`);
            return null;
        }

        const [metadata, data] = response;

        if (!data || data.length === 0) {
            await logger.warn(`No data points found for ${indicatorCode}`);
            return null;
        }

        // Transform and filter
        const transformed = data
            .filter(item => item.value !== null)
            .map(item => ({
                year: parseInt(item.date),
                value: item.value,
                indicator: indicatorCode,
                indicator_name: indicatorName,
                country: item.country.value,
            }))
            .sort((a, b) => a.year - b.year);

        await logger.success(`Found ${transformed.length} data points (${transformed[0]?.year}-${transformed[transformed.length - 1]?.year})`);

        return {
            indicator: indicatorCode,
            indicator_name: indicatorName,
            data: transformed,
            metadata: {
                source: 'World Bank',
                period: `${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`,
                fetched_at: new Date().toISOString(),
                total_points: transformed.length,
            },
        };
    } catch (error) {
        await logger.error(`Failed to fetch ${indicatorName}`, error);
        return null;
    }
}

/**
 * Calculate baseline statistics
 */
function calculateBaseline(data) {
    if (!data || data.length === 0) return null;

    const values = data.map(d => d.value);
    const years = data.map(d => d.year);

    return {
        earliest_year: Math.min(...years),
        latest_year: Math.max(...years),
        earliest_value: data.find(d => d.year === Math.min(...years))?.value,
        latest_value: data.find(d => d.year === Math.max(...years))?.value,
        average: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        data_points: data.length,
    };
}

/**
 * Generate comparison report
 */
function generateComparisonReport(historicalData) {
    const report = {
        period: `${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`,
        generated_at: new Date().toISOString(),
        indicators: {},
    };

    for (const [code, data] of Object.entries(historicalData)) {
        if (!data) continue;

        const baseline = calculateBaseline(data.data);
        if (!baseline) continue;

        report.indicators[code] = {
            name: data.indicator_name,
            baseline: baseline,
            trend: baseline.latest_value > baseline.earliest_value ? 'increasing' : 'decreasing',
            change_percent: ((baseline.latest_value - baseline.earliest_value) / baseline.earliest_value * 100).toFixed(2),
        };
    }

    return report;
}

/**
 * Main function
 */
async function fetchHistoricalData() {
    await logger.info('========================================');
    await logger.info('Historical Data Fetcher');
    await logger.info('========================================');
    await logger.info(`Period: ${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`);
    await logger.info(`Country: Palestine (${COUNTRY_CODE})`);
    await logger.info('========================================');

    await ensureDir(DATA_DIR);

    const results = {};
    const allData = [];

    // Fetch all indicators
    for (const [code, name] of Object.entries(HISTORICAL_INDICATORS)) {
        const indicatorData = await fetchHistoricalIndicator(code, name);
        if (indicatorData) {
            results[code] = indicatorData;
            allData.push(...indicatorData.data);
        }
        await sleep(RATE_LIMIT_DELAY);
    }

    // Save individual indicator files
    for (const [code, data] of Object.entries(results)) {
        const fileName = `${code.toLowerCase().replace(/\./g, '_')}.json`;
        await writeJSON(path.join(DATA_DIR, fileName), data);
        await logger.debug(`Saved ${fileName}`);
    }

    // Save all data
    const allDataFile = {
        metadata: {
            source: 'World Bank',
            country: 'Palestine',
            country_code: COUNTRY_CODE,
            period: `${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`,
            fetched_at: new Date().toISOString(),
            indicators: Object.keys(results).length,
            total_data_points: allData.length,
        },
        data: allData.sort((a, b) => a.year - b.year),
    };

    await writeJSON(path.join(DATA_DIR, 'all-historical-data.json'), allDataFile);
    await logger.success('Saved all-historical-data.json');

    // Transform to Unified Schema
    const indicatorCategories = {
        'NY.GDP.MKTP.CD': 'economy', 'NY.GDP.PCAP.CD': 'economy', 'NY.GDP.MKTP.KD.ZG': 'economy', 'FP.CPI.TOTL.ZG': 'economy',
        'SP.POP.TOTL': 'demographics', 'SP.POP.GROW': 'demographics', 'SP.URB.TOTL.IN.ZS': 'demographics', 'SP.DYN.TFRT.IN': 'demographics', 'SP.DYN.LE00.IN': 'health',
        'SL.UEM.TOTL.ZS': 'economy', 'SL.TLF.CACT.ZS': 'economy',
        'SI.POV.GINI': 'economy', 'SI.POV.NAHC': 'economy',
        'SE.PRM.ENRR': 'education', 'SE.SEC.ENRR': 'education', 'SE.ADT.LITR.ZS': 'education',
        'SH.DYN.MORT': 'health', 'SH.STA.MMRT': 'health', 'SH.MED.PHYS.ZS': 'health',
        'EG.ELC.ACCS.ZS': 'infrastructure', 'IT.NET.USER.ZS': 'infrastructure',
        'SH.H2O.BASW.ZS': 'water', 'SH.STA.BASS.ZS': 'water',
        'NE.TRD.GNFS.ZS': 'economy', 'BX.TRF.PWKR.CD.DT': 'economy'
    };

    const unifiedEvents = allData.map(item => {
        return schemaUtils.createEvent({
            id: `wb-${item.indicator}-${item.year}`,
            date: `${item.year}-01-01T00:00:00.000Z`,
            category: indicatorCategories[item.indicator] || 'uncategorized',
            event_type: 'indicator_measurement',
            location: {
                governorate: 'Palestine', // National level data
                lat: 31.9522, // Approximate center
                lon: 35.2332,
                precision: 'country'
            },
            metrics: {
                value: item.value,
                count: 1
            },
            details: `${item.indicator_name}: ${item.value}`,
            source_link: 'World Bank',
            confidence: 'high'
        });
    });

    await writeJSON(path.join(DATA_DIR, 'unified-historical-data.json'), {
        source: 'World Bank',
        category: 'historical',
        transformed_at: new Date().toISOString(),
        record_count: unifiedEvents.length,
        data: unifiedEvents
    });
    await logger.success(`Saved ${unifiedEvents.length} unified historical records`);

    // Generate and save baseline comparison report
    const comparisonReport = generateComparisonReport(results);
    await writeJSON(path.join(DATA_DIR, 'baseline-comparison.json'), comparisonReport);
    await logger.success('Saved baseline-comparison.json');

    // Generate summary
    const summary = {
        fetched_at: new Date().toISOString(),
        period: `${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`,
        total_indicators: Object.keys(results).length,
        total_data_points: allData.length,
        indicators: Object.entries(results).map(([code, data]) => ({
            code,
            name: data.indicator_name,
            data_points: data.data.length,
            year_range: `${data.data[0]?.year}-${data.data[data.data.length - 1]?.year}`,
        })),
    };

    await writeJSON(path.join(DATA_DIR, 'summary.json'), summary);

    // Print summary
    await logger.info('========================================');
    await logger.info('Fetch Summary');
    await logger.info('========================================');
    await logger.info(`Total indicators: ${summary.total_indicators}`);
    await logger.info(`Total data points: ${summary.total_data_points}`);
    await logger.info(`Period: ${HISTORICAL_START_YEAR}-${HISTORICAL_END_YEAR}`);
    await logger.info('');
    await logger.info('Indicators:');
    for (const indicator of summary.indicators) {
        await logger.info(`  ${indicator.name}: ${indicator.data_points} points (${indicator.year_range})`);
    }
    await logger.info('========================================');

    return summary;
}

// Run
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    fetchHistoricalData()
        .then(async () => {
            await logger.success('Historical data fetch completed successfully');
            process.exit(0);
        })
        .catch(async (error) => {
            await logger.error('Historical data fetch failed', error);
            process.exit(1);
        });
}

export { fetchHistoricalData };
