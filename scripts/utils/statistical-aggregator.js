/**
 * Statistical Aggregator Service
 * 
 * Combines spatial, temporal, descriptive statistics, and time series analysis
 * into a unified service for comprehensive data analysis.
 */

import {
  aggregateByRegion,
  aggregateByGovernorate,
  getTopRegions,
  compareRegions,
} from './spatial-aggregator.js';

import {
  aggregateByPeriod,
  calculatePeriodComparison,
  getRollingAggregation,
  aggregateByBaseline,
  getCumulativeTimeSeries,
} from './temporal-aggregator.js';

import {
  calculateComprehensiveStats,
  calculateMultiFieldStats,
  calculateCorrelation,
} from './descriptive-statistics.js';

import {
  analyzeTimeSeries,
  calculateLinearTrend,
  detectSeasonality,
} from './time-series-analysis.js';

/**
 * Perform comprehensive statistical analysis on a dataset
 */
export async function performComprehensiveAnalysis(data, options = {}) {
  const {
    includeRegional = true,
    includeTemporal = true,
    includeDescriptive = true,
    includeTimeSeries = true,
    baselineDate = '2023-10-07',
    forecastPeriods = 7,
  } = options;
  
  const analysis = {
    metadata: {
      total_records: data.length,
      analysis_date: new Date().toISOString(),
      baseline_date: baselineDate,
    },
  };
  
  // Regional analysis
  if (includeRegional) {
    analysis.regional = {
      by_region: aggregateByRegion(data),
      by_governorate: aggregateByGovernorate(data),
      top_regions: getTopRegions(aggregateByRegion(data), 'incident_count', 10),
    };
  }
  
  // Temporal analysis
  if (includeTemporal) {
    const dailyAgg = aggregateByPeriod(data, 'day');
    const weeklyAgg = aggregateByPeriod(data, 'week');
    const monthlyAgg = aggregateByPeriod(data, 'month');
    
    analysis.temporal = {
      daily: dailyAgg,
      weekly: weeklyAgg,
      monthly: monthlyAgg,
      daily_comparison: calculatePeriodComparison(dailyAgg),
      baseline_comparison: aggregateByBaseline(data, baselineDate),
      rolling_7day: getRollingAggregation(data, 7, 'incidents'),
      cumulative: getCumulativeTimeSeries(data, 'casualties'),
    };
  }
  
  // Descriptive statistics
  if (includeDescriptive) {
    const numericFields = ['fatalities', 'injuries', 'severity_index'];
    analysis.descriptive = calculateMultiFieldStats(data, numericFields);
  }
  
  // Time series analysis
  if (includeTimeSeries) {
    const dailyAgg = aggregateByPeriod(data, 'day');
    const timeSeries = Object.values(dailyAgg)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map(item => ({
        date: item.period,
        incidents: item.stats.incidents,
        casualties: item.stats.casualties,
      }));
    
    analysis.time_series = {
      incidents: analyzeTimeSeries(
        timeSeries.map(t => t.incidents),
        { forecastPeriods }
      ),
      casualties: analyzeTimeSeries(
        timeSeries.map(t => t.casualties),
        { forecastPeriods }
      ),
    };
  }
  
  return analysis;
}

/**
 * Generate summary report from analysis
 */
export function generateSummaryReport(analysis) {
  const report = {
    overview: {
      total_records: analysis.metadata.total_records,
      analysis_date: analysis.metadata.analysis_date,
    },
  };
  
  // Regional summary
  if (analysis.regional) {
    const regions = analysis.regional.by_region;
    report.regional_summary = {
      most_affected_region: analysis.regional.top_regions[0]?.region,
      total_incidents: Object.values(regions).reduce(
        (sum, r) => sum + r.stats.incident_count, 0
      ),
      total_casualties: Object.values(regions).reduce(
        (sum, r) => sum + r.stats.casualty_total, 0
      ),
    };
  }
  
  // Temporal summary
  if (analysis.temporal) {
    const baseline = analysis.temporal.baseline_comparison;
    report.temporal_summary = {
      baseline_date: analysis.metadata.baseline_date,
      incidents_before: baseline.before_baseline.stats.incidents,
      incidents_after: baseline.after_baseline.stats.incidents,
      change_percentage: baseline.comparison.changes.incidents.percentage,
    };
  }
  
  // Time series summary
  if (analysis.time_series) {
    const incidentTrend = analysis.time_series.incidents.trend;
    report.trend_summary = {
      direction: incidentTrend.direction,
      strength: incidentTrend.strength,
      has_seasonality: analysis.time_series.incidents.seasonality.has_seasonality,
    };
  }
  
  return report;
}

/**
 * Compare two datasets
 */
export function compareDatasets(dataset1, dataset2, label1 = 'Dataset 1', label2 = 'Dataset 2') {
  const stats1 = calculateComprehensiveStats(
    dataset1.map(d => d.fatalities || 0)
  );
  const stats2 = calculateComprehensiveStats(
    dataset2.map(d => d.fatalities || 0)
  );
  
  return {
    [label1]: stats1,
    [label2]: stats2,
    comparison: {
      mean_difference: stats2.mean - stats1.mean,
      median_difference: stats2.median - stats1.median,
      stddev_difference: stats2.stdDev - stats1.stdDev,
    },
  };
}

/**
 * Calculate correlation matrix for multiple fields
 */
export function calculateCorrelationMatrix(data, fields) {
  const matrix = {};
  
  fields.forEach(field1 => {
    matrix[field1] = {};
    
    fields.forEach(field2 => {
      const values1 = data.map(d => d[field1] || 0);
      const values2 = data.map(d => d[field2] || 0);
      
      matrix[field1][field2] = calculateCorrelation(values1, values2);
    });
  });
  
  return matrix;
}

/**
 * Export analysis to JSON file
 */
export function exportAnalysis(analysis, outputPath) {
  const fs = require('fs');
  const path = require('path');
  
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write analysis
  fs.writeFileSync(
    outputPath,
    JSON.stringify(analysis, null, 2),
    'utf-8'
  );
  
  console.log(`Analysis exported to ${outputPath}`);
}

export default {
  performComprehensiveAnalysis,
  generateSummaryReport,
  compareDatasets,
  calculateCorrelationMatrix,
  exportAnalysis,
};
