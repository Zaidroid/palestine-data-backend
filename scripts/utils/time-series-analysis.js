/**
 * Time Series Analysis Functions
 * 
 * Provides functions for analyzing time series data including trend detection,
 * seasonality analysis, autocorrelation, and simple forecasting.
 */

import { calculateMean, calculateStdDev } from './descriptive-statistics.js';

/**
 * Calculate linear trend (slope and direction)
 */
export function calculateLinearTrend(values) {
  if (!values || values.length < 2) {
    return { slope: 0, direction: 'stable', r_squared: 0 };
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length < 2) {
    return { slope: 0, direction: 'stable', r_squared: 0 };
  }
  
  const n = validValues.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = validValues;
  
  // Calculate means
  const xMean = calculateMean(x);
  const yMean = calculateMean(y);
  
  // Calculate slope using least squares
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - xMean) * (y[i] - yMean);
    denominator += Math.pow(x[i] - xMean, 2);
  }
  
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  
  // Calculate R-squared
  let ssRes = 0;
  let ssTot = 0;
  
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept;
    ssRes += Math.pow(y[i] - predicted, 2);
    ssTot += Math.pow(y[i] - yMean, 2);
  }
  
  const rSquared = ssTot === 0 ? 0 : 1 - (ssRes / ssTot);
  
  // Determine direction
  let direction = 'stable';
  if (Math.abs(slope) > 0.01) {
    direction = slope > 0 ? 'increasing' : 'decreasing';
  }
  
  return {
    slope,
    intercept,
    direction,
    r_squared: rSquared,
    strength: Math.abs(rSquared) > 0.7 ? 'strong' : Math.abs(rSquared) > 0.4 ? 'moderate' : 'weak',
  };
}

/**
 * Detect seasonality patterns
 */
export function detectSeasonality(timeSeries, period = 7) {
  if (!timeSeries || timeSeries.length < period * 2) {
    return {
      has_seasonality: false,
      period: null,
      strength: 0,
    };
  }
  
  const values = timeSeries.map(item => 
    typeof item === 'object' ? (item.value || item.incidents || 0) : item
  );
  
  // Calculate autocorrelation at the specified lag
  const autocorr = calculateAutocorrelation(values, period);
  
  // Seasonality is present if autocorrelation is significant
  const hasSeasonality = Math.abs(autocorr) > 0.3;
  
  return {
    has_seasonality: hasSeasonality,
    period: hasSeasonality ? period : null,
    strength: Math.abs(autocorr),
    autocorrelation: autocorr,
  };
}

/**
 * Calculate autocorrelation at a specific lag
 */
export function calculateAutocorrelation(values, lag = 1) {
  if (!values || values.length < lag + 1) {
    return 0;
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length < lag + 1) {
    return 0;
  }
  
  const n = validValues.length;
  const mean = calculateMean(validValues);
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n - lag; i++) {
    numerator += (validValues[i] - mean) * (validValues[i + lag] - mean);
  }
  
  for (let i = 0; i < n; i++) {
    denominator += Math.pow(validValues[i] - mean, 2);
  }
  
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Calculate autocorrelation function (ACF) for multiple lags
 */
export function calculateACF(values, maxLag = 10) {
  const acf = [];
  
  for (let lag = 0; lag <= maxLag; lag++) {
    acf.push({
      lag,
      correlation: calculateAutocorrelation(values, lag),
    });
  }
  
  return acf;
}

/**
 * Calculate moving average
 */
export function calculateMovingAverage(values, windowSize = 7) {
  if (!values || values.length === 0) {
    return [];
  }
  
  const result = [];
  
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = values.slice(start, i + 1);
    const avg = calculateMean(window);
    
    result.push({
      index: i,
      value: values[i],
      moving_average: avg,
      window_size: window.length,
    });
  }
  
  return result;
}

/**
 * Calculate exponential moving average (EMA)
 */
export function calculateEMA(values, alpha = 0.3) {
  if (!values || values.length === 0) {
    return [];
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length === 0) {
    return [];
  }
  
  const result = [];
  let ema = validValues[0];
  
  result.push({
    index: 0,
    value: validValues[0],
    ema: ema,
  });
  
  for (let i = 1; i < validValues.length; i++) {
    ema = alpha * validValues[i] + (1 - alpha) * ema;
    
    result.push({
      index: i,
      value: validValues[i],
      ema: ema,
    });
  }
  
  return result;
}

/**
 * Decompose time series into trend, seasonal, and residual components
 */
export function decomposeTimeSeries(timeSeries, period = 7) {
  if (!timeSeries || timeSeries.length < period * 2) {
    return {
      trend: [],
      seasonal: [],
      residual: [],
    };
  }
  
  const values = timeSeries.map(item => 
    typeof item === 'object' ? (item.value || item.incidents || 0) : item
  );
  
  // Calculate trend using moving average
  const trend = calculateMovingAverage(values, period).map(item => item.moving_average);
  
  // Calculate detrended series
  const detrended = values.map((val, i) => val - (trend[i] || 0));
  
  // Calculate seasonal component (average for each position in period)
  const seasonal = [];
  const seasonalAverages = new Array(period).fill(0);
  const seasonalCounts = new Array(period).fill(0);
  
  detrended.forEach((val, i) => {
    const seasonIndex = i % period;
    seasonalAverages[seasonIndex] += val;
    seasonalCounts[seasonIndex]++;
  });
  
  for (let i = 0; i < period; i++) {
    if (seasonalCounts[i] > 0) {
      seasonalAverages[i] /= seasonalCounts[i];
    }
  }
  
  // Apply seasonal pattern to full series
  values.forEach((_, i) => {
    seasonal.push(seasonalAverages[i % period]);
  });
  
  // Calculate residual
  const residual = values.map((val, i) => val - (trend[i] || 0) - seasonal[i]);
  
  return {
    trend,
    seasonal,
    residual,
    original: values,
  };
}

/**
 * Simple forecast using linear regression
 */
export function forecastLinear(values, periods = 7) {
  if (!values || values.length < 2) {
    return [];
  }
  
  const trend = calculateLinearTrend(values);
  const n = values.length;
  const forecast = [];
  
  for (let i = 0; i < periods; i++) {
    const x = n + i;
    const predicted = trend.slope * x + trend.intercept;
    
    forecast.push({
      period: i + 1,
      forecast: Math.max(0, predicted), // Ensure non-negative
      confidence: trend.r_squared,
    });
  }
  
  return forecast;
}

/**
 * Simple forecast using exponential smoothing
 */
export function forecastExponential(values, periods = 7, alpha = 0.3) {
  if (!values || values.length === 0) {
    return [];
  }
  
  const ema = calculateEMA(values, alpha);
  const lastEMA = ema[ema.length - 1].ema;
  
  const forecast = [];
  
  for (let i = 0; i < periods; i++) {
    forecast.push({
      period: i + 1,
      forecast: Math.max(0, lastEMA), // Constant forecast
      method: 'exponential_smoothing',
    });
  }
  
  return forecast;
}

/**
 * Detect change points in time series
 */
export function detectChangePoints(values, threshold = 2) {
  if (!values || values.length < 3) {
    return [];
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length < 3) {
    return [];
  }
  
  const mean = calculateMean(validValues);
  const stdDev = calculateStdDev(validValues);
  
  const changePoints = [];
  
  for (let i = 1; i < validValues.length - 1; i++) {
    const zScore = Math.abs((validValues[i] - mean) / stdDev);
    
    // Check if this point is significantly different from neighbors
    const prevDiff = Math.abs(validValues[i] - validValues[i - 1]);
    const nextDiff = Math.abs(validValues[i] - validValues[i + 1]);
    
    if (zScore > threshold && (prevDiff > stdDev || nextDiff > stdDev)) {
      changePoints.push({
        index: i,
        value: validValues[i],
        z_score: zScore,
        type: validValues[i] > mean ? 'spike' : 'drop',
      });
    }
  }
  
  return changePoints;
}

/**
 * Calculate growth rate
 */
export function calculateGrowthRate(values) {
  if (!values || values.length < 2) {
    return 0;
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v) && v !== 0);
  
  if (validValues.length < 2) {
    return 0;
  }
  
  const first = validValues[0];
  const last = validValues[validValues.length - 1];
  
  if (first === 0) return 0;
  
  return ((last - first) / first) * 100;
}

/**
 * Calculate compound annual growth rate (CAGR)
 */
export function calculateCAGR(startValue, endValue, periods) {
  if (startValue <= 0 || endValue <= 0 || periods <= 0) {
    return 0;
  }
  
  return (Math.pow(endValue / startValue, 1 / periods) - 1) * 100;
}

/**
 * Comprehensive time series analysis
 */
export function analyzeTimeSeries(timeSeries, options = {}) {
  const {
    period = 7,
    forecastPeriods = 7,
    maxLag = 10,
  } = options;
  
  const values = timeSeries.map(item => 
    typeof item === 'object' ? (item.value || item.incidents || 0) : item
  );
  
  const trend = calculateLinearTrend(values);
  const seasonality = detectSeasonality(timeSeries, period);
  const acf = calculateACF(values, maxLag);
  const decomposition = decomposeTimeSeries(timeSeries, period);
  const forecast = forecastLinear(values, forecastPeriods);
  const changePoints = detectChangePoints(values);
  const growthRate = calculateGrowthRate(values);
  
  return {
    trend,
    seasonality,
    acf,
    decomposition,
    forecast,
    change_points: changePoints,
    growth_rate: growthRate,
    summary: {
      has_trend: Math.abs(trend.slope) > 0.01,
      trend_direction: trend.direction,
      trend_strength: trend.strength,
      has_seasonality: seasonality.has_seasonality,
      seasonal_period: seasonality.period,
      volatility: calculateStdDev(values),
      change_point_count: changePoints.length,
    },
  };
}

export default {
  calculateLinearTrend,
  detectSeasonality,
  calculateAutocorrelation,
  calculateACF,
  calculateMovingAverage,
  calculateEMA,
  decomposeTimeSeries,
  forecastLinear,
  forecastExponential,
  detectChangePoints,
  calculateGrowthRate,
  calculateCAGR,
  analyzeTimeSeries,
};
