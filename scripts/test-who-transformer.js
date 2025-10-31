#!/usr/bin/env node

/**
 * Test WHO Transformer
 * Tests the WHO transformer with real fetched data
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the test data
const testDataPath = path.join(__dirname, '../public/data/who-test/test-data.json');

async function testTransformer() {
  console.log('Testing WHO Transformer...\n');
  
  // Read the fetched data
  const rawData = JSON.parse(await fs.readFile(testDataPath, 'utf-8'));
  console.log(`Loaded ${rawData.indicators.length} indicators`);
  console.log(`Total records: ${rawData.total_records}\n`);
  
  // Import the transformer (using dynamic import for ES modules)
  const { whoTransformer } = await import('../src/lib/transformation/transformers/who-transformer.ts');
  
  // Create mock metadata
  const metadata = {
    id: 'who-test',
    name: 'WHO Test Data',
    category: 'health',
    source: 'WHO',
    organization: 'World Health Organization',
    description: 'Test WHO data',
    last_updated: new Date().toISOString(),
    update_frequency: 'monthly',
    record_count: 0,
    date_range: { start: '2000-01-01', end: '2024-01-01' },
    quality: {
      score: 1,
      completeness: 1,
      consistency: 1,
      accuracy: 1,
      verified: true,
      confidence: 1,
    },
    partitioned: false,
    fields: [],
    relationships: [],
  };
  
  // Test transformation for each indicator
  for (const indicator of rawData.indicators) {
    console.log(`\nTransforming: ${indicator.indicator_name}`);
    console.log(`Raw records: ${indicator.record_count}`);
    
    try {
      // Update metadata with indicator-specific info
      const indicatorMetadata = {
        ...metadata,
        name: indicator.indicator_name,
        id: indicator.indicator_code,
      };
      
      const transformed = whoTransformer.transform(indicator, indicatorMetadata);
      console.log(`✓ Transformed records: ${transformed.length}`);
      
      if (transformed.length > 0) {
        const sample = transformed[0];
        console.log(`  Sample record:`);
        console.log(`    - ID: ${sample.id}`);
        console.log(`    - Type: ${sample.type}`);
        console.log(`    - Health Type: ${sample.health_type}`);
        console.log(`    - Date: ${sample.date}`);
        console.log(`    - Value: ${sample.value}`);
        console.log(`    - Unit: ${sample.unit}`);
        console.log(`    - Location: ${sample.location.name}`);
        console.log(`    - Quality Score: ${sample.quality.score.toFixed(2)}`);
        
        if (sample.staff) {
          console.log(`    - Staff: ${JSON.stringify(sample.staff)}`);
        }
        if (sample.disease_data) {
          console.log(`    - Disease: ${sample.disease_data.disease}`);
        }
        if (sample.demographics) {
          console.log(`    - Demographics: ${JSON.stringify(sample.demographics)}`);
        }
      }
      
      // Validate all records have required fields
      const missingFields = transformed.filter(r => 
        !r.id || !r.type || !r.date || !r.value || !r.location
      );
      
      if (missingFields.length > 0) {
        console.log(`  ⚠ Warning: ${missingFields.length} records missing required fields`);
      } else {
        console.log(`  ✓ All records have required fields`);
      }
      
    } catch (error) {
      console.error(`✗ Transformation failed:`, error.message);
      console.error(error.stack);
    }
  }
  
  console.log('\n✓ Transformer test completed');
}

testTransformer().catch(console.error);
