#!/usr/bin/env node

/**
 * B'Tselem Checkpoint Data Fetcher
 * 
 * Fetches checkpoint and restriction data for Palestine:
 * - Checkpoint locations and status
 * - Road closures and restrictions
 * - Access barriers in West Bank
 * 
 * B'Tselem Website: https://www.btselem.org/
 * Data Sources:
 * - B'Tselem database (when available via API)
 * - HDX datasets related to checkpoints
 * - OCHA checkpoint dataset
 * 
 * Usage: node scripts/fetch-btselem-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const BASELINE_DATE = '2023-10-07';

// Fallback to HDX/OCHA checkpoint data
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

/**
 * Fetch checkpoint data from HDX (OCHA datasets)
 */
async function fetchCheckpointData() {
  console.log('\n📊 Fetching checkpoint and restriction data...');
  
  const datasets = [
    'opt-checkpoints',
    'occupied-palestinian-territory-checkpoints',
    'west-bank-closures-and-checkpoints',
  ];
  
  const results = {
    checkpoints: [],
    metadata: {},
    errors: [],
  };
  
  for (const datasetId of datasets) {
    try {
      console.log(`  Trying dataset: ${datasetId}...`);
      
      const packageResponse = await fetch(
        `${HDX_API_BASE}/package_show?id=${datasetId}`
      );
      
      if (!packageResponse.ok) {
        console.log(`  ⚠️ Dataset ${datasetId} not found, trying next...`);
        continue;
      }
      
      const packageData = await packageResponse.json();
      
      if (!packageData.success || !packageData.result) {
        continue;
      }
      
      const pkg = packageData.result;
      const resources = pkg.resources || [];
      
      // Find GeoJSON or CSV resources
      const dataResource = resources.find(r => 
        r.format?.toLowerCase() === 'geojson' ||
        r.format?.toLowerCase() === 'csv' ||
        r.format?.toLowerCase() === 'json'
      );
      
      if (!dataResource) {
        console.log(`  ⚠️ No suitable resource in ${datasetId}`);
        continue;
      }
      
      console.log(`  Downloading: ${dataResource.name || 'data'}...`);
      
      const dataResponse = await fetch(dataResource.url);
      if (!dataResponse.ok) {
        throw new Error(`Failed to download: HTTP ${dataResponse.status}`);
      }
      
      const contentType = dataResponse.headers.get('content-type');
      let data;
      
      if (contentType?.includes('json') || dataResource.format?.toLowerCase() === 'geojson') {
        data = await dataResponse.json();
      } else if (contentType?.includes('csv')) {
        const csvText = await dataResponse.text();
        data = { csv: csvText, format: 'csv' };
      } else {
        data = await dataResponse.text();
      }
      
      results.checkpoints.push({
        dataset_id: datasetId,
        dataset_name: pkg.title || datasetId,
        data: data,
        format: dataResource.format,
        source_url: dataResource.url,
        last_modified: dataResource.last_modified || pkg.metadata_modified,
      });
      
      results.metadata = {
        source: 'ocha/hdx',
        organization: pkg.organization?.title || 'OCHA',
        last_updated: new Date().toISOString(),
      };
      
      console.log(`  ✓ ${pkg.title}: Downloaded successfully`);
      break; // Found data, stop trying other datasets
      
    } catch (error) {
      console.error(`  ❌ Failed to fetch ${datasetId}:`, error.message);
      results.errors.push({
        dataset: datasetId,
        error: error.message,
      });
    }
  }
  
  return results;
}

/**
 * Generate static checkpoint data as fallback
 */
function generateStaticCheckpointData() {
  console.log('\n🏗️ Using static checkpoint reference data...');
  
  // Static data based on known major checkpoints as of Oct 2023
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: 'Qalandiya Checkpoint',
          type: 'checkpoint',
          location: 'Jerusalem-Ramallah',
          status: 'active',
          restrictions: 'permits_required',
          notes: 'Main checkpoint between Jerusalem and Ramallah',
        },
        geometry: {
          type: 'Point',
          coordinates: [35.2194, 31.8656]
        }
      },
      {
        type: 'Feature',
        properties: {
          name: 'Bethlehem Checkpoint (300)',
          type: 'checkpoint',
          location: 'Jerusalem-Bethlehem',
          status: 'active',
          restrictions: 'permits_required',
          notes: 'Main checkpoint for Bethlehem access',
        },
        geometry: {
          type: 'Point',
          coordinates: [35.2047, 31.7367]
        }
      },
      {
        type: 'Feature',
        properties: {
          name: 'Erez Crossing',
          type: 'crossing',
          location: 'Gaza-Israel',
          status: 'restricted',
          restrictions: 'severely_limited',
          notes: 'Primary crossing for Gaza Strip',
        },
        geometry: {
          type: 'Point',
          coordinates: [34.5158, 31.5731]
        }
      },
    ],
    metadata: {
      source: 'static_reference',
      note: 'Static reference data. Real-time updates require B\'Tselem API access.',
      last_updated: new Date().toISOString(),
      baseline_date: BASELINE_DATE,
    }
  };
}

/**
 * Save B'Tselem/checkpoint data
 */
async function saveBTselemData(results) {
  console.log('\n💾 Saving checkpoint data...');
  
  const basePath = path.join(DATA_DIR, 'btselem');
  await ensureDir(basePath);
  
  let checkpointData;
  
  if (results.checkpoints.length > 0) {
    // Use fetched data
    checkpointData = results.checkpoints[0].data;
    
    await writeJSON(path.join(basePath, 'checkpoints.json'), {
      metadata: {
        source: results.metadata.source || 'hdx',
        organization: results.metadata.organization || 'OCHA',
        last_updated: new Date().toISOString(),
        dataset_name: results.checkpoints[0].dataset_name,
        format: results.checkpoints[0].format,
      },
      data: checkpointData,
    });
    
    console.log(`  ✓ Saved checkpoints.json from ${results.metadata.source}`);
  } else {
    // Use static fallback data
    checkpointData = generateStaticCheckpointData();
    
    await writeJSON(path.join(basePath, 'checkpoints.json'), checkpointData);
    console.log('  ✓ Saved checkpoints.json (static reference data)');
  }
  
  // Save metadata
  await writeJSON(path.join(basePath, 'metadata.json'), {
    source: 'btselem',
    source_name: 'B\'Tselem',
    data_source: results.checkpoints.length > 0 ? 'hdx/ocha' : 'static_reference',
    last_updated: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    datasets: {
      checkpoints: Array.isArray(checkpointData) ? checkpointData.length :
                   checkpointData.features ? checkpointData.features.length : 0,
    },
    note: results.checkpoints.length === 0 ? 
      'Using static reference data. Real-time updates require B\'Tselem API access or updated HDX datasets.' :
      'Data fetched from HDX/OCHA',
  });
  
  console.log('  ✓ Saved metadata.json');
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 B\'Tselem Checkpoint Data Fetcher');
  console.log('='.repeat(60));
  console.log(`Baseline Date: ${BASELINE_DATE}`);
  console.log(`Data Directory: ${DATA_DIR}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));
  
  try {
    // Try to fetch from HDX/OCHA
    const results = await fetchCheckpointData();
    
    // Save data (either fetched or static)
    await saveBTselemData(results);
    
    console.log('\n✅ B\'Tselem checkpoint data collection complete!');
    console.log(`Data saved to: ${path.join(DATA_DIR, 'btselem')}`);
    
    if (results.errors.length > 0) {
      console.log(`\n⚠️ ${results.errors.length} error(s) occurred during fetch.`);
    }
    
    if (results.checkpoints.length === 0) {
      console.log('\n📝 Note: Using static reference data.');
      console.log('For real-time updates, ensure HDX checkpoint datasets are available.');
    }
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run
main();