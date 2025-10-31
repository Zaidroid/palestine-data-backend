#!/usr/bin/env node

/**
 * Test Unified Pipeline
 * 
 * Tests the unified data pipeline with sample data
 * 
 * Usage: node scripts/test-unified-pipeline.js
 */

import { EconomicTransformer } from './utils/economic-transformer.js';
import { ConflictTransformer } from './utils/conflict-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger({ 
  context: 'Pipeline-Test',
  logLevel: 'INFO',
});

// Sample economic data (World Bank format)
const sampleEconomicData = [
  {
    indicator: 'NY.GDP.MKTP.CD',
    country: { value: 'Palestine' },
    date: '2020',
    value: 15000000000,
  },
  {
    indicator: 'NY.GDP.MKTP.CD',
    country: { value: 'Palestine' },
    date: '2021',
    value: 16000000000,
  },
  {
    indicator: 'NY.GDP.MKTP.CD',
    country: { value: 'Palestine' },
    date: '2022',
    value: 17000000000,
  },
  {
    indicator: 'NY.GDP.MKTP.CD',
    country: { value: 'Palestine' },
    date: '2023',
    value: 18000000000,
  },
];

// Sample conflict data
const sampleConflictData = [
  {
    event_date: '2023-10-08',
    event_type: 'airstrike',
    location: 'Gaza City',
    admin1: 'Gaza',
    latitude: 31.5,
    longitude: 34.45,
    fatalities: 10,
    injuries: 25,
    actor1: 'Military',
    notes: 'Airstrike on residential area',
  },
  {
    event_date: '2023-10-09',
    event_type: 'artillery',
    location: 'Khan Yunis',
    admin1: 'Khan Yunis',
    latitude: 31.35,
    longitude: 34.30,
    fatalities: 5,
    injuries: 15,
    actor1: 'Military',
    notes: 'Artillery shelling',
  },
];

async function testEconomicTransformer() {
  await logger.info('\n📊 Testing Economic Transformer...');
  await logger.info('=====================================');
  
  try {
    const transformer = new EconomicTransformer();
    const metadata = {
      source: 'World Bank',
      organization: 'World Bank',
      indicator_code: 'NY.GDP.MKTP.CD',
      indicator_name: 'GDP (current US$)',
    };
    
    // Transform
    const transformed = transformer.transform(sampleEconomicData, metadata);
    await logger.success(`Transformed ${transformed.length} records`);
    
    // Validate
    const validation = transformer.validate(transformed);
    await logger.info(`Quality score: ${(validation.qualityScore * 100).toFixed(1)}%`);
    await logger.info(`Completeness: ${(validation.completeness * 100).toFixed(1)}%`);
    await logger.info(`Consistency: ${(validation.consistency * 100).toFixed(1)}%`);
    
    if (validation.meetsThreshold) {
      await logger.success('✓ Validation passed');
    } else {
      await logger.warn('⚠ Validation below threshold');
    }
    
    // Enrich
    const enriched = transformer.enrich(transformed);
    await logger.success('Enriched with trend analysis');
    
    // Show sample
    await logger.info('\nSample transformed record:');
    console.log(JSON.stringify(enriched[0], null, 2));
    
    return true;
  } catch (error) {
    await logger.error('Economic transformer test failed', error);
    return false;
  }
}

async function testConflictTransformer() {
  await logger.info('\n⚔️  Testing Conflict Transformer...');
  await logger.info('=====================================');
  
  try {
    const transformer = new ConflictTransformer();
    const metadata = {
      source: 'Test Data',
      organization: { title: 'Test Org' },
      source_url: 'https://example.com',
    };
    
    // Transform
    const transformed = transformer.transform(sampleConflictData, metadata);
    await logger.success(`Transformed ${transformed.length} records`);
    
    // Validate
    const validation = transformer.validate(transformed);
    await logger.info(`Quality score: ${(validation.qualityScore * 100).toFixed(1)}%`);
    
    if (validation.meetsThreshold) {
      await logger.success('✓ Validation passed');
    } else {
      await logger.warn('⚠ Validation below threshold');
    }
    
    // Show sample
    await logger.info('\nSample transformed record:');
    console.log(JSON.stringify(transformed[0], null, 2));
    
    return true;
  } catch (error) {
    await logger.error('Conflict transformer test failed', error);
    return false;
  }
}

async function testFullPipeline() {
  await logger.info('\n🔄 Testing Full Pipeline...');
  await logger.info('=====================================');
  
  try {
    const transformer = new EconomicTransformer();
    const pipeline = new UnifiedPipeline({ logger });
    
    const metadata = {
      source: 'World Bank',
      organization: 'World Bank',
      indicator_code: 'NY.GDP.MKTP.CD',
      indicator_name: 'GDP (current US$)',
    };
    
    // Process through pipeline (without partitioning for test)
    const results = await pipeline.process(
      sampleEconomicData,
      metadata,
      transformer,
      {
        enrich: true,
        validate: true,
        partition: false, // Skip partitioning for test
      }
    );
    
    if (results.success) {
      await logger.success('✓ Pipeline processing successful');
      await logger.info(`Records: ${results.stats.recordCount}`);
      await logger.info(`Processing time: ${results.stats.processingTime}ms`);
      await logger.info(`Quality score: ${(results.validated.qualityScore * 100).toFixed(1)}%`);
      
      // Create output package
      const output = pipeline.createOutputPackage(results, metadata);
      await logger.success('✓ Output package created');
      
      await logger.info('\nOutput structure:');
      console.log(JSON.stringify({
        metadata: output.metadata,
        dataCount: output.data.length,
        validation: output.validation,
        partition_info: output.partition_info,
      }, null, 2));
      
      return true;
    } else {
      await logger.error('Pipeline processing failed');
      console.log('Errors:', results.errors);
      return false;
    }
  } catch (error) {
    await logger.error('Full pipeline test failed', error);
    return false;
  }
}

async function main() {
  await logger.info('🚀 Unified Pipeline Test Suite');
  await logger.info('================================\n');
  
  const results = {
    economic: false,
    conflict: false,
    pipeline: false,
  };
  
  // Run tests
  results.economic = await testEconomicTransformer();
  results.conflict = await testConflictTransformer();
  results.pipeline = await testFullPipeline();
  
  // Summary
  await logger.info('\n📋 Test Summary');
  await logger.info('================');
  await logger.info(`Economic Transformer: ${results.economic ? '✓ PASS' : '✗ FAIL'}`);
  await logger.info(`Conflict Transformer: ${results.conflict ? '✓ PASS' : '✗ FAIL'}`);
  await logger.info(`Full Pipeline: ${results.pipeline ? '✓ PASS' : '✗ FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    await logger.success('\n✅ All tests passed!');
    await logger.info('\nNext steps:');
    await logger.info('1. Review the integration guide: scripts/UNIFIED_PIPELINE_INTEGRATION.md');
    await logger.info('2. Update fetch-worldbank-data.js to use EconomicTransformer');
    await logger.info('3. Update fetch-hdx-ckan-data.js to use category transformers');
    await logger.info('4. Update fetch-goodshepherd-data.js to use ConflictTransformer');
  } else {
    await logger.error('\n❌ Some tests failed');
    process.exit(1);
  }
  
  await logger.logSummary();
}

// Run tests
main();
