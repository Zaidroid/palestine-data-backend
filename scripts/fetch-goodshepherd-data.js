#!/usr/bin/env node

/**
 * Good Shepherd Collective Data Fetcher
 * 
 * Fetches data from Good Shepherd Collective or uses local fallback data
 * Includes: prisoners, demolitions, casualties
 * 
 * Usage: node scripts/fetch-goodshepherd-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from './utils/fetch-with-retry.js';
import { createLogger } from './utils/logger.js';
import { validateDataset } from './utils/data-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/goodshepherd');
const FALLBACK_DIR = path.join(__dirname, '../src/data');
const BASELINE_DATE = '2023-10-07';
const API_BASE = 'https://goodshepherdcollective.org/api';
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Initialize logger
const logger = createLogger({ 
  context: 'GoodShepherd-Fetcher',
  logLevel: 'INFO',
});

// Helper functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

// Fetch with retry and fallback
const fetchWithFallback = async (endpoint, fallbackPath, returnRaw = false) => {
  // Try API first
  try {
    await logger.info(`Trying API: ${API_BASE}${endpoint}`);
    
    const data = await fetchJSONWithRetry(`${API_BASE}${endpoint}`, {}, {
      maxRetries: 3,
      initialDelay: 1000,
      backoffMultiplier: 2,
    });
    
    await sleep(RATE_LIMIT_DELAY);
    
    // If returnRaw is true, return the raw response (for complex structures)
    if (returnRaw) {
      await logger.success('API success: raw data');
      return { data, source: 'api' };
    }
    
    // Ensure data is an array
    let arrayData = Array.isArray(data) ? data : [];
    
    await logger.success(`API success: ${arrayData.length} records`);
    
    // If API returns empty, try fallback
    if (arrayData.length === 0 && fallbackPath) {
      await logger.warn('API returned empty, trying fallback...');
      throw new Error('Empty API response');
    }
    
    return { data: arrayData, source: 'api' };
    
  } catch (apiError) {
    await logger.warn(`API issue: ${apiError.message}`);
    
    // Try fallback
    if (fallbackPath) {
      try {
        await logger.info(`Trying fallback: ${fallbackPath}`);
        const fullPath = path.join(__dirname, '..', fallbackPath);
        const data = await readJSON(fullPath);
        
        // Ensure data is an array
        const arrayData = Array.isArray(data) ? data : [];
        await logger.success(`Fallback success: ${arrayData.length} records`);
        return { data: arrayData, source: 'fallback' };
      } catch (fallbackError) {
        await logger.error(`Fallback failed: ${fallbackError.message}`, fallbackError);
      }
    }
    
    // Return empty array instead of throwing
    await logger.warn('Returning empty dataset');
    return { data: returnRaw ? {} : [], source: 'empty' };
  }
};

const writeJSON = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    await logger.debug(`Wrote file: ${filePath}`);
  } catch (error) {
    await logger.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
};

const readJSON = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    await logger.error(`Failed to read JSON file: ${filePath}`, error);
    throw error;
  }
};

const getQuarter = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
};

const partitionByQuarter = (data, dateField = 'date') => {
  const quarters = {};
  data.forEach(record => {
    const recordDate = record[dateField];
    if (!recordDate) return;
    const quarter = getQuarter(recordDate);
    if (!quarters[quarter]) quarters[quarter] = [];
    quarters[quarter].push(record);
  });
  return quarters;
};

// Fetch child prisoners data
async function fetchChildPrisoners() {
  await logger.info('👶 Fetching child prisoners data...');
  
  try {
    const { data: rawData, source } = await fetchWithFallback(
      '/child_prisoners.json',
      'src/data/minors-pre.json'
    );
    
    // Transform to standard format
    const transformed = rawData
      .filter(item => {
        const date = item['Date of event'] || item.date;
        return date && date >= BASELINE_DATE;
      })
      .map(item => ({
        date: item['Date of event'] || item.date,
        name: item.Name || item.name || 'Unknown',
        age: item.Age || item.age || 17,
        location: item['Place of residence'] || item.location || 'Unknown',
        status: 'detained',
        notes: item.Notes || item.notes || '',
        source: `goodshepherd-${source}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    await logger.success(`Filtered to ${transformed.length} records (since ${BASELINE_DATE})`);
    return transformed;
  } catch (error) {
    await logger.error('Failed to fetch child prisoners', error);
    return [];
  }
}

// Fetch political prisoners data
async function fetchPoliticalPrisoners() {
  await logger.info('🔒 Fetching political prisoners data...');
  
  try {
    const { data: rawData, source } = await fetchWithFallback(
      '/prisoner_data.json',
      'src/data/spi-pre.json'
    );
    
    const transformed = rawData
      .filter(item => {
        const date = item['Date of event'] || item.date;
        return date && date >= BASELINE_DATE;
      })
      .map(item => ({
        date: item['Date of event'] || item.date,
        name: item.name || item.Name || 'Unknown',
        age: item.age || item.Age,
        location: item.location || item['Place of residence'] || 'Unknown',
        detention_type: item.detention_type || 'administrative',
        notes: item.notes || item.Notes || '',
        source: `goodshepherd-${source}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    await logger.success(`Filtered to ${transformed.length} records (since ${BASELINE_DATE})`);
    return transformed;
  } catch (error) {
    await logger.error('Failed to fetch political prisoners', error);
    return [];
  }
}

// Fetch demolitions data with multiple fallback sources
async function fetchDemolitions() {
  await logger.info('🏚️  Fetching demolitions data...');
  
  try {
    // Try Good Shepherd API first
    let rawData = [];
    let source = 'empty';
    
    try {
      const result = await fetchWithFallback(
        '/home_demolitions.json',
        'src/data/demolitions-pre.json'
      );
      rawData = result.data;
      source = result.source;
    } catch (goodShepherdError) {
      await logger.warn('Good Shepherd endpoint unavailable, trying alternative sources...');
    }
    
    // If Good Shepherd failed or returned empty, try HDX
    if (rawData.length === 0) {
      await logger.info('Attempting to fetch from HDX alternative source...');
      const hdxData = await fetchDemolitionsFromHDX();
      if (hdxData.length > 0) {
        rawData = hdxData;
        source = 'hdx';
        await logger.success(`Fetched ${hdxData.length} records from HDX`);
      }
    }
    
    // If still empty, try B'Tselem
    if (rawData.length === 0) {
      await logger.info('Attempting to fetch from B\'Tselem alternative source...');
      const btselemData = await fetchDemolitionsFromBTselem();
      if (btselemData.length > 0) {
        rawData = btselemData;
        source = 'btselem';
        await logger.success(`Fetched ${btselemData.length} records from B'Tselem`);
      }
    }
    
    // Transform the data
    const transformed = rawData
      .filter(item => {
        const date = item['Date of Demolition'] || item.date || item.demolition_date;
        return date && date >= BASELINE_DATE;
      })
      .map(item => ({
        date: item['Date of Demolition'] || item.date || item.demolition_date,
        location: item.Locality || item.location || item.locality || 'Unknown',
        homes_demolished: item['Housing Units'] || item.homes || item.structures_demolished || 1,
        people_affected: item['People left Homeless'] || item.people_affected || item.residents_affected || 0,
        reason: item.reason || item.demolition_reason || 'Administrative demolition',
        structure_type: item.structure_type || 'residential',
        source: source === 'api' ? 'goodshepherd-api' : source === 'fallback' ? 'goodshepherd-fallback' : source,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    await logger.success(`Filtered to ${transformed.length} records (since ${BASELINE_DATE})`);
    return transformed;
  } catch (error) {
    await logger.error('Failed to fetch demolitions from all sources', error);
    return [];
  }
}

// Fetch demolitions from HDX as alternative source
async function fetchDemolitionsFromHDX() {
  try {
    // HDX CKAN API endpoint for demolition-related datasets
    const HDX_CKAN_BASE = 'https://data.humdata.org/api/3/action';
    
    // Search for demolition datasets
    const searchUrl = `${HDX_CKAN_BASE}/package_search?q=demolition+palestine&rows=10`;
    
    await logger.info('Searching HDX for demolition datasets...');
    const searchResult = await fetchJSONWithRetry(searchUrl, {}, {
      maxRetries: 2,
      initialDelay: 1000,
    });
    
    if (!searchResult.success || !searchResult.result.results || searchResult.result.results.length === 0) {
      await logger.warn('No demolition datasets found on HDX');
      return [];
    }
    
    await logger.info(`Found ${searchResult.result.results.length} potential datasets on HDX`);
    
    // Try to fetch data from the first relevant dataset
    for (const dataset of searchResult.result.results) {
      if (dataset.resources && dataset.resources.length > 0) {
        for (const resource of dataset.resources) {
          // Look for CSV or JSON resources
          if (resource.format === 'CSV' || resource.format === 'JSON') {
            try {
              await logger.info(`Trying resource: ${resource.name}`);
              
              if (resource.format === 'JSON') {
                const data = await fetchJSONWithRetry(resource.url, {}, { maxRetries: 1 });
                if (Array.isArray(data) && data.length > 0) {
                  return data;
                }
              } else if (resource.format === 'CSV') {
                // For CSV, we'd need to parse it - skip for now
                await logger.info('CSV format found but skipping (would need parsing)');
              }
            } catch (resourceError) {
              await logger.debug(`Failed to fetch resource: ${resourceError.message}`);
            }
          }
        }
      }
    }
    
    return [];
  } catch (error) {
    await logger.warn('HDX alternative source failed', error);
    return [];
  }
}

// Fetch demolitions from B'Tselem as alternative source
async function fetchDemolitionsFromBTselem() {
  try {
    // B'Tselem doesn't have a public API, but they publish data that might be available
    // through other aggregators or we can use a static dataset
    
    await logger.info('Checking B\'Tselem data sources...');
    
    // Try to fetch from a known B'Tselem data aggregator or static source
    // Note: This is a placeholder - actual implementation would need the real B'Tselem data source
    const BTSELEM_DATA_SOURCES = [
      'https://statistics.btselem.org/en/demolitions/data.json', // Example URL
      'https://data.btselem.org/demolitions.json', // Example URL
    ];
    
    for (const url of BTSELEM_DATA_SOURCES) {
      try {
        await logger.info(`Trying B'Tselem source: ${url}`);
        const data = await fetchJSONWithRetry(url, {}, { 
          maxRetries: 1,
          initialDelay: 1000,
        });
        
        if (Array.isArray(data) && data.length > 0) {
          await logger.success(`Fetched ${data.length} records from B'Tselem`);
          return data;
        }
      } catch (sourceError) {
        await logger.debug(`B'Tselem source unavailable: ${sourceError.message}`);
      }
    }
    
    await logger.warn('No B\'Tselem data sources available');
    return [];
  } catch (error) {
    await logger.warn('B\'Tselem alternative source failed', error);
    return [];
  }
}

// Fetch West Bank data
async function fetchWestBankData() {
  await logger.info('🏔️  Fetching West Bank data...');
  
  try {
    const { data: response, source } = await fetchWithFallback(
      '/wb_data.json',
      null,
      true  // Return raw data
    );
    
    // WB data has structure: { reports: [...] }
    let rawData = [];
    if (response && response.reports && Array.isArray(response.reports)) {
      // Extract data from reports
      rawData = response.reports.flatMap(report => {
        if (report.data && Array.isArray(report.data)) {
          return report.data.map(item => ({
            ...item,
            report_date: report.metadata?.Date,
          }));
        }
        return [];
      });
    }
    
    const transformed = rawData
      .filter(item => {
        const date = item.date || item.report_date || item['Date of event'];
        return date && date >= BASELINE_DATE;
      })
      .map(item => ({
        date: item.date || item.report_date || item['Date of event'],
        location: item.location || item.Location || 'West Bank',
        incident_type: item.incident_type || item.type || item['Incident Type'] || 'unknown',
        killed: item.killed || item.Killed || 0,
        injured: item.injured || item.Injured || 0,
        description: item.description || item.Description || '',
        source: `goodshepherd-${source}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    await logger.success(`Filtered to ${transformed.length} records (since ${BASELINE_DATE})`);
    return transformed;
  } catch (error) {
    await logger.error('Failed to fetch West Bank data', error);
    return [];
  }
}

// Fetch healthcare attacks with streaming support for large datasets
async function fetchHealthcareAttacks() {
  await logger.info('🏥 Fetching healthcare attacks data...');
  
  try {
    // Try to fetch with streaming if dataset is large
    const { data: rawData, source } = await fetchHealthcareAttacksWithStreaming();
    
    // Filter for Palestine (PSE) only
    const palestineData = rawData.filter(item => 
      item.isoCode === 'PSE' || 
      item.isoCode === 'PS' ||
      (item.location && item.location.toLowerCase().includes('palestine'))
    );
    
    const transformed = palestineData
      .filter(item => {
        const date = item.isoDate || item.date || item['Date of event'];
        return date && date >= BASELINE_DATE;
      })
      .map(item => ({
        date: (item.isoDate || item.date || item['Date of event']).split('T')[0],
        facility_name: item.facility_name || item.facility || 'Unknown',
        facility_type: item.facility_type || item.type || 'healthcare',
        location: item.location || 'Unknown',
        incident_type: item.incident_type || 'attack',
        description: item.editedIncidentDescription || item.description || '',
        casualties: {
          killed: item.totalHealthWorkerKilled || item.killed || 0,
          injured: item.totalHealthWorkerInjured || item.injured || 0,
          kidnapped: item.totalHealthWorkerKidnapped || 0,
        },
        latitude: item.latitude,
        longitude: item.longitude,
        source: `goodshepherd-${source}`,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    await logger.success(`Filtered to ${transformed.length} records (since ${BASELINE_DATE})`);
    return transformed;
  } catch (error) {
    await logger.error('Failed to fetch healthcare attacks', error);
    return [];
  }
}

// Fetch healthcare attacks with streaming support
async function fetchHealthcareAttacksWithStreaming() {
  const CHUNK_SIZE = 10000;
  const endpoint = '/healthcare_attacks.json';
  
  try {
    await logger.info(`Attempting to fetch healthcare attacks with streaming support...`);
    
    // First, try to get the full dataset to check size
    const response = await fetch(`${API_BASE}${endpoint}`);
    
    if (!response.ok) {
      await logger.warn(`API returned ${response.status}, trying fallback...`);
      return { data: [], source: 'empty' };
    }
    
    // Check content length to determine if streaming is needed
    const contentLength = response.headers.get('content-length');
    const estimatedSize = contentLength ? parseInt(contentLength) : 0;
    
    await logger.info(`Response size: ${(estimatedSize / 1024 / 1024).toFixed(2)} MB`);
    
    // If dataset is large (>10MB), use streaming approach
    if (estimatedSize > 10 * 1024 * 1024) {
      await logger.info('Large dataset detected, using streaming approach...');
      return await streamLargeDataset(response, CHUNK_SIZE);
    }
    
    // For smaller datasets, use regular approach
    const data = await response.json();
    const arrayData = Array.isArray(data) ? data : [];
    
    await logger.success(`Fetched ${arrayData.length} records via standard fetch`);
    return { data: arrayData, source: 'api' };
    
  } catch (error) {
    await logger.warn(`Streaming fetch failed: ${error.message}`);
    
    // Fallback to regular fetch
    try {
      const { data, source } = await fetchWithFallback(endpoint, null);
      return { data, source };
    } catch (fallbackError) {
      await logger.error('All fetch attempts failed', fallbackError);
      return { data: [], source: 'empty' };
    }
  }
}

// Stream large dataset in chunks
async function streamLargeDataset(response, chunkSize) {
  await logger.info('Processing large dataset in chunks...');
  
  try {
    // Read the response as text first
    const text = await response.text();
    const data = JSON.parse(text);
    const arrayData = Array.isArray(data) ? data : [];
    
    await logger.success(`Loaded ${arrayData.length} records`);
    
    // If dataset is very large, save chunks incrementally
    if (arrayData.length > chunkSize) {
      await logger.info(`Dataset has ${arrayData.length} records, will partition during save`);
      await saveHealthcareChunks(arrayData, chunkSize);
    }
    
    return { data: arrayData, source: 'api-streamed' };
    
  } catch (error) {
    await logger.error('Failed to stream large dataset', error);
    throw error;
  }
}

// Save healthcare data in chunks with index
async function saveHealthcareChunks(data, chunkSize) {
  const chunksDir = path.join(DATA_DIR, 'healthcare', 'chunks');
  await ensureDir(chunksDir);
  
  const totalChunks = Math.ceil(data.length / chunkSize);
  await logger.info(`Saving ${totalChunks} chunks of ${chunkSize} records each...`);
  
  const chunkIndex = [];
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, data.length);
    const chunk = data.slice(start, end);
    
    const chunkFile = `chunk-${i + 1}.json`;
    const chunkPath = path.join(chunksDir, chunkFile);
    
    await writeJSON(chunkPath, {
      metadata: {
        chunk_number: i + 1,
        total_chunks: totalChunks,
        record_count: chunk.length,
        record_range: { start, end: end - 1 },
        created_at: new Date().toISOString(),
      },
      data: chunk,
    });
    
    chunkIndex.push({
      chunk_number: i + 1,
      file: chunkFile,
      record_count: chunk.length,
      record_range: { start, end: end - 1 },
    });
    
    await logger.debug(`Saved chunk ${i + 1}/${totalChunks} (${chunk.length} records)`);
  }
  
  // Save chunk index
  await writeJSON(path.join(chunksDir, 'index.json'), {
    total_records: data.length,
    total_chunks: totalChunks,
    chunk_size: chunkSize,
    chunks: chunkIndex,
    created_at: new Date().toISOString(),
  });
  
  await logger.success(`Saved ${totalChunks} chunks with index`);
}

// Fetch NGO data
async function fetchNGOData() {
  await logger.info('🏢 Fetching NGO data...');
  
  try {
    const { data: response, source } = await fetchWithFallback(
      '/ngo_data.json',
      null,
      true  // Return raw data
    );
    
    // NGO data has structure: { value: number, data: [...] }
    let rawData = [];
    if (response && response.data && Array.isArray(response.data)) {
      rawData = response.data;
    }
    
    // NGO data doesn't have dates, so we don't filter by baseline
    const transformed = rawData.map(item => {
      // Get latest filing data
      const latestFiling = item.filings && item.filings.length > 0 
        ? item.filings[item.filings.length - 1]
        : {};
      
      return {
        name: item.name || 'Unknown',
        ein: item.ein || item.EIN || '',
        state: item.state || '',
        total_assets: latestFiling.assetsEnd || item.total_assets || 0,
        total_revenue: latestFiling.revenue || item.totalRevenue || 0,
        total_expenses: latestFiling.expenses || 0,
        total_liabilities: latestFiling.liabilitiesEnd || 0,
        filing_year: latestFiling.year || new Date().getFullYear(),
        filings_count: item.filings ? item.filings.length : 0,
        pdf_url: item.latestPdfUrl || null,
        source: `goodshepherd-${source}`,
      };
    });
    
    console.log(`  ✓ Loaded ${transformed.length} NGO records`);
    console.log(`  ✓ Total value: $${response.value ? response.value.toLocaleString() : 0}`);
    return transformed;
  } catch (error) {
    console.error('  ❌ Failed to fetch NGO data:', error.message);
    return [];
  }
}

// Save NGO data in structured format
async function saveNGOData(ngoData) {
  console.log('\n💾 Saving NGO data...');
  
  if (ngoData.length === 0) {
    console.log('  ⚠️  No NGO data to save');
    return { totalOrganizations: 0, totalFunding: 0 };
  }
  
  const ngoPath = path.join(DATA_DIR, 'ngo');
  await ensureDir(ngoPath);
  
  // Validate NGO data
  let validationResult = null;
  try {
    validationResult = await validateDataset(ngoData, 'ngo');
    
    if (validationResult.meetsThreshold) {
      await logger.success(`NGO data validation passed (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
    } else {
      await logger.warn(`NGO data validation quality below threshold (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
    }
    
    if (validationResult.errors.length > 0) {
      await logger.warn(`Found ${validationResult.errors.length} validation errors in NGO data`);
    }
  } catch (validationError) {
    await logger.warn('NGO data validation failed', validationError);
  }
  
  // Save organizations.json
  const organizations = ngoData.map(ngo => ({
    name: ngo.name,
    ein: ngo.ein,
    state: ngo.state,
    total_assets: ngo.total_assets,
    total_revenue: ngo.total_revenue,
    total_expenses: ngo.total_expenses,
    total_liabilities: ngo.total_liabilities,
    filing_year: ngo.filing_year,
    filings_count: ngo.filings_count,
    pdf_url: ngo.pdf_url,
    source: ngo.source,
  }));
  
  await writeJSON(path.join(ngoPath, 'organizations.json'), {
    metadata: {
      source: 'goodshepherd',
      dataset: 'ngo-organizations',
      record_count: organizations.length,
      last_updated: new Date().toISOString(),
    },
    data: organizations,
  });
  console.log(`  ✓ Saved organizations.json (${organizations.length} organizations)`);
  
  // Calculate funding by year
  const fundingByYear = {};
  ngoData.forEach(ngo => {
    const year = ngo.filing_year;
    if (!fundingByYear[year]) {
      fundingByYear[year] = {
        year,
        total_revenue: 0,
        total_expenses: 0,
        total_assets: 0,
        organization_count: 0,
      };
    }
    fundingByYear[year].total_revenue += ngo.total_revenue || 0;
    fundingByYear[year].total_expenses += ngo.total_expenses || 0;
    fundingByYear[year].total_assets += ngo.total_assets || 0;
    fundingByYear[year].organization_count += 1;
  });
  
  const fundingByYearArray = Object.values(fundingByYear).sort((a, b) => a.year - b.year);
  
  await writeJSON(path.join(ngoPath, 'funding-by-year.json'), {
    metadata: {
      source: 'goodshepherd',
      dataset: 'ngo-funding',
      record_count: fundingByYearArray.length,
      last_updated: new Date().toISOString(),
    },
    data: fundingByYearArray,
  });
  console.log(`  ✓ Saved funding-by-year.json (${fundingByYearArray.length} years)`);
  
  // Save index
  const totalFunding = ngoData.reduce((sum, ngo) => sum + (ngo.total_revenue || 0), 0);
  await writeJSON(path.join(ngoPath, 'index.json'), {
    dataset: 'ngo-data',
    total_organizations: organizations.length,
    total_funding: totalFunding,
    years: fundingByYearArray.map(y => y.year),
    files: [
      { file: 'organizations.json', records: organizations.length },
      { file: 'funding-by-year.json', records: fundingByYearArray.length },
    ],
    validation: validationResult ? {
      qualityScore: validationResult.qualityScore,
      completeness: validationResult.completeness,
      meetsThreshold: validationResult.meetsThreshold,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
    } : null,
    last_updated: new Date().toISOString(),
  });
  console.log(`  ✓ Saved index.json`);
  
  // Save validation report if available
  if (validationResult) {
    await writeJSON(path.join(ngoPath, 'validation.json'), validationResult);
    console.log(`  ✓ Saved validation.json`);
  }
  
  return { totalOrganizations: organizations.length, totalFunding };
}

// Save partitioned data
async function savePartitionedData(datasetPath, data, datasetName, chunksExist = false) {
  console.log(`\n💾 Saving ${datasetName} data...`);
  
  await ensureDir(datasetPath);
  
  if (data.length === 0) {
    console.log('  ⚠️  No data to save');
    return;
  }
  
  // If chunks already exist, add reference in metadata
  if (chunksExist) {
    console.log('  ℹ️  Large dataset chunks already saved');
  }
  
  // Validate data before saving
  let validationResult = null;
  try {
    // Determine dataset type from name
    let datasetType = 'generic';
    if (datasetName.includes('healthcare')) {
      datasetType = 'healthcare';
    } else if (datasetName.includes('demolition')) {
      datasetType = 'demolitions';
    } else if (datasetName.includes('prisoner')) {
      datasetType = 'casualties'; // Use casualties schema for prisoner data
    } else if (datasetName.includes('ngo')) {
      datasetType = 'ngo';
    }
    
    validationResult = await validateDataset(data, datasetType);
    
    if (validationResult.meetsThreshold) {
      await logger.success(`Validation passed for ${datasetName} (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
    } else {
      await logger.warn(`Validation quality below threshold for ${datasetName} (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
    }
    
    if (validationResult.errors.length > 0) {
      await logger.warn(`Found ${validationResult.errors.length} validation errors in ${datasetName}`);
    }
  } catch (validationError) {
    await logger.warn(`Validation failed for ${datasetName}`, validationError);
    // Continue anyway - validation failure shouldn't stop the save
  }
  
  // Partition by quarter
  const quarters = partitionByQuarter(data);
  const quarterKeys = Object.keys(quarters).sort();
  
  console.log(`  ✓ Partitioned into ${quarterKeys.length} quarters`);
  
  // Save each quarter
  for (const quarter of quarterKeys) {
    const quarterData = quarters[quarter];
    const fileName = `${quarter}.json`;
    const filePath = path.join(datasetPath, fileName);
    
    const fileData = {
      metadata: {
        source: 'goodshepherd',
        dataset: datasetName,
        quarter,
        record_count: quarterData.length,
        last_updated: new Date().toISOString(),
      },
      data: quarterData,
    };
    
    await writeJSON(filePath, fileData);
    console.log(`  ✓ Saved ${fileName} (${quarterData.length} records)`);
  }
  
  // Save recent data (last 90 days)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const recentData = data.filter(record => new Date(record.date) >= ninetyDaysAgo);
  
  if (recentData.length > 0) {
    await writeJSON(path.join(datasetPath, 'recent.json'), {
      metadata: {
        source: 'goodshepherd',
        dataset: datasetName,
        record_count: recentData.length,
        last_updated: new Date().toISOString(),
      },
      data: recentData,
    });
    console.log(`  ✓ Saved recent.json (${recentData.length} records)`);
  }
  
  // Check if chunks exist
  let chunkInfo = null;
  if (chunksExist) {
    try {
      const chunksDir = path.join(datasetPath, 'chunks');
      const chunkIndexPath = path.join(chunksDir, 'index.json');
      const chunkIndexContent = await fs.readFile(chunkIndexPath, 'utf-8');
      chunkInfo = JSON.parse(chunkIndexContent);
    } catch (error) {
      await logger.warn('Failed to read chunk index', error);
    }
  }
  
  // Save index
  await writeJSON(path.join(datasetPath, 'index.json'), {
    dataset: datasetName,
    date_range: {
      start: data[0]?.date || BASELINE_DATE,
      end: data[data.length - 1]?.date || new Date().toISOString().split('T')[0],
      baseline_date: BASELINE_DATE,
    },
    files: quarterKeys.map(q => ({
      file: `${q}.json`,
      quarter: q,
      records: quarters[q].length,
    })),
    chunks: chunkInfo ? {
      enabled: true,
      total_chunks: chunkInfo.total_chunks,
      chunk_size: chunkInfo.chunk_size,
      chunks_directory: 'chunks/',
      index_file: 'chunks/index.json',
    } : null,
    validation: validationResult ? {
      qualityScore: validationResult.qualityScore,
      completeness: validationResult.completeness,
      consistency: validationResult.consistency,
      accuracy: validationResult.accuracy,
      meetsThreshold: validationResult.meetsThreshold,
      errorCount: validationResult.errors.length,
      warningCount: validationResult.warnings.length,
    } : null,
    last_updated: new Date().toISOString(),
  });
  console.log(`  ✓ Saved index.json`);
  
  // Save validation report if available
  if (validationResult) {
    await writeJSON(path.join(datasetPath, 'validation.json'), validationResult);
    console.log(`  ✓ Saved validation.json`);
  }
}

// Main execution
async function main() {
  await logger.info('🚀 Good Shepherd Collective Data Fetcher');
  await logger.info('========================================');
  await logger.info(`Baseline Date: ${BASELINE_DATE}`);
  await logger.info(`Data Directory: ${DATA_DIR}`);
  
  try {
    // Fetch all datasets
    const [
      childPrisoners,
      politicalPrisoners,
      demolitions,
      westBankData,
      healthcareAttacks,
      ngoData,
    ] = await Promise.all([
      fetchChildPrisoners(),
      fetchPoliticalPrisoners(),
      fetchDemolitions(),
      fetchWestBankData(),
      fetchHealthcareAttacks(),
      fetchNGOData(),
    ]);
    
    // Save child prisoners
    if (childPrisoners.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'prisoners/children'),
        childPrisoners,
        'child-prisoners'
      );
    }
    
    // Save political prisoners
    if (politicalPrisoners.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'prisoners/political'),
        politicalPrisoners,
        'political-prisoners'
      );
    }
    
    // Save demolitions
    if (demolitions.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'demolitions'),
        demolitions,
        'demolitions'
      );
    }
    
    // Save West Bank data
    if (westBankData.length > 0) {
      await savePartitionedData(
        path.join(DATA_DIR, 'westbank'),
        westBankData,
        'westbank-incidents'
      );
    }
    
    // Save healthcare attacks
    if (healthcareAttacks.length > 0) {
      // Check if chunks were already saved during streaming
      const chunksDir = path.join(DATA_DIR, 'healthcare', 'chunks');
      let chunksExist = false;
      try {
        await fs.access(path.join(chunksDir, 'index.json'));
        chunksExist = true;
        await logger.info('Healthcare chunks already saved during streaming');
      } catch {
        // Chunks don't exist, save normally
      }
      
      await savePartitionedData(
        path.join(DATA_DIR, 'healthcare'),
        healthcareAttacks,
        'healthcare-attacks',
        chunksExist
      );
    }
    
    // Save NGO data with structured format
    const ngoStats = await saveNGOData(ngoData);
    
    // Calculate date ranges for each dataset
    const getDateRange = (data) => {
      if (data.length === 0) return null;
      return {
        start: data[0]?.date || BASELINE_DATE,
        end: data[data.length - 1]?.date || new Date().toISOString().split('T')[0],
      };
    };
    
    // Count partitions for each dataset
    const countPartitions = (data) => {
      if (data.length === 0) return 0;
      const quarters = partitionByQuarter(data);
      return Object.keys(quarters).length;
    };
    
    // Save enhanced metadata
    const metadata = {
      source: 'goodshepherd',
      api_base: API_BASE,
      last_updated: new Date().toISOString(),
      baseline_date: BASELINE_DATE,
      datasets: {
        healthcare: {
          name: 'Healthcare Attacks',
          category: 'healthcare',
          record_count: healthcareAttacks.length,
          date_range: getDateRange(healthcareAttacks),
          partitioned: true,
          partition_count: countPartitions(healthcareAttacks),
          partition_strategy: 'quarter',
          has_recent_file: healthcareAttacks.length > 0,
          streaming: {
            enabled: true,
            chunk_size: 10000,
            chunks_directory: 'chunks/',
            description: 'Large datasets are automatically chunked for efficient loading',
          },
        },
        demolitions: {
          name: 'Home Demolitions',
          category: 'demolitions',
          record_count: demolitions.length,
          date_range: getDateRange(demolitions),
          partitioned: true,
          partition_count: countPartitions(demolitions),
          partition_strategy: 'quarter',
          has_recent_file: demolitions.length > 0,
          alternative_sources: {
            enabled: true,
            sources: ['hdx', 'btselem'],
            fallback_strategy: 'goodshepherd -> hdx -> btselem -> local',
          },
        },
        ngo: {
          name: 'NGO Financial Data',
          category: 'ngo',
          record_count: ngoStats.totalOrganizations,
          total_funding: ngoStats.totalFunding,
          partitioned: false,
          files: ['organizations.json', 'funding-by-year.json'],
        },
        childPrisoners: {
          name: 'Child Prisoners',
          category: 'prisoners',
          record_count: childPrisoners.length,
          date_range: getDateRange(childPrisoners),
          partitioned: true,
          partition_count: countPartitions(childPrisoners),
          partition_strategy: 'quarter',
          has_recent_file: childPrisoners.length > 0,
        },
        politicalPrisoners: {
          name: 'Political Prisoners',
          category: 'prisoners',
          record_count: politicalPrisoners.length,
          date_range: getDateRange(politicalPrisoners),
          partitioned: true,
          partition_count: countPartitions(politicalPrisoners),
          partition_strategy: 'quarter',
          has_recent_file: politicalPrisoners.length > 0,
        },
        westBankIncidents: {
          name: 'West Bank Incidents',
          category: 'westbank',
          record_count: westBankData.length,
          date_range: getDateRange(westBankData),
          partitioned: westBankData.length > 0,
          partition_count: countPartitions(westBankData),
          partition_strategy: 'quarter',
          has_recent_file: westBankData.length > 0,
        },
      },
      summary: {
        total_datasets: 6,
        total_records: childPrisoners.length + politicalPrisoners.length + demolitions.length + 
                       westBankData.length + healthcareAttacks.length + ngoStats.totalOrganizations,
        total_partitions: countPartitions(childPrisoners) + countPartitions(politicalPrisoners) + 
                         countPartitions(demolitions) + countPartitions(westBankData) + 
                         countPartitions(healthcareAttacks),
      },
    };
    
    await writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);
    
    await logger.success('✅ Good Shepherd data fetch completed successfully!');
    await logger.info('Summary:');
    console.log(`  Child Prisoners: ${childPrisoners.length} records`);
    console.log(`  Political Prisoners: ${politicalPrisoners.length} records`);
    console.log(`  Demolitions: ${demolitions.length} records`);
    console.log(`  West Bank Incidents: ${westBankData.length} records (API endpoint unavailable - all reports have empty data arrays)`);
    console.log(`  Healthcare Attacks: ${healthcareAttacks.length} records`);
    console.log(`  NGO Data: ${ngoStats.totalOrganizations} organizations ($${ngoStats.totalFunding.toLocaleString()} total funding)`);
    
    // Log operation summary
    await logger.logSummary();
    
  } catch (error) {
    await logger.error('Fatal error in Good Shepherd fetch script', error);
    await logger.logSummary();
    process.exit(1);
  }
}

// Run
main();
