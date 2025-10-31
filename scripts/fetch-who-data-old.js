#!/usr/bin/env node

/**
 * WHO Data Fetcher
 * 
 * Fetches health indicators for Palestine from WHO Global Health Observatory (GHO) API
 * No API key required - public data
 * 
 * Usage: node scripts/fetch-who-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/who');
const WHO_API_BASE = 'https://ghoapi.azureedge.net/api';
const COUNTRY_CODE = 'PSE'; // Palestine
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Create rate-limited fetcher
const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

// Helper functions
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureDir = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
};

const writeJSON = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
};

/**
 * WHO Health Indicators Configuration
 * Organized by category for Palestine-specific health data
 */
const WHO_INDICATORS = {
  // Life Expectancy and Mortality
  mortality: [
    { code: 'WHOSIS_000001', name: 'Life expectancy at birth (years)', priority: 1 },
    { code: 'WHOSIS_000015', name: 'Healthy life expectancy (HALE) at birth (years)', priority: 2 },
    { code: 'MDG_0000000001', name: 'Infant mortality rate (per 1000 live births)', priority: 3 },
    { code: 'MDG_0000000006', name: 'Under-five mortality rate (per 1000 live births)', priority: 4 },
    { code: 'MDG_0000000026', name: 'Maternal mortality ratio (per 100,000 live births)', priority: 5 },
    { code: 'WHOSIS_000004', name: 'Neonatal mortality rate (per 1000 live births)', priority: 6 },
  ],

  // Health Workforce
  workforce: [
    { code: 'HWF_0001', name: 'Medical doctors (per 10,000 population)', priority: 1 },
    { code: 'HWF_0002', name: 'Nursing and midwifery personnel (per 10,000 population)', priority: 2 },
    { code: 'HWF_0003', name: 'Dentists (per 10,000 population)', priority: 3 },
    { code: 'HWF_0004', name: 'Pharmacists (per 10,000 population)', priority: 4 },
  ],

  // Health Infrastructure
  infrastructure: [
    { code: 'WHS6_102', name: 'Hospital beds (per 10,000 population)', priority: 1 },
    { code: 'WHS6_104', name: 'Psychiatric beds (per 100,000 population)', priority: 2 },
  ],

  // Immunization and Vaccination
  immunization: [
    { code: 'WHS4_100', name: 'Immunization coverage - BCG (%)', priority: 1 },
    { code: 'WHS4_544', name: 'Immunization coverage - DTP3 (%)', priority: 2 },
    { code: 'WHS4_117', name: 'Immunization coverage - measles (%)', priority: 3 },
    { code: 'WHS4_543', name: 'Immunization coverage - polio3 (%)', priority: 4 },
    { code: 'WHS4_545', name: 'Immunization coverage - hepatitis B3 (%)', priority: 5 },
  ],

  // Disease Surveillance
  diseases: [
    { code: 'TB_1', name: 'Tuberculosis incidence (per 100,000 population)', priority: 1 },
    { code: 'TB_2', name: 'Tuberculosis mortality (per 100,000 population)', priority: 2 },
    { code: 'HIV_0000000001', name: 'HIV prevalence (% of population aged 15-49)', priority: 3 },
    { code: 'MALARIA_EST_INCIDENCE', name: 'Malaria incidence (per 1,000 population at risk)', priority: 4 },
  ],

  // Maternal and Child Health
  maternal_child: [
    { code: 'WHS3_48', name: 'Births attended by skilled health personnel (%)', priority: 1 },
    { code: 'WHS3_41', name: 'Antenatal care coverage - at least 4 visits (%)', priority: 2 },
    { code: 'WHS3_42', name: 'Contraceptive prevalence (%)', priority: 3 },
    { code: 'WHS3_62', name: 'Low birth weight prevalence (%)', priority: 4 },
  ],

  // Nutrition
  nutrition: [
    { code: 'NUT_ANAEMIA_WOMEN', name: 'Prevalence of anaemia in women (%)', priority: 1 },
    { code: 'NUT_ANAEMIA_CHILDREN', name: 'Prevalence of anaemia in children (%)', priority: 2 },
    { code: 'NUTRITION_WA_2', name: 'Children underweight for age (%)', priority: 3 },
    { code: 'NUTRITION_ST_2', name: 'Children stunted for age (%)', priority: 4 },
    { code: 'NUTRITION_WH_2', name: 'Children wasted for weight-for-height (%)', priority: 5 },
  ],

  // Non-Communicable Diseases
  ncd: [
    { code: 'NCD_BMI_30A', name: 'Prevalence of obesity among adults (%)', priority: 1 },
    { code: 'NCD_BMI_25A', name: 'Prevalence of overweight among adults (%)', priority: 2 },
    { code: 'SA_0000001688', name: 'Prevalence of raised blood pressure (%)', priority: 3 },
    { code: 'NCD_GLUC_04', name: 'Prevalence of diabetes (%)', priority: 4 },
  ],

  // Health Expenditure
  expenditure: [
    { code: 'WHS7_104', name: 'Total health expenditure (% of GDP)', priority: 1 },
    { code: 'WHS7_105', name: 'Government health expenditure (% of total health expenditure)', priority: 2 },
    { code: 'WHS7_108', name: 'Out-of-pocket health expenditure (% of total health expenditure)', priority: 3 },
    { code: 'WHS7_156', name: 'Per capita total health expenditure (USD)', priority: 4 },
  ],

  // Water and Sanitation (Health-Related)
  wash: [
    { code: 'WSH_SANITATION_BASIC', name: 'Population using basic sanitation services (%)', priority: 1 },
    { code: 'WSH_WATER_BASIC', name: 'Population using basic drinking water services (%)', priority: 2 },
    { code: 'WSH_SANITATION_SAFELY_MANAGED', name: 'Population using safely managed sanitation (%)', priority: 3 },
    { code: 'WSH_WATER_SAFELY_MANAGED', name: 'Population using safely managed drinking water (%)', priority: 4 },
  ],
};

/**
 * Fetch data for a single WHO indicator with retry logic
 */
async function fetchIndicatorData(indicatorCode, indicatorName, retryCount = 0) {
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds

  try {
    console.log(`Fetching ${indicatorName} (${indicatorCode})...`);

    // WHO API endpoint for indicator data by country
    const url = `${WHO_API_BASE}/${indicatorCode}?$filter=SpatialDim eq '${COUNTRY_CODE}'`;
    
    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // WHO API returns data in 'value' array
    const records = data?.value || [];
    
    console.log(`✓ Fetched ${records.length} records for ${indicatorName}`);

    return {
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
      data: records,
      fetched_at: new Date().toISOString(),
      record_count: records.length,
    };

  } catch (error) {
    console.error(`✗ Failed to fetch ${indicatorName}:`, error.message);

    // Implement exponential backoff retry
    if (retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount);
      console.log(`Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
      await sleep(delay);
      return fetchIndicatorData(indicatorCode, indicatorName, retryCount + 1);
    }

    // Return empty result if all retries failed
    console.error(`All retries failed for ${indicatorName}`);
    return {
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
      data: [],
      fetched_at: new Date().toISOString(),
      record_count: 0,
      error: error.message,
    };
  }
}

/**
 * Fetch all indicators in a category
 */
async function fetchCategoryData(categoryName, indicators) {
  console.log(`\n=== Fetching ${categoryName} indicators ===`);
  
  const results = [];
  
  for (const indicator of indicators) {
    const result = await fetchIndicatorData(indicator.code, indicator.name);
    results.push(result);
    
    // Rate limiting delay
    await sleep(RATE_LIMIT_DELAY);
  }
  
  const totalRecords = results.reduce((sum, r) => sum + r.record_count, 0);
  console.log(`Category ${categoryName}: ${totalRecords} total records\n`);
  
  return {
    category: categoryName,
    indicators: results,
    total_records: totalRecords,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Main fetch function
 */
async function fetchWHOData() {
  console.log('========================================');
  console.log('WHO Data Fetcher');
  console.log('========================================');
  console.log(`Country: ${COUNTRY_CODE} (Palestine)`);
  console.log(`Rate limit: ${RATE_LIMIT_DELAY}ms between requests`);
  console.log('========================================\n');

  // Ensure output directory exists
  await ensureDir(DATA_DIR);
  console.log(`Output directory: ${DATA_DIR}\n`);

  const allResults = {
    source: 'WHO Global Health Observatory',
    country: COUNTRY_CODE,
    country_name: 'Palestine',
    fetched_at: new Date().toISOString(),
    categories: {},
    summary: {
      total_indicators: 0,
      total_records: 0,
      successful_indicators: 0,
      failed_indicators: 0,
    },
  };

  // Fetch data for each category
  for (const [categoryKey, indicators] of Object.entries(WHO_INDICATORS)) {
    const categoryData = await fetchCategoryData(categoryKey, indicators);
    allResults.categories[categoryKey] = categoryData;
    
    // Update summary
    allResults.summary.total_indicators += indicators.length;
    allResults.summary.total_records += categoryData.total_records;
    allResults.summary.successful_indicators += categoryData.indicators.filter(i => !i.error).length;
    allResults.summary.failed_indicators += categoryData.indicators.filter(i => i.error).length;
  }

  // Save complete results
  const allDataPath = path.join(DATA_DIR, 'all-data.json');
  await writeJSON(allDataPath, allResults);
  console.log(`\n✓ Saved complete data to: ${allDataPath}`);

  // Save category-specific files
  for (const [categoryKey, categoryData] of Object.entries(allResults.categories)) {
    const categoryPath = path.join(DATA_DIR, `${categoryKey}.json`);
    await writeJSON(categoryPath, categoryData);
    console.log(`✓ Saved ${categoryKey} data to: ${categoryPath}`);
  }

  // Save metadata
  const metadata = {
    source: 'WHO Global Health Observatory',
    api_base: WHO_API_BASE,
    country_code: COUNTRY_CODE,
    country_name: 'Palestine',
    last_updated: new Date().toISOString(),
    update_frequency: 'monthly',
    categories: Object.keys(WHO_INDICATORS),
    summary: allResults.summary,
    data_quality: {
      completeness: allResults.summary.successful_indicators / allResults.summary.total_indicators,
      total_indicators: allResults.summary.total_indicators,
      total_records: allResults.summary.total_records,
    },
  };

  const metadataPath = path.join(DATA_DIR, 'metadata.json');
  await writeJSON(metadataPath, metadata);
  console.log(`✓ Saved metadata to: ${metadataPath}`);

  // Print summary
  console.log('\n========================================');
  console.log('Fetch Summary');
  console.log('========================================');
  console.log(`Total indicators: ${allResults.summary.total_indicators}`);
  console.log(`Successful: ${allResults.summary.successful_indicators}`);
  console.log(`Failed: ${allResults.summary.failed_indicators}`);
  console.log(`Total records: ${allResults.summary.total_records}`);
  console.log(`Data quality: ${(metadata.data_quality.completeness * 100).toFixed(1)}%`);
  console.log('========================================');

  return allResults;
}

/**
 * Run the fetcher
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchWHOData()
    .then(() => {
      console.log('\n✓ WHO data fetch completed successfully\n');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n✗ WHO data fetch failed:', error);
      process.exit(1);
    });
}

export { fetchWHOData, WHO_INDICATORS };
