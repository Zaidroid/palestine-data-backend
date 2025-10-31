/**
 * Economic Data Transformer (JavaScript)
 * 
 * Transforms economic indicator data from World Bank and other sources
 * into the unified EconomicData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class EconomicTransformer extends BaseTransformer {
  constructor() {
    super('economic');
  }

  /**
   * Transform raw World Bank data to unified format
   */
  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : 
                    (rawData.data ? rawData.data : []);
    
    return records
      .filter(record => record && record.value !== null && record.value !== undefined)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  /**
   * Transform a single economic record
   */
  transformRecord(record, metadata, index) {
    const indicatorCode = record.indicator || record.indicator_code || metadata.indicator_code || 'UNKNOWN';
    const indicatorName = record.indicator_name || metadata.indicator_name || 'Unknown Indicator';
    const year = record.year || new Date(record.date).getFullYear();
    const date = `${year}-01-01`;
    
    return {
      // Identity
      id: this.generateId('economic', { ...record, date }),
      type: 'economic',
      category: 'economic',
      
      // Temporal
      date: date,
      timestamp: new Date(date).toISOString(),
      period: {
        type: 'year',
        value: year.toString(),
      },
      
      // Spatial
      location: {
        name: record.country || 'Palestine',
        admin_levels: {
          level1: 'Palestine',
        },
        region: 'palestine',
      },
      
      // Data
      value: parseFloat(record.value),
      unit: this.detectUnit(indicatorName),
      
      // Economic-specific
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
      
      // Quality
      quality: this.enrichQuality({
        id: this.generateId('economic', record),
        date,
        location: { name: 'Palestine' },
        value: record.value,
      }).quality,
      
      // Provenance
      sources: [{
        name: metadata.source || 'World Bank',
        organization: metadata.organization || 'World Bank',
        fetched_at: new Date().toISOString(),
      }],
      
      // Metadata
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };
  }

  /**
   * Detect unit from indicator name
   */
  detectUnit(indicatorName) {
    const name = indicatorName.toLowerCase();
    
    if (name.includes('(% of') || name.includes('(%)')) return 'percentage';
    if (name.includes('us$') || name.includes('usd')) return 'currency_usd';
    if (name.includes('per 1,000')) return 'per_1000';
    if (name.includes('per 100,000')) return 'per_100000';
    if (name.includes('per 100 people')) return 'per_100';
    if (name.includes('kwh')) return 'kwh';
    if (name.includes('metric tons')) return 'metric_tons';
    if (name.includes('births per woman')) return 'births_per_woman';
    if (name.includes('years')) return 'years';
    
    return 'number';
  }

  /**
   * Enrich with trend analysis
   */
  enrich(data) {
    // Group by indicator
    const byIndicator = {};
    data.forEach(record => {
      const code = record.indicator_code;
      if (!byIndicator[code]) byIndicator[code] = [];
      byIndicator[code].push(record);
    });

    // Add trend analysis to each record
    return data.map(record => {
      const timeSeries = byIndicator[record.indicator_code] || [];
      const analysis = this.calculateTrendAnalysis(timeSeries, record);
      
      return {
        ...record,
        analysis,
      };
    });
  }

  /**
   * Calculate trend analysis
   */
  calculateTrendAnalysis(timeSeries, currentRecord) {
    if (timeSeries.length < 2) return null;

    // Sort by date
    const sorted = [...timeSeries].sort((a, b) => a.date.localeCompare(b.date));
    const values = sorted.map(r => r.value);
    
    // Calculate trend
    const trend = this.calculateLinearTrend(values);
    const growthRate = this.calculateAverageGrowth(values);
    const volatility = this.calculateStdDev(values);
    
    // Recent change (last year)
    const currentIndex = sorted.findIndex(r => r.date === currentRecord.date);
    const recentChange = currentIndex > 0 
      ? ((sorted[currentIndex].value - sorted[currentIndex - 1].value) / sorted[currentIndex - 1].value) * 100
      : 0;

    // Baseline comparison
    const baselineDate = '2023-10-07';
    const baselineComparison = this.compareToBaseline(sorted, baselineDate, currentRecord);

    return {
      trend,
      growth_rate: growthRate,
      volatility,
      recent_change: recentChange,
      baseline_comparison: baselineComparison,
    };
  }

  /**
   * Calculate linear trend
   */
  calculateLinearTrend(values) {
    if (values.length < 2) return { slope: 0, direction: 'stable' };

    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    let direction = 'stable';
    if (slope > 0.01) direction = 'increasing';
    else if (slope < -0.01) direction = 'decreasing';

    return { slope, direction };
  }

  /**
   * Calculate average growth rate
   */
  calculateAverageGrowth(values) {
    if (values.length < 2) return 0;

    let totalGrowth = 0;
    let count = 0;

    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] !== 0) {
        totalGrowth += ((values[i] - values[i - 1]) / values[i - 1]) * 100;
        count++;
      }
    }

    return count > 0 ? totalGrowth / count : 0;
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values) {
    if (values.length < 2) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;

    return Math.sqrt(variance);
  }

  /**
   * Compare to baseline
   */
  compareToBaseline(timeSeries, baselineDate, currentRecord) {
    const baseline = timeSeries.find(r => r.date <= baselineDate);
    if (!baseline) return 0;

    const change = currentRecord.value - baseline.value;
    const percentChange = baseline.value !== 0 
      ? (change / baseline.value) * 100 
      : 0;

    return percentChange;
  }
}

export default EconomicTransformer;
