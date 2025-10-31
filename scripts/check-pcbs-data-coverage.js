#!/usr/bin/env node

/**
 * Check PCBS Data Coverage
 * 
 * Analyzes which indicators have data and which are empty
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/pcbs');

async function checkCoverage() {
  console.log('========================================');
  console.log('PCBS Data Coverage Analysis');
  console.log('========================================\n');
  
  const files = await fs.readdir(DATA_DIR);
  const indicatorFiles = files.filter(f => 
    f.endsWith('.json') && 
    f !== 'metadata.json' && 
    f !== 'all-indicators.json' && 
    f !== 'manual-data-template.json'
  );
  
  const withData = [];
  const withoutData = [];
  
  for (const file of indicatorFiles) {
    const filePath = path.join(DATA_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    if (data.data && data.data.length > 0) {
      withData.push({
        file,
        indicator: data.indicator,
        name: data.indicator_name,
        category: data.category,
        records: data.data.length,
      });
    } else {
      withoutData.push({
        file,
        indicator: data.indicator,
        name: data.indicator_name,
        category: data.category,
      });
    }
  }
  
  console.log(`Total indicator files: ${indicatorFiles.length}`);
  console.log(`With data: ${withData.length}`);
  console.log(`Without data: ${withoutData.length}\n`);
  
  if (withoutData.length > 0) {
    console.log('Indicators without data:');
    withoutData.forEach(item => {
      console.log(`  ❌ ${item.indicator} - ${item.name}`);
      console.log(`     Category: ${item.category}`);
    });
    console.log('');
  }
  
  // Group by category
  const byCategory = {};
  withData.forEach(item => {
    if (!byCategory[item.category]) {
      byCategory[item.category] = {
        count: 0,
        totalRecords: 0,
        indicators: [],
      };
    }
    byCategory[item.category].count++;
    byCategory[item.category].totalRecords += item.records;
    byCategory[item.category].indicators.push(item.name);
  });
  
  console.log('Data by category:');
  Object.entries(byCategory).forEach(([category, info]) => {
    console.log(`  ${category}:`);
    console.log(`    Indicators: ${info.count}`);
    console.log(`    Total records: ${info.totalRecords}`);
  });
  console.log('');
  
  // Calculate total records
  const totalRecords = withData.reduce((sum, item) => sum + item.records, 0);
  console.log(`Total data records across all indicators: ${totalRecords}`);
  
  console.log('\n========================================');
  console.log('Coverage Summary');
  console.log('========================================');
  console.log(`✅ ${withData.length} indicators have data`);
  console.log(`❌ ${withoutData.length} indicators have no data`);
  console.log(`📊 ${totalRecords} total data points`);
  console.log(`📈 Coverage: ${((withData.length / indicatorFiles.length) * 100).toFixed(1)}%`);
  console.log('========================================\n');
}

checkCoverage().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
