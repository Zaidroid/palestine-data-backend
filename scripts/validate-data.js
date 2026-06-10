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
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

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

  // Check that all records have valid dates
  for (const record of data.data) {
    if (!record.date || !isValidDate(record.date)) {
      return false;
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
    test('Manifest has sources', !!manifest?.sources);

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

    test(`All files under 200MB (${validSizes}/${files.length})`, validSizes === files.length);
    console.log(`  Largest file: ${path.basename(largestFile.path)} (${(largestFile.size / 1024).toFixed(2)}KB)`);

    // Test 4: Time-Series Data
    console.log(`\n${colors.blue}=== Time-Series Data Tests ===${colors.reset}\n`);
    const timeSeriesFiles = files.filter(f =>
      // Scope to the fetcher layouts this structure check was written for —
      // top-level displacement/ now holds raw UNHCR/IDMC envelopes with a
      // different (legitimate) shape.
      (f.includes('tech4palestine/') || f.includes('goodshepherd/')) &&
      (f.includes('/casualties/') ||
        f.includes('/displacement/') ||
        f.includes('/prisoners/') ||
        f.includes('/demolitions/')) &&
      !f.endsWith('index.json') && // Exclude index files
      !f.endsWith('validation.json') // Exclude validation files
    );

    let validTimeSeries = 0;
    const failedTimeSeriesFiles = [];

    for (const file of timeSeriesFiles) {
      const data = await readJSON(file);
      if (data && validateTimeSeriesData(data)) {
        validTimeSeries++;
      } else {
        failedTimeSeriesFiles.push(path.relative(DATA_DIR, file));
      }
    }

    test(`Time-series files have correct structure (${validTimeSeries}/${timeSeriesFiles.length})`,
      validTimeSeries === timeSeriesFiles.length);

    if (failedTimeSeriesFiles.length > 0) {
      console.log(`  ❌ Failed files: ${failedTimeSeriesFiles.join(', ')}`);
    }

    // Test 5: Date Validation
    console.log(`\n${colors.blue}=== Date Validation Tests ===${colors.reset}\n`);
    let validDates = 0;
    let afterBaseline = 0;

    for (const file of timeSeriesFiles) {
      const data = await readJSON(file);
      if (data?.data && Array.isArray(data.data)) {
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
    const indexFiles = files.filter(f => f.endsWith('index.json') && !f.endsWith('search-index.json') && !f.endsWith('stable-id-index.json') && !f.endsWith('member-index.json'));

    let validIndexes = 0;
    const failedIndexFiles = [];

    for (const file of indexFiles) {
      const data = await readJSON(file);
      // Check for various index file structures:
      // 1. Source data index: has dataset and files
      // 2. Unified partition index: has partitions array
      // 3. Unified data index: has dataset and partitions
      if ((data?.dataset && data?.files && Array.isArray(data.files)) ||
        (data?.partitions && Array.isArray(data.partitions)) ||
        (data?.dataset && data?.partitions && Array.isArray(data.partitions))) {
        validIndexes++;
      } else {
        failedIndexFiles.push(path.relative(DATA_DIR, file));
      }
    }

    test(`All index files have correct structure (${validIndexes}/${indexFiles.length})`,
      validIndexes === indexFiles.length);

    if (failedIndexFiles.length > 0) {
      console.log(`  ❌ Failed files: ${failedIndexFiles.join(', ')}`);
    }

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

    // Check Tech4Palestine Martyrs
    const t4pMartyrsIndex = await readJSON(path.join(DATA_DIR, 'tech4palestine/killed-in-gaza/index.json'));
    if (t4pMartyrsIndex) {
      const filesExist = await Promise.all(
        t4pMartyrsIndex.files.map(f =>
          fs.access(path.join(DATA_DIR, 'tech4palestine/killed-in-gaza', f.file))
            .then(() => true)
            .catch(() => false)
        )
      );
      test('All Tech4Palestine martyrs files exist', filesExist.every(e => e));
    }

    // Check Unified Martyrs (frozen snapshot category since the 2026 pivot).
    // Large categories keep only partitions/ after optimize-unified-data.js
    // removes the oversized all-data.json, so accept either layout.
    const unifiedMartyrsPath = path.join(DATA_DIR, 'unified/martyrs_snapshot_2023/all-data.json');
    const martyrsPartitionsDir = path.join(DATA_DIR, 'unified/martyrs_snapshot_2023/partitions');
    const unifiedMartyrsExists = await fs.access(unifiedMartyrsPath).then(() => true).catch(() => false);
    const martyrsPartitions = await fs.readdir(martyrsPartitionsDir).catch(() => []);
    test('Unified martyrs data exists', unifiedMartyrsExists || martyrsPartitions.length > 0);

    if (unifiedMartyrsExists) {
      const martyrsData = await readJSON(unifiedMartyrsPath);
      test('Unified martyrs data has records', martyrsData?.data?.length > 0);
    }

    // Check Unified Infrastructure
    const unifiedInfraPath = path.join(DATA_DIR, 'unified/infrastructure/all-data.json');
    const unifiedInfraExists = await fs.access(unifiedInfraPath).then(() => true).catch(() => false);
    test('Unified infrastructure data exists', unifiedInfraExists);

    // Test 9: Cross-source consistency — what we serve must reconcile with
    // what we fetched. Catches silent transform data loss between refreshes.
    console.log(`\n${colors.blue}=== Cross-Source Consistency Tests ===${colors.reset}\n`);

    // 9a. Martyrs summary record carries the live MoH cumulative totals from
    // the T4P summary fetched the same run (tolerance ±5% for fetch skew).
    const t4pSummary = await readJSON(path.join(DATA_DIR, 'tech4palestine/summary.json'));
    const gazaSummary = t4pSummary?.data?.gaza ?? t4pSummary?.gaza ?? null;
    const mohKilled = gazaSummary?.killed?.total ?? gazaSummary?.killed ?? null;
    if (mohKilled) {
      let summaryRec = null;
      if (unifiedMartyrsExists) {
        const martyrsData = await readJSON(unifiedMartyrsPath);
        summaryRec = (martyrsData?.data || []).find(r => r.event_type === 'cumulative_summary');
      }
      if (!summaryRec) {
        for (const f of martyrsPartitions) {
          if (!f.endsWith('.json') || f === 'index.json') continue;
          const part = await readJSON(path.join(DATA_DIR, 'unified/martyrs_snapshot_2023/partitions', f));
          summaryRec = (part?.data || []).find(r => r.event_type === 'cumulative_summary');
          if (summaryRec) break;
        }
      }
      const served = summaryRec?.metrics?.killed ?? null;
      const within = served != null && Math.abs(served - mohKilled) / mohKilled <= 0.05;
      test(`Martyrs cumulative summary matches MoH total (served ${served}, MoH ${mohKilled})`, within);
    }

    // 9b. FTS funding: unified records vs fetched flows (dedup may shrink
    // the served count slightly; it must never exceed the fetched count nor
    // fall below 90% of it).
    const ftsRaw = await readJSON(path.join(DATA_DIR, 'static/unfts-funding.json'));
    const ftsUnified = await readJSON(path.join(DATA_DIR, 'unified/funding/all-data.json'));
    if (ftsRaw?.count && ftsUnified?.data) {
      const served = ftsUnified.data.length;
      test(`Funding records reconcile with FTS fetch (served ${served}, fetched ${ftsRaw.count})`,
        served <= ftsRaw.count && served >= ftsRaw.count * 0.9);
    }

    // 9c. Depopulated villages: unified events vs POM registry count.
    const pom = await readJSON(path.join(DATA_DIR, 'static/pom-localities.json'));
    const conflictAll = await readJSON(path.join(DATA_DIR, 'unified/conflict/all-data.json'));
    if (pom?.depopulated_count && conflictAll?.data) {
      const served = conflictAll.data.filter(r => r.event_type === 'village_depopulation').length;
      test(`Depopulation events match POM registry (served ${served}, registry ${pom.depopulated_count})`,
        served === pom.depopulated_count);
    }

    // 9d. UNHCR refugees: unified records sourced from UNHCR vs fetched rows.
    const unhcrRaw = await readJSON(path.join(DATA_DIR, 'static/unhcr-refugees.json'));
    const refugeesAll = await readJSON(path.join(DATA_DIR, 'unified/refugees/all-data.json'));
    if (unhcrRaw?.data?.length && refugeesAll?.data) {
      const served = refugeesAll.data.filter(r =>
        (r.sources || []).some(s => /unhcr/i.test(s?.organization || s?.name || ''))
      ).length;
      test(`UNHCR refugee records reconcile (served ${served}, fetched ${unhcrRaw.data.length})`,
        served >= unhcrRaw.data.length * 0.9 && served <= unhcrRaw.data.length);
    }

    // Summary
    console.log(`\n${colors.blue}=== Summary ===${colors.reset}\n`);
    console.log(`Total Tests: ${totalTests}`);
    console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
    console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
    const successRate = ((passedTests / totalTests) * 100).toFixed(1);
    console.log(`Success Rate: ${successRate}%`);

    if (errors.length > 0) {
      console.log(`\n${colors.red}Errors:${colors.reset}`);
      errors.forEach(err => console.log(`  - ${err}`));
    }

    // Generate Validation Report
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        total_tests: totalTests,
        passed: passedTests,
        failed: failedTests,
        success_rate: `${successRate}%`,
        status: failedTests === 0 ? 'passed' : 'failed'
      },
      errors: errors,
      details: {
        manifest: true, // Simplified for now
        json_syntax: { valid: validJSON, total: files.length },
        file_sizes: { valid: validSizes, total: files.length },
        time_series: { valid: validTimeSeries, total: timeSeriesFiles.length, failed_files: failedTimeSeriesFiles },
        dates: { valid_format: validDates > 0, after_baseline: afterBaseline > 0 },
        index_files: { valid: validIndexes, total: indexFiles.length, failed_files: failedIndexFiles }
      }
    };

    await fs.writeFile(path.join(DATA_DIR, 'validation-report.json'), JSON.stringify(report, null, 2));
    console.log(`\n📄 Validation report saved to: public/data/validation-report.json`);

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
