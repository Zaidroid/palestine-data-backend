#!/usr/bin/env node

/**
 * Comprehensive Manifest Generator
 * 
 * Scans all data directories and generates comprehensive manifests with:
 * - Dataset metadata (record counts, date ranges)
 * - Partition information for partitioned datasets
 * - Source-level summaries
 * - Global manifest with all data sources
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const BASELINE_DATE = '2023-10-07';

// Utility functions
async function readJSON(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getDirectorySize(dirPath) {
  let size = 0;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirectorySize(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        size += stats.size;
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
  return size;
}

async function getFileSize(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

async function countRecordsInFile(filePath) {
  try {
    const data = await readJSON(filePath);
    if (!data) return 0;

    // Check for metadata.record_count first (Good Shepherd format)
    if (data.metadata && typeof data.metadata.record_count === 'number') {
      return data.metadata.record_count;
    }

    // Handle different data structures
    if (Array.isArray(data)) {
      return data.length;
    } else if (data.data && Array.isArray(data.data)) {
      return data.data.length;
    } else if (data.records && Array.isArray(data.records)) {
      return data.records.length;
    } else if (data.data && typeof data.data === 'object' && data.data.csv) {
      // HDX CSV format - count lines minus header
      const lines = data.data.csv.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      return Math.max(0, lines.length - 1); // Subtract header row
    }
    return 0;
  } catch {
    return 0;
  }
}

function extractDateRange(data) {
  if (!data || !Array.isArray(data)) return null;

  const dates = [];
  for (const record of data) {
    const dateStr = record.date || record.Date || record.year || record.Year;
    if (dateStr) {
      dates.push(new Date(dateStr));
    }
  }

  if (dates.length === 0) return null;

  dates.sort((a, b) => a - b);
  return {
    start: dates[0].toISOString().split('T')[0],
    end: dates[dates.length - 1].toISOString().split('T')[0]
  };
}

// HDX Manifest Generation
async function generateHDXManifest() {
  console.log('📊 Generating HDX manifest...');

  const hdxPath = path.join(DATA_DIR, 'hdx');
  const categories = ['casualties', 'conflict', 'displacement', 'food-security', 'health', 'humanitarian', 'infrastructure'];

  const manifest = {
    source: 'hdx-ckan',
    last_updated: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    total_datasets: 0,
    total_records: 0,
    datasets: [],
    categories: {}
  };

  for (const category of categories) {
    const categoryPath = path.join(hdxPath, category);
    const categoryExists = await fileExists(categoryPath);

    if (!categoryExists) {
      manifest.categories[category] = 0;
      continue;
    }

    let categoryDatasets = 0;
    const entries = await fs.readdir(categoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'datasets.json' || entry.name === 'index.json') continue;

      const entryPath = path.join(categoryPath, entry.name);

      if (entry.isDirectory()) {
        // Check for partitioned dataset
        const indexPath = path.join(entryPath, 'index.json');
        const indexExists = await fileExists(indexPath);

        if (indexExists) {
          const index = await readJSON(indexPath);
          const recentPath = path.join(entryPath, 'recent.json');
          const recentRecords = await countRecordsInFile(recentPath);

          let totalRecords = 0;
          const partitions = [];

          if (index && index.partitions) {
            for (const partition of index.partitions) {
              const partPath = path.join(entryPath, partition.file);
              const records = await countRecordsInFile(partPath);
              totalRecords += records;
              partitions.push({
                file: partition.file,
                quarter: partition.quarter || partition.year,
                record_count: records,
                date_range: partition.date_range
              });
            }
          }

          manifest.datasets.push({
            id: entry.name,
            name: entry.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            category: category,
            record_count: totalRecords,
            date_range: index.date_range || null,
            partitioned: true,
            partition_count: partitions.length,
            partitions: partitions,
            has_recent_file: recentRecords > 0,
            recent_records: recentRecords
          });

          manifest.total_records += totalRecords;
          categoryDatasets++;
        }
      } else if (entry.name.endsWith('.json')) {
        // Single file dataset
        const records = await countRecordsInFile(entryPath);
        const data = await readJSON(entryPath);
        const dateRange = extractDateRange(data);

        manifest.datasets.push({
          id: entry.name.replace('.json', ''),
          name: entry.name.replace('.json', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          category: category,
          record_count: records,
          date_range: dateRange,
          partitioned: false,
          file: entry.name
        });

        manifest.total_records += records;
        categoryDatasets++;
      }
    }

    manifest.categories[category] = categoryDatasets;
    manifest.total_datasets += categoryDatasets;
  }

  // Write HDX catalog
  await writeJSON(path.join(hdxPath, 'metadata.json'), manifest);
  console.log(`  ✓ HDX: ${manifest.total_datasets} datasets, ${manifest.total_records} records`);

  return manifest;
}

// Good Shepherd Manifest Generation
async function generateGoodShepherdManifest() {
  console.log('📊 Generating Good Shepherd manifest...');

  const gsPath = path.join(DATA_DIR, 'goodshepherd');
  const categories = ['healthcare', 'demolitions', 'ngo', 'prisoners/political', 'prisoners/children', 'westbank'];

  const manifest = {
    source: 'goodshepherd',
    api_base: 'https://goodshepherdcollective.org/api',
    last_updated: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    datasets: {},
    summary: {
      total_datasets: 0,
      total_records: 0,
      total_partitions: 0
    }
  };

  for (const category of categories) {
    const categoryPath = path.join(gsPath, category);
    const categoryExists = await fileExists(categoryPath);

    if (!categoryExists) continue;

    const entries = await fs.readdir(categoryPath, { withFileTypes: true });

    // Check for partitioned data
    const indexPath = path.join(categoryPath, 'index.json');
    const indexExists = await fileExists(indexPath);

    if (indexExists) {
      const index = await readJSON(indexPath);
      const recentPath = path.join(categoryPath, 'recent.json');
      const recentRecords = await countRecordsInFile(recentPath);

      let totalRecords = 0;
      const partitions = [];

      const partitionList = index.partitions || index.files;

      if (partitionList) {
        for (const partition of partitionList) {
          const partPath = path.join(categoryPath, partition.file);
          const records = await countRecordsInFile(partPath);
          totalRecords += records;
          partitions.push({
            file: partition.file,
            quarter: partition.quarter || partition.year,
            record_count: records
          });
        }
      }

      // If no records from partitions, try to get from recent file
      if (totalRecords === 0 && recentRecords > 0) {
        totalRecords = recentRecords;
      }

      // Format name: "prisoners/political" -> "Political Prisoners"
      const name = category.includes('/')
        ? category.split('/').reverse().map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : category.charAt(0).toUpperCase() + category.slice(1);

      manifest.datasets[category] = {
        name: name,
        category: category,
        record_count: totalRecords,
        date_range: index.date_range || null,
        partitioned: true,
        partition_count: partitions.length,
        partition_strategy: 'quarter',
        has_recent_file: recentRecords > 0
      };

      manifest.summary.total_records += totalRecords;
      manifest.summary.total_partitions += partitions.length;
      manifest.summary.total_datasets++;
    } else {
      // Check for non-partitioned data (like NGO)
      const files = entries.filter(e => e.isFile() && e.name.endsWith('.json'));

      if (files.length > 0) {
        let totalRecords = 0;
        const fileList = [];

        for (const file of files) {
          const filePath = path.join(categoryPath, file.name);
          const records = await countRecordsInFile(filePath);
          totalRecords += records;
          fileList.push(file.name);
        }

        manifest.datasets[category] = {
          name: category.charAt(0).toUpperCase() + category.slice(1),
          category: category,
          record_count: totalRecords,
          partitioned: false,
          files: fileList
        };

        manifest.summary.total_records += totalRecords;
        manifest.summary.total_datasets++;
      }
    }
  }

  // Write Good Shepherd metadata
  await writeJSON(path.join(gsPath, 'metadata.json'), manifest);
  console.log(`  ✓ Good Shepherd: ${manifest.summary.total_datasets} datasets, ${manifest.summary.total_records} records`);

  return manifest;
}

// World Bank Manifest Generation
async function generateWorldBankManifest() {
  console.log('📊 Generating World Bank manifest...');

  const wbPath = path.join(DATA_DIR, 'worldbank');

  const manifest = {
    metadata: {
      source: 'worldbank',
      country: 'Palestine',
      country_code: 'PSE',
      last_updated: new Date().toISOString(),
      indicators: 0,
      total_data_points: 0
    },
    indicators: []
  };

  // Read all indicator files
  const entries = await fs.readdir(wbPath, { withFileTypes: true });
  const indicatorFiles = entries.filter(e =>
    e.isFile() &&
    e.name.endsWith('.json') &&
    e.name !== 'metadata.json' &&
    e.name !== 'all-indicators.json'
  );

  for (const file of indicatorFiles) {
    const filePath = path.join(wbPath, file.name);
    const data = await readJSON(filePath);

    if (!data) continue;

    const dataPoints = data.data ? data.data.length : 0;
    const indicatorCode = file.name.replace('.json', '').toUpperCase().replace(/_/g, '.');

    // Determine category based on indicator code
    let category = 'other';
    if (indicatorCode.startsWith('NY.') || indicatorCode.startsWith('NE.') || indicatorCode.startsWith('FP.')) {
      category = 'economic';
    } else if (indicatorCode.startsWith('SP.POP') || indicatorCode.startsWith('SP.DYN') || indicatorCode.startsWith('SP.URB')) {
      category = 'population';
    } else if (indicatorCode.startsWith('SL.')) {
      category = 'labor';
    } else if (indicatorCode.startsWith('SI.POV') || indicatorCode.startsWith('SI.DST')) {
      category = 'poverty';
    } else if (indicatorCode.startsWith('SE.')) {
      category = 'education';
    } else if (indicatorCode.startsWith('SH.')) {
      category = 'health';
    } else if (indicatorCode.startsWith('EG.') || indicatorCode.startsWith('IT.') || indicatorCode.startsWith('IS.')) {
      category = 'infrastructure';
    } else if (indicatorCode.startsWith('AG.') || indicatorCode.startsWith('ER.')) {
      category = 'environment';
    } else if (indicatorCode.startsWith('TG.') || indicatorCode.startsWith('BN.') || indicatorCode.startsWith('BX.') || indicatorCode.startsWith('BM.') || indicatorCode.startsWith('TX.') || indicatorCode.startsWith('TM.')) {
      category = 'trade';
    } else if (indicatorCode.startsWith('FB.') || indicatorCode.startsWith('FS.') || indicatorCode.startsWith('FM.')) {
      category = 'financial';
    }

    // Determine unit
    let unit = 'number';
    const name = data.indicator_name || '';
    if (name.includes('% of') || name.includes('(%)')) {
      unit = 'percentage';
    } else if (name.includes('US$')) {
      unit = 'currency_usd';
    } else if (name.includes('per 1,000')) {
      unit = 'per_1000';
    } else if (name.includes('per 100,000')) {
      unit = 'per_100000';
    } else if (name.includes('per 100')) {
      unit = 'per_100';
    } else if (name.includes('years')) {
      unit = 'years';
    } else if (name.includes('births per woman')) {
      unit = 'births_per_woman';
    } else if (name.includes('kWh')) {
      unit = 'kwh';
    } else if (name.includes('TEU')) {
      unit = 'teu';
    }

    manifest.indicators.push({
      code: indicatorCode,
      name: data.indicator_name || indicatorCode,
      category: category,
      data_points: dataPoints,
      unit: unit
    });

    manifest.metadata.total_data_points += dataPoints;
  }

  manifest.metadata.indicators = manifest.indicators.length;

  // Sort indicators by category and code
  manifest.indicators.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    return a.code.localeCompare(b.code);
  });

  // Write World Bank metadata
  await writeJSON(path.join(wbPath, 'metadata.json'), manifest);

  // Also update all-indicators.json
  const allIndicators = {
    generated_at: new Date().toISOString(),
    total_indicators: manifest.indicators.length,
    indicators: manifest.indicators
  };
  await writeJSON(path.join(wbPath, 'all-indicators.json'), allIndicators);

  console.log(`  ✓ World Bank: ${manifest.metadata.indicators} indicators, ${manifest.metadata.total_data_points} data points`);

  return manifest;
}

// Tech4Palestine Manifest Generation
async function generateTech4PalestineManifest() {
  console.log('📊 Generating Tech4Palestine manifest...');

  const t4pPath = path.join(DATA_DIR, 'tech4palestine');

  const manifest = {
    source: 'tech4palestine',
    last_updated: new Date().toISOString(),
    datasets: {}
  };

  // Check for summary file
  const summaryPath = path.join(t4pPath, 'summary.json');
  if (await fileExists(summaryPath)) {
    const summary = await readJSON(summaryPath);
    if (summary) {
      manifest.datasets.summary = 'available';
    }
  }

  // Check for press killed
  const pressPath = path.join(t4pPath, 'press-killed.json');
  if (await fileExists(pressPath)) {
    const records = await countRecordsInFile(pressPath);
    manifest.datasets.pressKilled = records;
  }

  // Check for casualties
  const casualtiesPath = path.join(t4pPath, 'casualties');
  if (await fileExists(casualtiesPath)) {
    const entries = await fs.readdir(casualtiesPath);
    const jsonFiles = entries.filter(f => f.endsWith('.json'));
    let totalRecords = 0;
    for (const file of jsonFiles) {
      const records = await countRecordsInFile(path.join(casualtiesPath, file));
      totalRecords += records;
    }
    manifest.datasets.casualties = totalRecords;
  }

  // Check for killed in Gaza
  const killedPath = path.join(t4pPath, 'killed-in-gaza');
  if (await fileExists(killedPath)) {
    const entries = await fs.readdir(killedPath);
    const jsonFiles = entries.filter(f => f.endsWith('.json') && f !== 'index.json');
    let totalRecords = 0;
    for (const file of jsonFiles) {
      const records = await countRecordsInFile(path.join(killedPath, file));
      totalRecords += records;
    }
    manifest.datasets.killedInGaza = totalRecords;
  }

  // Write Tech4Palestine metadata
  await writeJSON(path.join(t4pPath, 'metadata.json'), manifest);
  console.log(`  ✓ Tech4Palestine: ${Object.keys(manifest.datasets).length} datasets`);

  return manifest;
}

// Generate Global Manifest
async function generateGlobalManifest(hdxManifest, gsManifest, wbManifest, t4pManifest) {
  console.log('📊 Generating global manifest...');

  const manifest = {
    generated_at: new Date().toISOString(),
    version: '3.0.0',
    baseline_date: BASELINE_DATE,
    sources: {},
    summary: {
      total_sources: 0,
      total_datasets: 0,
      total_records: 0,
      total_size_bytes: 0,
      total_size_mb: 0
    }
  };

  // HDX
  const hdxSize = await getDirectorySize(path.join(DATA_DIR, 'hdx'));
  manifest.sources.hdx = {
    name: 'Humanitarian Data Exchange',
    path: '/data/hdx',
    datasets: hdxManifest.total_datasets,
    records: hdxManifest.total_records,
    categories: Object.keys(hdxManifest.categories).length,
    size_bytes: hdxSize,
    size_mb: (hdxSize / (1024 * 1024)).toFixed(2),
    last_updated: hdxManifest.last_updated
  };
  manifest.summary.total_datasets += hdxManifest.total_datasets;
  manifest.summary.total_records += hdxManifest.total_records;
  manifest.summary.total_size_bytes += hdxSize;
  manifest.summary.total_sources++;

  // Good Shepherd
  const gsSize = await getDirectorySize(path.join(DATA_DIR, 'goodshepherd'));
  manifest.sources.goodshepherd = {
    name: 'Good Shepherd Collective',
    path: '/data/goodshepherd',
    datasets: gsManifest.summary.total_datasets,
    records: gsManifest.summary.total_records,
    partitions: gsManifest.summary.total_partitions,
    size_bytes: gsSize,
    size_mb: (gsSize / (1024 * 1024)).toFixed(2),
    last_updated: gsManifest.last_updated
  };
  manifest.summary.total_datasets += gsManifest.summary.total_datasets;
  manifest.summary.total_records += gsManifest.summary.total_records;
  manifest.summary.total_size_bytes += gsSize;
  manifest.summary.total_sources++;

  // World Bank
  const wbSize = await getDirectorySize(path.join(DATA_DIR, 'worldbank'));
  manifest.sources.worldbank = {
    name: 'World Bank',
    path: '/data/worldbank',
    indicators: wbManifest.metadata.indicators,
    data_points: wbManifest.metadata.total_data_points,
    size_bytes: wbSize,
    size_mb: (wbSize / (1024 * 1024)).toFixed(2),
    last_updated: wbManifest.metadata.last_updated
  };
  manifest.summary.total_datasets += wbManifest.metadata.indicators;
  manifest.summary.total_records += wbManifest.metadata.total_data_points;
  manifest.summary.total_size_bytes += wbSize;
  manifest.summary.total_sources++;

  // Tech4Palestine
  const t4pSize = await getDirectorySize(path.join(DATA_DIR, 'tech4palestine'));
  const t4pDatasets = Object.keys(t4pManifest.datasets).length;
  const t4pRecords = Object.values(t4pManifest.datasets).reduce((sum, val) => {
    return sum + (typeof val === 'number' ? val : 0);
  }, 0);
  manifest.sources.tech4palestine = {
    name: 'Tech4Palestine',
    path: '/data/tech4palestine',
    datasets: t4pDatasets,
    records: t4pRecords,
    size_bytes: t4pSize,
    size_mb: (t4pSize / (1024 * 1024)).toFixed(2),
    last_updated: t4pManifest.last_updated
  };
  manifest.summary.total_datasets += t4pDatasets;
  manifest.summary.total_records += t4pRecords;
  manifest.summary.total_size_bytes += t4pSize;
  manifest.summary.total_sources++;

  manifest.summary.total_size_mb = (manifest.summary.total_size_bytes / (1024 * 1024)).toFixed(2);

  // Write global manifest
  await writeJSON(path.join(DATA_DIR, 'manifest.json'), manifest);
  console.log(`  ✓ Global manifest: ${manifest.summary.total_sources} sources, ${manifest.summary.total_datasets} datasets`);

  return manifest;
}

// Main execution
async function main() {
  console.log('🔨 Generating comprehensive manifests...\n');

  try {
    // Generate individual source manifests
    const hdxManifest = await generateHDXManifest();
    const gsManifest = await generateGoodShepherdManifest();
    const wbManifest = await generateWorldBankManifest();
    const t4pManifest = await generateTech4PalestineManifest();

    // Generate global manifest
    const globalManifest = await generateGlobalManifest(hdxManifest, gsManifest, wbManifest, t4pManifest);

    console.log('\n✅ All manifests generated successfully!');
    console.log(`\nGlobal Summary:`);
    console.log(`  Sources: ${globalManifest.summary.total_sources}`);
    console.log(`  Datasets: ${globalManifest.summary.total_datasets}`);
    console.log(`  Records: ${globalManifest.summary.total_records.toLocaleString()}`);
    console.log(`  Total size: ${globalManifest.summary.total_size_mb}MB`);
  } catch (error) {
    console.error('❌ Error generating manifests:', error);
    process.exit(1);
  }
}

main();
