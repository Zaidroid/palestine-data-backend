#!/usr/bin/env node

/**
 * Tech4Palestine Data Fetcher
 * 
 * Fetches data from Tech4Palestine API:
 * - Killed in Gaza (individual records)
 * - Press casualties
 * - Daily casualty summaries
 * - West Bank casualties
 * - Overall summary statistics
 * 
 * Usage: node scripts/fetch-tech4palestine-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const BASELINE_DATE = '2023-10-07';

// Helper: Write JSON file
async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Helper: Ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
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

// Helper: Partition data by quarter
function partitionByQuarter(data, dateField = 'date') {
  const quarters = {};
  
  data.forEach(record => {
    const recordDate = record[dateField];
    if (!recordDate) return;
    
    const quarter = getQuarter(recordDate);
    if (!quarters[quarter]) {
      quarters[quarter] = [];
    }
    quarters[quarter].push(record);
  });
  
  return quarters;
}

/**
 * Fetch Tech4Palestine data from API
 */
async function fetchTech4Palestine() {
  console.log('\n📊 Fetching Tech4Palestine data...');
  
  const API_BASE = 'https://data.techforpalestine.org/api';
  const endpoints = {
    killedInGaza: '/v3/killed-in-gaza.min.json',
    pressKilled: '/v2/press_killed_in_gaza.json',
    summary: '/v3/summary.json',
    casualtiesDaily: '/v2/casualties_daily.json',
    westBankDaily: '/v2/west_bank_daily.json',
    infrastructure: '/v3/infrastructure-damaged.json',
  };
  
  const results = {};
  
  for (const [key, endpoint] of Object.entries(endpoints)) {
    try {
      console.log(`  Fetching ${key}...`);
      const response = await fetch(`${API_BASE}${endpoint}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      results[key] = data;
      console.log(`  ✓ ${key}: ${Array.isArray(data) ? data.length : 'N/A'} records`);
    } catch (error) {
      console.error(`  ❌ Failed to fetch ${key}:`, error.message);
      results[key] = null;
    }
  }
  
  return results;
}

/**
 * Save Tech4Palestine data with partitioning
 */
async function saveTech4PalestineData(data) {
  console.log('\n💾 Saving Tech4Palestine data...');
  
  const basePath = path.join(DATA_DIR, 'tech4palestine');
  await ensureDir(basePath);
  
  // Save summary (current snapshot only)
  if (data.summary) {
    await writeJSON(path.join(basePath, 'summary.json'), {
      metadata: {
        source: 'tech4palestine',
        last_updated: new Date().toISOString(),
      },
      data: data.summary,
    });
    console.log('  ✓ Saved summary.json');
  }
  
  // Save press killed (complete list)
  if (data.pressKilled) {
    await writeJSON(path.join(basePath, 'press-killed.json'), {
      metadata: {
        source: 'tech4palestine',
        last_updated: new Date().toISOString(),
        record_count: data.pressKilled.length,
      },
      data: data.pressKilled,
    });
    console.log(`  ✓ Saved press-killed.json (${data.pressKilled.length} records)`);
  }
  
  // Save casualties daily (partitioned)
  if (data.casualtiesDaily && Array.isArray(data.casualtiesDaily)) {
    const casualtiesPath = path.join(basePath, 'casualties');
    await ensureDir(casualtiesPath);
    
    // Filter for post-Oct 7 data
    const filtered = data.casualtiesDaily.filter(record => {
      const date = record.report_date || record.date;
      return date && date >= BASELINE_DATE;
    });
    
    // Normalize data - keep API field names for compatibility
    const normalized = filtered.map(record => ({
      report_date: record.report_date || record.date,
      date: record.report_date || record.date, // Keep both for compatibility
      ext_killed_cum: record.ext_killed_cum || record.killed || 0,
      killed: record.ext_killed_cum || record.killed || 0,
      ext_injured_cum: record.ext_injured_cum || record.injured || 0,
      injured: record.ext_injured_cum || record.injured || 0,
      source: 'tech4palestine',
    })).sort((a, b) => a.report_date.localeCompare(b.report_date));
    
    // Partition by quarter
    const quarters = partitionByQuarter(normalized);
    
    for (const [quarter, quarterData] of Object.entries(quarters)) {
      await writeJSON(path.join(casualtiesPath, `${quarter}.json`), {
        metadata: {
          source: 'tech4palestine',
          dataset: 'casualties',
          quarter,
          record_count: quarterData.length,
          last_updated: new Date().toISOString(),
        },
        data: quarterData,
      });
      console.log(`  ✓ Saved casualties/${quarter}.json (${quarterData.length} records)`);
    }
    
    // Save recent (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recent = normalized.filter(r => new Date(r.date) >= thirtyDaysAgo);
    
    if (recent.length > 0) {
      await writeJSON(path.join(casualtiesPath, 'recent.json'), {
        metadata: {
          source: 'tech4palestine',
          dataset: 'casualties',
          record_count: recent.length,
          last_updated: new Date().toISOString(),
        },
        data: recent,
      });
      console.log(`  ✓ Saved casualties/recent.json (${recent.length} records)`);
    }
    
    // Save index
    await writeJSON(path.join(casualtiesPath, 'index.json'), {
      dataset: 'casualties',
      date_range: {
        start: normalized[0]?.date || BASELINE_DATE,
        end: normalized[normalized.length - 1]?.date || new Date().toISOString().split('T')[0],
        baseline_date: BASELINE_DATE,
      },
      files: Object.keys(quarters).sort().map(q => ({
        file: `${q}.json`,
        quarter: q,
        records: quarters[q].length,
      })),
      last_updated: new Date().toISOString(),
    });
    console.log('  ✓ Saved casualties/index.json');
  }
  
  // Save West Bank daily (partitioned)
  if (data.westBankDaily && Array.isArray(data.westBankDaily)) {
    const westBankPath = path.join(basePath, 'westbank');
    await ensureDir(westBankPath);
    
    // Filter for post-Oct 7 data
    const filtered = data.westBankDaily.filter(record => {
      const date = record.report_date || record.date;
      return date && date >= BASELINE_DATE;
    });
    
    // Normalize data
    const normalized = filtered.map(record => ({
      report_date: record.report_date || record.date,
      date: record.report_date || record.date,
      killed: record.killed || 0,
      injured: record.injured || 0,
      source: 'tech4palestine',
    })).sort((a, b) => a.report_date.localeCompare(b.report_date));
    
    // Partition by quarter
    const quarters = partitionByQuarter(normalized);
    
    for (const [quarter, quarterData] of Object.entries(quarters)) {
      await writeJSON(path.join(westBankPath, `${quarter}.json`), {
        metadata: {
          source: 'tech4palestine',
          dataset: 'westbank',
          quarter,
          record_count: quarterData.length,
          last_updated: new Date().toISOString(),
        },
        data: quarterData,
      });
      console.log(`  ✓ Saved westbank/${quarter}.json (${quarterData.length} records)`);
    }
    
    // Save recent (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recent = normalized.filter(r => new Date(r.date) >= thirtyDaysAgo);
    
    if (recent.length > 0) {
      await writeJSON(path.join(westBankPath, 'recent.json'), {
        metadata: {
          source: 'tech4palestine',
          dataset: 'westbank',
          record_count: recent.length,
          last_updated: new Date().toISOString(),
        },
        data: recent,
      });
      console.log(`  ✓ Saved westbank/recent.json (${recent.length} records)`);
    }
    
    // Save index
    await writeJSON(path.join(westBankPath, 'index.json'), {
      dataset: 'westbank',
      date_range: {
        start: normalized[0]?.date || BASELINE_DATE,
        end: normalized[normalized.length - 1]?.date || new Date().toISOString().split('T')[0],
        baseline_date: BASELINE_DATE,
      },
      files: Object.keys(quarters).sort().map(q => ({
        file: `${q}.json`,
        quarter: q,
        records: quarters[q].length,
      })),
      last_updated: new Date().toISOString(),
    });
    console.log('  ✓ Saved westbank/index.json');
  }
  
  // Save killed in Gaza (partitioned)
  if (data.killedInGaza && Array.isArray(data.killedInGaza)) {
    const killedPath = path.join(basePath, 'killed-in-gaza');
    await ensureDir(killedPath);
    
    // Filter for post-Oct 7 data
    const filtered = data.killedInGaza.filter(record => {
      const date = record.date_of_death || record.date;
      return date && date >= BASELINE_DATE;
    });
    
    // Normalize data
    const normalized = filtered.map(record => ({
      date: record.date_of_death || record.date,
      name: record.name || record.en_name,
      age: record.age,
      sex: record.sex,
      source: 'tech4palestine',
    })).sort((a, b) => a.date.localeCompare(b.date));
    
    // Partition by quarter
    const quarters = partitionByQuarter(normalized);
    
    for (const [quarter, quarterData] of Object.entries(quarters)) {
      await writeJSON(path.join(killedPath, `${quarter}.json`), {
        metadata: {
          source: 'tech4palestine',
          dataset: 'killed-in-gaza',
          quarter,
          record_count: quarterData.length,
          last_updated: new Date().toISOString(),
        },
        data: quarterData,
      });
      console.log(`  ✓ Saved killed-in-gaza/${quarter}.json (${quarterData.length} records)`);
    }
    
    // Save index
    await writeJSON(path.join(killedPath, 'index.json'), {
      dataset: 'killed-in-gaza',
      date_range: {
        start: normalized[0]?.date || BASELINE_DATE,
        end: normalized[normalized.length - 1]?.date || new Date().toISOString().split('T')[0],
        baseline_date: BASELINE_DATE,
      },
      files: Object.keys(quarters).sort().map(q => ({
        file: `${q}.json`,
        quarter: q,
        records: quarters[q].length,
      })),
      last_updated: new Date().toISOString(),
    });
    console.log('  ✓ Saved killed-in-gaza/index.json');
  }
  
  // Save metadata
  await writeJSON(path.join(basePath, 'metadata.json'), {
    source: 'tech4palestine',
    last_updated: new Date().toISOString(),
    datasets: {
      summary: data.summary ? 'available' : 'unavailable',
      pressKilled: data.pressKilled ? data.pressKilled.length : 0,
      casualties: data.casualtiesDaily ? data.casualtiesDaily.length : 0,
      killedInGaza: data.killedInGaza ? data.killedInGaza.length : 0,
    },
  });
  console.log('  ✓ Saved metadata.json');
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Tech4Palestine Data Fetcher');
  console.log('='.repeat(60));
  console.log(`Baseline Date: ${BASELINE_DATE}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  
  try {
    // Fetch data from API
    const tech4palestineData = await fetchTech4Palestine();
    
    // Save data with partitioning
    await saveTech4PalestineData(tech4palestineData);
    
    console.log('\n✅ Tech4Palestine data collection complete!');
    console.log(`Data saved to: ${path.join(DATA_DIR, 'tech4palestine')}`);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { fetchTech4Palestine, saveTech4PalestineData };