# Statistical Analysis and Aggregation Utilities

This directory contains comprehensive statistical analysis utilities for the Palestine Pulse unified data system. These utilities provide spatial aggregation, temporal aggregation, descriptive statistics, and time series analysis capabilities.

## Overview

The statistical analysis system consists of five main modules:

1. **Spatial Aggregator** - Geographic aggregation by region, governorate, and custom boundaries
2. **Temporal Aggregator** - Time-based aggregation by day, week, month, quarter, and year
3. **Descriptive Statistics** - Advanced statistical calculations (mean, median, mode, std dev, quartiles, outliers)
4. **Time Series Analysis** - Trend detection, seasonality, forecasting, and change point detection
5. **Statistical Aggregator** - Unified service combining all analysis capabilities

## Installation

These utilities are part of the unified data system and require no additional installation. They use ES6 modules and can be imported directly:

```javascript
import { aggregateByRegion } from './utils/spatial-aggregator.js';
import { aggregateByPeriod } from './utils/temporal-aggregator.js';
import { calculateComprehensiveStats } from './utils/descriptive-statistics.js';
import { analyzeTimeSeries } from './utils/time-series-analysis.js';
import { performComprehensiveAnalysis } from './utils/statistical-aggregator.js';
```

## Usage Examples

### 1. Spatial Aggregation

Aggregate data by geographic regions:

```javascript
import { aggregateByRegion, aggregateByGovernorate, getTopRegions } from './utils/spatial-aggregator.js';

// Aggregate by region (Gaza, West Bank, East Jerusalem)
const byRegion = aggregateByRegion(data);
console.log(byRegion.gaza.stats.incident_count);
console.log(byRegion.gaza.stats.casualty_total);

// Aggregate by governorate
const byGovernorate = aggregateByGovernorate(data);
console.log(byGovernorate['Khan Yunis'].stats);

// Get top 10 regions by incident count
const topRegions = getTopRegions(byGovernorate, 'incident_count', 10);
```

**Output Structure:**
```javascript
{
  gaza: {
    data: [...],  // Array of records
    stats: {
      total_records: 100,
      incident_count: 50,
      casualty_total: 200,
      fatalities: 80,
      injuries: 120,
      severity_index: 5.2,
      affected_locations: 15,
      date_range: { start: '2023-10-01', end: '2024-01-15' },
      time_series: [...]
    }
  },
  west_bank: { ... },
  east_jerusalem: { ... }
}
```

### 2. Temporal Aggregation

Aggregate data by time periods:

```javascript
import { 
  aggregateByPeriod, 
  calculatePeriodComparison,
  aggregateByBaseline,
  getRollingAggregation 
} from './utils/temporal-aggregator.js';

// Aggregate by day, week, month, quarter, or year
const byDay = aggregateByPeriod(data, 'day');
const byWeek = aggregateByPeriod(data, 'week');
const byMonth = aggregateByPeriod(data, 'month');

// Calculate period-over-period changes
const comparison = calculatePeriodComparison(byWeek);
console.log(comparison['2024-W02'].changes.incidents.percentage);

// Compare before/after baseline date
const baseline = aggregateByBaseline(data, '2023-10-07');
console.log(baseline.before_baseline.stats);
console.log(baseline.after_baseline.stats);
console.log(baseline.comparison.changes);

// Calculate 7-day rolling average
const rolling = getRollingAggregation(data, 7, 'incidents');
```

**Output Structure:**
```javascript
{
  '2024-01-15': {
    period: '2024-01-15',
    period_type: 'day',
    data: [...],
    stats: {
      total_records: 5,
      incidents: 3,
      casualties: 25,
      fatalities: 10,
      injuries: 15,
      affected_locations: 2,
      unique_event_types: 2
    }
  },
  '2024-01-16': { ... }
}
```

### 3. Descriptive Statistics

Calculate comprehensive statistical measures:

```javascript
import { 
  calculateComprehensiveStats,
  detectOutliers,
  calculateCorrelation 
} from './utils/descriptive-statistics.js';

// Calculate comprehensive statistics for a field
const fatalities = data.map(d => d.fatalities);
const stats = calculateComprehensiveStats(fatalities);

console.log(stats.mean);
console.log(stats.median);
console.log(stats.stdDev);
console.log(stats.quartiles);
console.log(stats.outliers);

// Detect outliers using IQR method
const outliers = detectOutliers(fatalities, 1.5);
console.log(outliers.outliers);
console.log(outliers.bounds);

// Calculate correlation between two variables
const correlation = calculateCorrelation(
  data.map(d => d.fatalities),
  data.map(d => d.injuries)
);
```

**Output Structure:**
```javascript
{
  count: 100,
  mean: 13.64,
  median: 13.00,
  mode: 15,
  stdDev: 8.65,
  variance: 74.82,
  min: 0,
  max: 29,
  range: 29,
  quartiles: { q1: 6.00, q2: 13.00, q3: 21.00 },
  iqr: 15.00,
  outliers: {
    count: 2,
    values: [45, 50],
    bounds: { lower: -16.5, upper: 43.5 }
  },
  percentiles: {
    p10: 2.5,
    p25: 6.0,
    p50: 13.0,
    p75: 21.0,
    p90: 25.5,
    p95: 27.0,
    p99: 28.5
  }
}
```

### 4. Time Series Analysis

Analyze trends, seasonality, and forecast future values:

```javascript
import { 
  analyzeTimeSeries,
  calculateLinearTrend,
  detectSeasonality,
  forecastLinear 
} from './utils/time-series-analysis.js';

// Comprehensive time series analysis
const timeSeries = data.map(d => d.incidents);
const analysis = analyzeTimeSeries(timeSeries, {
  period: 7,           // Weekly seasonality
  forecastPeriods: 7,  // Forecast 7 periods ahead
  maxLag: 10          // Calculate ACF up to lag 10
});

console.log(analysis.trend);
console.log(analysis.seasonality);
console.log(analysis.forecast);
console.log(analysis.change_points);

// Calculate linear trend
const trend = calculateLinearTrend(timeSeries);
console.log(trend.direction);  // 'increasing', 'decreasing', or 'stable'
console.log(trend.slope);
console.log(trend.r_squared);

// Detect seasonality
const seasonality = detectSeasonality(timeSeries, 7);
console.log(seasonality.has_seasonality);
console.log(seasonality.period);
```

**Output Structure:**
```javascript
{
  trend: {
    slope: 0.0234,
    intercept: 5.2,
    direction: 'increasing',
    r_squared: 0.75,
    strength: 'strong'
  },
  seasonality: {
    has_seasonality: true,
    period: 7,
    strength: 0.45,
    autocorrelation: 0.45
  },
  forecast: [
    { period: 1, forecast: 15.2, confidence: 0.75 },
    { period: 2, forecast: 15.4, confidence: 0.75 },
    ...
  ],
  change_points: [
    { index: 25, value: 45, z_score: 3.2, type: 'spike' }
  ],
  growth_rate: 23.5,
  summary: {
    has_trend: true,
    trend_direction: 'increasing',
    trend_strength: 'strong',
    has_seasonality: true,
    seasonal_period: 7,
    volatility: 8.5,
    change_point_count: 1
  }
}
```

### 5. Comprehensive Analysis

Perform all analyses at once:

```javascript
import { 
  performComprehensiveAnalysis,
  generateSummaryReport 
} from './utils/statistical-aggregator.js';

// Perform comprehensive analysis
const analysis = await performComprehensiveAnalysis(data, {
  includeRegional: true,
  includeTemporal: true,
  includeDescriptive: true,
  includeTimeSeries: true,
  baselineDate: '2023-10-07',
  forecastPeriods: 7
});

// Generate summary report
const summary = generateSummaryReport(analysis);
console.log(summary);

// Access specific analyses
console.log(analysis.regional.by_region);
console.log(analysis.temporal.baseline_comparison);
console.log(analysis.descriptive);
console.log(analysis.time_series);
```

## Data Format Requirements

All functions expect data in the unified data model format:

```javascript
{
  id: 'incident-123',
  type: 'conflict',
  category: 'conflict',
  date: '2024-01-15',  // ISO 8601 YYYY-MM-DD
  location: {
    name: 'Gaza',
    region: 'gaza',  // 'gaza', 'west_bank', or 'east_jerusalem'
    admin_levels: {
      level1: 'Gaza',  // Governorate
      level2: 'Gaza City',  // District (optional)
      level3: 'Al-Rimal'  // Locality (optional)
    },
    coordinates: [34.4668, 31.5017]  // [longitude, latitude]
  },
  fatalities: 5,
  injuries: 12,
  severity_index: 3.2,
  event_type: 'airstrike',
  value: 17  // Total casualties or other numeric value
}
```

## Testing

Run the test script to verify all functions:

```bash
node scripts/test-statistical-analysis.js
```

This will generate sample data and run tests for:
- Spatial aggregation
- Temporal aggregation
- Descriptive statistics
- Time series analysis
- Comprehensive analysis

## Performance Considerations

- **Large Datasets**: Functions are optimized for datasets up to 100,000 records
- **Memory Usage**: Temporal aggregation creates intermediate objects; consider streaming for very large datasets
- **Computation Time**: Time series analysis with long series (>1000 points) may take several seconds
- **Caching**: Consider caching aggregation results for frequently accessed time periods

## Integration with Fetch Scripts

These utilities can be integrated into data fetch scripts:

```javascript
import { performComprehensiveAnalysis } from './utils/statistical-aggregator.js';

// After fetching and transforming data
const transformedData = await fetchAndTransform();

// Perform analysis
const analysis = await performComprehensiveAnalysis(transformedData);

// Save analysis alongside data
fs.writeFileSync(
  'public/data/unified/conflict/analysis.json',
  JSON.stringify(analysis, null, 2)
);
```

## API Reference

### Spatial Aggregator
- `aggregateByRegion(data)` - Aggregate by Gaza, West Bank, East Jerusalem
- `aggregateByGovernorate(data)` - Aggregate by 16 governorates
- `aggregateByCustomBoundary(data, field)` - Aggregate by custom field
- `getTopRegions(aggregated, metric, limit)` - Get top N regions
- `compareRegions(aggregated, metrics)` - Compare regions by metrics

### Temporal Aggregator
- `aggregateByPeriod(data, periodType)` - Aggregate by day/week/month/quarter/year
- `calculatePeriodComparison(aggregated)` - Period-over-period changes
- `getRollingAggregation(data, windowDays, metric)` - Rolling averages
- `aggregateByBaseline(data, baselineDate)` - Before/after comparison
- `getCumulativeTimeSeries(data, metric)` - Cumulative values over time

### Descriptive Statistics
- `calculateMean(values)` - Average
- `calculateMedian(values)` - Middle value
- `calculateMode(values)` - Most frequent value
- `calculateStdDev(values)` - Standard deviation
- `calculateQuartiles(values)` - Q1, Q2, Q3
- `detectOutliers(values, multiplier)` - IQR-based outlier detection
- `calculateComprehensiveStats(values)` - All statistics at once
- `calculateCorrelation(xValues, yValues)` - Correlation coefficient

### Time Series Analysis
- `calculateLinearTrend(values)` - Trend slope and direction
- `detectSeasonality(timeSeries, period)` - Seasonality detection
- `calculateAutocorrelation(values, lag)` - ACF at specific lag
- `calculateMovingAverage(values, windowSize)` - Moving average
- `calculateEMA(values, alpha)` - Exponential moving average
- `forecastLinear(values, periods)` - Linear regression forecast
- `detectChangePoints(values, threshold)` - Significant changes
- `analyzeTimeSeries(timeSeries, options)` - Comprehensive analysis

### Statistical Aggregator
- `performComprehensiveAnalysis(data, options)` - All analyses
- `generateSummaryReport(analysis)` - Summary of key findings
- `compareDatasets(dataset1, dataset2)` - Compare two datasets
- `calculateCorrelationMatrix(data, fields)` - Correlation matrix

## Requirements Satisfied

This implementation satisfies the following requirements from the unified data system spec:

- **Requirement 10.1**: Spatial aggregations by region with incident counts, casualty totals, and severity indices
- **Requirement 10.2**: Temporal aggregations by day, week, month, quarter with period-over-period comparisons
- **Requirement 10.3**: Descriptive statistics (mean, median, mode, standard deviation, quartiles)
- **Requirement 10.4**: Time series analysis including trend direction, seasonality detection, and autocorrelation

## Future Enhancements

Potential improvements for future versions:

1. **Advanced Forecasting**: ARIMA, Prophet, or other sophisticated models
2. **Spatial Clustering**: Identify geographic clusters of incidents
3. **Anomaly Detection**: More sophisticated outlier detection algorithms
4. **Causal Analysis**: Granger causality tests between variables
5. **Interactive Visualizations**: Integration with charting libraries
6. **Real-time Analysis**: Streaming analysis for real-time data
7. **Machine Learning**: Predictive models for incident forecasting

## Support

For questions or issues with the statistical analysis utilities, please refer to:
- Main documentation: `docs/README.md`
- Design document: `.kiro/specs/unified-data-system/design.md`
- Requirements: `.kiro/specs/unified-data-system/requirements.md`
