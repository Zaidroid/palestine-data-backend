#!/usr/bin/env node

/**
 * HDX HAPI Data Fetcher
 * 
 * Fetches data from HDX HAPI API and stores it in structured JSON files
 * Supports time-series partitioning and incremental updates
 * 
 * Usage: HDX_API_KEY=your_key node scripts/fetch-hdx-hapi-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const HDX_HAPI_BASE_URL = 'https://hapi.humdata.org/api/v1';
const HDX_API_KEY = process.env.HDX_API_KEY;
const DATA_DIR = path.join(__dirname, '../public/data/hdx');
const BASELINE_DATE = '2023-10-07';
const RATE_LIMIT_DELAY = 1100; // 1.1 seconds (HDX limit: 1 req/sec)

// Validate API key
if (!HDX_API_KEY) {
  console.error('❌ HDX_API_KEY environment variable is required');
  process.exit(1);
}

// Helper: Sleep function for rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Fetch with retry and rate limiting
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`  Fetching: ${url}`);
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${HDX_API_KEY}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Rate limiting: wait 1.1 seconds between requests
      await sleep(RATE_LIMIT_DELAY);
      
      return data;
    } catch (error) {
      console.warn(`  Attempt ${i + 1}/${retries} failed:`, error.message);
      
      if (i === retries - 1) throw error;
      
      // Exponential backoff
      await sleep(1000 * Math.pow(2, i));
    }
  }
}

// Helper: Ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

// Helper: Write JSON file
async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Helper: Read JSON file
async function readJSON(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

// Helper: Get quarter from date
function getQuarter(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
}

// Helper: Get quarter date range
function getQuarterRange(quarterStr) {
  const [year, q] = quarterStr.split('-Q');
  const quarter = parseInt(q);
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 2;
  
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, endMonth + 1, 0); // Last day of quarter
  
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

// Helper: Partition data by quarter
function partitionByQuarter(data, dateField = 'date') {
  const quarters = {};
  
  data.forEach(record => {
    const quarter = getQuarter(record[dateField]);
    if (!quarters[quarter]) {
      quarters[quarter] = [];
    }
    quarters[quarter].push(record);
  });
  
  return quarters;
}

// Fetch affected people data (casualties)
async function fetchCasualties() {
  console.log('\n📊 Fetching casualties data...');
  
  const url = `${HDX_HAPI_BASE_URL}/affected-people?location_code=PSE&output_format=json&limit=10000`;
  
  try {
    const response = await fetchWithRetry(url);
    const data = response.data || [];
    
    console.log(`  ✓ Fetched ${data.length} records`);
    
    // Filter for post-Oct 7, 2023 data
    const filtered = data.filter(record => {
      const recordDate = record.reference_period_start || record.reference_period_end;
      return recordDate && recordDate >= BASELINE_DATE;
    });
    
    console.log(`  ✓ Filtered to ${filtered.length} records (since ${BASELINE_DATE})`);
    
    // Transform data
    const transformed = filtered.map(record => ({
      date: record.reference_period_start || record.reference_period_end,
      location: record.location_name,
      affected: record.population || 0,
      category: record.category || 'unknown',
      source: 'hdx-hapi',
      reference_period_start: record.reference_period_start,
      reference_period_end: record.reference_period_end,
    }));
    
    // Sort by date
    transformed.sort((a, b) => a.date.localeCompare(b.date));
    
    return transformed;
  } catch (error) {
    console.error('  ❌ Failed to fetch casualties:', error.message);
    return [];
  }
}

// Fetch displacement data
async function fetchDisplacement() {
  console.log('\n🏠 Fetching displacement data...');
  
  const url = `${HDX_HAPI_BASE_URL}/population-social?location_code=PSE&output_format=json&limit=10000`;
  
  try {
    const response = await fetchWithRetry(url);
    const data = response.data || [];
    
    console.log(`  ✓ Fetched ${data.length} records`);
    
    // Filter for displacement-related data
    const filtered = data.filter(record => {
      const recordDate = record.reference_period_start || record.reference_period_end;
      return recordDate && recordDate >= BASELINE_DATE;
    });
    
    console.log(`  ✓ Filtered to ${filtered.length} records (since ${BASELINE_DATE})`);
    
    // Transform data
    const transformed = filtered.map(record => ({
      date: record.reference_period_start || record.reference_period_end,
      location: record.location_name,
      population: record.population || 0,
      category: record.category || 'unknown',
      source: 'hdx-hapi',
      reference_period_start: record.reference_period_start,
      reference_period_end: record.reference_period_end,
    }));
    
    // Sort by date
    transformed.sort((a, b) => a.date.localeCompare(b.date));
    
    return transformed;
  } catch (error) {
    console.error('  ❌ Failed to fetch displacement:', error.message);
    return [];
  }
}

// Fetch food security data
async function fetchFoodSecurity() {
  console.log('\n🍞 Fetching food security data...');
  
  const url = `${HDX_HAPI_BASE_URL}/food-security?location_code=PSE&output_format=json&limit=10000`;
  
  try {
    const response = await fetchWithRetry(url);
    const data = response.data || [];
    
    console.log(`  ✓ Fetched ${data.length} records`);
    
    // Filter for post-Oct 7, 2023 data
    const filtered = data.filter(record => {
      const recordDate = record.reference_period_start || record.reference_period_end;
      return recordDate && recordDate >= BASELINE_DATE;
    });
    
    console.log(`  ✓ Filtered to ${filtered.length} records (since ${BASELINE_DATE})`);
    
    // Transform data
    const transformed = filtered.map(record => ({
      date: record.reference_period_start || record.reference_period_end,
      location: record.location_name,
      population: record.population || 0,
      ipc_phase: record.ipc_phase || 'unknown',
      ipc_type: record.ipc_type || 'unknown',
      source: 'hdx-hapi',
      reference_period_start: record.reference_period_start,
      reference_period_end: record.reference_period_end,
    }));
    
    // Sort by date
    transformed.sort((a, b) => a.date.localeCompare(b.date));
    
    return transformed;
  } catch (error) {
    console.error('  ❌ Failed to fetch food security:', error.message);
    return [];
  }
}

// Fetch conflict events
async function fetchConflictEvents() {
  console.log('\n⚔️  Fetching conflict events...');
  
  const url = `${HDX_HAPI_BASE_URL}/conflict-event?location_code=PSE&output_format=json&limit=10000`;
  
  try {
    const response = await fetchWithRetry(url);
    const data = response.data || [];
    
    console.log(`  ✓ Fetched ${data.length} records`);
    
    // Filter for post-Oct 7, 2023 data
    const filtered = data.filter(record => {
      const recordDate = record.event_date;
      return recordDate && recordDate >= BASELINE_DATE;
    });
    
    console.log(`  ✓ Filtered to ${filtered.length} records (since ${BASELINE_DATE})`);
    
    // Transform data
    const transformed = filtered.map(record => ({
      date: record.event_date,
      location: record.location_name,
      event_type: record.event_type || 'unknown',
      fatalities: record.fatalities || 0,
      source: 'hdx-hapi',
    }));
    
    // Sort by date
    transformed.sort((a, b) => a.date.localeCompare(b.date));
    
    return transformed;
  } catch (error) {
    console.error('  ❌ Failed to fetch conflict events:', error.message);
    return [];
  }
}

// Save partitioned data
async function savePartitionedData(datasetPath, data, datasetName) {
  console.log(`\n💾 Saving ${datasetName} data...`);
  
  await ensureDir(datasetPath);
  
  if (data.length === 0) {
    console.log('  ⚠️  No data to save');
    return;
  }
  
  // Partition by quarter
  const quarters = partitionByQuarter(data);
  const quarterKeys = Object.keys(quarters).sort();
  
  console.log(`  ✓ Partitioned into ${quarterKeys.length} quarters`);
  
  // Create index
  const index = {
    dataset: datasetName,
    date_range: {
      start: data[0].date,
      end: data[data.length - 1].date,
      baseline_date: BASELINE_DATE,
    },
    files: [],
    last_updated: new Date().toISOString(),
  };
  
  // Save each quarter
  for (const quarter of quarterKeys) {
    const quarterData = quarters[quarter];
    const fileName = `${quarter}.json`;
    const filePath = path.join(datasetPath, fileName);
    const range = getQuarterRange(quarter);
    
    const fileData = {
      metadata: {
        source: 'hdx-hapi',
        dataset: datasetName,
        date_range: range,
        record_count: quarterData.length,
        last_updated: new Date().toISOString(),
        data_quality: 'verified',
        provisional: false,
      },
      data: quarterData,
    };
    
    await writeJSON(filePath, fileData);
    
    const stats = await fs.stat(filePath);
    const sizeKb = Math.round(stats.size / 1024);
    
    index.files.push({
      file: fileName,
      date_range: range,
      records: quarterData.length,
      size_kb: sizeKb,
    });
    
    console.log(`  ✓ Saved ${fileName} (${quarterData.length} records, ${sizeKb}KB)`);
  }
  
  // Save recent data (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentData = data.filter(record => new Date(record.date) >= thirtyDaysAgo);
  
  if (recentData.length > 0) {
    const recentFile = {
      metadata: {
        source: 'hdx-hapi',
        dataset: datasetName,
        date_range: {
          start: recentData[0].date,
          end: recentData[recentData.length - 1].date,
        },
        record_count: recentData.length,
        last_updated: new Date().toISOString(),
        data_quality: 'verified',
        provisional: false,
      },
      data: recentData,
    };
    
    await writeJSON(path.join(datasetPath, 'recent.json'), recentFile);
    console.log(`  ✓ Saved recent.json (${recentData.length} records)`);
  }
  
  // Save index
  await writeJSON(path.join(datasetPath, 'index.json'), index);
  console.log(`  ✓ Saved index.json`);
  
  // Save metadata
  const metadata = {
    source: 'hdx-hapi',
    dataset: datasetName,
    baseline_date: BASELINE_DATE,
    last_updated: new Date().toISOString(),
    next_update: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours
    total_records: data.length,
    api_endpoint: `${HDX_HAPI_BASE_URL}/${datasetName}`,
    update_frequency: '6_hours',
    data_quality: 'verified',
    provisional: false,
    date_range: {
      start: data[0].date,
      end: data[data.length - 1].date,
    },
    partitioning: {
      strategy: 'quarterly',
      files: quarterKeys.length,
      total_size_kb: index.files.reduce((sum, f) => sum + f.size_kb, 0),
    },
  };
  
  await writeJSON(path.join(datasetPath, 'metadata.json'), metadata);
  console.log(`  ✓ Saved metadata.json`);
}

// Main execution
async function main() {
  console.log('🚀 HDX HAPI Data Fetcher');
  console.log('========================\n');
  console.log(`Baseline Date: ${BASELINE_DATE}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Rate Limit: 1 request per ${RATE_LIMIT_DELAY}ms\n`);
  
  try {
    // Fetch all datasets
    const [casualties, displacement, foodSecurity, conflictEvents] = await Promise.all([
      fetchCasualties(),
      fetchDisplacement(),
      fetchFoodSecurity(),
      fetchConflictEvents(),
    ]);
    
    // Save casualties
    if (casualties.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'casualties'),
        casualties,
        'casualties'
      );
    }
    
    // Save displacement
    if (displacement.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'displacement'),
        displacement,
        'displacement'
      );
    }
    
    // Save food security
    if (foodSecurity.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'humanitarian/food-security'),
        foodSecurity,
        'food-security'
      );
    }
    
    // Save conflict events
    if (conflictEvents.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'conflict'),
        conflictEvents,
        'conflict-events'
      );
    }
    
    console.log('\n✅ HDX HAPI data fetch completed successfully!');
    console.log('\nSummary:');
    console.log(`  Casualties: ${casualties.length} records`);
    console.log(`  Displacement: ${displacement.length} records`);
    console.log(`  Food Security: ${foodSecurity.length} records`);
    console.log(`  Conflict Events: ${conflictEvents.length} records`);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run
main();
