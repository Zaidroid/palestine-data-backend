#!/usr/bin/env node

/**
 * Test UNRWA Data Sources
 * 
 * Tests multiple potential sources for UNRWA data
 */

console.log('Testing UNRWA Data Sources...\n');

const sources = [
  {
    name: 'HDX - UNRWA Organization',
    url: 'https://data.humdata.org/api/3/action/package_search?fq=organization:unrwa&rows=10',
  },
  {
    name: 'HDX - UNRWA Keyword',
    url: 'https://data.humdata.org/api/3/action/package_search?q=UNRWA&rows=10',
  },
  {
    name: 'HDX - Palestine Refugees',
    url: 'https://data.humdata.org/api/3/action/package_search?q=palestine+refugees&rows=10',
  },
  {
    name: 'UN Data - UNRWA',
    url: 'https://data.un.org/ws/rest/data/UNRWA/ALL/ALL',
  },
  {
    name: 'OCHA - Palestine',
    url: 'https://data.humdata.org/api/3/action/package_search?q=OCHA+palestine&rows=10',
  },
];

async function testSource(source) {
  console.log(`Testing: ${source.name}`);
  console.log(`URL: ${source.url}`);
  
  try {
    const response = await fetch(source.url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      
      if (data.result?.results) {
        console.log(`✓ Found ${data.result.results.length} datasets`);
        
        // Show first 3 datasets
        data.result.results.slice(0, 3).forEach((ds, i) => {
          console.log(`  ${i + 1}. ${ds.title || ds.name}`);
          console.log(`     Org: ${ds.organization?.title || 'N/A'}`);
          console.log(`     Resources: ${ds.num_resources || 0}`);
        });
      } else if (data.result?.count !== undefined) {
        console.log(`✓ Found ${data.result.count} results`);
      } else {
        console.log(`✓ Response received (structure: ${Object.keys(data).join(', ')})`);
      }
    } else {
      console.log(`✗ Failed: ${response.status}`);
    }
  } catch (error) {
    console.log(`✗ Error: ${error.message}`);
  }
  
  console.log('');
}

async function main() {
  for (const source of sources) {
    await testSource(source);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }
  
  console.log('========================================');
  console.log('Testing Complete');
  console.log('========================================');
}

main().catch(console.error);
