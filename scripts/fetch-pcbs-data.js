#!/usr/bin/env node

/**
 * PCBS (Palestinian Central Bureau of Statistics) Data Fetcher
 * 
 * Fetches official statistics from PCBS for Palestine.
 * 
 * Data Sources:
 * 1. World Bank API - Republished PCBS indicators
 * 2. Manual data entry template for key indicators not available via API
 * 
 * Note: PCBS official website (www.pcbs.gov.ps) primarily publishes data in PDF/Excel reports.
 * This script focuses on programmatically accessible data via World Bank API which republishes
 * many PCBS indicators.
 * 
 * Usage: node scripts/fetch-pcbs-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry, createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import { createLogger } from './utils/logger.js';
import { validateDataset } from './utils/data-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/pcbs');
const WB_API_BASE = 'https://api.worldbank.org/v2';
const COUNTRY_CODE = 'PSE'; // Palestine
const RATE_LIMIT_DELAY = 500; // 0.5 seconds

// Initialize logger
const logger = createLogger({ 
  context: 'PCBS-Fetcher',
  logLevel: 'INFO',
});

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
    await logger.debug(`Wrote file: ${filePath}`);
  } catch (error) {
    await logger.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
};

/**
 * PCBS indicators available through World Bank API
 * These are official PCBS statistics republished by World Bank
 */
const PCBS_INDICATORS = {
  // Population Statistics
  'SP.POP.TOTL': 'Population, total',
  'SP.POP.GROW': 'Population growth (annual %)',
  'SP.URB.TOTL.IN.ZS': 'Urban population (% of total)',
  'SP.URB.GROW': 'Urban population growth (annual %)',
  'SP.POP.0014.TO.ZS': 'Population ages 0-14 (% of total)',
  'SP.POP.1564.TO.ZS': 'Population ages 15-64 (% of total)',
  'SP.POP.65UP.TO.ZS': 'Population ages 65 and above (% of total)',
  'SP.DYN.TFRT.IN': 'Fertility rate, total (births per woman)',
  'SP.DYN.LE00.IN': 'Life expectancy at birth, total (years)',
  'SP.DYN.LE00.FE.IN': 'Life expectancy at birth, female (years)',
  'SP.DYN.LE00.MA.IN': 'Life expectancy at birth, male (years)',
  'SP.DYN.CBRT.IN': 'Birth rate, crude (per 1,000 people)',
  'SP.DYN.CDRT.IN': 'Death rate, crude (per 1,000 people)',
  'SP.POP.DPND': 'Age dependency ratio (% of working-age population)',
  'SP.POP.DPND.OL': 'Age dependency ratio, old (% of working-age population)',
  'SP.POP.DPND.YG': 'Age dependency ratio, young (% of working-age population)',
  
  // Labor Statistics
  'SL.UEM.TOTL.ZS': 'Unemployment, total (% of total labor force)',
  'SL.UEM.TOTL.FE.ZS': 'Unemployment, female (% of female labor force)',
  'SL.UEM.TOTL.MA.ZS': 'Unemployment, male (% of male labor force)',
  'SL.TLF.CACT.ZS': 'Labor force participation rate, total (% of total population ages 15+)',
  'SL.TLF.CACT.FE.ZS': 'Labor force participation rate, female (% of female population ages 15+)',
  'SL.TLF.CACT.MA.ZS': 'Labor force participation rate, male (% of male population ages 15+)',
  'SL.UEM.1524.ZS': 'Unemployment, youth total (% of total labor force ages 15-24)',
  'SL.UEM.ADVN.ZS': 'Unemployment with advanced education (% of total labor force)',
  'SL.EMP.VULN.ZS': 'Vulnerable employment, total (% of total employment)',
  'SL.TLF.TOTL.IN': 'Labor force, total',
  'SL.EMP.TOTL.SP.ZS': 'Employment to population ratio, 15+, total (%)',
  'SL.EMP.TOTL.SP.FE.ZS': 'Employment to population ratio, 15+, female (%)',
  'SL.EMP.TOTL.SP.MA.ZS': 'Employment to population ratio, 15+, male (%)',
  
  // Economic Statistics
  'NY.GDP.MKTP.CD': 'GDP (current US$)',
  'NY.GDP.MKTP.KD.ZG': 'GDP growth (annual %)',
  'NY.GDP.PCAP.CD': 'GDP per capita (current US$)',
  'NY.GDP.PCAP.KD.ZG': 'GDP per capita growth (annual %)',
  'NV.AGR.TOTL.ZS': 'Agriculture, forestry, and fishing, value added (% of GDP)',
  'NV.IND.TOTL.ZS': 'Industry (including construction), value added (% of GDP)',
  'NV.SRV.TOTL.ZS': 'Services, value added (% of GDP)',
  'FP.CPI.TOTL.ZG': 'Inflation, consumer prices (annual %)',
  'NY.GNP.PCAP.CD': 'GNI per capita, Atlas method (current US$)',
  'NE.EXP.GNFS.ZS': 'Exports of goods and services (% of GDP)',
  'NE.IMP.GNFS.ZS': 'Imports of goods and services (% of GDP)',
  
  // Poverty & Social Statistics
  'SI.POV.GINI': 'Gini index',
  'SI.POV.NAHC': 'Poverty headcount ratio at national poverty lines (% of population)',
  'SI.DST.FRST.20': 'Income share held by lowest 20%',
  'SI.DST.05TH.20': 'Income share held by highest 20%',
  
  // Education Statistics
  'SE.PRM.ENRR': 'School enrollment, primary (% gross)',
  'SE.SEC.ENRR': 'School enrollment, secondary (% gross)',
  'SE.TER.ENRR': 'School enrollment, tertiary (% gross)',
  'SE.PRM.ENRR.FE': 'School enrollment, primary, female (% gross)',
  'SE.SEC.ENRR.FE': 'School enrollment, secondary, female (% gross)',
  'SE.TER.ENRR.FE': 'School enrollment, tertiary, female (% gross)',
  'SE.PRM.CMPT.ZS': 'Primary completion rate, total (% of relevant age group)',
  'SE.ADT.LITR.ZS': 'Literacy rate, adult total (% of people ages 15 and above)',
  'SE.XPD.TOTL.GD.ZS': 'Government expenditure on education, total (% of GDP)',
  'SE.PRM.ENRL.TC.ZS': 'Pupil-teacher ratio, primary',
  'SE.SEC.ENRL.TC.ZS': 'Pupil-teacher ratio, secondary',
  
  // Health Statistics
  'SH.DYN.MORT': 'Mortality rate, under-5 (per 1,000 live births)',
  'SH.DYN.NMRT': 'Mortality rate, neonatal (per 1,000 live births)',
  'SH.STA.MMRT': 'Maternal mortality ratio (per 100,000 live births)',
  'SH.MED.PHYS.ZS': 'Physicians (per 1,000 people)',
  'SH.MED.BEDS.ZS': 'Hospital beds (per 1,000 people)',
  'SH.MED.NUMW.P3': 'Nurses and midwives (per 1,000 people)',
  'SH.XPD.CHEX.GD.ZS': 'Current health expenditure (% of GDP)',
  'SH.IMM.IDPT': 'Immunization, DPT (% of children ages 12-23 months)',
  'SH.IMM.MEAS': 'Immunization, measles (% of children ages 12-23 months)',
  
  // Housing Statistics
  'EG.ELC.ACCS.ZS': 'Access to electricity (% of population)',
  'SH.H2O.BASW.ZS': 'People using at least basic drinking water services (% of population)',
  'SH.STA.BASS.ZS': 'People using at least basic sanitation services (% of population)',
};

/**
 * Categorize PCBS indicators
 */
const getIndicatorCategory = (indicatorCode) => {
  if (indicatorCode.startsWith('SP.POP') || indicatorCode.startsWith('SP.DYN')) {
    return 'population';
  }
  if (indicatorCode.startsWith('SL.')) {
    return 'labor';
  }
  if (indicatorCode.startsWith('NY.') || indicatorCode.startsWith('NV.') || 
      indicatorCode.startsWith('NE.') || indicatorCode.startsWith('FP.')) {
    return 'economic';
  }
  if (indicatorCode.startsWith('SI.POV') || indicatorCode.startsWith('SI.DST')) {
    return 'poverty';
  }
  if (indicatorCode.startsWith('SE.')) {
    return 'education';
  }
  if (indicatorCode.startsWith('SH.')) {
    return 'health';
  }
  if (indicatorCode.startsWith('EG.ELC') || indicatorCode.startsWith('SH.H2O') || 
      indicatorCode.startsWith('SH.STA.BASS')) {
    return 'housing';
  }
  return 'other';
};

/**
 * Fetch with retry
 */
async function fetchWithRetry(url, retries = 3) {
  try {
    const data = await rateLimitedFetch(url, {}, {
      maxRetries: retries,
      initialDelay: 1000,
      backoffMultiplier: 2,
      onRetry: async (attempt, delay, reason) => {
        await logger.warn(`Retry ${attempt}/${retries} for ${url} (${reason}), waiting ${delay}ms`);
      },
    });
    
    const jsonData = await data.json();
    return jsonData;
  } catch (error) {
    await logger.error(`Failed to fetch ${url} after ${retries} retries`, error);
    throw error;
  }
}

/**
 * Fetch indicator data from World Bank API
 */
async function fetchIndicator(indicatorCode, indicatorName) {
  await logger.info(`📊 Fetching: ${indicatorName}...`);
  
  try {
    // Fetch data from 2010 onwards
    const url = `${WB_API_BASE}/country/${COUNTRY_CODE}/indicator/${indicatorCode}?format=json&date=2010:2024&per_page=100`;
    const response = await fetchWithRetry(url);
    
    // World Bank API returns [metadata, data]
    if (!response || response.length < 2) {
      await logger.warn(`No data available for ${indicatorCode}`);
      return null;
    }
    
    const [metadata, data] = response;
    
    if (!data || data.length === 0) {
      await logger.warn(`No data points found for ${indicatorCode}`);
      return null;
    }
    
    await logger.success(`Found ${data.length} data points for ${indicatorCode}`);
    
    // Transform data
    const transformed = data
      .filter(item => item.value !== null)
      .map(item => ({
        year: parseInt(item.date),
        value: item.value,
        indicator: indicatorCode,
        indicator_name: indicatorName,
        country: item.country.value,
        source: 'pcbs',
        source_detail: 'PCBS via World Bank API',
      }))
      .sort((a, b) => a.year - b.year);
    
    return {
      indicator: indicatorCode,
      indicator_name: indicatorName,
      category: getIndicatorCategory(indicatorCode),
      data: transformed,
      metadata: {
        source: 'Palestinian Central Bureau of Statistics (PCBS)',
        source_detail: 'Data accessed via World Bank Open Data API',
        last_updated: new Date().toISOString(),
        total_points: transformed.length,
      },
    };
  } catch (error) {
    await logger.error(`Failed to fetch ${indicatorName} (${indicatorCode})`, error);
    return null;
  }
}

/**
 * Create manual data entry template
 */
async function createManualDataTemplate() {
  const template = {
    _instructions: {
      description: 'Manual data entry template for PCBS indicators not available via API',
      usage: 'Fill in the data array with values from PCBS official reports',
      source: 'Palestinian Central Bureau of Statistics (www.pcbs.gov.ps)',
      date_format: 'YYYY',
      notes: [
        'Download official PCBS reports from www.pcbs.gov.ps',
        'Extract data from PDF/Excel reports',
        'Enter data in the format shown below',
        'Run the fetch script again to process manual entries',
      ],
    },
    manual_indicators: [
      {
        indicator_code: 'PCBS_WAGES_AVG',
        indicator_name: 'Average daily wage (NIS)',
        category: 'labor',
        unit: 'NIS',
        data: [
          // Example format:
          // { year: 2023, value: 120.5, region: 'palestine', notes: 'Source: PCBS Labor Force Survey 2023' }
        ],
      },
      {
        indicator_code: 'PCBS_POVERTY_RATE',
        indicator_name: 'Poverty rate (%)',
        category: 'poverty',
        unit: 'percentage',
        data: [
          // Example: { year: 2023, value: 29.2, region: 'palestine', notes: 'Source: PCBS Poverty Report 2023' }
        ],
      },
      {
        indicator_code: 'PCBS_HOUSING_DENSITY',
        indicator_name: 'Average household size (persons)',
        category: 'housing',
        unit: 'persons',
        data: [],
      },
      {
        indicator_code: 'PCBS_CONSUMER_PRICE_INDEX',
        indicator_name: 'Consumer Price Index (base year = 100)',
        category: 'economic',
        unit: 'index',
        data: [],
      },
      {
        indicator_code: 'PCBS_TRADE_BALANCE',
        indicator_name: 'Trade balance (million USD)',
        category: 'economic',
        unit: 'million_usd',
        data: [],
      },
    ],
  };
  
  const templatePath = path.join(DATA_DIR, 'manual-data-template.json');
  await writeJSON(templatePath, template);
  await logger.info(`Created manual data entry template: ${templatePath}`);
  
  return template;
}

/**
 * Load and process manual data entries
 */
async function loadManualData() {
  const templatePath = path.join(DATA_DIR, 'manual-data-template.json');
  
  try {
    const content = await fs.readFile(templatePath, 'utf-8');
    const template = JSON.parse(content);
    
    const manualData = {};
    let totalEntries = 0;
    
    for (const indicator of template.manual_indicators) {
      if (indicator.data && indicator.data.length > 0) {
        manualData[indicator.indicator_code] = {
          indicator: indicator.indicator_code,
          indicator_name: indicator.indicator_name,
          category: indicator.category,
          data: indicator.data.map(entry => ({
            year: entry.year,
            value: entry.value,
            indicator: indicator.indicator_code,
            indicator_name: indicator.indicator_name,
            region: entry.region || 'palestine',
            notes: entry.notes || '',
            source: 'pcbs',
            source_detail: 'PCBS Official Reports (Manual Entry)',
          })),
          metadata: {
            source: 'Palestinian Central Bureau of Statistics (PCBS)',
            source_detail: 'Manual entry from official PCBS reports',
            last_updated: new Date().toISOString(),
            total_points: indicator.data.length,
          },
        };
        totalEntries += indicator.data.length;
      }
    }
    
    if (totalEntries > 0) {
      await logger.success(`Loaded ${Object.keys(manualData).length} manual indicators with ${totalEntries} data points`);
    }
    
    return manualData;
  } catch (error) {
    if (error.code === 'ENOENT') {
      await logger.info('No manual data template found (this is normal on first run)');
      return {};
    }
    await logger.warn('Failed to load manual data', error);
    return {};
  }
}

/**
 * Main execution
 */
async function main() {
  await logger.info('🚀 PCBS Data Fetcher');
  await logger.info('==========================');
  await logger.info('Source: Palestinian Central Bureau of Statistics');
  await logger.info(`Country: Palestine (${COUNTRY_CODE})`);
  await logger.info(`Data Directory: ${DATA_DIR}`);
  await logger.info('');
  
  try {
    await ensureDir(DATA_DIR);
    
    // Create manual data template
    await createManualDataTemplate();
    
    // Load any manual data entries
    const manualData = await loadManualData();
    
    const results = {};
    const allData = [];
    const errors = [];
    
    // Fetch all indicators from World Bank API
    await logger.info('Fetching PCBS indicators from World Bank API...\n');
    for (const [code, name] of Object.entries(PCBS_INDICATORS)) {
      try {
        const indicatorData = await fetchIndicator(code, name);
        if (indicatorData) {
          results[code] = indicatorData;
          allData.push(...indicatorData.data);
        } else {
          errors.push({ code, name, error: 'No data returned' });
        }
      } catch (indicatorError) {
        await logger.error(`Error processing indicator ${code}`, indicatorError);
        errors.push({ code, name, error: indicatorError.message });
      }
    }
    
    // Add manual data
    Object.entries(manualData).forEach(([code, data]) => {
      results[code] = data;
      allData.push(...data.data);
    });
    
    // Save individual indicator files
    for (const [code, data] of Object.entries(results)) {
      try {
        const fileName = `${code.toLowerCase().replace(/\./g, '_')}.json`;
        await writeJSON(path.join(DATA_DIR, fileName), data);
        await logger.success(`Saved ${fileName}`);
      } catch (saveError) {
        await logger.error(`Failed to save indicator ${code}`, saveError);
        errors.push({ code, error: `Save failed: ${saveError.message}` });
      }
    }
    
    // Generate category summary
    const categories = {};
    Object.entries(results).forEach(([code, data]) => {
      const category = data.category || getIndicatorCategory(code);
      if (!categories[category]) {
        categories[category] = {
          count: 0,
          indicators: [],
        };
      }
      categories[category].count++;
      categories[category].indicators.push({
        code,
        name: data.indicator_name,
      });
    });
    
    // Save metadata
    const metadata = {
      source: 'pcbs',
      source_name: 'Palestinian Central Bureau of Statistics',
      country: 'Palestine',
      country_code: COUNTRY_CODE,
      last_updated: new Date().toISOString(),
      indicators: Object.keys(results).length,
      total_data_points: allData.length,
      api_indicators: Object.keys(PCBS_INDICATORS).length,
      manual_indicators: Object.keys(manualData).length,
      categories: categories,
      data_sources: [
        {
          name: 'World Bank Open Data API',
          description: 'PCBS indicators republished by World Bank',
          url: 'https://api.worldbank.org/v2',
        },
        {
          name: 'PCBS Official Reports',
          description: 'Manual data entry from official PCBS publications',
          url: 'https://www.pcbs.gov.ps',
        },
      ],
    };
    
    await writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);
    await logger.success('Saved metadata.json');
    
    // Save all data in one file
    const allDataFile = {
      metadata: metadata,
      data: allData.sort((a, b) => a.year - b.year),
    };
    
    await writeJSON(path.join(DATA_DIR, 'all-indicators.json'), allDataFile);
    await logger.success('Saved all-indicators.json');
    
    await logger.success('✅ PCBS data fetch completed successfully!');
    await logger.info('Summary:');
    await logger.info(`  Indicators fetched: ${Object.keys(results).length}`);
    await logger.info(`  - From API: ${Object.keys(results).length - Object.keys(manualData).length}`);
    await logger.info(`  - Manual entries: ${Object.keys(manualData).length}`);
    await logger.info(`  Total data points: ${allData.length}`);
    
    if (errors.length > 0) {
      await logger.warn(`  Failed indicators: ${errors.length}`);
    }
    
    await logger.info('\nCategories:');
    Object.entries(categories).forEach(([category, info]) => {
      logger.info(`  ${category}: ${info.count} indicators`);
    });
    
    await logger.info('\nNote: To add manual data entries, edit manual-data-template.json and run this script again.');
    
    // Log operation summary
    await logger.logSummary();
    
  } catch (error) {
    await logger.error('Fatal error in PCBS fetch script', error);
    await logger.logSummary();
    process.exit(1);
  }
}

// Run
main();
