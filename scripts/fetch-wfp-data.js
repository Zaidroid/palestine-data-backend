#!/usr/bin/env node

/**
 * WFP (World Food Programme) Data Fetcher
 * 
 * Fetches food security and market data from WFP API:
 * - Market food prices
 * - Food security indicators
 * - Humanitarian response data
 * 
 * WFP API Documentation: https://docs.api.wfp.org/
 * Data Portal: https://data.humdata.org/organization/wfp
 * 
 * Usage: node scripts/fetch-wfp-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const BASELINE_DATE = '2023-10-07';

// WFP uses HDX for data distribution
const HDX_API_BASE = 'https://data.humdata.org/api/3/action';

// Helper functions
async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

function getQuarter(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
}

/**
 * Fetch WFP datasets from HDX
 */
async function fetchWFPDatasets() {
  console.log('\n📊 Fetching WFP food security data...');
  
  const wfpDatasets = [
    {
      id: 'wfp-food-prices-for-palestine',
      name: 'WFP Food Prices - Palestine',
      category: 'food_security',
    },
    {
      id: 'world-food-programme-food-security',
      name: 'WFP Food Security Monitoring',
      category: 'food_security',
    }
  ];
  
  const results = {
    datasets: [],
    errors: [],
  };
  
  for (const dataset of wfpDatasets) {
    try {
      console.log(`  Fetching: ${dataset.name}...`);
      
      // Get package metadata
      const packageResponse = await fetch(
        `${HDX_API_BASE}/package_show?id=${dataset.id}`
      );
      
      if (!packageResponse.ok) {
        throw new Error(`HTTP ${packageResponse.status} - Dataset may not exist`);
      }
      
      const packageData = await packageResponse.json();
      
      if (!packageData.success || !packageData.result) {
        throw new Error('Invalid API response');
      }
      
      const pkg = packageData.result;
      
      // Find CSV or JSON resources
      const resources = pkg.resources || [];
      const dataResource = resources.find(r => 
        r.format?.toLowerCase() === 'csv' || 
        r.format?.toLowerCase() === 'json'
      );
      
      if (!dataResource) {
        console.log(`  ⚠️ No suitable data resource found for ${dataset.name}`);
        continue;
      }
      
      console.log(`  Downloading: ${dataResource.name || 'data file'}...`);
      
      // Download resource
      const dataResponse = await fetch(dataResource.url);
      if (!dataResponse.ok) {
        throw new Error(`Failed to download: HTTP ${dataResponse.status}`);
      }
      
      const contentType = dataResponse.headers.get('content-type');
      let data;
      
      if (contentType?.includes('json')) {
        data = await dataResponse.json();
      } else if (contentType?.includes('csv') || dataResource.format?.toLowerCase() === 'csv') {
        const csvText = await dataResponse.text();
        data = { csv: csvText, format: 'csv' };
      } else {
        data = await dataResponse.text();
      }
      
      results.datasets.push({
        id: dataset.id,
        name: dataset.name,
        category: dataset.category,
        data: data,
        metadata: {
          source: 'wfp',
          fetched_at: new Date().toISOString(),
          resource_url: dataResource.url,
          format: dataResource.format,
          last_modified: dataResource.last_modified || pkg.metadata_modified,
        }
      });
      
      console.log(`  ✓ ${dataset.name}: Downloaded successfully`);
      
    } catch (error) {
      console.error(`  ❌ Failed to fetch ${dataset.name}:`, error.message);
      results.errors.push({
        dataset: dataset.name,
        error: error.message,
      });
    }
  }
  
  return results;
}

/**
 * Parse CSV data into JSON
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const records = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    const record = {};
    
    headers.forEach((header, index) => {
      record[header] = values[index] || null;
    });
    
    records.push(record);
  }
  
  return records;
}

/**
 * Save WFP data
 */
async function saveWFPData(results) {
  console.log('\n💾 Saving WFP data...');
  
  const basePath = path.join(DATA_DIR, 'wfp');
  await ensureDir(basePath);
  
  let totalRecords = 0;
  const savedDatasets = [];
  
  for (const dataset of results.datasets) {
    try {
      const datasetPath = path.join(basePath, dataset.category);
      await ensureDir(datasetPath);
      
      // Convert CSV to JSON if needed
      let processedData = dataset.data;
      if (dataset.data.csv) {
        processedData = parseCSV(dataset.data.csv);
      } else if (Array.isArray(dataset.data)) {
        processedData = dataset.data;
      } else if (dataset.data.data && Array.isArray(dataset.data.data)) {
        processedData = dataset.data.data;
      }
      
      // Filter for post-baseline data if date field exists
      let filteredData = processedData;
      if (Array.isArray(processedData) && processedData.length > 0) {
        const firstRecord = processedData[0];
        const dateField = Object.keys(firstRecord).find(key => 
          key.toLowerCase().includes('date') || 
          key.toLowerCase().includes('time') ||
          key.toLowerCase().includes('year')
        );
        
        if (dateField) {
          filteredData = processedData.filter(record => {
            const dateValue = record[dateField];
            if (!dateValue) return false;
            try {
              const recordDate = new Date(dateValue);
              const baselineDate = new Date(BASELINE_DATE);
              return recordDate >= baselineDate;
            } catch {
              return true; // Keep if can't parse date
            }
          });
        }
      }
      
      // Save dataset
      const datasetFile = path.join(datasetPath, `${dataset.id}.json`);
      await writeJSON(datasetFile, {
        metadata: {
          ...dataset.metadata,
          record_count: Array.isArray(filteredData) ? filteredData.length : 0,
          dataset_id: dataset.id,
          category: dataset.category,
        },
        data: filteredData,
      });
      
      const recordCount = Array.isArray(filteredData) ? filteredData.length : 0;
      totalRecords += recordCount;
      
      savedDatasets.push({
        id: dataset.id,
        name: dataset.name,
        category: dataset.category,
        records: recordCount,
      });
      
      console.log(`  ✓ Saved ${dataset.id}: ${recordCount} records`);
      
    } catch (error) {
      console.error(`  ❌ Failed to save ${dataset.id}:`, error.message);
    }
  }
  
  // Save metadata
  await writeJSON(path.join(basePath, 'metadata.json'), {
    source: 'wfp',
    source_name: 'World Food Programme',
    last_updated: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    total_datasets: savedDatasets.length,
    total_records: totalRecords,
    datasets: savedDatasets,
    errors: results.errors.length > 0 ? results.errors : undefined,
  });
  
  console.log('\n📋 WFP Summary:');
  console.log(`  Datasets: ${savedDatasets.length}`);
  console.log(`  Total Records: ${totalRecords}`);
  console.log(`  Errors: ${results.errors.length}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 WFP Data Fetcher');
  console.log('='.repeat(60));
  console.log(`Baseline Date: ${BASELINE_DATE}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  
  try {
    // Fetch WFP datasets
    const results = await fetchWFPDatasets();
    
    if (results.datasets.length === 0) {
      console.warn('\n⚠️ No WFP datasets found. This may be because:');
      console.warn('  1. Dataset IDs have changed on HDX');
      console.warn('  2. WFP has reorganized their data');
      console.warn('  3. Network connectivity issues');
      console.warn('\nPlease check https://data.humdata.org/organization/wfp for current datasets.');
      process.exit(0);
    }
    
    // Save data
    await saveWFPData(results);
    
    console.log('\n✅ WFP data collection complete!');
    console.log(`Data saved to: ${path.join(DATA_DIR, 'wfp')}`);
    
    if (results.errors.length > 0) {
      console.log('\n⚠️ Some datasets failed. Check metadata.json for details.');
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run
main();