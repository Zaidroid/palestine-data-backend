#!/usr/bin/env node

/**
 * Consolidated Data Fetcher
 * 
 * Orchestrates data fetching from all sources:
 * - HDX CKAN
 * - Tech4Palestine
 * - Good Shepherd Collective
 * - World Bank
 * 
 * Usage: HDX_API_KEY=your_key node scripts/fetch-all-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const BASELINE_DATE = '2023-10-07';

// Initialize logger
const logger = createLogger({
  context: 'FetchAllData',
  logLevel: 'INFO',
  enableConsole: true,
  enableFile: true,
});

// Track overall execution
const executionTracker = {
  scripts: [],
  errors: [],
  warnings: [],
  startTime: Date.now(),
  totalDatasets: 0,
  totalRecords: 0,
  storageSize: 0,
};

/**
 * Execute a fetch script with progress tracking and error handling
 */
async function executeScript(scriptName, scriptPath, description) {
  const scriptLogger = logger.child(scriptName);
  const scriptStartTime = Date.now();
  
  await scriptLogger.info(`Starting ${description}...`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📡 ${description}`);
  console.log(`${'='.repeat(60)}\n`);
  
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });
    
    const scriptResult = {
      name: scriptName,
      description,
      startTime: scriptStartTime,
      endTime: null,
      duration: null,
      success: false,
      error: null,
    };
    
    child.on('close', async (code) => {
      scriptResult.endTime = Date.now();
      scriptResult.duration = scriptResult.endTime - scriptResult.startTime;
      scriptResult.success = code === 0;
      
      if (code === 0) {
        await scriptLogger.success(`${description} completed in ${(scriptResult.duration / 1000).toFixed(2)}s`);
      } else {
        scriptResult.error = `Process exited with code ${code}`;
        await scriptLogger.error(`${description} failed with code ${code}`);
        executionTracker.errors.push({
          script: scriptName,
          error: scriptResult.error,
          timestamp: new Date().toISOString(),
        });
      }
      
      executionTracker.scripts.push(scriptResult);
      resolve(scriptResult);
    });
    
    child.on('error', async (error) => {
      scriptResult.endTime = Date.now();
      scriptResult.duration = scriptResult.endTime - scriptResult.startTime;
      scriptResult.success = false;
      scriptResult.error = error.message;
      
      await scriptLogger.error(`${description} failed`, error);
      executionTracker.errors.push({
        script: scriptName,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      
      executionTracker.scripts.push(scriptResult);
      resolve(scriptResult);
    });
  });
}

/**
 * Display progress indicator
 */
function displayProgress(current, total, scriptName) {
  const percentage = Math.round((current / total) * 100);
  const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
  
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Progress: [${progressBar}] ${percentage}% (${current}/${total})`);
  console.log(`Current: ${scriptName}`);
  console.log(`${'─'.repeat(60)}\n`);
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

// Fetch Tech4Palestine data
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

// Save Tech4Palestine data
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
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get directory size recursively
 */
async function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return totalSize;
}

/**
 * Count records in a data source
 */
async function countRecords(sourcePath) {
  let totalRecords = 0;
  
  try {
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(sourcePath, entry.name);
      
      if (entry.isDirectory()) {
        totalRecords += await countRecords(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = await readJSON(fullPath);
          if (data && data.data && Array.isArray(data.data)) {
            totalRecords += data.data.length;
          } else if (Array.isArray(data)) {
            totalRecords += data.length;
          }
        } catch (error) {
          // Skip files that can't be parsed
        }
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  
  return totalRecords;
}

/**
 * Calculate statistics from collected data
 */
async function calculateStatistics() {
  await logger.info('Calculating statistics...');
  
  const sources = ['hdx', 'tech4palestine', 'goodshepherd', 'worldbank', 'who', 'pcbs', 'unrwa'];
  let totalDatasets = 0;
  let totalRecords = 0;
  let totalSize = 0;
  
  for (const source of sources) {
    const sourcePath = path.join(DATA_DIR, source);
    
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        // Count datasets (subdirectories and JSON files)
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        const datasets = entries.filter(e => e.isDirectory() || e.name.endsWith('.json')).length;
        totalDatasets += datasets;
        
        // Count records
        const records = await countRecords(sourcePath);
        totalRecords += records;
        
        // Calculate size
        const size = await getDirectorySize(sourcePath);
        totalSize += size;
        
        await logger.info(`${source}: ${datasets} datasets, ${records.toLocaleString()} records, ${formatBytes(size)}`);
      }
    } catch (error) {
      // Directory doesn't exist
    }
  }
  
  executionTracker.totalDatasets = totalDatasets;
  executionTracker.totalRecords = totalRecords;
  executionTracker.storageSize = totalSize;
  
  await logger.info(`Total: ${totalDatasets} datasets, ${totalRecords.toLocaleString()} records, ${formatBytes(totalSize)}`);
}

/**
 * Generate comprehensive summary report
 */
async function generateSummaryReport() {
  await logger.info('Generating summary report...');
  
  const totalDuration = Date.now() - executionTracker.startTime;
  const successfulScripts = executionTracker.scripts.filter(s => s.success).length;
  const failedScripts = executionTracker.scripts.filter(s => !s.success).length;
  
  // Read validation report if it exists
  let validationResults = null;
  try {
    const validationPath = path.join(DATA_DIR, 'validation-report.json');
    validationResults = await readJSON(validationPath);
  } catch (error) {
    // Validation report doesn't exist
  }
  
  const summaryReport = {
    generated_at: new Date().toISOString(),
    execution: {
      start_time: new Date(executionTracker.startTime).toISOString(),
      end_time: new Date().toISOString(),
      duration_seconds: (totalDuration / 1000).toFixed(2),
      duration_formatted: `${Math.floor(totalDuration / 60000)}m ${Math.floor((totalDuration % 60000) / 1000)}s`,
    },
    scripts: {
      total: executionTracker.scripts.length,
      successful: successfulScripts,
      failed: failedScripts,
      success_rate: `${((successfulScripts / executionTracker.scripts.length) * 100).toFixed(1)}%`,
      details: executionTracker.scripts.map(script => ({
        name: script.name,
        description: script.description,
        success: script.success,
        duration_seconds: (script.duration / 1000).toFixed(2),
        error: script.error,
      })),
    },
    data_collection: {
      total_datasets: executionTracker.totalDatasets,
      total_records: executionTracker.totalRecords,
      storage_size_bytes: executionTracker.storageSize,
      storage_size_formatted: formatBytes(executionTracker.storageSize),
    },
    errors: {
      count: executionTracker.errors.length,
      details: executionTracker.errors,
    },
    warnings: {
      count: executionTracker.warnings.length,
      details: executionTracker.warnings,
    },
    validation: validationResults ? {
      total_datasets_validated: validationResults.summary?.total_datasets || 0,
      passed: validationResults.summary?.passed || 0,
      failed: validationResults.summary?.failed || 0,
      warnings: validationResults.summary?.warnings || 0,
      average_quality_score: validationResults.summary?.average_quality_score || 0,
    } : null,
    sources: {},
  };
  
  // Add per-source statistics
  const sources = ['hdx', 'tech4palestine', 'goodshepherd', 'worldbank', 'who', 'pcbs', 'unrwa'];
  
  for (const source of sources) {
    const sourcePath = path.join(DATA_DIR, source);
    
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        const metadataPath = path.join(sourcePath, 'metadata.json');
        const metadata = await readJSON(metadataPath);
        
        const catalogPath = path.join(sourcePath, 'catalog.json');
        const catalog = await readJSON(catalogPath);
        
        const entries = await fs.readdir(sourcePath, { withFileTypes: true });
        const datasets = entries.filter(e => e.isDirectory() || e.name.endsWith('.json')).length;
        const records = await countRecords(sourcePath);
        const size = await getDirectorySize(sourcePath);
        
        summaryReport.sources[source] = {
          datasets: datasets,
          records: records,
          storage_size: formatBytes(size),
          metadata: metadata || null,
          catalog_entries: catalog ? (Array.isArray(catalog) ? catalog.length : Object.keys(catalog).length) : 0,
        };
      }
    } catch (error) {
      summaryReport.sources[source] = {
        status: 'not_available',
        error: error.message,
      };
    }
  }
  
  // Save summary report
  const summaryPath = path.join(DATA_DIR, 'data-collection-summary.json');
  await writeJSON(summaryPath, summaryReport);
  
  await logger.success('Summary report generated');
  
  return summaryReport;
}

// Update global manifest
async function updateManifest() {
  console.log('\n📋 Updating global manifest...');
  
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  const manifest = {
    generated_at: new Date().toISOString(),
    version: '2.0.0',
    baseline_date: BASELINE_DATE,
    datasets: {},
  };
  
  // Scan all data directories
  const sources = ['hdx', 'tech4palestine', 'goodshepherd', 'worldbank', 'who', 'pcbs', 'unrwa', 'btselem'];
  
  for (const source of sources) {
    const sourcePath = path.join(DATA_DIR, source);
    
    try {
      const stats = await fs.stat(sourcePath);
      if (stats.isDirectory()) {
        manifest.datasets[source] = {
          path: `/data/${source}`,
          last_updated: new Date().toISOString(),
        };
        
        // Try to read metadata
        const metadataPath = path.join(sourcePath, 'metadata.json');
        const metadata = await readJSON(metadataPath);
        if (metadata) {
          manifest.datasets[source].metadata = metadata;
        }
      }
    } catch (error) {
      // Directory doesn't exist yet
    }
  }
  
  await writeJSON(manifestPath, manifest);
  console.log('  ✓ Manifest updated');
}

// Main execution
async function main() {
  console.log('\n🚀 Palestine Pulse - Consolidated Data Fetcher');
  console.log('='.repeat(60));
  console.log(`Baseline Date: ${BASELINE_DATE}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  
  await logger.info('Starting consolidated data collection');
  
  try {
    // Define all fetch scripts to run
    const fetchScripts = [
      {
        name: 'HDX-CKAN',
        path: path.join(__dirname, 'fetch-hdx-ckan-data.js'),
        description: 'HDX CKAN Data Collection',
        required: false,
      },
      {
        name: 'GoodShepherd',
        path: path.join(__dirname, 'fetch-goodshepherd-data.js'),
        description: 'Good Shepherd Data Collection',
        required: false,
      },
      {
        name: 'WorldBank',
        path: path.join(__dirname, 'fetch-worldbank-data.js'),
        description: 'World Bank Data Collection',
        required: false,
      },
      {
        name: 'WHO',
        path: path.join(__dirname, 'fetch-who-data.js'),
        description: 'WHO Health Data Collection',
        required: false,
      },
      {
        name: 'PCBS',
        path: path.join(__dirname, 'fetch-pcbs-data.js'),
        description: 'PCBS Official Statistics Collection',
        required: false,
      },
      {
        name: 'UNRWA',
        path: path.join(__dirname, 'fetch-unrwa-data.js'),
        description: 'UNRWA Refugee Data Collection',
        required: false,
      },
    ];
    
    const totalScripts = fetchScripts.length + 2; // +2 for Tech4Palestine and manifest (PCBS, WHO, UNRWA now in fetchScripts)
    let currentScript = 0;
    
    // Execute each fetch script
    for (const script of fetchScripts) {
      currentScript++;
      displayProgress(currentScript, totalScripts, script.description);
      
      // Check if script file exists
      try {
        await fs.access(script.path);
      } catch (error) {
        await logger.warn(`Script not found: ${script.path}, skipping...`);
        executionTracker.warnings.push({
          script: script.name,
          warning: 'Script file not found',
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      
      await executeScript(script.name, script.path, script.description);
    }
    
    // Fetch Tech4Palestine data (inline)
    currentScript++;
    displayProgress(currentScript, totalScripts, 'Tech4Palestine Data Collection');
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📡 Tech4Palestine Data Collection`);
    console.log(`${'='.repeat(60)}\n`);
    
    const tech4StartTime = Date.now();
    try {
      const tech4palestineData = await fetchTech4Palestine();
      await saveTech4PalestineData(tech4palestineData);
      
      const tech4Duration = Date.now() - tech4StartTime;
      await logger.success(`Tech4Palestine data collection completed in ${(tech4Duration / 1000).toFixed(2)}s`);
      
      executionTracker.scripts.push({
        name: 'Tech4Palestine',
        description: 'Tech4Palestine Data Collection',
        startTime: tech4StartTime,
        endTime: Date.now(),
        duration: tech4Duration,
        success: true,
        error: null,
      });
    } catch (error) {
      const tech4Duration = Date.now() - tech4StartTime;
      await logger.error('Tech4Palestine data collection failed', error);
      
      executionTracker.errors.push({
        script: 'Tech4Palestine',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      
      executionTracker.scripts.push({
        name: 'Tech4Palestine',
        description: 'Tech4Palestine Data Collection',
        startTime: tech4StartTime,
        endTime: Date.now(),
        duration: tech4Duration,
        success: false,
        error: error.message,
      });
    }
    
    // Update global manifest
    currentScript++;
    displayProgress(currentScript, totalScripts, 'Manifest Generation');
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Generating Global Manifest`);
    console.log(`${'='.repeat(60)}\n`);
    
    const manifestStartTime = Date.now();
    try {
      await updateManifest();
      const manifestDuration = Date.now() - manifestStartTime;
      await logger.success(`Manifest generation completed in ${(manifestDuration / 1000).toFixed(2)}s`);
      
      executionTracker.scripts.push({
        name: 'Manifest',
        description: 'Manifest Generation',
        startTime: manifestStartTime,
        endTime: Date.now(),
        duration: manifestDuration,
        success: true,
        error: null,
      });
    } catch (error) {
      const manifestDuration = Date.now() - manifestStartTime;
      await logger.error('Manifest generation failed', error);
      
      executionTracker.errors.push({
        script: 'Manifest',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      
      executionTracker.scripts.push({
        name: 'Manifest',
        description: 'Manifest Generation',
        startTime: manifestStartTime,
        endTime: Date.now(),
        duration: manifestDuration,
        success: false,
        error: error.message,
      });
    }
    
    // Calculate final statistics
    await calculateStatistics();
    
    // Generate summary report
    await generateSummaryReport();
    
    // Display completion message
    const totalDuration = Date.now() - executionTracker.startTime;
    const successfulScripts = executionTracker.scripts.filter(s => s.success).length;
    const failedScripts = executionTracker.scripts.filter(s => !s.success).length;
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Data Collection Complete!');
    console.log('='.repeat(60));
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Successful Scripts: ${successfulScripts}/${executionTracker.scripts.length}`);
    console.log(`Failed Scripts: ${failedScripts}`);
    console.log(`Warnings: ${executionTracker.warnings.length}`);
    console.log(`Total Datasets: ${executionTracker.totalDatasets}`);
    console.log(`Total Records: ${executionTracker.totalRecords.toLocaleString()}`);
    console.log(`Storage Size: ${formatBytes(executionTracker.storageSize)}`);
    console.log('='.repeat(60));
    
    if (failedScripts > 0) {
      console.log('\n⚠️  Some scripts failed. Check data-collection-summary.json for details.');
    }
    
    console.log('\n📄 Summary report saved to: public/data/data-collection-summary.json');
    console.log('📋 Global manifest updated: public/data/manifest.json');
    console.log('📝 Detailed logs: data-collection.log');
    
    await logger.logSummary();
    
    // Exit with error code if any critical failures
    if (failedScripts > 0) {
      process.exit(1);
    }
    
  } catch (error) {
    await logger.error('Fatal error in data collection', error);
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run
main();
