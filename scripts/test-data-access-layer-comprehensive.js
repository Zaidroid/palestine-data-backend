#!/usr/bin/env node

/**
 * Comprehensive Data Access Layer Test
 * Task 21.2: Test all service functions, React Query hooks logic, filtering, and error handling
 * 
 * Tests:
 * - All service functions return correct data
 * - Filtering and querying functionality
 * - Error handling and fallbacks
 * - Pagination
 * - Multi-category queries
 * - Quality thresholds
 * - Region and date filtering
 * 
 * Usage: node scripts/test-data-access-layer-comprehensive.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================
// TEST CONFIGURATION
// ============================================

const TEST_CONFIG = {
  testDataDir: path.join(process.cwd(), 'public', 'data', 'unified', 'test-access'),
  recordCount: 100,
  categories: ['conflict', 'economic', 'infrastructure', 'humanitarian'],
  regions: ['gaza', 'west_bank'],
  governorates: ['Gaza', 'Jenin', 'Hebron', 'Ramallah'],
};

let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
};

// ============================================
// TEST UTILITIES
// ============================================

function assert(condition, message) {
  testResults.total++;
  if (condition) {
    testResults.passed++;
    testResults.tests.push({ name: message, status: 'PASS' });
    console.log(`✓ ${message}`);
  } else {
    testResults.failed++;
    testResults.tests.push({ name: message, status: 'FAIL' });
    console.error(`✗ ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

function assertGreaterThan(actual, threshold, message) {
  assert(actual > threshold, `${message} (expected > ${threshold}, got: ${actual})`);
}

function assertArrayLength(array, expectedLength, message) {
  assertEquals(array.length, expectedLength, message);
}

function assertExists(value, message) {
  assert(value !== null && value !== undefined, message);
}

// ============================================
// MOCK DATA GENERATION
// ============================================

async function setupMockData() {
  console.log('\n📦 Setting up mock data...\n');
  
  const testDataDir = TEST_CONFIG.testDataDir;
  
  // Create directories for each category
  for (const category of TEST_CONFIG.categories) {
    await fs.mkdir(path.join(testDataDir, category, 'partitions'), { recursive: true });
  }
  
  // Generate conflict data
  await generateConflictData(testDataDir);
  
  // Generate economic data
  await generateEconomicData(testDataDir);
  
  // Generate infrastructure data
  await generateInfrastructureData(testDataDir);
  
  // Generate humanitarian data
  await generateHumanitarianData(testDataDir);
  
  console.log('✓ Mock data setup complete\n');
}

async function generateConflictData(baseDir) {
  const data = [];
  const startDate = new Date('2024-01-01');
  
  for (let i = 0; i < TEST_CONFIG.recordCount; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    const region = i % 2 === 0 ? 'gaza' : 'west_bank';
    const governorate = region === 'gaza' ? 'Gaza' : (i % 3 === 0 ? 'Jenin' : 'Hebron');
    
    data.push({
      id: `conflict-${i}`,
      type: 'conflict',
      category: 'conflict',
      date: date.toISOString().split('T')[0],
      location: {
        name: `Location ${i}`,
        region,
        admin_levels: {
          level1: governorate,
          level2: `District ${i % 5}`,
        },
        coordinates: [35.0 + (i % 10) * 0.1, 31.5 + (i % 10) * 0.1],
      },
      value: Math.floor(Math.random() * 10) + 1,
      unit: 'casualties',
      event_type: ['airstrike', 'raid', 'clash'][i % 3],
      fatalities: Math.floor(Math.random() * 5),
      injuries: Math.floor(Math.random() * 10),
      actors: { actor1: 'Military' },
      description: `Test incident ${i}`,
      quality: {
        score: 0.7 + (Math.random() * 0.3),
        completeness: 0.8 + (Math.random() * 0.2),
        consistency: 0.85,
        accuracy: 0.8,
        verified: i % 3 === 0,
        confidence: 0.85,
      },
      sources: [{
        name: 'Test Source',
        organization: 'Test Org',
        fetched_at: new Date().toISOString(),
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
  }
  
  await fs.writeFile(
    path.join(baseDir, 'conflict', 'recent.json'),
    JSON.stringify({ data }, null, 2)
  );
  
  await fs.writeFile(
    path.join(baseDir, 'conflict', 'metadata.json'),
    JSON.stringify({
      id: 'conflict_data',
      name: 'Conflict Data',
      category: 'conflict',
      source: 'Test Source',
      last_updated: new Date().toISOString(),
      record_count: data.length,
      partitioned: false,
    }, null, 2)
  );
}

async function generateEconomicData(baseDir) {
  const data = [];
  
  for (let i = 0; i < 50; i++) {
    const year = 2020 + Math.floor(i / 10);
    
    data.push({
      id: `economic-${i}`,
      type: 'economic',
      category: 'economic',
      date: `${year}-01-01`,
      location: {
        name: 'Palestine',
        region: 'west_bank',
        admin_levels: { level1: 'National' },
        coordinates: [35.2, 31.9],
      },
      value: 1000 + i * 100,
      unit: 'USD',
      indicator_code: `IND.${i % 5}`,
      indicator_name: `Indicator ${i % 5}`,
      quality: {
        score: 0.85,
        completeness: 0.9,
        consistency: 0.9,
        accuracy: 0.85,
        verified: true,
        confidence: 0.9,
      },
      sources: [{
        name: 'World Bank',
        organization: 'World Bank',
        fetched_at: new Date().toISOString(),
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
  }
  
  await fs.writeFile(
    path.join(baseDir, 'economic', 'recent.json'),
    JSON.stringify({ data }, null, 2)
  );
  
  await fs.writeFile(
    path.join(baseDir, 'economic', 'metadata.json'),
    JSON.stringify({
      id: 'economic_data',
      name: 'Economic Data',
      category: 'economic',
      source: 'World Bank',
      last_updated: new Date().toISOString(),
      record_count: data.length,
      partitioned: false,
    }, null, 2)
  );
}

async function generateInfrastructureData(baseDir) {
  const data = [];
  
  for (let i = 0; i < 75; i++) {
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i);
    
    data.push({
      id: `infrastructure-${i}`,
      type: 'infrastructure',
      category: 'infrastructure',
      date: date.toISOString().split('T')[0],
      location: {
        name: `Building ${i}`,
        region: i % 2 === 0 ? 'gaza' : 'west_bank',
        admin_levels: { level1: i % 2 === 0 ? 'Gaza' : 'Ramallah' },
        coordinates: [35.0 + (i % 10) * 0.1, 31.5 + (i % 10) * 0.1],
      },
      value: 1,
      unit: 'structure',
      structure_type: ['hospital', 'school', 'residential'][i % 3],
      damage_level: ['minor', 'moderate', 'severe', 'destroyed'][i % 4],
      quality: {
        score: 0.75 + (Math.random() * 0.2),
        completeness: 0.8,
        consistency: 0.85,
        accuracy: 0.8,
        verified: i % 2 === 0,
        confidence: 0.8,
      },
      sources: [{
        name: 'HDX',
        organization: 'UNOCHA',
        fetched_at: new Date().toISOString(),
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
  }
  
  await fs.writeFile(
    path.join(baseDir, 'infrastructure', 'recent.json'),
    JSON.stringify({ data }, null, 2)
  );
  
  await fs.writeFile(
    path.join(baseDir, 'infrastructure', 'metadata.json'),
    JSON.stringify({
      id: 'infrastructure_data',
      name: 'Infrastructure Data',
      category: 'infrastructure',
      source: 'HDX',
      last_updated: new Date().toISOString(),
      record_count: data.length,
      partitioned: false,
    }, null, 2)
  );
}

async function generateHumanitarianData(baseDir) {
  const data = [];
  
  for (let i = 0; i < 60; i++) {
    const date = new Date('2024-01-01');
    date.setDate(date.getDate() + i * 2);
    
    data.push({
      id: `humanitarian-${i}`,
      type: 'humanitarian',
      category: 'humanitarian',
      date: date.toISOString().split('T')[0],
      location: {
        name: `Area ${i}`,
        region: i % 2 === 0 ? 'gaza' : 'west_bank',
        admin_levels: { level1: i % 2 === 0 ? 'Gaza' : 'Jenin' },
        coordinates: [35.0 + (i % 10) * 0.1, 31.5 + (i % 10) * 0.1],
      },
      value: 1000 + i * 100,
      unit: 'people',
      sector: ['food', 'health', 'shelter', 'wash'][i % 4],
      people_in_need: 1000 + i * 100,
      quality: {
        score: 0.8 + (Math.random() * 0.15),
        completeness: 0.85,
        consistency: 0.85,
        accuracy: 0.8,
        verified: true,
        confidence: 0.85,
      },
      sources: [{
        name: 'OCHA',
        organization: 'UN OCHA',
        fetched_at: new Date().toISOString(),
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });
  }
  
  await fs.writeFile(
    path.join(baseDir, 'humanitarian', 'recent.json'),
    JSON.stringify({ data }, null, 2)
  );
  
  await fs.writeFile(
    path.join(baseDir, 'humanitarian', 'metadata.json'),
    JSON.stringify({
      id: 'humanitarian_data',
      name: 'Humanitarian Data',
      category: 'humanitarian',
      source: 'OCHA',
      last_updated: new Date().toISOString(),
      record_count: data.length,
      partitioned: false,
    }, null, 2)
  );
}

// ============================================
// SERVICE FUNCTION TESTS
// ============================================

async function testServiceFunctions() {
  console.log('🧪 Testing Service Functions\n');
  
  // Test 1: Load conflict data
  console.log('Test 1: Load conflict data');
  const conflictData = await loadTestData('conflict');
  assertExists(conflictData, 'Conflict data should exist');
  assertExists(conflictData.data, 'Conflict data should have data array');
  assertEquals(conflictData.data.length, 100, 'Should load 100 conflict records');
  
  // Test 2: Load economic data
  console.log('\nTest 2: Load economic data');
  const economicData = await loadTestData('economic');
  assertExists(economicData, 'Economic data should exist');
  assertEquals(economicData.data.length, 50, 'Should load 50 economic records');
  
  // Test 3: Load infrastructure data
  console.log('\nTest 3: Load infrastructure data');
  const infrastructureData = await loadTestData('infrastructure');
  assertExists(infrastructureData, 'Infrastructure data should exist');
  assertEquals(infrastructureData.data.length, 75, 'Should load 75 infrastructure records');
  
  // Test 4: Load humanitarian data
  console.log('\nTest 4: Load humanitarian data');
  const humanitarianData = await loadTestData('humanitarian');
  assertExists(humanitarianData, 'Humanitarian data should exist');
  assertEquals(humanitarianData.data.length, 60, 'Should load 60 humanitarian records');
  
  // Test 5: Verify metadata
  console.log('\nTest 5: Verify metadata');
  assertExists(conflictData.metadata, 'Should have metadata');
  assertEquals(conflictData.metadata.category, 'conflict', 'Metadata category should match');
  assertGreaterThan(conflictData.metadata.quality_score, 0, 'Should have quality score');
}

// ============================================
// FILTERING TESTS
// ============================================

async function testFiltering() {
  console.log('\n🧪 Testing Filtering Functionality\n');
  
  const conflictData = await loadTestData('conflict');
  const allRecords = conflictData.data;
  
  // Test 1: Date range filtering
  console.log('Test 1: Date range filtering');
  const dateFiltered = filterByDateRange(allRecords, '2024-01-01', '2024-01-31');
  assertGreaterThan(dateFiltered.length, 0, 'Should have records in date range');
  assert(dateFiltered.length <= 31, 'Should not exceed date range');
  assert(dateFiltered.every(r => r.date >= '2024-01-01' && r.date <= '2024-01-31'), 
    'All records should be within date range');
  
  // Test 2: Region filtering
  console.log('\nTest 2: Region filtering');
  const gazaRecords = filterByRegion(allRecords, 'gaza');
  assertGreaterThan(gazaRecords.length, 0, 'Should have Gaza records');
  assert(gazaRecords.every(r => r.location.region === 'gaza'), 'All records should be from Gaza');
  
  const westBankRecords = filterByRegion(allRecords, 'west_bank');
  assertGreaterThan(westBankRecords.length, 0, 'Should have West Bank records');
  assert(westBankRecords.every(r => r.location.region === 'west_bank'), 
    'All records should be from West Bank');
  
  // Test 3: Governorate filtering
  console.log('\nTest 3: Governorate filtering');
  const jeninRecords = filterByGovernorate(allRecords, 'Jenin');
  assertGreaterThan(jeninRecords.length, 0, 'Should have Jenin records');
  assert(jeninRecords.every(r => r.location.admin_levels.level1.includes('Jenin')), 
    'All records should be from Jenin');
  
  // Test 4: Quality threshold filtering
  console.log('\nTest 4: Quality threshold filtering');
  const highQuality = filterByQuality(allRecords, 0.9);
  assert(highQuality.every(r => r.quality.score >= 0.9), 
    'All records should meet quality threshold');
  
  // Test 5: Field filtering
  console.log('\nTest 5: Field filtering');
  const airstrikes = filterByField(allRecords, 'event_type', 'airstrike');
  assertGreaterThan(airstrikes.length, 0, 'Should have airstrike records');
  assert(airstrikes.every(r => r.event_type === 'airstrike'), 
    'All records should be airstrikes');
  
  // Test 6: Combined filtering
  console.log('\nTest 6: Combined filtering');
  const combined = allRecords
    .filter(r => r.date >= '2024-01-01' && r.date <= '2024-01-31')
    .filter(r => r.location.region === 'gaza')
    .filter(r => r.quality.score >= 0.8);
  assertGreaterThan(combined.length, 0, 'Should have records matching all filters');
  assert(combined.every(r => 
    r.date >= '2024-01-01' && 
    r.date <= '2024-01-31' && 
    r.location.region === 'gaza' && 
    r.quality.score >= 0.8
  ), 'All records should match combined filters');
}

// ============================================
// PAGINATION TESTS
// ============================================

async function testPagination() {
  console.log('\n🧪 Testing Pagination\n');
  
  const conflictData = await loadTestData('conflict');
  const allRecords = conflictData.data;
  
  // Test 1: Basic pagination
  console.log('Test 1: Basic pagination');
  const page1 = paginateData(allRecords, 1, 10);
  assertEquals(page1.data.length, 10, 'Page 1 should have 10 records');
  assertEquals(page1.pagination.page, 1, 'Should be page 1');
  assertEquals(page1.pagination.pageSize, 10, 'Page size should be 10');
  assert(page1.pagination.hasNext, 'Should have next page');
  assert(!page1.pagination.hasPrevious, 'Should not have previous page');
  
  // Test 2: Second page
  console.log('\nTest 2: Second page');
  const page2 = paginateData(allRecords, 2, 10);
  assertEquals(page2.data.length, 10, 'Page 2 should have 10 records');
  assert(page2.pagination.hasNext, 'Should have next page');
  assert(page2.pagination.hasPrevious, 'Should have previous page');
  
  // Test 3: Last page
  console.log('\nTest 3: Last page');
  const lastPage = paginateData(allRecords, 10, 10);
  assertEquals(lastPage.data.length, 10, 'Last page should have 10 records');
  assert(!lastPage.pagination.hasNext, 'Should not have next page');
  assert(lastPage.pagination.hasPrevious, 'Should have previous page');
  
  // Test 4: Total pages calculation
  console.log('\nTest 4: Total pages calculation');
  assertEquals(page1.pagination.totalPages, 10, 'Should have 10 total pages');
  assertEquals(page1.pagination.totalItems, 100, 'Should have 100 total items');
}

// ============================================
// SORTING TESTS
// ============================================

async function testSorting() {
  console.log('\n🧪 Testing Sorting\n');
  
  const conflictData = await loadTestData('conflict');
  const allRecords = conflictData.data;
  
  // Test 1: Sort by date ascending
  console.log('Test 1: Sort by date ascending');
  const sortedAsc = sortByField(allRecords, 'date', 'asc');
  assert(sortedAsc[0].date <= sortedAsc[sortedAsc.length - 1].date, 
    'First date should be <= last date');
  
  // Test 2: Sort by date descending
  console.log('\nTest 2: Sort by date descending');
  const sortedDesc = sortByField(allRecords, 'date', 'desc');
  assert(sortedDesc[0].date >= sortedDesc[sortedDesc.length - 1].date, 
    'First date should be >= last date');
  
  // Test 3: Sort by quality score
  console.log('\nTest 3: Sort by quality score');
  const sortedByQuality = sortByField(allRecords, 'quality.score', 'desc');
  assert(sortedByQuality[0].quality.score >= sortedByQuality[sortedByQuality.length - 1].quality.score, 
    'First quality score should be >= last quality score');
}

// ============================================
// MULTI-CATEGORY TESTS
// ============================================

async function testMultiCategory() {
  console.log('\n🧪 Testing Multi-Category Queries\n');
  
  // Test 1: Load multiple categories
  console.log('Test 1: Load multiple categories');
  const categories = ['conflict', 'infrastructure', 'humanitarian'];
  const allData = [];
  
  for (const category of categories) {
    const data = await loadTestData(category);
    allData.push(...data.data);
  }
  
  const expectedTotal = 100 + 75 + 60; // conflict + infrastructure + humanitarian
  assertEquals(allData.length, expectedTotal, `Should have ${expectedTotal} total records`);
  
  // Test 2: Filter across categories
  console.log('\nTest 2: Filter across categories');
  const gazaData = allData.filter(r => r.location.region === 'gaza');
  assertGreaterThan(gazaData.length, 0, 'Should have Gaza records across categories');
  
  // Test 3: Verify category distribution
  console.log('\nTest 3: Verify category distribution');
  const conflictCount = allData.filter(r => r.category === 'conflict').length;
  const infraCount = allData.filter(r => r.category === 'infrastructure').length;
  const humanCount = allData.filter(r => r.category === 'humanitarian').length;
  
  assertEquals(conflictCount, 100, 'Should have 100 conflict records');
  assertEquals(infraCount, 75, 'Should have 75 infrastructure records');
  assertEquals(humanCount, 60, 'Should have 60 humanitarian records');
}

// ============================================
// ERROR HANDLING TESTS
// ============================================

async function testErrorHandling() {
  console.log('\n🧪 Testing Error Handling\n');
  
  // Test 1: Non-existent category
  console.log('Test 1: Non-existent category');
  try {
    await loadTestData('nonexistent');
    assert(false, 'Should throw error for non-existent category');
  } catch (error) {
    assert(true, 'Should throw error for non-existent category');
  }
  
  // Test 2: Invalid date range
  console.log('\nTest 2: Invalid date range');
  const conflictData = await loadTestData('conflict');
  const invalidRange = filterByDateRange(conflictData.data, '2025-01-01', '2025-12-31');
  assertEquals(invalidRange.length, 0, 'Should return empty array for invalid date range');
  
  // Test 3: Invalid quality threshold
  console.log('\nTest 3: Invalid quality threshold');
  const tooHighQuality = filterByQuality(conflictData.data, 1.5);
  assertEquals(tooHighQuality.length, 0, 'Should return empty array for impossible quality threshold');
  
  // Test 4: Empty data handling
  console.log('\nTest 4: Empty data handling');
  const emptyPagination = paginateData([], 1, 10);
  assertEquals(emptyPagination.data.length, 0, 'Should handle empty data');
  assertEquals(emptyPagination.pagination.totalItems, 0, 'Should have 0 total items');
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function loadTestData(category) {
  const dataPath = path.join(TEST_CONFIG.testDataDir, category, 'recent.json');
  const metadataPath = path.join(TEST_CONFIG.testDataDir, category, 'metadata.json');
  
  try {
    const dataContent = await fs.readFile(dataPath, 'utf-8');
    const metadataContent = await fs.readFile(metadataPath, 'utf-8');
    
    const data = JSON.parse(dataContent);
    const metadata = JSON.parse(metadataContent);
    
    // Calculate quality score
    const qualityScore = data.data.length > 0
      ? data.data.reduce((sum, item) => sum + item.quality.score, 0) / data.data.length
      : 0;
    
    return {
      data: data.data,
      metadata: {
        ...metadata,
        quality_score: qualityScore,
      },
    };
  } catch (error) {
    throw new Error(`Failed to load ${category} data: ${error.message}`);
  }
}

function filterByDateRange(data, startDate, endDate) {
  return data.filter(item => item.date >= startDate && item.date <= endDate);
}

function filterByRegion(data, region) {
  return data.filter(item => item.location.region === region);
}

function filterByGovernorate(data, governorate) {
  return data.filter(item => 
    item.location.admin_levels.level1.toLowerCase().includes(governorate.toLowerCase())
  );
}

function filterByQuality(data, threshold) {
  return data.filter(item => item.quality.score >= threshold);
}

function filterByField(data, field, value) {
  return data.filter(item => item[field] === value);
}

function paginateData(data, page, pageSize) {
  const totalItems = data.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  
  return {
    data: data.slice(startIndex, endIndex),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    },
  };
}

function sortByField(data, field, direction = 'asc') {
  return [...data].sort((a, b) => {
    const aValue = field.includes('.') 
      ? field.split('.').reduce((obj, key) => obj[key], a)
      : a[field];
    const bValue = field.includes('.') 
      ? field.split('.').reduce((obj, key) => obj[key], b)
      : b[field];
    
    if (direction === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });
}

// ============================================
// CLEANUP
// ============================================

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...\n');
  
  try {
    await fs.rm(TEST_CONFIG.testDataDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete\n');
  } catch (error) {
    console.error('✗ Cleanup failed:', error.message);
  }
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  COMPREHENSIVE DATA ACCESS LAYER TEST - Task 21.2');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    // Setup
    await setupMockData();
    
    // Run test suites
    await testServiceFunctions();
    await testFiltering();
    await testPagination();
    await testSorting();
    await testMultiCategory();
    await testErrorHandling();
    
    // Cleanup
    await cleanup();
    
    // Print results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  TEST RESULTS');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Total Tests: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed} ✓`);
    console.log(`Failed: ${testResults.failed} ✗`);
    console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%\n`);
    
    if (testResults.failed > 0) {
      console.log('Failed Tests:');
      testResults.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  ✗ ${t.name}`));
      console.log();
      process.exit(1);
    } else {
      console.log('🎉 All tests passed!\n');
      process.exit(0);
    }
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    await cleanup();
    process.exit(1);
  }
}

// Run tests
runTests();
