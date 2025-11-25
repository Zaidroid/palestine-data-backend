/**
 * PCBS Data Transformer
 * 
 * Transforms PCBS (Palestinian Central Bureau of Statistics) data
 * into the unified data model format.
 * 
 * Handles both:
 * - Economic indicators (GDP, inflation, trade, etc.)
 * - Population/demographic data
 * - Labor statistics
 * - Social indicators (education, health, poverty)
 */

import { BaseTransformer } from './base-transformer.js';

export class PCBSTransformer extends BaseTransformer {
  constructor() {
    super('pcbs');
  }

  /**
   * Transform raw PCBS data to unified format
   */
  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData :
      (rawData.data ? rawData.data : []);

    return records
      .filter(record => record && record.value !== null && record.value !== undefined)
      .map((record, index) => this.transformRecord(record, metadata, index));
  }

  /**
   * Transform a single PCBS record
   */
  transformRecord(record, metadata, index) {
    const indicatorCode = record.indicator || record.indicator_code || metadata.indicator_code || 'UNKNOWN';
    const indicatorName = record.indicator_name || metadata.indicator_name || 'Unknown Indicator';
    const category = this.determineCategory(indicatorCode, indicatorName);
    const year = record.year || new Date(record.date).getFullYear();
    const date = `${year}-01-01`;

    // Determine the unified data type based on category
    const unifiedType = this.getUnifiedType(category);

    const baseRecord = {
      // Identity
      id: this.generateId('pcbs', { ...record, date }),
      type: unifiedType,
      category: category,

      // Temporal
      date: date,
      timestamp: new Date(date).toISOString(),
      period: {
        type: 'year',
        value: year.toString(),
      },

      // Spatial
      location: this.createPalestineLocation(record),

      // Data
      value: parseFloat(record.value),
      unit: this.detectUnit(indicatorName, indicatorCode),

      // Quality
      quality: this.enrichQuality({
        id: this.generateId('pcbs', record),
        date,
        location: { name: record.region || 'Palestine' },
        value: record.value,
      }).quality,

      // Provenance
      sources: [{
        name: 'Palestinian Central Bureau of Statistics (PCBS)',
        organization: 'PCBS',
        url: record.source_detail === 'PCBS via World Bank API'
          ? 'https://api.worldbank.org/v2'
          : 'https://www.pcbs.gov.ps',
        fetched_at: new Date().toISOString(),
        reliability_score: 0.95, // PCBS is official source
      }],

      // Metadata
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    };

    // Add category-specific fields
    if (unifiedType === 'economic') {
      return {
        ...baseRecord,
        indicator_code: indicatorCode,
        indicator_name: indicatorName,
      };
    } else if (unifiedType === 'population') {
      return {
        ...baseRecord,
        indicator_code: indicatorCode,
        indicator_name: indicatorName,
        demographic_category: this.getDemographicCategory(indicatorCode),
      };
    }

    return {
      ...baseRecord,
      indicator_code: indicatorCode,
      indicator_name: indicatorName,
    };
  }

  /**
   * Determine category from indicator code and name
   */
  determineCategory(indicatorCode, indicatorName) {
    const code = indicatorCode.toUpperCase();
    const name = indicatorName.toLowerCase();

    // Population indicators
    if (code.startsWith('SP.POP') || code.startsWith('SP.DYN') ||
      name.includes('population') || name.includes('birth rate') ||
      name.includes('death rate') || name.includes('life expectancy')) {
      return 'population';
    }

    // Labor indicators
    if (code.startsWith('SL.') || name.includes('unemployment') ||
      name.includes('labor force') || name.includes('employment')) {
      return 'labor';
    }

    // Economic indicators
    if (code.startsWith('NY.') || code.startsWith('NV.') ||
      code.startsWith('NE.') || code.startsWith('FP.') ||
      name.includes('gdp') || name.includes('inflation') ||
      name.includes('trade') || name.includes('economic')) {
      return 'economic';
    }

    // Poverty indicators
    if (code.startsWith('SI.POV') || code.startsWith('SI.DST') ||
      name.includes('poverty') || name.includes('gini') ||
      name.includes('income share')) {
      return 'poverty';
    }

    // Education indicators
    if (code.startsWith('SE.') || name.includes('education') ||
      name.includes('school') || name.includes('literacy')) {
      return 'education';
    }

    // Health indicators
    if (code.startsWith('SH.') && !code.startsWith('SH.H2O') && !code.startsWith('SH.STA.BASS')) {
      return 'health';
    }

    // Housing/infrastructure indicators
    if (code.startsWith('EG.ELC') || code.startsWith('SH.H2O') ||
      code.startsWith('SH.STA.BASS') || name.includes('electricity') ||
      name.includes('water') || name.includes('sanitation')) {
      return 'housing';
    }

    return 'other';
  }

  /**
   * Get unified data type based on category
   */
  getUnifiedType(category) {
    const typeMapping = {
      'economic': 'economic',
      'population': 'population',
      'labor': 'economic', // Labor stats are economic indicators
      'poverty': 'economic', // Poverty stats are economic indicators
      'education': 'education',
      'health': 'health',
      'housing': 'infrastructure',
      'other': 'other',
    };

    return typeMapping[category] || 'other';
  }

  /**
   * Get demographic category for population indicators
   */
  getDemographicCategory(indicatorCode) {
    const code = indicatorCode.toUpperCase();

    if (code.includes('POP.TOTL')) return 'total_population';
    if (code.includes('POP.GROW')) return 'population_growth';
    if (code.includes('URB')) return 'urbanization';
    if (code.includes('0014')) return 'age_0_14';
    if (code.includes('1564')) return 'age_15_64';
    if (code.includes('65UP')) return 'age_65_plus';
    if (code.includes('TFRT')) return 'fertility';
    if (code.includes('LE00')) return 'life_expectancy';
    if (code.includes('CBRT')) return 'birth_rate';
    if (code.includes('CDRT')) return 'death_rate';
    if (code.includes('DPND')) return 'dependency_ratio';

    return 'general';
  }

  /**
   * Create Palestine location object
   */
  createPalestineLocation(record) {
    const region = record.region || 'palestine';

    return {
      name: this.formatRegionName(region),
      admin_levels: {
        level1: 'Palestine',
        level2: region !== 'palestine' ? this.formatRegionName(region) : undefined,
      },
      region: this.normalizeRegion(region),
    };
  }

  /**
   * Format region name
   */
  formatRegionName(region) {
    const regionMap = {
      'palestine': 'Palestine',
      'gaza': 'Gaza Strip',
      'west_bank': 'West Bank',
      'westbank': 'West Bank',
      'east_jerusalem': 'East Jerusalem',
    };

    return regionMap[region.toLowerCase()] || region;
  }

  /**
   * Normalize region identifier
   */
  normalizeRegion(region) {
    const normalized = region.toLowerCase().replace(/\s+/g, '_');

    if (normalized.includes('gaza')) return 'Gaza Strip';
    if (normalized.includes('west') && normalized.includes('bank')) return 'West Bank';
    if (normalized.includes('jerusalem')) return 'East Jerusalem';

    return 'Palestine';
  }

  /**
   * Detect unit from indicator name and code
   */
  detectUnit(indicatorName, indicatorCode) {
    const name = indicatorName.toLowerCase();
    const code = indicatorCode.toUpperCase();

    // Percentage indicators
    if (name.includes('(% of') || name.includes('(%)') || name.includes('percent')) {
      return 'percentage';
    }

    // Currency indicators
    if (name.includes('us$') || name.includes('usd') || code.includes('CD')) {
      return 'currency_usd';
    }

    // Rate per population
    if (name.includes('per 1,000')) return 'per_1000';
    if (name.includes('per 100,000')) return 'per_100000';
    if (name.includes('per 100 people')) return 'per_100';

    // Specific units
    if (name.includes('births per woman')) return 'births_per_woman';
    if (name.includes('years')) return 'years';
    if (name.includes('ratio')) return 'ratio';
    if (name.includes('index')) return 'index';

    // Count/number
    if (code.includes('TOTL.IN') || name.includes('total')) return 'count';

    return 'number';
  }

  /**
   * Enrich with trend analysis and comparative context
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
        pcbs_metadata: {
          official_source: true,
          data_quality: 'high',
          update_frequency: this.getUpdateFrequency(record.indicator_code),
        },
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

    // Baseline comparison (October 7, 2023)
    const baselineDate = '2023-10-07';
    const baselineComparison = this.compareToBaseline(sorted, baselineDate, currentRecord);

    return {
      trend,
      growth_rate: growthRate,
      volatility,
      recent_change: recentChange,
      baseline_comparison: baselineComparison,
      data_points: timeSeries.length,
      date_range: {
        start: sorted[0].date,
        end: sorted[sorted.length - 1].date,
      },
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
    // Find closest data point before or at baseline
    const baseline = timeSeries
      .filter(r => r.date <= baselineDate)
      .sort((a, b) => b.date.localeCompare(a.date))[0];

    if (!baseline) return 0;

    const change = currentRecord.value - baseline.value;
    const percentChange = baseline.value !== 0
      ? (change / baseline.value) * 100
      : 0;

    return percentChange;
  }

  /**
   * Get update frequency for indicator
   */
  getUpdateFrequency(indicatorCode) {
    const code = indicatorCode.toUpperCase();

    // Annual indicators
    if (code.startsWith('NY.') || code.startsWith('SP.POP') ||
      code.startsWith('SE.') || code.startsWith('SH.')) {
      return 'annual';
    }

    // Quarterly indicators
    if (code.startsWith('SL.') || code.includes('GDP')) {
      return 'quarterly';
    }

    // Monthly indicators
    if (code.includes('CPI') || code.includes('INFLATION')) {
      return 'monthly';
    }

    return 'annual';
  }

  /**
   * Validate PCBS data
   */
  validate(data) {
    const errors = [];
    const warnings = [];

    data.forEach((record, index) => {
      // Check required fields
      if (!record.indicator_code) {
        errors.push(`Record ${index}: Missing indicator_code`);
      }
      if (!record.value && record.value !== 0) {
        errors.push(`Record ${index}: Missing value`);
      }
      if (!record.date) {
        errors.push(`Record ${index}: Missing date`);
      }

      // Check value ranges
      if (record.unit === 'percentage' && (record.value < 0 || record.value > 100)) {
        warnings.push(`Record ${index}: Percentage value out of range (${record.value})`);
      }

      // Check date validity
      if (record.date) {
        const year = parseInt(record.date.split('-')[0]);
        if (year < 1990 || year > new Date().getFullYear() + 1) {
          warnings.push(`Record ${index}: Unusual year (${year})`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalRecords: data.length,
      validRecords: data.length - errors.length,
    };
  }
}

export default PCBSTransformer;
