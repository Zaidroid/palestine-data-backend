#!/usr/bin/env node

/**
 * WHO Data Fetcher - Limited Test
 * Fetches a subset of indicators for testing
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/who');
const WHO_API_BASE = 'https://ghoapi.azureedge.net/api';
const COUNTRY_CODE = 'PSE';
const RATE_LIMIT_DELAY = 1000;

const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

const writeJSON = async (filePath, data) => {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

// Limited set of indicators for testing
const WHO_INDICATORS = {
  mortality: [
    { code: 'WHOSIS_000001', name: 'Life expectancy at birth (years)' },
    { code: 'MDG_0000000001', name: 'Infant mortality rate (per 1000 live births)' },
  ],
  workforce: [
    { code: 'HWF_0001', name: 'Medical doctors (per 10,000 population)' },
    { code: 'HWF_0002', name: 'Nursing and midwifery personnel (per 10,000 population)' },
  ],
  immunization: [
    { code: 'WHS4_117', name: 'Immunization coverage - measles (%)' },
  ],
};

async function fetchIndicatorData(indicatorCode, indicatorName) {
  try {
    console.log(`Fetching ${indicatorName}...`);
    const url = `${WHO_API_BASE}/${indicatorCode}?$filter=SpatialDim eq '${COUNTRY_CODE}'`;
    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const records = data?.value || [];
    console.log(`✓ Fetched ${records.length} records`);

    return {
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
      data: records,
      fetched_at: new Date().toISOString(),
      record_count: records.length,
    };
  } catch (error) {
    console.error(`✗ Failed:`, error.message);
    return {
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
      data: [],
      fetched_at: new Date().toISOString(),
      record_count: 0,
      error: error.message,
    };
  }
}

async function fetchCategoryData(categoryName, indicators) {
  console.log(`\n=== ${categoryName} ===`);
  const results = [];
  
  for (const indicator of indicators) {
    const result = await fetchIndicatorData(indicator.code, indicator.name);
    results.push(result);
    await sleep(RATE_LIMIT_DELAY);
  }
  
  return {
    category: categoryName,
    indicators: results,
    total_records: results.reduce((sum, r) => sum + r.record_count, 0),
    fetched_at: new Date().toISOString(),
  };
}

async function main() {
  console.log('========================================');
  console.log('WHO Data Fetcher (Limited Test)');
  console.log('========================================\n');

  await ensureDir(DATA_DIR);

  const allResults = {
    source: 'WHO Global Health Observatory',
    country: COUNTRY_CODE,
    country_name: 'Palestine',
    fetched_at: new Date().toISOString(),
    categories: {},
    summary: {
      total_indicators: 0,
      total_records: 0,
      successful_indicators: 0,
      failed_indicators: 0,
    },
  };

  for (const [categoryKey, indicators] of Object.entries(WHO_INDICATORS)) {
    const categoryData = await fetchCategoryData(categoryKey, indicators);
    allResults.categories[categoryKey] = categoryData;
    
    allResults.summary.total_indicators += indicators.length;
    allResults.summary.total_records += categoryData.total_records;
    allResults.summary.successful_indicators += categoryData.indicators.filter(i => !i.error).length;
    allResults.summary.failed_indicators += categoryData.indicators.filter(i => i.error).length;
  }

  const allDataPath = path.join(DATA_DIR, 'all-data.json');
  await writeJSON(allDataPath, allResults);
  console.log(`\n✓ Saved to: ${allDataPath}`);

  const metadata = {
    source: 'WHO Global Health Observatory',
    country_code: COUNTRY_CODE,
    country_name: 'Palestine',
    last_updated: new Date().toISOString(),
    categories: Object.keys(WHO_INDICATORS),
    summary: allResults.summary,
  };

  const metadataPath = path.join(DATA_DIR, 'metadata.json');
  await writeJSON(metadataPath, metadata);
  console.log(`✓ Saved metadata to: ${metadataPath}`);

  console.log('\n========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Total indicators: ${allResults.summary.total_indicators}`);
  console.log(`Successful: ${allResults.summary.successful_indicators}`);
  console.log(`Failed: ${allResults.summary.failed_indicators}`);
  console.log(`Total records: ${allResults.summary.total_records}`);
  console.log('========================================\n');
}

main().catch(console.error);
