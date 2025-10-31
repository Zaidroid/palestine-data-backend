#!/usr/bin/env node

/**
 * Test WHO Data Fetcher - Small Test
 * Fetches just 2 indicators to test the full pipeline
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/who-test');
const WHO_API_BASE = 'https://ghoapi.azureedge.net/api';
const COUNTRY_CODE = 'PSE';
const RATE_LIMIT_DELAY = 1000;

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

async function fetchIndicatorData(indicatorCode, indicatorName) {
  try {
    console.log(`Fetching ${indicatorName}...`);
    
    const url = `${WHO_API_BASE}/${indicatorCode}?$filter=SpatialDim eq '${COUNTRY_CODE}'`;
    const response = await fetch(url);
    
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

async function testFetch() {
  console.log('Testing WHO data fetch (small test)...\n');
  
  await ensureDir(DATA_DIR);
  
  const indicators = [
    { code: 'WHOSIS_000001', name: 'Life expectancy at birth (years)' },
    { code: 'MDG_0000000001', name: 'Infant mortality rate (per 1000 live births)' },
  ];
  
  const results = [];
  
  for (const indicator of indicators) {
    const result = await fetchIndicatorData(indicator.code, indicator.name);
    results.push(result);
    await sleep(RATE_LIMIT_DELAY);
  }
  
  const output = {
    source: 'WHO Global Health Observatory',
    country: COUNTRY_CODE,
    fetched_at: new Date().toISOString(),
    indicators: results,
    total_records: results.reduce((sum, r) => sum + r.record_count, 0),
  };
  
  const outputPath = path.join(DATA_DIR, 'test-data.json');
  await writeJSON(outputPath, output);
  
  console.log(`\n✓ Saved test data to: ${outputPath}`);
  console.log(`Total records: ${output.total_records}`);
}

testFetch().catch(console.error);
