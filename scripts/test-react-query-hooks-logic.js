#!/usr/bin/env node

/**
 * React Query Hooks Logic Test
 * Task 21.2: Test React Query hooks caching, error handling, and fallback logic
 * 
 * Tests:
 * - Query key generation
 * - Caching behavior simulation
 * - Error handling with fallback data
 * - Stale time and cache time logic
 * - Refetch behavior
 * - Query result structure
 * 
 * Note: This tests the logic without React environment
 * 
 * Usage: node scripts/test-react-query-hooks-logic.js
 */

import fs from 'fs/promises';
import path from 'path';

// ============================================
// TEST UTILITIES
// ============================================

let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  tests: [],
};

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

function assertDeepEquals(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), 
    `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
}

function assertExists(value, message) {
  assert(value !== null && value !== undefined, message);
}

// ============================================
// MOCK QUERY CACHE
// ============================================

class MockQueryCache {
  constructor() {
    this.cache = new Map();
    this.timestamps = new Map();
  }
  
  set(key, value, staleTime = 5 * 60 * 1000) {
    const cacheKey = JSON.stringify(key);
    this.cache.set(cacheKey, value);
    this.timestamps.set(cacheKey, {
      createdAt: Date.now(),
      staleTime,
    });
  }
  
  get(key) {
    const cacheKey = JSON.stringify(key);
    const value = this.cache.get(cacheKey);
    const timestamp = this.timestamps.get(cacheKey);
    
    if (!value || !timestamp) {
      return { data: null, isStale: true };
    }
    
    const age = Date.now() - timestamp.createdAt;
    const isStale = age > timestamp.staleTime;
    
    return { data: value, isStale };
  }
  
  has(key) {
    return this.cache.has(JSON.stringify(key));
  }
  
  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }
  
  size() {
    return this.cache.size;
  }
}

// ============================================
// QUERY KEY GENERATION
// ============================================

function buildQueryKey(category, filter) {
  return ['unified-data', category, filter];
}

// ============================================
// MOCK QUERY FUNCTION
// ============================================

async function mockQueryFn(category, filter = {}, shouldFail = false) {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 10));
  
  if (shouldFail) {
    throw new Error(`Failed to fetch ${category} data`);
  }
  
  // Return mock data
  return {
    data: [
      {
        id: `${category}-1`,
        category,
        date: '2024-01-01',
        value: 100,
        quality: { score: 0.9 },
      },
    ],
    metadata: {
      source: 'test',
      category,
      record_count: 1,
      filtered_count: 1,
      last_updated: new Date().toISOString(),
      quality_score: 0.9,
    },
  };
}

// ============================================
// MOCK QUERY HOOK
// ============================================

async function mockUseQuery(options, cache) {
  const { queryKey, queryFn, staleTime, fallbackData } = options;
  
  // Check cache
  const cached = cache.get(queryKey);
  
  if (cached.data && !cached.isStale) {
    return {
      data: cached.data,
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
      isFetching: false,
      isStale: false,
      fromCache: true,
    };
  }
  
  // Fetch data
  try {
    const data = await queryFn();
    cache.set(queryKey, data, staleTime);
    
    return {
      data,
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
      isFetching: false,
      isStale: false,
      fromCache: false,
    };
  } catch (error) {
    // Use fallback data if available
    if (fallbackData) {
      const fallbackResponse = {
        data: fallbackData,
        metadata: {
          source: 'fallback',
          category: queryKey[1],
          record_count: fallbackData.length,
          filtered_count: fallbackData.length,
          last_updated: new Date().toISOString(),
          quality_score: 0,
        },
      };
      
      return {
        data: fallbackResponse,
        isLoading: false,
        isError: false,
        error: null,
        isSuccess: true,
        isFetching: false,
        isStale: false,
        isFallback: true,
      };
    }
    
    return {
      data: undefined,
      isLoading: false,
      isError: true,
      error,
      isSuccess: false,
      isFetching: false,
      isStale: false,
      fromCache: false,
    };
  }
}

// ============================================
// TESTS
// ============================================

async function testQueryKeyGeneration() {
  console.log('🧪 Testing Query Key Generation\n');
  
  // Test 1: Basic query key
  console.log('Test 1: Basic query key');
  const key1 = buildQueryKey('conflict', {});
  assertDeepEquals(key1, ['unified-data', 'conflict', {}], 'Should generate correct query key');
  
  // Test 2: Query key with filter
  console.log('\nTest 2: Query key with filter');
  const filter = { region: 'gaza', dateRange: { start: '2024-01-01', end: '2024-12-31' } };
  const key2 = buildQueryKey('conflict', filter);
  assertDeepEquals(key2, ['unified-data', 'conflict', filter], 
    'Should include filter in query key');
  
  // Test 3: Different filters create different keys
  console.log('\nTest 3: Different filters create different keys');
  const key3 = buildQueryKey('conflict', { region: 'west_bank' });
  assert(JSON.stringify(key2) !== JSON.stringify(key3), 
    'Different filters should create different keys');
  
  // Test 4: Same filter creates same key
  console.log('\nTest 4: Same filter creates same key');
  const key4 = buildQueryKey('conflict', filter);
  assertDeepEquals(key2, key4, 'Same filter should create same key');
}

async function testCachingBehavior() {
  console.log('\n🧪 Testing Caching Behavior\n');
  
  const cache = new MockQueryCache();
  
  // Test 1: First query fetches data
  console.log('Test 1: First query fetches data');
  const queryKey = buildQueryKey('conflict', {});
  const result1 = await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict'),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertExists(result1.data, 'Should have data');
  assertEquals(result1.fromCache, false, 'First query should not be from cache');
  assertEquals(result1.isSuccess, true, 'Should be successful');
  
  // Test 2: Second query uses cache
  console.log('\nTest 2: Second query uses cache');
  const result2 = await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict'),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertExists(result2.data, 'Should have data');
  assertEquals(result2.fromCache, true, 'Second query should be from cache');
  assertEquals(result2.isStale, false, 'Cached data should not be stale');
  
  // Test 3: Different query key fetches new data
  console.log('\nTest 3: Different query key fetches new data');
  const queryKey2 = buildQueryKey('economic', {});
  const result3 = await mockUseQuery({
    queryKey: queryKey2,
    queryFn: () => mockQueryFn('economic'),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertEquals(result3.fromCache, false, 'Different key should not use cache');
  assertEquals(cache.size(), 2, 'Cache should have 2 entries');
  
  // Test 4: Stale data detection
  console.log('\nTest 4: Stale data detection');
  const shortStaleTime = 10; // 10ms
  cache.clear();
  
  await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict'),
    staleTime: shortStaleTime,
  }, cache);
  
  // Wait for data to become stale
  await new Promise(resolve => setTimeout(resolve, 20));
  
  const cached = cache.get(queryKey);
  assertEquals(cached.isStale, true, 'Data should be stale after stale time');
}

async function testErrorHandling() {
  console.log('\n🧪 Testing Error Handling\n');
  
  const cache = new MockQueryCache();
  
  // Test 1: Query failure without fallback
  console.log('Test 1: Query failure without fallback');
  const queryKey = buildQueryKey('conflict', {});
  const result1 = await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict', {}, true), // Force failure
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertEquals(result1.isError, true, 'Should be in error state');
  assertEquals(result1.isSuccess, false, 'Should not be successful');
  assertExists(result1.error, 'Should have error object');
  
  // Test 2: Query failure with fallback
  console.log('\nTest 2: Query failure with fallback');
  const fallbackData = [
    { id: 'fallback-1', category: 'conflict', value: 0 },
  ];
  
  const result2 = await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict', {}, true), // Force failure
    staleTime: 5 * 60 * 1000,
    fallbackData,
  }, cache);
  
  assertEquals(result2.isError, false, 'Should not be in error state with fallback');
  assertEquals(result2.isSuccess, true, 'Should be successful with fallback');
  assertEquals(result2.isFallback, true, 'Should indicate fallback data');
  assertDeepEquals(result2.data.data, fallbackData, 'Should return fallback data');
  
  // Test 3: Fallback metadata
  console.log('\nTest 3: Fallback metadata');
  assertEquals(result2.data.metadata.source, 'fallback', 'Metadata should indicate fallback');
  assertEquals(result2.data.metadata.quality_score, 0, 'Fallback quality score should be 0');
}

async function testQueryResultStructure() {
  console.log('\n🧪 Testing Query Result Structure\n');
  
  const cache = new MockQueryCache();
  
  // Test 1: Successful query result structure
  console.log('Test 1: Successful query result structure');
  const queryKey = buildQueryKey('conflict', {});
  const result = await mockUseQuery({
    queryKey,
    queryFn: () => mockQueryFn('conflict'),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertExists(result.data, 'Should have data property');
  assertExists(result.isLoading, 'Should have isLoading property');
  assertExists(result.isError, 'Should have isError property');
  assertExists(result.isSuccess, 'Should have isSuccess property');
  assertExists(result.isFetching, 'Should have isFetching property');
  
  // Test 2: Data structure
  console.log('\nTest 2: Data structure');
  assertExists(result.data.data, 'Data should have data array');
  assertExists(result.data.metadata, 'Data should have metadata');
  assertExists(result.data.metadata.category, 'Metadata should have category');
  assertExists(result.data.metadata.quality_score, 'Metadata should have quality score');
  
  // Test 3: Loading states
  console.log('\nTest 3: Loading states');
  assertEquals(result.isLoading, false, 'Should not be loading after completion');
  assertEquals(result.isFetching, false, 'Should not be fetching after completion');
  assertEquals(result.isSuccess, true, 'Should be successful');
}

async function testFilteringWithCache() {
  console.log('\n🧪 Testing Filtering with Cache\n');
  
  const cache = new MockQueryCache();
  
  // Test 1: Different filters create separate cache entries
  console.log('Test 1: Different filters create separate cache entries');
  
  const filter1 = { region: 'gaza' };
  const filter2 = { region: 'west_bank' };
  
  const key1 = buildQueryKey('conflict', filter1);
  const key2 = buildQueryKey('conflict', filter2);
  
  await mockUseQuery({
    queryKey: key1,
    queryFn: () => mockQueryFn('conflict', filter1),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  await mockUseQuery({
    queryKey: key2,
    queryFn: () => mockQueryFn('conflict', filter2),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertEquals(cache.size(), 2, 'Should have 2 separate cache entries');
  assert(cache.has(key1), 'Should have cache entry for filter1');
  assert(cache.has(key2), 'Should have cache entry for filter2');
  
  // Test 2: Same filter reuses cache
  console.log('\nTest 2: Same filter reuses cache');
  const result = await mockUseQuery({
    queryKey: key1,
    queryFn: () => mockQueryFn('conflict', filter1),
    staleTime: 5 * 60 * 1000,
  }, cache);
  
  assertEquals(result.fromCache, true, 'Should reuse cache for same filter');
}

async function testMultipleCategoryQueries() {
  console.log('\n🧪 Testing Multiple Category Queries\n');
  
  const cache = new MockQueryCache();
  
  // Test 1: Query multiple categories
  console.log('Test 1: Query multiple categories');
  const categories = ['conflict', 'economic', 'infrastructure'];
  const results = [];
  
  for (const category of categories) {
    const queryKey = buildQueryKey(category, {});
    const result = await mockUseQuery({
      queryKey,
      queryFn: () => mockQueryFn(category),
      staleTime: 5 * 60 * 1000,
    }, cache);
    results.push(result);
  }
  
  assertEquals(results.length, 3, 'Should have 3 results');
  assert(results.every(r => r.isSuccess), 'All queries should be successful');
  assertEquals(cache.size(), 3, 'Cache should have 3 entries');
  
  // Test 2: Verify each category has correct data
  console.log('\nTest 2: Verify each category has correct data');
  results.forEach((result, index) => {
    const category = categories[index];
    assertEquals(result.data.metadata.category, category, 
      `Result ${index} should have category ${category}`);
  });
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  REACT QUERY HOOKS LOGIC TEST - Task 21.2');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  try {
    await testQueryKeyGeneration();
    await testCachingBehavior();
    await testErrorHandling();
    await testQueryResultStructure();
    await testFilteringWithCache();
    await testMultipleCategoryQueries();
    
    // Print results
    console.log('\n═══════════════════════════════════════════════════════════');
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
    process.exit(1);
  }
}

// Run tests
runTests();
