#!/usr/bin/env node

/**
 * Data Status Dashboard Generator
 * 
 * Generates a comprehensive status dashboard showing:
 * - Data source health and freshness
 * - Last update timestamps
 * - Record counts and coverage
 * - Error tracking
 * - Quality metrics
 * 
 * Output: data/status-dashboard.json and status-dashboard.html
 * 
 * Usage: node scripts/generate-status-dashboard.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const BASELINE_DATE = '2023-10-07';

// Helper functions
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

/**
 * Calculate data freshness (in hours)
 */
function calculateFreshness(lastUpdated) {
  if (!lastUpdated) return null;
  
  const now = new Date();
  const updated = new Date(lastUpdated);
  const diffMs = now - updated;
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  return diffHours;
}

/**
 * Determine health status based on freshness
 */
function determineHealth(freshness, expectedUpdateFrequency) {
  if (freshness === null) return 'unknown';
  
  // Expected frequencies in hours
  const frequencies = {
    realtime: 6,
    daily: 24,
    weekly: 168,
    monthly: 720,
  };
  
  const threshold = frequencies[expectedUpdateFrequency] || 24;
  
  if (freshness <= threshold) return 'healthy';
  if (freshness <= threshold * 2) return 'stale';
  return 'critical';
}

/**
 * Get source status
 */
async function getSourceStatus(sourceName, updateFrequency = 'daily') {
  const sourcePath = path.join(DATA_DIR, sourceName);
  const metadataPath = path.join(sourcePath, 'metadata.json');
  
  const exists = await fileExists(metadataPath);
  
  if (!exists) {
    return {
      name: sourceName,
      status: 'not_configured',
      health: 'unknown',
      last_updated: null,
      freshness_hours: null,
      datasets: 0,
      records: 0,
    };
  }
  
  const metadata = await readJSON(metadataPath);
  
  if (!metadata) {
    return {
      name: sourceName,
      status: 'error',
      health: 'unknown',
      last_updated: null,
      freshness_hours: null,
      datasets: 0,
      records: 0,
    };
  }
  
  const lastUpdated = metadata.last_updated || metadata.metadata?.last_updated;
  const freshness = calculateFreshness(lastUpdated);
  const health = determineHealth(freshness, updateFrequency);
  
  // Count datasets and records
  let datasets = 0;
  let records = 0;
  
  if (metadata.summary) {
    datasets = metadata.summary.total_datasets || 0;
    records = metadata.summary.total_records || 0;
  } else if (metadata.datasets) {
    datasets = Object.keys(metadata.datasets).length;
    records = Object.values(metadata.datasets).reduce((sum, val) => {
      return sum + (typeof val === 'number' ? val : 0);
    }, 0);
  } else if (metadata.metadata) {
    datasets = metadata.metadata.indicators || 0;
    records = metadata.metadata.total_data_points || 0;
  }
  
  return {
    name: sourceName,
    status: 'active',
    health,
    last_updated: lastUpdated,
    freshness_hours: freshness,
    datasets,
    records,
    metadata: metadata,
  };
}

/**
 * Generate status dashboard
 */
async function generateStatusDashboard() {
  console.log('🔍 Generating data status dashboard...\n');
  
  const sources = [
    { name: 'tech4palestine', frequency: 'realtime' },
    { name: 'hdx', frequency: 'weekly' },
    { name: 'goodshepherd', frequency: 'daily' },
    { name: 'worldbank', frequency: 'monthly' },
    { name: 'who', frequency: 'monthly' },
    { name: 'pcbs', frequency: 'monthly' },
    { name: 'unrwa', frequency: 'monthly' },
    { name: 'wfp', frequency: 'weekly' },
    { name: 'btselem', frequency: 'daily' },
  ];
  
  const statusData = {
    generated_at: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    sources: [],
    summary: {
      total_sources: sources.length,
      healthy: 0,
      stale: 0,
      critical: 0,
      not_configured: 0,
      total_datasets: 0,
      total_records: 0,
    },
  };
  
  for (const source of sources) {
    const status = await getSourceStatus(source.name, source.frequency);
    status.update_frequency = source.frequency;
    statusData.sources.push(status);
    
    // Update summary
    if (status.health === 'healthy') statusData.summary.healthy++;
    else if (status.health === 'stale') statusData.summary.stale++;
    else if (status.health === 'critical') statusData.summary.critical++;
    else if (status.status === 'not_configured') statusData.summary.not_configured++;
    
    statusData.summary.total_datasets += status.datasets;
    statusData.summary.total_records += status.records;
    
    // Display status
    const healthEmoji = {
      healthy: '✅',
      stale: '⚠️',
      critical: '🔴',
      unknown: '❓',
    };
    
    console.log(`${healthEmoji[status.health] || '❓'} ${source.name.padEnd(20)} | ${status.status.padEnd(15)} | ${status.datasets} datasets, ${status.records.toLocaleString()} records`);
  }
  
  // Save JSON dashboard
  const jsonPath = path.join(DATA_DIR, 'status-dashboard.json');
  await writeJSON(jsonPath, statusData);
  console.log(`\n✅ Status dashboard saved to: ${jsonPath}`);
  
  // Generate HTML dashboard
  const html = generateHTMLDashboard(statusData);
  const htmlPath = path.join(DATA_DIR, 'status-dashboard.html');
  await fs.writeFile(htmlPath, html, 'utf-8');
  console.log(`✅ HTML dashboard saved to: ${htmlPath}`);
  
  return statusData;
}

/**
 * Generate HTML dashboard
 */
function generateHTMLDashboard(statusData) {
  const healthColors = {
    healthy: '#10b981',
    stale: '#f59e0b',
    critical: '#ef4444',
    unknown: '#6b7280',
  };
  
  const sourceRows = statusData.sources.map(source => {
    const healthColor = healthColors[source.health] || healthColors.unknown;
    const freshnessText = source.freshness_hours !== null ? 
      `${source.freshness_hours}h ago` : 'Unknown';
    
    return `
      <tr>
        <td>
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${healthColor}; margin-right: 8px;"></span>
          ${source.name}
        </td>
        <td>${source.status}</td>
        <td>${source.health}</td>
        <td>${source.datasets}</td>
        <td>${source.records.toLocaleString()}</td>
        <td>${freshnessText}</td>
        <td>${source.update_frequency}</td>
        <td style="font-size: 0.85em;">${source.last_updated || 'Never'}</td>
      </tr>
    `;
  }).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Palestine Data Backend - Status Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f9fafb;
      padding: 20px;
      color: #1f2937;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      padding: 30px;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      color: #111827;
    }
    .subtitle {
      color: #6b7280;
      margin-bottom: 30px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: #f9fafb;
      padding: 20px;
      border-radius: 6px;
      border-left: 4px solid #3b82f6;
    }
    .summary-card h3 {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #111827;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #f9fafb;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
      color: #374151;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    tr:hover {
      background: #f9fafb;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 14px;
      text-align: center;
    }
    .healthy { color: #10b981; }
    .stale { color: #f59e0b; }
    .critical { color: #ef4444; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🇵🇸 Palestine Data Backend - Status Dashboard</h1>
    <p class="subtitle">Real-time monitoring of all data sources</p>
    
    <div class="summary">
      <div class="summary-card">
        <h3>Total Sources</h3>
        <div class="value">${statusData.summary.total_sources}</div>
      </div>
      <div class="summary-card" style="border-left-color: #10b981;">
        <h3>Healthy</h3>
        <div class="value" style="color: #10b981;">${statusData.summary.healthy}</div>
      </div>
      <div class="summary-card" style="border-left-color: #f59e0b;">
        <h3>Stale</h3>
        <div class="value" style="color: #f59e0b;">${statusData.summary.stale}</div>
      </div>
      <div class="summary-card" style="border-left-color: #ef4444;">
        <h3>Critical</h3>
        <div class="value" style="color: #ef4444;">${statusData.summary.critical}</div>
      </div>
      <div class="summary-card" style="border-left-color: #6b7280;">
        <h3>Total Datasets</h3>
        <div class="value">${statusData.summary.total_datasets}</div>
      </div>
      <div class="summary-card" style="border-left-color: #3b82f6;">
        <h3>Total Records</h3>
        <div class="value">${statusData.summary.total_records.toLocaleString()}</div>
      </div>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Source</th>
          <th>Status</th>
          <th>Health</th>
          <th>Datasets</th>
          <th>Records</th>
          <th>Freshness</th>
          <th>Update Frequency</th>
          <th>Last Updated</th>
        </tr>
      </thead>
      <tbody>
        ${sourceRows}
      </tbody>
    </table>
    
    <div class="footer">
      <p>Generated: ${new Date(statusData.generated_at).toLocaleString()}</p>
      <p>Baseline Date: ${BASELINE_DATE}</p>
      <p>Auto-refresh: Run <code>npm run generate-status</code></p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Generating Status Dashboard...\n');
  
  try {
    const dashboard = await generateStatusDashboard();
    
    console.log('\n📊 Summary:');
    console.log(`  Healthy: ${dashboard.summary.healthy}/${dashboard.summary.total_sources}`);
    console.log(`  Stale: ${dashboard.summary.stale}`);
    console.log(`  Critical: ${dashboard.summary.critical}`);
    console.log(`  Not Configured: ${dashboard.summary.not_configured}`);
    console.log(`  Total Records: ${dashboard.summary.total_records.toLocaleString()}`);
    
    console.log('\n✅ Status dashboard generated successfully!');
    console.log('\nView dashboard:');
    console.log(`  JSON: ${path.join(DATA_DIR, 'status-dashboard.json')}`);
    console.log(`  HTML: Open ${path.join(DATA_DIR, 'status-dashboard.html')} in browser`);
    
  } catch (error) {
    console.error('\n❌ Error generating dashboard:', error);
    process.exit(1);
  }
}

// Run
main();