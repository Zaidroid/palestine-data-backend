/**
 * Test Statistical Analysis Functions
 * 
 * Demonstrates the usage of spatial, temporal, descriptive statistics,
 * and time series analysis functions with sample data.
 */

import {
  aggregateByRegion,
  aggregateByGovernorate,
  getTopRegions,
} from './utils/spatial-aggregator.js';

import {
  aggregateByPeriod,
  calculatePeriodComparison,
  getRollingAggregation,
  aggregateByBaseline,
} from './utils/temporal-aggregator.js';

import {
  calculateComprehensiveStats,
  detectOutliers,
} from './utils/descriptive-statistics.js';

import {
  analyzeTimeSeries,
  calculateLinearTrend,
} from './utils/time-series-analysis.js';

import {
  performComprehensiveAnalysis,
  generateSummaryReport,
} from './utils/statistical-aggregator.js';

/**
 * Generate sample conflict data for testing
 */
function generateSampleData() {
  const regions = ['gaza', 'west_bank', 'east_jerusalem'];
  const governorates = ['Gaza', 'Khan Yunis', 'Rafah', 'Jenin', 'Nablus', 'Hebron'];
  const eventTypes = ['airstrike', 'raid', 'shooting', 'arrest'];
  
  const data = [];
  const startDate = new Date('2023-10-01');
  
  for (let i = 0; i < 100; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    
    const region = regions[Math.floor(Math.random() * regions.length)];
    const governorate = governorates[Math.floor(Math.random() * governorates.length)];
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    // Generate more incidents after baseline (2023-10-07)
    const isAfterBaseline = date >= new Date('2023-10-07');
    const incidentMultiplier = isAfterBaseline ? 3 : 1;
    
    const fatalities = Math.floor(Math.random() * 10 * incidentMultiplier);
    const injuries = Math.floor(Math.random() * 20 * incidentMultiplier);
    
    data.push({
      id: `incident-${i}`,
      type: 'conflict',
      category: 'conflict',
      date: date.toISOString().split('T')[0],
      location: {
        name: governorate,
        region: region,
        admin_levels: {
          level1: governorate,
        },
        coordinates: [35.0 + Math.random(), 31.5 + Math.random()],
      },
      event_type: eventType,
      fatalities: fatalities,
      injuries: injuries,
      severity_index: (fatalities * 2 + injuries) / 10,
      value: fatalities + injuries,
    });
  }
  
  return data;
}

/**
 * Test spatial aggregation
 */
function testSpatialAggregation(data) {
  console.log('\n=== SPATIAL AGGREGATION TEST ===\n');
  
  // Aggregate by region
  const byRegion = aggregateByRegion(data);
  console.log('By Region:');
  Object.entries(byRegion).forEach(([region, info]) => {
    console.log(`  ${region}:`);
    console.log(`    Incidents: ${info.stats.incident_count}`);
    console.log(`    Casualties: ${info.stats.casualty_total}`);
    console.log(`    Fatalities: ${info.stats.fatalities}`);
    console.log(`    Injuries: ${info.stats.injuries}`);
  });
  
  // Aggregate by governorate
  const byGovernorate = aggregateByGovernorate(data);
  console.log('\nBy Governorate (top 5):');
  const topGovs = getTopRegions(byGovernorate, 'incident_count', 5);
  topGovs.forEach((gov, index) => {
    console.log(`  ${index + 1}. ${gov.region}: ${gov.value} incidents`);
  });
}

/**
 * Test temporal aggregation
 */
function testTemporalAggregation(data) {
  console.log('\n=== TEMPORAL AGGREGATION TEST ===\n');
  
  // Aggregate by week
  const byWeek = aggregateByPeriod(data, 'week');
  const weeks = Object.keys(byWeek).sort().slice(0, 5);
  
  console.log('By Week (first 5 weeks):');
  weeks.forEach(week => {
    const stats = byWeek[week].stats;
    console.log(`  ${week}:`);
    console.log(`    Incidents: ${stats.incidents}`);
    console.log(`    Casualties: ${stats.casualties}`);
  });
  
  // Period comparison
  const comparison = calculatePeriodComparison(byWeek);
  const firstComparison = Object.values(comparison)[0];
  
  if (firstComparison) {
    console.log('\nPeriod-over-Period Comparison (first comparison):');
    console.log(`  Period: ${firstComparison.period}`);
    console.log(`  Previous: ${firstComparison.previous_period}`);
    console.log(`  Incident Change: ${firstComparison.changes.incidents.absolute} (${firstComparison.changes.incidents.percentage.toFixed(1)}%)`);
    console.log(`  Casualty Change: ${firstComparison.changes.casualties.absolute} (${firstComparison.changes.casualties.percentage.toFixed(1)}%)`);
  }
  
  // Baseline comparison
  const baseline = aggregateByBaseline(data, '2023-10-07');
  console.log('\nBaseline Comparison (2023-10-07):');
  console.log(`  Before: ${baseline.before_baseline.stats.incidents} incidents, ${baseline.before_baseline.stats.casualties} casualties`);
  console.log(`  After: ${baseline.after_baseline.stats.incidents} incidents, ${baseline.after_baseline.stats.casualties} casualties`);
  console.log(`  Change: ${baseline.comparison.changes.incidents.percentage.toFixed(1)}% incidents, ${baseline.comparison.changes.casualties.percentage.toFixed(1)}% casualties`);
}

/**
 * Test descriptive statistics
 */
function testDescriptiveStatistics(data) {
  console.log('\n=== DESCRIPTIVE STATISTICS TEST ===\n');
  
  const fatalities = data.map(d => d.fatalities);
  const stats = calculateComprehensiveStats(fatalities);
  
  console.log('Fatalities Statistics:');
  console.log(`  Count: ${stats.count}`);
  console.log(`  Mean: ${stats.mean.toFixed(2)}`);
  console.log(`  Median: ${stats.median.toFixed(2)}`);
  console.log(`  Std Dev: ${stats.stdDev.toFixed(2)}`);
  console.log(`  Min: ${stats.min}`);
  console.log(`  Max: ${stats.max}`);
  console.log(`  Q1: ${stats.quartiles.q1.toFixed(2)}`);
  console.log(`  Q3: ${stats.quartiles.q3.toFixed(2)}`);
  console.log(`  IQR: ${stats.iqr.toFixed(2)}`);
  
  // Outlier detection
  const outliers = detectOutliers(fatalities);
  console.log(`\nOutliers Detected: ${outliers.outliers.length}`);
  if (outliers.outliers.length > 0) {
    console.log(`  Values: ${outliers.outliers.slice(0, 5).join(', ')}${outliers.outliers.length > 5 ? '...' : ''}`);
    console.log(`  Bounds: [${outliers.bounds.lower.toFixed(2)}, ${outliers.bounds.upper.toFixed(2)}]`);
  }
}

/**
 * Test time series analysis
 */
function testTimeSeriesAnalysis(data) {
  console.log('\n=== TIME SERIES ANALYSIS TEST ===\n');
  
  // Aggregate by day
  const byDay = aggregateByPeriod(data, 'day');
  const timeSeries = Object.values(byDay)
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(item => item.stats.incidents);
  
  // Analyze time series
  const analysis = analyzeTimeSeries(timeSeries, { forecastPeriods: 7 });
  
  console.log('Trend Analysis:');
  console.log(`  Direction: ${analysis.trend.direction}`);
  console.log(`  Slope: ${analysis.trend.slope.toFixed(4)}`);
  console.log(`  R-squared: ${analysis.trend.r_squared.toFixed(4)}`);
  console.log(`  Strength: ${analysis.trend.strength}`);
  
  console.log('\nSeasonality:');
  console.log(`  Has Seasonality: ${analysis.seasonality.has_seasonality}`);
  console.log(`  Period: ${analysis.seasonality.period || 'N/A'}`);
  console.log(`  Strength: ${analysis.seasonality.strength.toFixed(4)}`);
  
  console.log('\nForecast (next 7 periods):');
  analysis.forecast.slice(0, 3).forEach(f => {
    console.log(`  Period +${f.period}: ${f.forecast.toFixed(2)} incidents (confidence: ${f.confidence.toFixed(2)})`);
  });
  
  console.log('\nChange Points:');
  console.log(`  Detected: ${analysis.change_points.length}`);
  if (analysis.change_points.length > 0) {
    analysis.change_points.slice(0, 3).forEach(cp => {
      console.log(`    Index ${cp.index}: ${cp.value} (${cp.type}, z-score: ${cp.z_score.toFixed(2)})`);
    });
  }
}

/**
 * Test comprehensive analysis
 */
async function testComprehensiveAnalysis(data) {
  console.log('\n=== COMPREHENSIVE ANALYSIS TEST ===\n');
  
  const analysis = await performComprehensiveAnalysis(data, {
    includeRegional: true,
    includeTemporal: true,
    includeDescriptive: true,
    includeTimeSeries: true,
    baselineDate: '2023-10-07',
    forecastPeriods: 7,
  });
  
  const summary = generateSummaryReport(analysis);
  
  console.log('Summary Report:');
  console.log(`  Total Records: ${summary.overview.total_records}`);
  
  if (summary.regional_summary) {
    console.log(`  Most Affected Region: ${summary.regional_summary.most_affected_region}`);
    console.log(`  Total Incidents: ${summary.regional_summary.total_incidents}`);
    console.log(`  Total Casualties: ${summary.regional_summary.total_casualties}`);
  }
  
  if (summary.temporal_summary) {
    console.log(`  Baseline Date: ${summary.temporal_summary.baseline_date}`);
    console.log(`  Incidents Before: ${summary.temporal_summary.incidents_before}`);
    console.log(`  Incidents After: ${summary.temporal_summary.incidents_after}`);
    console.log(`  Change: ${summary.temporal_summary.change_percentage.toFixed(1)}%`);
  }
  
  if (summary.trend_summary) {
    console.log(`  Trend Direction: ${summary.trend_summary.direction}`);
    console.log(`  Trend Strength: ${summary.trend_summary.strength}`);
    console.log(`  Has Seasonality: ${summary.trend_summary.has_seasonality}`);
  }
  
  return analysis;
}

/**
 * Main test function
 */
async function runTests() {
  console.log('Generating sample data...');
  const data = generateSampleData();
  console.log(`Generated ${data.length} sample records`);
  
  testSpatialAggregation(data);
  testTemporalAggregation(data);
  testDescriptiveStatistics(data);
  testTimeSeriesAnalysis(data);
  await testComprehensiveAnalysis(data);
  
  console.log('\n=== ALL TESTS COMPLETED ===\n');
}

// Run tests
runTests().catch(console.error);
