#!/usr/bin/env node

/**
 * WHO Data Fetcher (FIXED)
 * 
 * The WHO GHO API (ghoapi.azureedge.net) has been deprecated.
 * This script fetches WHO health indicators for Palestine from HDX where WHO publishes their data.
 * 
 * Dataset: "State of Palestine - Health Indicators" by World Health Organization
 * 
 * Usage: node scripts/fetch-who-data-fixed.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { createLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({
  context: 'WHO-Fetcher',
  logLevel: 'INFO',
});

const DATA_DIR = path.join(__dirname, '../public/data/who');
const HDX_API_BASE = 'https://data.humdata.org/api/3/action';
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

/**
 * Find WHO health indicators dataset for Palestine
 */
async function findWHODataset() {
  await logger.info('Searching for WHO health indicators dataset...');

  const query = 'health AND groups:pse';
  const url = `${HDX_API_BASE}/package_search?q=${encodeURIComponent(query)}&rows=100`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HDX API error: ${response.status}`);
  }

  const data = await response.json();
  const datasets = data?.result?.results || [];

  // Find WHO dataset
  const whoDataset = datasets.find(ds => {
    const isWHO = ds.organization?.name === 'who' ||
      ds.organization?.title?.toLowerCase().includes('world health organization');
    const isHealthIndicators = ds.title?.toLowerCase().includes('health indicators');
    return isWHO && isHealthIndicators;
  });

  if (!whoDataset) {
    await logger.warn('Available health datasets:');
    datasets.slice(0, 10).forEach(async (ds, i) => {
      await logger.warn(`  ${i + 1}. ${ds.title} (${ds.organization?.title}) [org: ${ds.organization?.name}]`);
    });
    throw new Error('WHO Health Indicators dataset not found');
  }

  await logger.success(`Found: ${whoDataset.title}`);
  await logger.info(`Organization: ${whoDataset.organization?.title}`);
  await logger.info(`Resources: ${whoDataset.resources?.length}`);

  return whoDataset;
}

/**
 * Download and parse a resource
 */
async function downloadResource(resource) {
  try {
    await logger.info(`Downloading: ${resource.name}`);
    await logger.debug(`Format: ${resource.format}`);
    await logger.debug(`Size: ${(resource.size / 1024).toFixed(2)} KB`);

    const response = await fetch(resource.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const format = resource.format?.toLowerCase();
    let data;
    let records = [];

    if (format === 'json' || format === 'geojson') {
      data = await response.json();
      records = Array.isArray(data) ? data : [data];
    } else if (format === 'csv') {
      const text = await response.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
      });
      records = parsed.data || [];
    } else {
      await logger.warn(`Skipping unsupported format: ${format}`);
      return null;
    }

    await logger.success(`Downloaded ${records.length} records`);

    return {
      resource_id: resource.id,
      resource_name: resource.name,
      format: resource.format,
      description: resource.description,
      last_modified: resource.last_modified,
      data: records,
      record_count: records.length,
      downloaded_at: new Date().toISOString(),
    };

  } catch (error) {
    await logger.error(`Failed: ${error.message}`, error);
    return null;
  }
}

/**
 * Categorize resources by indicator type
 */
function categorizeResources(resources) {
  const categories = {
    mortality: [],
    maternal_child: [],
    diseases: [],
    immunization: [],
    nutrition: [],
    ncd: [],
    workforce: [],
    infrastructure: [],
    expenditure: [],
    wash: [],
    other: [],
  };

  resources.forEach(resource => {
    const name = resource.resource_name.toLowerCase();

    if (name.includes('mortality') || name.includes('life expectancy')) {
      categories.mortality.push(resource);
    } else if (name.includes('maternal') || name.includes('child') || name.includes('birth')) {
      categories.maternal_child.push(resource);
    } else if (name.includes('disease') || name.includes('tb') || name.includes('hiv') || name.includes('malaria')) {
      categories.diseases.push(resource);
    } else if (name.includes('immunization') || name.includes('vaccination') || name.includes('vaccine')) {
      categories.immunization.push(resource);
    } else if (name.includes('nutrition') || name.includes('anaemia') || name.includes('underweight')) {
      categories.nutrition.push(resource);
    } else if (name.includes('ncd') || name.includes('diabetes') || name.includes('obesity') || name.includes('blood pressure')) {
      categories.ncd.push(resource);
    } else if (name.includes('doctor') || name.includes('nurse') || name.includes('workforce') || name.includes('health worker')) {
      categories.workforce.push(resource);
    } else if (name.includes('hospital') || name.includes('bed') || name.includes('facility')) {
      categories.infrastructure.push(resource);
    } else if (name.includes('expenditure') || name.includes('spending') || name.includes('budget')) {
      categories.expenditure.push(resource);
    } else if (name.includes('water') || name.includes('sanitation') || name.includes('wash')) {
      categories.wash.push(resource);
    } else {
      categories.other.push(resource);
    }
  });

  return categories;
}

/**
 * Main fetch function
 */
async function fetchWHOData() {
  await logger.info('========================================');
  await logger.info('WHO Data Fetcher');
  await logger.info('========================================');
  await logger.info('Source: HDX (Humanitarian Data Exchange)');
  await logger.info('Note: WHO GHO API is deprecated');
  await logger.info('========================================');

  await ensureDir(DATA_DIR);

  // Find WHO dataset
  const dataset = await findWHODataset();

  // Download all resources
  await logger.info('Downloading resources...');
  const downloadedResources = [];

  for (const resource of dataset.resources) {
    const result = await downloadResource(resource);
    if (result) {
      downloadedResources.push(result);
    }
    await sleep(RATE_LIMIT_DELAY);
  }

  await logger.success(`Downloaded ${downloadedResources.length} resources`);

  // Categorize resources
  const categories = categorizeResources(downloadedResources);

  // Calculate summary
  const totalRecords = downloadedResources.reduce((sum, r) => sum + r.record_count, 0);

  // Save all data
  const allData = {
    source: 'WHO (via HDX)',
    dataset_id: dataset.id,
    dataset_name: dataset.title,
    organization: dataset.organization?.title,
    country: 'PSE',
    country_name: 'Palestine',
    fetched_at: new Date().toISOString(),
    categories: categories,
    resources: downloadedResources,
    summary: {
      total_resources: downloadedResources.length,
      total_records: totalRecords,
      by_category: Object.entries(categories).map(([name, resources]) => ({
        category: name,
        resources: resources.length,
        records: resources.reduce((sum, r) => sum + r.record_count, 0),
      })).filter(c => c.resources > 0),
    },
    metadata: {
      dataset_date: dataset.dataset_date,
      last_modified: dataset.last_modified,
      maintainer: dataset.maintainer,
      license: dataset.license_title,
      tags: dataset.tags?.map(t => t.name) || [],
    },
  };

  const allDataPath = path.join(DATA_DIR, 'all-data.json');
  await writeJSON(allDataPath, allData);
  await logger.success(`Saved complete data to: ${allDataPath}`);

  // Save category-specific files
  for (const [categoryName, resources] of Object.entries(categories)) {
    if (resources.length > 0) {
      const categoryPath = path.join(DATA_DIR, `${categoryName}.json`);
      await writeJSON(categoryPath, {
        category: categoryName,
        resources: resources,
        total_records: resources.reduce((sum, r) => sum + r.record_count, 0),
      });
      await logger.success(`Saved ${categoryName} data (${resources.length} resources)`);
    }
  }

  // Save metadata
  const metadata = {
    source: 'WHO (via HDX)',
    api_base: HDX_API_BASE,
    country_code: 'PSE',
    country_name: 'Palestine',
    last_updated: new Date().toISOString(),
    update_frequency: 'monthly',
    summary: allData.summary,
    note: 'WHO GHO API (ghoapi.azureedge.net) has been deprecated. Data is now sourced from HDX where WHO publishes their datasets.',
  };

  const metadataPath = path.join(DATA_DIR, 'metadata.json');
  await writeJSON(metadataPath, metadata);
  await logger.success(`Saved metadata to: ${metadataPath}`);

  // Print summary
  await logger.info('========================================');
  await logger.info('Fetch Summary');
  await logger.info('========================================');
  await logger.info(`Dataset: ${dataset.title}`);
  await logger.info(`Organization: ${dataset.organization?.title}`);
  await logger.info(`Total resources: ${allData.summary.total_resources}`);
  await logger.info(`Total records: ${allData.summary.total_records}`);
  await logger.info('By category:');
  allData.summary.by_category.forEach(async cat => {
    await logger.info(`  ${cat.category}: ${cat.resources} resources, ${cat.records} records`);
  });
  await logger.info('========================================');

  return allData;
}

// Run
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchWHOData()
    .then(async () => {
      await logger.success('WHO data fetch completed successfully');
      process.exit(0);
    })
    .catch(async (error) => {
      await logger.error('WHO data fetch failed', error);
      await logger.error('Stack:', error.stack);
      process.exit(1);
    });
}

export { fetchWHOData };
