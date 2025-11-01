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

const DATA_DIR = path.join(__dirname, '../data');
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
    // Define all fetch scripts to run (9 data sources)
    const fetchScripts = [
      {
        name: 'Tech4Palestine',
        path: path.join(__dirname, 'fetch-tech4palestine-data.js'),
        description: 'Tech4Palestine Data Collection',
        required: false,
      },
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
      {
        name: 'WFP',
        path: path.join(__dirname, 'fetch-wfp-data.js'),
        description: 'WFP Food Security Data Collection',
        required: false,
      },
      {
        name: 'BTselem',
        path: path.join(__dirname, 'fetch-btselem-data.js'),
        description: 'B\'Tselem Checkpoint Data Collection',
        required: false,
      },
    ];
    
    const totalScripts = fetchScripts.length + 1; // +1 for manifest generation
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
    
    console.log('\n📄 Summary report saved to: data/data-collection-summary.json');
    console.log('📋 Global manifest updated: data/manifest.json');
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
