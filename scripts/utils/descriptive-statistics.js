/**
 * Descriptive Statistics Functions
 * 
 * Provides advanced statistical calculations including mean, median, mode,
 * standard deviation, quartiles, and outlier detection.
 */

/**
 * Calculate mean (average)
 */
export function calculateMean(values) {
  if (!values || values.length === 0) return 0;
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length === 0) return 0;
  
  const sum = validValues.reduce((acc, val) => acc + val, 0);
  return sum / validValues.length;
}

/**
 * Calculate median (middle value)
 */
export function calculateMedian(values) {
  if (!values || values.length === 0) return 0;
  
  const validValues = values
    .filter(v => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => a - b);
  
  if (validValues.length === 0) return 0;
  
  const mid = Math.floor(validValues.length / 2);
  
  if (validValues.length % 2 === 0) {
    return (validValues[mid - 1] + validValues[mid]) / 2;
  } else {
    return validValues[mid];
  }
}

/**
 * Calculate mode (most frequent value)
 */
export function calculateMode(values) {
  if (!values || values.length === 0) return null;
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length === 0) return null;
  
  const frequency = {};
  let maxFreq = 0;
  let mode = null;
  
  validValues.forEach(value => {
    frequency[value] = (frequency[value] || 0) + 1;
    if (frequency[value] > maxFreq) {
      maxFreq = frequency[value];
      mode = value;
    }
  });
  
  return mode;
}

/**
 * Calculate standard deviation
 */
export function calculateStdDev(values) {
  if (!values || values.length === 0) return 0;
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length === 0) return 0;
  
  const mean = calculateMean(validValues);
  const squaredDiffs = validValues.map(value => Math.pow(value - mean, 2));
  const variance = calculateMean(squaredDiffs);
  
  return Math.sqrt(variance);
}

/**
 * Calculate variance
 */
export function calculateVariance(values) {
  if (!values || values.length === 0) return 0;
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length === 0) return 0;
  
  const mean = calculateMean(validValues);
  const squaredDiffs = validValues.map(value => Math.pow(value - mean, 2));
  
  return calculateMean(squaredDiffs);
}

/**
 * Calculate quartiles (Q1, Q2/median, Q3)
 */
export function calculateQuartiles(values) {
  if (!values || values.length === 0) {
    return { q1: 0, q2: 0, q3: 0 };
  }
  
  const validValues = values
    .filter(v => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => a - b);
  
  if (validValues.length === 0) {
    return { q1: 0, q2: 0, q3: 0 };
  }
  
  const q2 = calculateMedian(validValues);
  
  const mid = Math.floor(validValues.length / 2);
  const lowerHalf = validValues.slice(0, mid);
  const upperHalf = validValues.length % 2 === 0 
    ? validValues.slice(mid)
    : validValues.slice(mid + 1);
  
  const q1 = calculateMedian(lowerHalf);
  const q3 = calculateMedian(upperHalf);
  
  return { q1, q2, q3 };
}

/**
 * Calculate interquartile range (IQR)
 */
export function calculateIQR(values) {
  const quartiles = calculateQuartiles(values);
  return quartiles.q3 - quartiles.q1;
}

/**
 * Calculate min and max
 */
export function calculateMinMax(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0 };
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length === 0) {
    return { min: 0, max: 0 };
  }
  
  return {
    min: Math.min(...validValues),
    max: Math.max(...validValues),
  };
}

/**
 * Calculate range
 */
export function calculateRange(values) {
  const { min, max } = calculateMinMax(values);
  return max - min;
}

/**
 * Detect outliers using IQR method
 */
export function detectOutliers(values, multiplier = 1.5) {
  if (!values || values.length === 0) {
    return { outliers: [], indices: [], bounds: { lower: 0, upper: 0 } };
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length === 0) {
    return { outliers: [], indices: [], bounds: { lower: 0, upper: 0 } };
  }
  
  const quartiles = calculateQuartiles(validValues);
  const iqr = quartiles.q3 - quartiles.q1;
  
  const lowerBound = quartiles.q1 - (multiplier * iqr);
  const upperBound = quartiles.q3 + (multiplier * iqr);
  
  const outliers = [];
  const indices = [];
  
  validValues.forEach((value, index) => {
    if (value < lowerBound || value > upperBound) {
      outliers.push(value);
      indices.push(index);
    }
  });
  
  return {
    outliers,
    indices,
    bounds: {
      lower: lowerBound,
      upper: upperBound,
    },
    iqr,
    quartiles,
  };
}

/**
 * Detect outliers using Z-score method
 */
export function detectOutliersZScore(values, threshold = 3) {
  if (!values || values.length === 0) {
    return { outliers: [], indices: [], zScores: [] };
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length === 0) {
    return { outliers: [], indices: [], zScores: [] };
  }
  
  const mean = calculateMean(validValues);
  const stdDev = calculateStdDev(validValues);
  
  if (stdDev === 0) {
    return { outliers: [], indices: [], zScores: [] };
  }
  
  const outliers = [];
  const indices = [];
  const zScores = [];
  
  validValues.forEach((value, index) => {
    const zScore = (value - mean) / stdDev;
    zScores.push(zScore);
    
    if (Math.abs(zScore) > threshold) {
      outliers.push(value);
      indices.push(index);
    }
  });
  
  return {
    outliers,
    indices,
    zScores,
    mean,
    stdDev,
  };
}

/**
 * Calculate percentile
 */
export function calculatePercentile(values, percentile) {
  if (!values || values.length === 0) return 0;
  if (percentile < 0 || percentile > 100) {
    throw new Error('Percentile must be between 0 and 100');
  }
  
  const validValues = values
    .filter(v => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => a - b);
  
  if (validValues.length === 0) return 0;
  
  const index = (percentile / 100) * (validValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  
  if (lower === upper) {
    return validValues[lower];
  }
  
  return validValues[lower] * (1 - weight) + validValues[upper] * weight;
}

/**
 * Calculate comprehensive statistics for a dataset
 */
export function calculateComprehensiveStats(values) {
  if (!values || values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: null,
      stdDev: 0,
      variance: 0,
      min: 0,
      max: 0,
      range: 0,
      quartiles: { q1: 0, q2: 0, q3: 0 },
      iqr: 0,
      outliers: { count: 0, values: [] },
    };
  }
  
  const validValues = values.filter(v => typeof v === 'number' && !isNaN(v));
  
  if (validValues.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      mode: null,
      stdDev: 0,
      variance: 0,
      min: 0,
      max: 0,
      range: 0,
      quartiles: { q1: 0, q2: 0, q3: 0 },
      iqr: 0,
      outliers: { count: 0, values: [] },
    };
  }
  
  const quartiles = calculateQuartiles(validValues);
  const { min, max } = calculateMinMax(validValues);
  const outlierData = detectOutliers(validValues);
  
  return {
    count: validValues.length,
    mean: calculateMean(validValues),
    median: calculateMedian(validValues),
    mode: calculateMode(validValues),
    stdDev: calculateStdDev(validValues),
    variance: calculateVariance(validValues),
    min,
    max,
    range: max - min,
    quartiles,
    iqr: quartiles.q3 - quartiles.q1,
    outliers: {
      count: outlierData.outliers.length,
      values: outlierData.outliers,
      bounds: outlierData.bounds,
    },
    percentiles: {
      p10: calculatePercentile(validValues, 10),
      p25: calculatePercentile(validValues, 25),
      p50: calculatePercentile(validValues, 50),
      p75: calculatePercentile(validValues, 75),
      p90: calculatePercentile(validValues, 90),
      p95: calculatePercentile(validValues, 95),
      p99: calculatePercentile(validValues, 99),
    },
  };
}

/**
 * Calculate statistics for multiple fields in a dataset
 */
export function calculateMultiFieldStats(data, fields) {
  const stats = {};
  
  fields.forEach(field => {
    const values = data
      .map(record => record[field])
      .filter(v => v !== null && v !== undefined);
    
    stats[field] = calculateComprehensiveStats(values);
  });
  
  return stats;
}

/**
 * Calculate correlation coefficient between two variables
 */
export function calculateCorrelation(xValues, yValues) {
  if (!xValues || !yValues || xValues.length !== yValues.length || xValues.length === 0) {
    return 0;
  }
  
  const n = xValues.length;
  const xMean = calculateMean(xValues);
  const yMean = calculateMean(yValues);
  
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;
  
  for (let i = 0; i < n; i++) {
    const xDiff = xValues[i] - xMean;
    const yDiff = yValues[i] - yMean;
    
    numerator += xDiff * yDiff;
    xDenominator += xDiff * xDiff;
    yDenominator += yDiff * yDiff;
  }
  
  const denominator = Math.sqrt(xDenominator * yDenominator);
  
  if (denominator === 0) return 0;
  
  return numerator / denominator;
}

export default {
  calculateMean,
  calculateMedian,
  calculateMode,
  calculateStdDev,
  calculateVariance,
  calculateQuartiles,
  calculateIQR,
  calculateMinMax,
  calculateRange,
  detectOutliers,
  detectOutliersZScore,
  calculatePercentile,
  calculateComprehensiveStats,
  calculateMultiFieldStats,
  calculateCorrelation,
};
