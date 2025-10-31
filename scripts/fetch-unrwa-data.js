#!/usr/bin/env node

/**
 * UNRWA Data Fetcher
 * 
 * Fetches UNRWA (United Nations Relief and Works Agency) data for Palestine refugees
 * Sources:
 * 1. HDX datasets published by UNRWA
 * 2. UNRWA website data (fallback)
 * 
 * Data includes:
 * - Registered refugee statistics by field (Gaza, West Bank, Jordan, Lebanon, Syria)
 * - Education facilities, schools, students, and teachers
 * - Health centers, patients, and services
 * - Emergency response data (food assistance, cash assistance, shelter)
 * 
 * Usage: node scripts/fetch-unrwa-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry, createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import { createLogger } from './utils/logger.js';
import { validateDataset } from './utils/data-validator.js';
import { UNRWATransformer } from './utils/unrwa-transformer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({ 
  context: 'UNRWA-Fetcher',
  logLevel: 'INFO',
});

// Configuration
const HDX_CKAN_BASE = 'https://data.humdata.org/api/3/action';
const DATA_DIR = path.join(__dirname, '../public/data/unrwa');
const RATE_LIMIT_DELAY = 1100; // 1.1 seconds

// UNRWA-specific datasets to fetch from HDX
const UNRWA_DATASETS = {
  refugees: [
    { search: 'UNRWA registered refugees', name: 'Registered Refugees', priority: 1 },
    { search: 'Palestine refugees statistics', name: 'Refugee Statistics', priority: 2 },
    { search: 'UNRWA refugee camps', name: 'Refugee Camps', priority: 3 },
    { search: 'UNRWA displacement', name: 'Displacement Data', priority: 4 },
  ],
  education: [
    { search: 'UNRWA schools', name: 'Schools', priority: 1 },
    { search: 'UNRWA education facilities', name: 'Education Facilities', priority: 2 },
    { search: 'UNRWA students enrollment', name: 'Student Enrollment', priority: 3 },
    { search: 'UNRWA teachers', name: 'Teachers', priority: 4 },
  ],
  health: [
    { search: 'UNRWA health centers', name: 'Health Centers', priority: 1 },
    { search: 'UNRWA health services', name: 'Health Services', priority: 2 },
    { search: 'UNRWA patients', name: 'Patient Data', priority: 3 },
    { search: 'UNRWA medical services', name: 'Medical Services', priority: 4 },
  ],
  emergency: [
    { search: 'UNRWA emergency response', name: 'Emergency Response', priority: 1 },
    { search: 'UNRWA food assistance', name: 'Food Assistance', priority: 2 },
    { search: 'UNRWA cash assistance', name: 'Cash Assistance', priority: 3 },
    { search: 'UNRWA shelter assistance', name: 'Shelter Assistance', priority: 4 },
    { search: 'UNRWA humanitarian aid', name: 'Humanitarian Aid', priority: 5 },
  ],
};

// Create rate-limited fetcher
const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

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
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    await logger.debug(`Wrote file: ${filePath}`);
  } catch (error) {
    await logger.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
}

// Helper: Sanitize filename
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

// Helper: Normalize date to ISO 8601 YYYY-MM-DD
function normalizeDate(dateValue) {
  if (!dateValue) return null;
  
  try {
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Search for UNRWA datasets on HDX
 */
async function searchUNRWADatasets() {
  console.log('Searching for UNRWA datasets on HDX...');
  
  try {
    // Try searching by organization first
    let searchUrl = `${HDX_CKAN_BASE}/package_search?fq=organization:unrwa&rows=100`;
    let response = await fetchJSONWithRetry(searchUrl);
    
    if (!response.success) {
      throw new Error('HDX API returned unsuccessful response');
    }
    
    let datasets = response.result?.results || [];
    
    // If no results, search by keyword "UNRWA"
    if (datasets.length === 0) {
      console.log('  No datasets found by organization, searching by keyword...');
      searchUrl = `${HDX_CKAN_BASE}/package_search?q=UNRWA AND groups:pse&rows=100`;
      response = await fetchJSONWithRetry(searchUrl);
      
      if (response.success) {
        datasets = response.result?.results || [];
      }
    }
    
    // If still no results, try broader search
    if (datasets.length === 0) {
      console.log('  Trying broader search for refugee and Palestine data...');
      searchUrl = `${HDX_CKAN_BASE}/package_search?q=(refugee OR displacement) AND groups:pse&rows=100`;
      response = await fetchJSONWithRetry(searchUrl);
      
      if (response.success) {
        const allDatasets = response.result?.results || [];
        // Filter for UNRWA-related datasets
        datasets = allDatasets.filter(ds => {
          const text = `${ds.title} ${ds.notes || ''} ${ds.organization?.title || ''}`.toLowerCase();
          return text.includes('unrwa') || text.includes('united nations relief');
        });
      }
    }
    
    console.log(`✓ Found ${datasets.length} UNRWA-related datasets on HDX\n`);
    
    return datasets;
  } catch (error) {
    console.error('✗ Failed to search UNRWA datasets:', error.message);
    throw error;
  }
}

/**
 * Get full dataset details
 */
async function getDatasetDetails(datasetId) {
  try {
    const url = `${HDX_CKAN_BASE}/package_show?id=${datasetId}`;
    const response = await fetchJSONWithRetry(url);
    
    if (!response.success) {
      throw new Error('Failed to get dataset details');
    }
    
    return response.result;
  } catch (error) {
    console.log(`      ✗ Failed to get details for dataset ${datasetId}:`, error.message);
    return null;
  }
}

/**
 * Download and parse a resource
 */
async function downloadResource(resource) {
  try {
    console.log(`      Downloading: ${resource.name} (${resource.format})`);
    
    const response = await fetch(resource.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const format = resource.format?.toLowerCase();
    let data;
    
    if (format === 'json' || format === 'geojson') {
      data = await response.json();
    } else if (format === 'csv') {
      const text = await response.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      data = parsed.data || [];
    } else {
      console.log(`      ⚠️  Unsupported format: ${format}`);
      return null;
    }
    
    const recordCount = Array.isArray(data) ? data.length : 1;
    console.log(`      ✓ Downloaded ${recordCount} records`);
    
    return { format, data };
  } catch (error) {
    console.log(`      ✗ Failed to download resource ${resource.name}:`, error.message);
    return null;
  }
}

/**
 * Extract metadata from dataset
 */
function extractMetadata(dataset, category) {
  return {
    id: dataset.id,
    name: dataset.name,
    title: dataset.title,
    description: dataset.notes || '',
    category,
    organization: {
      name: dataset.organization?.name || 'unrwa',
      title: dataset.organization?.title || 'UNRWA',
    },
    tags: dataset.tags?.map(t => t.name) || [],
    license: dataset.license_title || dataset.license_id || 'Unknown',
    dataset_date: dataset.dataset_date || null,
    last_modified: dataset.metadata_modified || new Date().toISOString(),
    data_update_frequency: dataset.data_update_frequency || 'unknown',
    num_resources: dataset.num_resources || 0,
    resources: dataset.resources?.map(r => ({
      id: r.id,
      name: r.name,
      format: r.format,
      size: r.size,
      last_modified: r.last_modified,
      url: r.url,
    })) || [],
    source_url: `https://data.humdata.org/dataset/${dataset.name}`,
    extracted_at: new Date().toISOString(),
  };
}

/**
 * Find best matching dataset for a search query
 */
function findBestMatch(datasets, searchQuery) {
  const query = searchQuery.toLowerCase();
  const keywords = query.split(' ');
  
  let bestMatch = null;
  let bestScore = 0;
  
  for (const dataset of datasets) {
    const searchText = `${dataset.title} ${dataset.notes || ''}`.toLowerCase();
    let score = 0;
    
    // Count keyword matches
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        score++;
      }
    }
    
    // Bonus for exact title match
    if (dataset.title.toLowerCase().includes(query)) {
      score += 5;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = dataset;
    }
  }
  
  return bestMatch;
}

/**
 * Fetch datasets by category
 */
async function fetchCategoryDatasets(category, datasetConfigs, allDatasets) {
  console.log(`\nProcessing ${category} datasets...`);
  
  const categoryDir = path.join(DATA_DIR, category);
  await ensureDir(categoryDir);
  
  let downloaded = 0;
  let failed = 0;
  const downloadedDatasets = [];
  
  for (const config of datasetConfigs) {
    console.log(`  [${config.priority}] Searching: ${config.name}`);
    
    try {
      // Find best matching dataset
      const dataset = findBestMatch(allDatasets, config.search);
      
      if (!dataset) {
        console.log(`    ⚠️  No match found for: ${config.search}`);
        failed++;
        continue;
      }
      
      console.log(`    ✓ Found: ${dataset.title}`);
      
      // Get full dataset details
      const fullDataset = await getDatasetDetails(dataset.id);
      if (!fullDataset) {
        console.log(`    ✗ Failed to get details for ${dataset.id}`);
        failed++;
        continue;
      }
      
      // Extract metadata
      const metadata = extractMetadata(fullDataset, category);
      
      // Find downloadable resources
      const dataResources = fullDataset.resources?.filter(r => {
        const format = r.format?.toLowerCase() || '';
        const name = r.name?.toLowerCase() || '';
        // Allow CSV, JSON, GeoJSON, and small files
        const isValidFormat = format === 'csv' || format === 'json' || format === 'geojson';
        // Skip very large files (> 50MB)
        const isReasonableSize = !r.size || (r.size / (1024 * 1024)) <= 50;
        return isValidFormat && isReasonableSize;
      }) || [];
      
      if (dataResources.length === 0) {
        console.log(`    ⚠️  No downloadable resources for ${fullDataset.name}`);
        failed++;
        continue;
      }
      
      // Try downloading resources until one succeeds
      let downloadedData = null;
      for (const resource of dataResources) {
        downloadedData = await downloadResource(resource);
        if (downloadedData) {
          break; // Success, stop trying
        }
      }
      
      if (!downloadedData) {
        console.log(`    ✗ All resources failed to download for ${fullDataset.name}`);
        failed++;
        continue;
      }
      
      // Create dataset directory
      const datasetDir = path.join(categoryDir, sanitizeFilename(fullDataset.name));
      await ensureDir(datasetDir);
      
      // Save metadata
      await writeJSON(path.join(datasetDir, 'metadata.json'), metadata);
      
      // Save raw data
      await writeJSON(path.join(datasetDir, 'raw-data.json'), {
        source: 'unrwa-hdx',
        downloaded_at: new Date().toISOString(),
        resource: {
          id: resource.id,
          name: resource.name,
          format: resource.format,
          url: resource.url,
        },
        data: downloadedData.data,
      });
      
      // Transform data using UNRWA transformer
      const transformer = new UNRWATransformer();
      let transformedData = [];
      try {
        transformedData = transformer.transform(downloadedData.data, metadata);
        console.log(`      ✓ Transformed ${transformedData.length} records`);
        
        // Save transformed data
        await writeJSON(path.join(datasetDir, 'transformed.json'), {
          source: 'unrwa-hdx',
          category,
          transformed_at: new Date().toISOString(),
          record_count: transformedData.length,
          data: transformedData,
        });
      } catch (transformError) {
        console.log(`      ⚠️  Transformation failed: ${transformError.message}`);
      }
      
      downloaded++;
      downloadedDatasets.push({
        id: fullDataset.id,
        name: fullDataset.name,
        title: fullDataset.title,
        recordCount: Array.isArray(downloadedData.data) ? downloadedData.data.length : 0,
        transformedCount: transformedData.length,
        metadata,
      });
      
      console.log(`    ✓ Downloaded to ${category}/${sanitizeFilename(fullDataset.name)}/`);
      
    } catch (error) {
      console.log(`    ✗ Error processing ${config.name}:`, error.message);
      failed++;
    }
  }
  
  console.log(`  Summary: ${downloaded} downloaded, ${failed} failed`);
  
  return { downloaded, failed, datasets: downloadedDatasets };
}

/**
 * Main fetch function
 */
async function fetchUNRWAData() {
  console.log('========================================');
  console.log('UNRWA Data Fetcher');
  console.log('========================================');
  console.log('Source: HDX (Humanitarian Data Exchange)');
  console.log('Organization: UNRWA');
  console.log('========================================\n');
  
  await ensureDir(DATA_DIR);
  
  // Search for all UNRWA datasets
  const allDatasets = await searchUNRWADatasets();
  
  if (allDatasets.length === 0) {
    console.log('⚠️  No UNRWA datasets found on HDX');
    return;
  }
  
  // Fetch datasets by category
  const results = {};
  
  for (const [category, configs] of Object.entries(UNRWA_DATASETS)) {
    results[category] = await fetchCategoryDatasets(category, configs, allDatasets);
  }
  
  // Calculate totals
  const totalDownloaded = Object.values(results).reduce((sum, r) => sum + r.downloaded, 0);
  const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0);
  const allDownloadedDatasets = Object.entries(results).flatMap(([cat, r]) => 
    r.datasets.map(d => ({ ...d, category: cat }))
  );
  
  // Save summary
  const summary = {
    source: 'UNRWA (via HDX)',
    fetched_at: new Date().toISOString(),
    total_datasets: totalDownloaded,
    total_failed: totalFailed,
    by_category: Object.entries(results).map(([category, result]) => ({
      category,
      downloaded: result.downloaded,
      failed: result.failed,
      datasets: result.datasets.length,
    })),
    datasets: allDownloadedDatasets,
  };
  
  await writeJSON(path.join(DATA_DIR, 'summary.json'), summary);
  
  // Save metadata
  const metadata = {
    source: 'UNRWA',
    api_base: HDX_CKAN_BASE,
    organization: 'unrwa',
    last_updated: new Date().toISOString(),
    update_frequency: 'monthly',
    categories: Object.keys(UNRWA_DATASETS),
    total_datasets: totalDownloaded,
  };
  
  await writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);
  
  // Print summary
  console.log('\n========================================');
  console.log('Fetch Summary');
  console.log('========================================');
  console.log(`Total datasets downloaded: ${totalDownloaded}`);
  console.log(`Total failed: ${totalFailed}`);
  console.log('By category:');
  for (const [category, result] of Object.entries(results)) {
    console.log(`  ${category}: ${result.downloaded} downloaded, ${result.failed} failed`);
  }
  console.log('========================================');
  
  return summary;
}

// Run
if (import.meta.url.startsWith('file:') && process.argv[1] && import.meta.url.includes(path.basename(process.argv[1]))) {
  fetchUNRWAData()
    .then(() => {
      console.log('\n✓ UNRWA data fetch completed successfully\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n✗ UNRWA data fetch failed:', error);
      console.error('Stack:', error.stack);
      process.exit(1);
    });
}

export { fetchUNRWAData };
