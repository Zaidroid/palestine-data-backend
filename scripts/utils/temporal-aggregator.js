/**
 * Temporal Aggregation Functions
 * 
 * Provides functions for aggregating data by time periods
 * (day, week, month, quarter, year) with period-over-period comparisons.
 */

/**
 * Aggregate data by time period
 */
export function aggregateByPeriod(data, periodType = 'day') {
  const periods = {};
  
  data.forEach(record => {
    if (!record.date) return;
    
    const period = getPeriodKey(record.date, periodType);
    
    if (!periods[period]) {
      periods[period] = {
        period,
        period_type: periodType,
        data: [],
        stats: {},
      };
    }
    
    periods[period].data.push(record);
  });
  
  // Calculate statistics for each period
  Object.keys(periods).forEach(period => {
    periods[period].stats = calculatePeriodStats(periods[period].data);
  });
  
  return periods;
}

/**
 * Get period key based on date and period type
 */
function getPeriodKey(dateString, periodType) {
  const date = new Date(dateString);
  
  switch (periodType) {
    case 'day':
      return date.toISOString().split('T')[0]; // YYYY-MM-DD
    
    case 'week':
      return getWeekKey(date);
    
    case 'month':
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    
    case 'quarter':
      const qYear = date.getFullYear();
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      return `${qYear}-Q${quarter}`;
    
    case 'year':
      return String(date.getFullYear());
    
    default:
      return dateString;
  }
}

/**
 * Get ISO week key (YYYY-Www)
 */
function getWeekKey(date) {
  const year = date.getFullYear();
  const week = getWeekNumber(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Get ISO week number
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Calculate statistics for a time period
 */
function calculatePeriodStats(data) {
  if (!data || data.length === 0) {
    return {
      total_records: 0,
      incidents: 0,
      casualties: 0,
      fatalities: 0,
      injuries: 0,
      affected_locations: 0,
      unique_event_types: 0,
    };
  }
  
  const stats = {
    total_records: data.length,
    incidents: 0,
    casualties: 0,
    fatalities: 0,
    injuries: 0,
    affected_locations: new Set(),
    event_types: new Set(),
  };
  
  data.forEach(record => {
    // Count incidents
    if (record.type === 'conflict' || record.category === 'conflict') {
      stats.incidents++;
      
      if (record.event_type) {
        stats.event_types.add(record.event_type);
      }
    }
    
    // Sum casualties
    if (record.fatalities !== undefined) {
      stats.fatalities += record.fatalities || 0;
    }
    if (record.injuries !== undefined) {
      stats.injuries += record.injuries || 0;
    }
    
    // Track locations
    if (record.location?.name) {
      stats.affected_locations.add(record.location.name);
    }
  });
  
  stats.casualties = stats.fatalities + stats.injuries;
  stats.affected_locations = stats.affected_locations.size;
  stats.unique_event_types = stats.event_types.size;
  
  delete stats.event_types; // Remove Set from output
  
  return stats;
}

/**
 * Calculate period-over-period comparison
 */
export function calculatePeriodComparison(aggregatedData) {
  const periods = Object.keys(aggregatedData).sort();
  const comparisons = {};
  
  for (let i = 1; i < periods.length; i++) {
    const currentPeriod = periods[i];
    const previousPeriod = periods[i - 1];
    
    const current = aggregatedData[currentPeriod].stats;
    const previous = aggregatedData[previousPeriod].stats;
    
    comparisons[currentPeriod] = {
      period: currentPeriod,
      previous_period: previousPeriod,
      changes: {
        incidents: {
          absolute: current.incidents - previous.incidents,
          percentage: calculatePercentageChange(previous.incidents, current.incidents),
        },
        casualties: {
          absolute: current.casualties - previous.casualties,
          percentage: calculatePercentageChange(previous.casualties, current.casualties),
        },
        fatalities: {
          absolute: current.fatalities - previous.fatalities,
          percentage: calculatePercentageChange(previous.fatalities, current.fatalities),
        },
        injuries: {
          absolute: current.injuries - previous.injuries,
          percentage: calculatePercentageChange(previous.injuries, current.injuries),
        },
        affected_locations: {
          absolute: current.affected_locations - previous.affected_locations,
          percentage: calculatePercentageChange(previous.affected_locations, current.affected_locations),
        },
      },
      current_stats: current,
      previous_stats: previous,
    };
  }
  
  return comparisons;
}

/**
 * Calculate percentage change
 */
function calculatePercentageChange(oldValue, newValue) {
  if (oldValue === 0) {
    return newValue > 0 ? 100 : 0;
  }
  return ((newValue - oldValue) / oldValue) * 100;
}

/**
 * Get rolling aggregation (e.g., 7-day rolling sum)
 */
export function getRollingAggregation(data, windowDays = 7, metric = 'incidents') {
  // Sort data by date
  const sortedData = [...data].sort((a, b) => 
    (a.date || '').localeCompare(b.date || '')
  );
  
  const rolling = [];
  
  for (let i = 0; i < sortedData.length; i++) {
    const currentDate = new Date(sortedData[i].date);
    const windowStart = new Date(currentDate);
    windowStart.setDate(windowStart.getDate() - windowDays);
    
    // Get data within window
    const windowData = sortedData.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate >= windowStart && recordDate <= currentDate;
    });
    
    // Calculate metric for window
    const stats = calculatePeriodStats(windowData);
    
    rolling.push({
      date: sortedData[i].date,
      window_days: windowDays,
      value: stats[metric] || 0,
      window_stats: stats,
    });
  }
  
  return rolling;
}

/**
 * Aggregate by baseline comparison (before/after specific date)
 */
export function aggregateByBaseline(data, baselineDate = '2023-10-07') {
  const baseline = new Date(baselineDate);
  
  const aggregation = {
    before_baseline: { data: [], stats: {} },
    after_baseline: { data: [], stats: {} },
  };
  
  data.forEach(record => {
    if (!record.date) return;
    
    const recordDate = new Date(record.date);
    
    if (recordDate < baseline) {
      aggregation.before_baseline.data.push(record);
    } else {
      aggregation.after_baseline.data.push(record);
    }
  });
  
  // Calculate statistics
  aggregation.before_baseline.stats = calculatePeriodStats(aggregation.before_baseline.data);
  aggregation.after_baseline.stats = calculatePeriodStats(aggregation.after_baseline.data);
  
  // Calculate comparison
  aggregation.comparison = {
    baseline_date: baselineDate,
    changes: {
      incidents: {
        absolute: aggregation.after_baseline.stats.incidents - aggregation.before_baseline.stats.incidents,
        percentage: calculatePercentageChange(
          aggregation.before_baseline.stats.incidents,
          aggregation.after_baseline.stats.incidents
        ),
      },
      casualties: {
        absolute: aggregation.after_baseline.stats.casualties - aggregation.before_baseline.stats.casualties,
        percentage: calculatePercentageChange(
          aggregation.before_baseline.stats.casualties,
          aggregation.after_baseline.stats.casualties
        ),
      },
    },
  };
  
  return aggregation;
}

/**
 * Get time series with cumulative values
 */
export function getCumulativeTimeSeries(data, metric = 'casualties') {
  const dailyAgg = aggregateByPeriod(data, 'day');
  const periods = Object.keys(dailyAgg).sort();
  
  let cumulative = 0;
  const series = [];
  
  periods.forEach(period => {
    const value = dailyAgg[period].stats[metric] || 0;
    cumulative += value;
    
    series.push({
      date: period,
      daily_value: value,
      cumulative_value: cumulative,
    });
  });
  
  return series;
}

/**
 * Aggregate by multiple time periods simultaneously
 */
export function aggregateByMultiplePeriods(data, periodTypes = ['day', 'week', 'month']) {
  const result = {};
  
  periodTypes.forEach(periodType => {
    result[periodType] = aggregateByPeriod(data, periodType);
  });
  
  return result;
}

export default {
  aggregateByPeriod,
  calculatePeriodComparison,
  getRollingAggregation,
  aggregateByBaseline,
  getCumulativeTimeSeries,
  aggregateByMultiplePeriods,
};
