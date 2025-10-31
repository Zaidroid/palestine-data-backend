#!/usr/bin/env node

/**
 * Fetch Prisoner Statistics from Good Shepherd API
 * 
 * Downloads the statistical summary data (not individual records)
 * for use in dashboards
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/goodshepherd/prisoners');
const API_BASE = 'https://goodshepherdcollective.org/api';

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  console.log('🚀 Fetching Prisoner Statistics from Good Shepherd API\n');
  
  try {
    // Fetch prisoner statistics (monthly totals)
    console.log('📊 Fetching prisoner_data.json (monthly statistics)...');
    const prisonerStats = await fetchJSON(`${API_BASE}/prisoner_data.json`);
    console.log(`  ✓ Loaded ${prisonerStats.length} monthly records`);
    
    // Fetch child prisoner statistics (age group breakdowns)
    console.log('📊 Fetching child_prisoners.json (age group data)...');
    const childStats = await fetchJSON(`${API_BASE}/child_prisoners.json`);
    console.log(`  ✓ Loaded child prisoner statistics`);
    
    // Save prisoner statistics
    const statsDir = path.join(DATA_DIR, 'statistics');
    await ensureDir(statsDir);
    
    await writeJSON(path.join(statsDir, 'monthly-totals.json'), {
      metadata: {
        source: 'goodshepherd',
        dataset: 'prisoner-statistics',
        description: 'Monthly prisoner statistics including totals, administrative detention, women, etc.',
        record_count: prisonerStats.length,
        last_updated: new Date().toISOString(),
      },
      data: prisonerStats,
    });
    console.log('  ✓ Saved statistics/monthly-totals.json');
    
    await writeJSON(path.join(statsDir, 'child-age-groups.json'), {
      metadata: {
        source: 'goodshepherd',
        dataset: 'child-prisoner-statistics',
        description: 'Child prisoner statistics by age group and detention type',
        last_updated: new Date().toISOString(),
      },
      data: childStats,
    });
    console.log('  ✓ Saved statistics/child-age-groups.json');
    
    // Create index
    await writeJSON(path.join(statsDir, 'index.json'), {
      dataset: 'prisoner-statistics',
      description: 'Statistical summaries for prisoner data',
      files: [
        {
          file: 'monthly-totals.json',
          description: 'Monthly totals and administrative detention data',
          records: prisonerStats.length,
        },
        {
          file: 'child-age-groups.json',
          description: 'Child prisoner age group breakdowns',
        },
      ],
      last_updated: new Date().toISOString(),
    });
    console.log('  ✓ Saved statistics/index.json');
    
    console.log('\n✅ Prisoner statistics downloaded successfully!');
    console.log('\nFiles created:');
    console.log('  - public/data/goodshepherd/prisoners/statistics/monthly-totals.json');
    console.log('  - public/data/goodshepherd/prisoners/statistics/child-age-groups.json');
    console.log('  - public/data/goodshepherd/prisoners/statistics/index.json');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
