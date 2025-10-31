#!/usr/bin/env node

/**
 * Show Sample PCBS Data
 * 
 * Displays sample records from each category to verify data quality
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNIFIED_DIR = path.join(__dirname, '../public/data/unified/pcbs');

async function showSamples() {
  console.log('========================================');
  console.log('PCBS Sample Data Preview');
  console.log('========================================\n');
  
  const categories = ['population', 'economic', 'labor', 'education', 'health', 'poverty'];
  
  for (const category of categories) {
    const filePath = path.join(UNIFIED_DIR, `${category}.json`);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      console.log(`📊 ${category.toUpperCase()} (${data.data.length} records)`);
      console.log('─'.repeat(60));
      
      // Show first record
      const sample = data.data[0];
      console.log(`Indicator: ${sample.indicator_name}`);
      console.log(`Date: ${sample.date}`);
      console.log(`Value: ${sample.value} ${sample.unit}`);
      console.log(`Location: ${sample.location.name}`);
      
      if (sample.analysis) {
        console.log(`Trend: ${sample.analysis.trend.direction} (slope: ${sample.analysis.trend.slope.toFixed(2)})`);
        console.log(`Growth Rate: ${sample.analysis.growth_rate.toFixed(2)}%`);
        console.log(`Data Points: ${sample.analysis.data_points}`);
      }
      
      console.log(`Quality Score: ${(sample.quality.score * 100).toFixed(1)}%`);
      console.log(`Source: ${sample.sources[0].name}`);
      console.log(`Reliability: ${(sample.sources[0].reliability_score * 100).toFixed(0)}%`);
      
      // Show a few more values from the same indicator
      const sameIndicator = data.data.filter(r => r.indicator_code === sample.indicator_code).slice(0, 5);
      console.log(`\nRecent values:`);
      sameIndicator.forEach(r => {
        console.log(`  ${r.date.split('-')[0]}: ${r.value}`);
      });
      
      console.log('\n');
      
    } catch (error) {
      console.log(`❌ Error loading ${category}: ${error.message}\n`);
    }
  }
  
  console.log('========================================');
  console.log('Sample data preview complete');
  console.log('========================================\n');
}

showSamples().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
