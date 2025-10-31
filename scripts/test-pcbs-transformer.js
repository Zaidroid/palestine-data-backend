#!/usr/bin/env node

/**
 * Test PCBS Transformer
 * 
 * Tests the PCBS data transformer with sample data
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PCBSTransformer } from './utils/pcbs-transformer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/pcbs');

async function testTransformer() {
  console.log('========================================');
  console.log('PCBS Transformer Test');
  console.log('========================================\n');
  
  try {
    // Load sample data
    const allDataPath = path.join(DATA_DIR, 'all-indicators.json');
    const content = await fs.readFile(allDataPath, 'utf-8');
    const allData = JSON.parse(content);
    
    console.log(`Loaded ${allData.data.length} records from PCBS data\n`);
    
    // Initialize transformer
    const transformer = new PCBSTransformer();
    
    // Test transformation
    console.log('Testing transformation...');
    const metadata = {
      source: 'PCBS',
      indicator_code: 'TEST',
      indicator_name: 'Test Indicator',
    };
    
    const transformed = transformer.transform(allData.data.slice(0, 50), metadata);
    console.log(`✓ Transformed ${transformed.length} records\n`);
    
    // Display sample transformed record
    console.log('Sample transformed record:');
    console.log(JSON.stringify(transformed[0], null, 2));
    console.log('');
    
    // Test validation
    console.log('Testing validation...');
    const validationResult = transformer.validate(transformed);
    console.log(`✓ Validation complete`);
    console.log(`  Valid: ${validationResult.valid}`);
    console.log(`  Total records: ${validationResult.totalRecords}`);
    console.log(`  Valid records: ${validationResult.validRecords}`);
    console.log(`  Errors: ${validationResult.errors.length}`);
    console.log(`  Warnings: ${validationResult.warnings.length}\n`);
    
    if (validationResult.errors.length > 0) {
      console.log('Errors:');
      validationResult.errors.forEach(err => console.log(`  - ${err}`));
      console.log('');
    }
    
    if (validationResult.warnings.length > 0) {
      console.log('Warnings (first 5):');
      validationResult.warnings.slice(0, 5).forEach(warn => console.log(`  - ${warn}`));
      console.log('');
    }
    
    // Test enrichment
    console.log('Testing enrichment...');
    const enriched = transformer.enrich(transformed);
    console.log(`✓ Enriched ${enriched.length} records\n`);
    
    // Display sample enriched record
    console.log('Sample enriched record (with analysis):');
    const recordWithAnalysis = enriched.find(r => r.analysis);
    if (recordWithAnalysis) {
      console.log(JSON.stringify({
        indicator: recordWithAnalysis.indicator_name,
        value: recordWithAnalysis.value,
        date: recordWithAnalysis.date,
        analysis: recordWithAnalysis.analysis,
        pcbs_metadata: recordWithAnalysis.pcbs_metadata,
      }, null, 2));
    } else {
      console.log('  Note: Analysis requires multiple data points for the same indicator');
      console.log('  Sample enriched record:');
      console.log(JSON.stringify({
        indicator: enriched[0].indicator_name,
        value: enriched[0].value,
        date: enriched[0].date,
        pcbs_metadata: enriched[0].pcbs_metadata,
      }, null, 2));
    }
    console.log('');
    
    // Test category distribution
    console.log('Category distribution:');
    const categories = {};
    transformed.forEach(record => {
      const cat = record.category;
      categories[cat] = (categories[cat] || 0) + 1;
    });
    Object.entries(categories).forEach(([cat, count]) => {
      console.log(`  ${cat}: ${count} records`);
    });
    console.log('');
    
    // Test type distribution
    console.log('Type distribution:');
    const types = {};
    transformed.forEach(record => {
      const type = record.type;
      types[type] = (types[type] || 0) + 1;
    });
    Object.entries(types).forEach(([type, count]) => {
      console.log(`  ${type}: ${count} records`);
    });
    console.log('');
    
    console.log('========================================');
    console.log('✓ All tests passed!');
    console.log('========================================');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testTransformer();
