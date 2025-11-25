/**
 * Time Series Validation Utilities for Standardized Schema
 *
 * Provides comprehensive validation for time-series data including:
 * - Continuity checks
 * - Outlier detection
 * - Trend analysis
 * - Missing data interpolation
 * - Seasonal adjustment validation
 */

import { standardizedSchema } from './standardized-schema.js';

class TimeSeriesValidator {
  constructor(options = {}) {
    this.options = {
      maxGapDays: options.maxGapDays || 30,
      outlierThreshold: options.outlierThreshold || 3,
      minDataPoints: options.minDataPoints || 3,
      allowInterpolation: options.allowInterpolation !== false,
      seasonalAdjustment: options.seasonalAdjustment || false,
      ...options
    };
  }

  /**
   * Validate time series data structure and continuity
   */
  validateTimeSeries(dataset) {
    const errors = [];
    const warnings = [];
    const records = dataset.data_structure?.records || [];

    if (!records.length) {
      errors.push('No records found in dataset');
      return { isValid: false, errors, warnings, score: 0 };
    }

    // Sort records by date
    const sortedRecords = this.sortRecordsByDate(records);

    // Check for required date fields
    const dateValidation = this.validateDateFields(sortedRecords);
    errors.push(...dateValidation.errors);
    warnings.push(...dateValidation.warnings);

    // Check time series continuity
    const continuityCheck = this.checkContinuity(sortedRecords);
    errors.push(...continuityCheck.errors);
    warnings.push(...continuityCheck.warnings);

    // Detect outliers
    const outlierCheck = this.detectOutliers(sortedRecords);
    warnings.push(...outlierCheck.warnings);

    // Validate trends and patterns
    const trendValidation = this.validateTrends(sortedRecords);
    warnings.push(...trendValidation.warnings);

    // Calculate overall score
    const score = this.calculateValidationScore(errors, warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score,
      metadata: {
        totalRecords: records.length,
        dateRange: this.getDateRange(sortedRecords),
        gaps: continuityCheck.gaps,
        outliers: outlierCheck.outliers,
        trend: trendValidation.trend
      }
    };
  }

  /**
   * Sort records by date
   */
  sortRecordsByDate(records) {
    return records.sort((a, b) => {
      const dateA = new Date(a.date?.recorded || a.date?.start_date);
      const dateB = new Date(b.date?.recorded || b.date?.start_date);
      return dateA - dateB;
    });
  }

  /**
   * Validate date fields in records
   */
  validateDateFields(records) {
    const errors = [];
    const warnings = [];

    records.forEach((record, index) => {
      if (!record.date) {
        errors.push(`Record ${index}: Missing date field`);
        return;
      }

      const date = record.date.recorded || record.date.start_date;
      if (!date) {
        errors.push(`Record ${index}: No valid date found`);
        return;
      }

      // Check if date is valid
      const parsedDate = new Date(date);
      if (isNaN(parsedDate.getTime())) {
        errors.push(`Record ${index}: Invalid date format: ${date}`);
      }

      // Check date range (not in future, not too old)
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const tenYearsAgo = new Date(now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000);

      if (parsedDate > now) {
        warnings.push(`Record ${index}: Date is in the future: ${date}`);
      }

      if (parsedDate < tenYearsAgo) {
        warnings.push(`Record ${index}: Date is very old (more than 10 years): ${date}`);
      }
    });

    return { errors, warnings };
  }

  /**
   * Check time series continuity
   */
  checkContinuity(records) {
    const errors = [];
    const warnings = [];
    const gaps = [];

    if (records.length < 2) {
      return { errors, warnings, gaps };
    }

    // Determine expected frequency from data
    const frequency = this.determineFrequency(records);

    for (let i = 1; i < records.length; i++) {
      const prevDate = new Date(records[i-1].date?.recorded || records[i-1].date?.start_date);
      const currDate = new Date(records[i].date?.recorded || records[i].date?.start_date);

      const gapDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);

      // Check for gaps based on frequency
      let expectedGap;
      switch (frequency) {
        case 'daily':
          expectedGap = 1;
          break;
        case 'weekly':
          expectedGap = 7;
          break;
        case 'monthly':
          expectedGap = 30; // Approximate
          break;
        case 'quarterly':
          expectedGap = 90; // Approximate
          break;
        case 'yearly':
          expectedGap = 365; // Approximate
          break;
        default:
          expectedGap = 30; // Default monthly
      }

      if (gapDays > expectedGap * 2) { // Allow some flexibility
        const gap = {
          startDate: prevDate.toISOString(),
          endDate: currDate.toISOString(),
          gapDays: Math.round(gapDays),
          expectedGap: expectedGap
        };
        gaps.push(gap);

        if (gapDays > this.options.maxGapDays) {
          errors.push(`Large gap detected: ${gapDays} days between ${prevDate.toISOString()} and ${currDate.toISOString()}`);
        } else {
          warnings.push(`Gap detected: ${gapDays} days between records`);
        }
      }
    }

    return { errors, warnings, gaps };
  }

  /**
   * Determine data frequency from records
   */
  determineFrequency(records) {
    if (records.length < 3) return 'unknown';

    const intervals = [];
    for (let i = 1; i < records.length; i++) {
      const prev = new Date(records[i-1].date?.recorded || records[i-1].date?.start_date);
      const curr = new Date(records[i].date?.recorded || records[i].date?.start_date);
      intervals.push(curr - prev);
    }

    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const avgDays = avgInterval / (1000 * 60 * 60 * 24);

    if (avgDays <= 2) return 'daily';
    if (avgDays <= 10) return 'weekly';
    if (avgDays <= 40) return 'monthly';
    if (avgDays <= 100) return 'quarterly';
    return 'yearly';
  }

  /**
   * Detect outliers in time series data
   */
  detectOutliers(records) {
    const warnings = [];
    const outliers = [];

    if (records.length < this.options.minDataPoints) {
      return { warnings, outliers };
    }

    // Extract numeric values
    const values = records
      .map(r => r.values?.primary_value)
      .filter(v => typeof v === 'number' && !isNaN(v));

    if (values.length < this.options.minDataPoints) {
      warnings.push('Insufficient numeric values for outlier detection');
      return { warnings, outliers };
    }

    // Calculate statistics
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Detect outliers using z-score
    records.forEach((record, index) => {
      const value = record.values?.primary_value;
      if (typeof value === 'number' && !isNaN(value)) {
        const zScore = Math.abs((value - mean) / stdDev);
        if (zScore > this.options.outlierThreshold) {
          outliers.push({
            index,
            value,
            zScore,
            date: record.date?.recorded || record.date?.start_date
          });
          warnings.push(`Potential outlier detected at ${record.date?.recorded || record.date?.start_date}: value ${value} (z-score: ${zScore.toFixed(2)})`);
        }
      }
    });

    return { warnings, outliers };
  }

  /**
   * Validate trends and patterns
   */
  validateTrends(records) {
    const warnings = [];
    const trend = { direction: 'unknown', strength: 0 };

    if (records.length < this.options.minDataPoints) {
      return { warnings, trend };
    }

    // Simple linear trend analysis
    const numericRecords = records.filter(r =>
      typeof r.values?.primary_value === 'number' && !isNaN(r.values.primary_value)
    );

    if (numericRecords.length < this.options.minDataPoints) {
      warnings.push('Insufficient numeric data for trend analysis');
      return { warnings, trend };
    }

    // Calculate trend using linear regression
    const n = numericRecords.length;
    const sumX = numericRecords.reduce((sum, _, i) => sum + i, 0);
    const sumY = numericRecords.reduce((sum, r) => sum + r.values.primary_value, 0);
    const sumXY = numericRecords.reduce((sum, r, i) => sum + i * r.values.primary_value, 0);
    const sumXX = numericRecords.reduce((sum, _, i) => sum + i * i, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssRes = numericRecords.reduce((sum, r, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(r.values.primary_value - predicted, 2);
    }, 0);
    const ssTot = numericRecords.reduce((sum, r) => sum + Math.pow(r.values.primary_value - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);

    trend.strength = rSquared;
    trend.slope = slope;
    trend.direction = slope > 0.01 ? 'increasing' : slope < -0.01 ? 'decreasing' : 'stable';

    if (rSquared < 0.1) {
      warnings.push(`Weak trend detected (R² = ${rSquared.toFixed(3)})`);
    }

    return { warnings, trend };
  }

  /**
   * Get date range of records
   */
  getDateRange(records) {
    if (!records.length) return null;

    const dates = records
      .map(r => new Date(r.date?.recorded || r.date?.start_date))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);

    return {
      start: dates[0]?.toISOString(),
      end: dates[dates.length - 1]?.toISOString(),
      span: dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24) : 0
    };
  }

  /**
   * Calculate validation score
   */
  calculateValidationScore(errors, warnings) {
    const baseScore = 100;
    const errorPenalty = 20;
    const warningPenalty = 5;

    let score = baseScore - (errors.length * errorPenalty) - (warnings.length * warningPenalty);
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Interpolate missing values (if enabled)
   */
  interpolateMissingValues(records) {
    if (!this.options.allowInterpolation) return records;

    // Implementation for linear interpolation of missing values
    // This is a simplified version - production would need more sophisticated methods
    const interpolated = [...records];

    for (let i = 0; i < interpolated.length; i++) {
      if (interpolated[i].values?.primary_value == null) {
        // Find nearest non-null values
        let before = i - 1;
        let after = i + 1;

        while (before >= 0 && interpolated[before].values?.primary_value == null) before--;
        while (after < interpolated.length && interpolated[after].values?.primary_value == null) after++;

        if (before >= 0 && after < interpolated.length) {
          const valBefore = interpolated[before].values.primary_value;
          const valAfter = interpolated[after].values.primary_value;
          const interpolatedValue = (valBefore + valAfter) / 2;

          interpolated[i].values.primary_value = interpolatedValue;
          interpolated[i].values.interpolated = true;
          interpolated[i].values.interpolation_method = 'linear';
        }
      }
    }

    return interpolated;
  }

  /**
   * Apply seasonal adjustment (if enabled)
   */
  applySeasonalAdjustment(records) {
    if (!this.options.seasonalAdjustment) return records;

    // Simplified seasonal adjustment - production would use more sophisticated methods
    // This is just a placeholder for the concept
    return records.map(record => ({
      ...record,
      values: {
        ...record.values,
        seasonally_adjusted: record.values?.primary_value,
        seasonal_factor: 1.0
      }
    }));
  }
}

// Export utilities
export { TimeSeriesValidator };

export default TimeSeriesValidator;
