#!/usr/bin/env node

/**
 * Test WHO Data Fetcher
 * Simple test to verify WHO API connectivity
 */

const WHO_API_BASE = 'https://ghoapi.azureedge.net/api';
const COUNTRY_CODE = 'PSE';

async function testWHOAPI() {
  console.log('Testing WHO API connectivity...\n');
  
  // Test 1: Fetch life expectancy data
  console.log('Test 1: Fetching life expectancy data...');
  try {
    const url = `${WHO_API_BASE}/WHOSIS_000001?$filter=SpatialDim eq '${COUNTRY_CODE}'`;
    console.log(`URL: ${url}`);
    
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Records received: ${data?.value?.length || 0}`);
    
    if (data?.value && data.value.length > 0) {
      console.log('Sample record:', JSON.stringify(data.value[0], null, 2));
    }
    
    console.log('✓ Test 1 passed\n');
  } catch (error) {
    console.error('✗ Test 1 failed:', error.message);
    console.error('Full error:', error);
  }
  
  // Test 2: Fetch infant mortality data
  console.log('Test 2: Fetching infant mortality data...');
  try {
    const url = `${WHO_API_BASE}/MDG_0000000001?$filter=SpatialDim eq '${COUNTRY_CODE}'`;
    console.log(`URL: ${url}`);
    
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Records received: ${data?.value?.length || 0}`);
    
    console.log('✓ Test 2 passed\n');
  } catch (error) {
    console.error('✗ Test 2 failed:', error.message);
  }
  
  // Test 3: Test without country filter to see all available data
  console.log('Test 3: Fetching indicator metadata (no filter)...');
  try {
    const url = `${WHO_API_BASE}/WHOSIS_000001`;
    console.log(`URL: ${url}`);
    
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Total records: ${data?.value?.length || 0}`);
    
    // Check if Palestine data exists
    if (data?.value) {
      const palestineRecords = data.value.filter(r => r.SpatialDim === 'PSE');
      console.log(`Palestine records: ${palestineRecords.length}`);
      
      if (palestineRecords.length > 0) {
        console.log('Sample Palestine record:', JSON.stringify(palestineRecords[0], null, 2));
      }
    }
    
    console.log('✓ Test 3 passed\n');
  } catch (error) {
    console.error('✗ Test 3 failed:', error.message);
  }
  
  console.log('WHO API test completed');
}

testWHOAPI().catch(console.error);
