#!/usr/bin/env node

/**
 * Check specific UNRWA datasets for downloadable resources
 */

const datasets = [
  'gaza-supplies-and-dispatch-tracking',
  'data-on-displaced-persons-in-unrwa-shelters',
  'lebanon-public-schools-and-unrwa-schools-for-palestine-refugees',
];

async function checkDataset(datasetId) {
  console.log(`\nChecking: ${datasetId}`);
  console.log('='.repeat(60));
  
  try {
    const url = `https://data.humdata.org/api/3/action/package_show?id=${datasetId}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`✗ Failed to fetch: ${response.status}`);
      return;
    }
    
    const data = await response.json();
    const dataset = data.result;
    
    console.log(`Title: ${dataset.title}`);
    console.log(`Organization: ${dataset.organization?.title}`);
    console.log(`Last Modified: ${dataset.metadata_modified}`);
    console.log(`Resources: ${dataset.resources?.length || 0}`);
    
    if (dataset.resources && dataset.resources.length > 0) {
      console.log('\nResources:');
      for (const resource of dataset.resources) {
        console.log(`\n  ${resource.name}`);
        console.log(`  Format: ${resource.format}`);
        console.log(`  Size: ${resource.size ? (resource.size / 1024).toFixed(2) + ' KB' : 'Unknown'}`);
        console.log(`  URL: ${resource.url}`);
        
        // Test if URL is accessible
        try {
          const testResponse = await fetch(resource.url, { method: 'HEAD' });
          console.log(`  Status: ${testResponse.status} ${testResponse.statusText}`);
          
          if (testResponse.ok) {
            console.log(`  ✓ Downloadable`);
          } else {
            console.log(`  ✗ Not accessible`);
          }
        } catch (error) {
          console.log(`  ✗ Error: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.log(`✗ Error: ${error.message}`);
  }
}

async function main() {
  console.log('Checking UNRWA Datasets for Downloadable Resources\n');
  
  for (const datasetId of datasets) {
    await checkDataset(datasetId);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Check Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
