#!/usr/bin/env node

/**
 * Data Sources Verification Script
 * Checks all data sources and reports their status
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');

async function checkDataSource(sourceName, metadataPath) {
  try {
    const exists = await fs.access(metadataPath).then(() => true).catch(() => false);
    
    if (!exists) {
      return {
        source: sourceName,
        status: '❌ NOT FOUND',
        records: 0,
        datasets: 0,
      };
    }
    
    const content = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(content);
    
    // Handle different metadata structures
    let records = 0;
    let datasets = 0;
    let lastUpdated = metadata.last_updated;
    
    if (metadata.summary) {
      // HDX and WHO format
      records = metadata.summary.total_records || metadata.summary.totalRecords || 0;
      datasets = metadata.summary.total_datasets || metadata.summary.totalDatasets || 
                 metadata.summary.total_resources || 0;
    } else if (metadata.metadata) {
      // World Bank format
      records = metadata.metadata.total_data_points || 0;
      datasets = metadata.metadata.indicators || 0;
      lastUpdated = metadata.metadata.last_updated;
    }
    
    return {
      source: sourceName,
      status: '✅ WORKING',
      records: records,
      datasets: datasets,
      lastUpdated: lastUpdated,
    };
  } catch (error) {
    return {
      source: sourceName,
      status: '⚠️ ERROR',
      error: error.message,
    };
  }
}

async function main() {
  console.log('========================================');
  console.log('Data Sources Verification');
  console.log('========================================\n');
  
  const sources = [
    { name: 'HDX CKAN', path: path.join(DATA_DIR, 'hdx/metadata.json') },
    { name: 'World Bank', path: path.join(DATA_DIR, 'worldbank/metadata.json') },
    { name: 'WHO', path: path.join(DATA_DIR, 'who/metadata.json') },
  ];
  
  const results = [];
  
  for (const source of sources) {
    const result = await checkDataSource(source.name, source.path);
    results.push(result);
  }
  
  // Print results
  results.forEach(result => {
    console.log(`${result.source}:`);
    console.log(`  Status: ${result.status}`);
    if (result.records) {
      console.log(`  Records: ${result.records.toLocaleString()}`);
      console.log(`  Datasets: ${result.datasets}`);
      console.log(`  Last Updated: ${new Date(result.lastUpdated).toLocaleString()}`);
    }
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log();
  });
  
  // Summary
  const working = results.filter(r => r.status === '✅ WORKING');
  const totalRecords = results.reduce((sum, r) => sum + (r.records || 0), 0);
  const totalDatasets = results.reduce((sum, r) => sum + (r.datasets || 0), 0);
  
  console.log('========================================');
  console.log('Summary');
  console.log('========================================');
  console.log(`Working Sources: ${working.length}/${results.length}`);
  console.log(`Total Records: ${totalRecords.toLocaleString()}`);
  console.log(`Total Datasets: ${totalDatasets}`);
  console.log('========================================');
  
  if (working.length === results.length) {
    console.log('\n✅ All data sources are operational!\n');
  } else {
    console.log('\n⚠️ Some data sources need attention\n');
  }
}

main().catch(console.error);
