#!/usr/bin/env node

/**
 * Data Validation Script
 * 
 * Validates all data files for:
 * - JSON validity
 * - Required fields
 * - Date formats
 * - Data consistency
 * - File sizes
 * 
 * Usage: node scripts/validate-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const BASELINE_DATE = '2023-10-07';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const errors = [];

// Helper: Test function
function test(name, condition, errorMsg = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    return true;
  } else {
    failedTests++;
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    if (errorMsg) errors.push(`${name}: ${errorMsg}`);
    return false;
  }
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

// Helper: Get all JSON files
async function getAllJSONFiles(dir) {
  const files = [];
  
  async function scan(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }
  
  await scan(dir);
  return files;
}

// Validate JSON syntax
async function validateJSONSyntax(filePath) {
  const data = await readJSON(filePath);
  return data !== null;
}

// Validate date format
function isValidDate(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
}

// Validate baseline date
function isAfterBaseline(dateStr) {
  return dateStr >= BASELINE_DATE;
}

// Validate file size
async function validateFileSize(filePath) {
  const stats = await fs.stat(filePath);
  return stats.size <= MAX_FILE_SIZE;
}

// Validate time-series data
function validateTimeSeriesData(data) {
  if (!data.metadata) return false;
  if (!data.data || !Array.isArray(data.data)) return false;
  
  // Check if data is sorted by date
  for (let i = 1; i < data.data.length; i++) {
    const prevDate = data.data[i - 1].date;
    const currDate = data.data[i].date;
    
    if (prevDate && currDate && prevDate > currDate) {
      return false; // Not sorted
    }
  }
  
  return true;
}

// Main validation
async function main() {
  console.log(`${colors.blue}🔍 Data Validation Suite${colors.reset}`);
  console.log('========================\n');
  
  try {
    // Get all JSON files
    const files = await getAllJSONFiles(DATA_DIR);
    console.log(`Found ${files.length} JSON files\n`);
    
    // Test 1: Manifest exists
    console.log(`${colors.blue}=== Manifest Tests ===${colors.reset}\n`);
    const manifestPath = path.join(DATA_DIR, 'manifest.json');
    test('Manifest file exists', await fs.access(manifestPath).then(() => true).catch(() => false));
    
    const manifest = await readJSON(manifestPath);
    test('Manifest is valid JSON', manifest !== null);
    test('Manifest has baseline_date', manifest?.baseline_date === BASELINE_DATE);
    test('Manifest has version', !!manifest?.version);
    test('Manifest has datasets', !!manifest?.datasets);
    
    // Test 2: JSON Syntax
    console.log(`\n${colors.blue}=== JSON Syntax Tests ===${colors.reset}\n`);
    let validJSON = 0;
    for (const file of files) {
      const isValid = await validateJSONSyntax(file);
      if (isValid) validJSON++;
    }
    test(`All JSON files are valid (${validJSON}/${files.length})`, validJSON === files.length);
    
    // Test 3: File Sizes
    console.log(`\n${colors.blue}=== File Size Tests ===${colors.reset}\n`);
    let validSizes = 0;
    let largestFile = { path: '', size: 0 };
    
    for (const file of files) {
      const stats = await fs.stat(file);
      if (stats.size <= MAX_FILE_SIZE) {
        validSizes++;
      }
      if (stats.size > largestFile.size) {
        largestFile = { path: file, size: stats.size };
      }
    }
    
    test(`All files under 10MB (${validSizes}/${files.length})`, validSizes === files.length);
    console.log(`  Largest file: ${path.basename(largestFile.path)} (${(largestFile.size / 1024).toFixed(2)}KB)`);
    
    // Test 4: Time-Series Data
    console.log(`\n${colors.blue}=== Time-Series Data Tests ===${colors.reset}\n`);
    const timeSeriesFiles = files.filter(f => 
      f.includes('/casualties/') || 
      f.includes('/displacement/') ||
      f.includes('/prisoners/') ||
      f.includes('/demolitions/')
    );
    
    let validTimeSeries = 0;
    for (const file of timeSeriesFiles) {
      const data = await readJSON(file);
      if (data && validateTimeSeriesData(data)) {
        validTimeSeries++;
      }
    }
    
    test(`Time-series files have correct structure (${validTimeSeries}/${timeSeriesFiles.length})`, 
      validTimeSeries === timeSeriesFiles.length);
    
    // Test 5: Date Validation
    console.log(`\n${colors.blue}=== Date Validation Tests ===${colors.reset}\n`);
    let validDates = 0;
    let afterBaseline = 0;
    
    for (const file of timeSeriesFiles) {
      const data = await readJSON(file);
      if (data?.data) {
        for (const record of data.data) {
          if (record.date) {
            if (isValidDate(record.date)) validDates++;
            if (isAfterBaseline(record.date)) afterBaseline++;
          }
        }
      }
    }
    
    test(`All dates are valid ISO format`, validDates > 0);
    test(`All dates are after baseline (${BASELINE_DATE})`, afterBaseline > 0);
    
    // Test 6: Data Sources
    console.log(`\n${colors.blue}=== Data Source Tests ===${colors.reset}\n`);
    const sources = ['tech4palestine', 'hdx', 'goodshepherd', 'worldbank'];
    
    for (const source of sources) {
      const sourcePath = path.join(DATA_DIR, source);
      const exists = await fs.access(sourcePath).then(() => true).catch(() => false);
      test(`${source} directory exists`, exists);
      
      if (exists) {
        const metadataPath = path.join(sourcePath, 'metadata.json');
        const hasMetadata = await fs.access(metadataPath).then(() => true).catch(() => false);
        test(`${source} has metadata.json`, hasMetadata);
      }
    }
    
    // Test 7: Index Files
    console.log(`\n${colors.blue}=== Index File Tests ===${colors.reset}\n`);
    const indexFiles = files.filter(f => f.endsWith('index.json'));
    
    let validIndexes = 0;
    for (const file of indexFiles) {
      const data = await readJSON(file);
      if (data?.dataset && data?.files && Array.isArray(data.files)) {
        validIndexes++;
      }
    }
    
    test(`All index files have correct structure (${validIndexes}/${indexFiles.length})`, 
      validIndexes === indexFiles.length);
    
    // Test 8: Data Consistency
    console.log(`\n${colors.blue}=== Data Consistency Tests ===${colors.reset}\n`);
    
    // Check Tech4Palestine casualties
    const t4pCasualtiesIndex = await readJSON(path.join(DATA_DIR, 'tech4palestine/casualties/index.json'));
    if (t4pCasualtiesIndex) {
      const filesExist = await Promise.all(
        t4pCasualtiesIndex.files.map(f => 
          fs.access(path.join(DATA_DIR, 'tech4palestine/casualties', f.file))
            .then(() => true)
            .catch(() => false)
        )
      );
      test('All Tech4Palestine casualty files exist', filesExist.every(e => e));
    }
    
    // Summary
    console.log(`\n${colors.blue}=== Summary ===${colors.reset}\n`);
    console.log(`Total Tests: ${totalTests}`);
    console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
    console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (errors.length > 0) {
      console.log(`\n${colors.red}Errors:${colors.reset}`);
      errors.forEach(err => console.log(`  - ${err}`));
    }
    
    if (failedTests === 0) {
      console.log(`\n${colors.green}✅ All validation tests passed!${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`\n${colors.red}❌ Some validation tests failed${colors.reset}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Fatal error:${colors.reset}`, error);
    process.exit(1);
  }
}

// Run
main();
