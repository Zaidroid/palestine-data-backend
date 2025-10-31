#!/usr/bin/env node

/**
 * Comprehensive PCBS Transformer Test
 * 
 * Tests the PCBS transformer with full dataset to verify trend analysis
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PCBSTransformer } from './utils/pcbs-transformer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/pcbs');
const OUTPUT_DIR = path.join(__dirname, '../public/data/unified/pcbs');

async function testComprehensive() {
  console.log('========================================');
  console.log('PCBS Comprehensive Transformer Test');
  console.log('========================================\n');
  
  try {
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Load all PCBS data
    const allDataPath = path.join(DATA_DIR, 'all-indicators.json');
    const content = await fs.readFile(allDataPath, 'utf-8');
    const allData = JSON.parse(content);
    
    console.log(`Loaded ${allData.data.length} records from PCBS data\n`);
    
    // Initialize transformer
    const transformer = new PCBSTransformer();
    
    // Transform all data
    console.log('Transforming all data...');
    const metadata = allData.metadata;
    const transformed = transformer.transform(allData.data, metadata);
    console.log(`✓ Transformed ${transformed.length} records\n`);
    
    // Validate
    console.log('Validating transformed data...');
    const validationResult = transformer.validate(transformed);
    console.log(`✓ Validation complete`);
    console.log(`  Valid: ${validationResult.valid}`);
    console.log(`  Errors: ${validationResult.errors.length}`);
    console.log(`  Warnings: ${validationResult.warnings.length}\n`);
    
    // Enrich with trend analysis
    console.log('Enriching with trend analysis...');
    const enriched = transformer.enrich(transformed);
    console.log(`✓ Enriched ${enriched.length} records\n`);
    
    // Find records with analysis
    const withAnalysis = enriched.filter(r => r.analysis);
    console.log(`Records with trend analysis: ${withAnalysis.length}\n`);
    
    // Display sample with analysis
    if (withAnalysis.length > 0) {
      console.log('Sample record with trend analysis:');
      const sample = withAnalysis[0];
      console.log(JSON.stringify({
        indicator: sample.indicator_name,
        category: sample.category,
        type: sample.type,
        value: sample.value,
        unit: sample.unit,
        date: sample.date,
        analysis: sample.analysis,
        pcbs_metadata: sample.pcbs_metadata,
      }, null, 2));
      console.log('');
    }
    
    // Category breakdown
    console.log('Category breakdown:');
    const byCategory = {};
    enriched.forEach(record => {
      const cat = record.category;
      if (!byCategory[cat]) {
        byCategory[cat] = {
          count: 0,
          withAnalysis: 0,
          indicators: new Set(),
        };
      }
      byCategory[cat].count++;
      if (record.analysis) byCategory[cat].withAnalysis++;
      byCategory[cat].indicators.add(record.indicator_code);
    });
    
    Object.entries(byCategory).forEach(([cat, info]) => {
      console.log(`  ${cat}:`);
      console.log(`    Records: ${info.count}`);
      console.log(`    With analysis: ${info.withAnalysis}`);
      console.log(`    Unique indicators: ${info.indicators.size}`);
    });
    console.log('');
    
    // Save transformed data
    console.log('Saving transformed data...');
    const outputData = {
      metadata: {
        source: 'pcbs',
        source_name: 'Palestinian Central Bureau of Statistics',
        transformed_at: new Date().toISOString(),
        total_records: enriched.length,
        categories: Object.keys(byCategory),
        transformer_version: '1.0.0',
      },
      data: enriched,
    };
    
    const outputPath = path.join(OUTPUT_DIR, 'all-data-transformed.json');
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');
    console.log(`✓ Saved to: ${outputPath}\n`);
    
    // Save by category
    for (const [category, info] of Object.entries(byCategory)) {
      const categoryData = enriched.filter(r => r.category === category);
      const categoryPath = path.join(OUTPUT_DIR, `${category}.json`);
      await fs.writeFile(categoryPath, JSON.stringify({
        category,
        metadata: {
          source: 'pcbs',
          record_count: categoryData.length,
          indicators: Array.from(info.indicators),
        },
        data: categoryData,
      }, null, 2), 'utf-8');
      console.log(`✓ Saved ${category} data (${categoryData.length} records)`);
    }
    
    console.log('');
    console.log('========================================');
    console.log('✓ Comprehensive test completed!');
    console.log('========================================');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run test
testComprehensive();
