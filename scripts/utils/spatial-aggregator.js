/**
 * Spatial Aggregation Functions
 * 
 * Provides functions for aggregating data by geographic regions
 * (governorates, districts, regions) with statistical calculations.
 */

/**
 * Governorate definitions for Palestine
 */
const GOVERNORATES = {
  gaza: ['Gaza', 'North Gaza', 'Deir al-Balah', 'Khan Yunis', 'Rafah'],
  west_bank: ['Jenin', 'Tubas', 'Tulkarm', 'Nablus', 'Qalqilya', 'Salfit', 
               'Ramallah', 'Jericho', 'Jerusalem', 'Bethlehem', 'Hebron'],
};

/**
 * Aggregate data by region (Gaza, West Bank, East Jerusalem)
 */
export function aggregateByRegion(data) {
  const regions = {
    gaza: { data: [], stats: {} },
    west_bank: { data: [], stats: {} },
    east_jerusalem: { data: [], stats: {} },
    unknown: { data: [], stats: {} },
  };
  
  // Group data by region
  data.forEach(record => {
    const region = record.location?.region || 'unknown';
    if (regions[region]) {
      regions[region].data.push(record);
    } else {
      regions.unknown.data.push(record);
    }
  });
  
  // Calculate statistics for each region
  Object.keys(regions).forEach(region => {
    regions[region].stats = calculateRegionStats(regions[region].data);
  });
  
  return regions;
}

/**
 * Aggregate data by governorate
 */
export function aggregateByGovernorate(data) {
  const governorates = {};
  
  // Initialize governorate buckets
  [...GOVERNORATES.gaza, ...GOVERNORATES.west_bank].forEach(gov => {
    governorates[gov] = { data: [], stats: {} };
  });
  governorates.unknown = { data: [], stats: {} };
  
  // Group data by governorate
  data.forEach(record => {
    const gov = record.location?.admin_levels?.level1 || 'unknown';
    if (governorates[gov]) {
      governorates[gov].data.push(record);
    } else {
      governorates.unknown.data.push(record);
    }
  });
  
  // Calculate statistics for each governorate
  Object.keys(governorates).forEach(gov => {
    governorates[gov].stats = calculateRegionStats(governorates[gov].data);
  });
  
  return governorates;
}

/**
 * Calculate statistics for a region's data
 */
function calculateRegionStats(data) {
  if (!data || data.length === 0) {
    return {
      total_records: 0,
      incident_count: 0,
      casualty_total: 0,
      fatalities: 0,
      injuries: 0,
      severity_index: 0,
      affected_locations: 0,
      date_range: { start: null, end: null },
      time_series: [],
    };
  }
  
  const stats = {
    total_records: data.length,
    incident_count: 0,
    casualty_total: 0,
    fatalities: 0,
    injuries: 0,
    severity_index: 0,
    affected_locations: new Set(),
    date_range: { start: null, end: null },
  };
  
  // Calculate aggregates
  data.forEach(record => {
    // Count incidents
    if (record.type === 'conflict' || record.category === 'conflict') {
      stats.incident_count++;
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
    
    // Track date range
    if (record.date) {
      if (!stats.date_range.start || record.date < stats.date_range.start) {
        stats.date_range.start = record.date;
      }
      if (!stats.date_range.end || record.date > stats.date_range.end) {
        stats.date_range.end = record.date;
      }
    }
    
    // Add to severity index
    if (record.severity_index !== undefined) {
      stats.severity_index += record.severity_index;
    }
  });
  
  stats.casualty_total = stats.fatalities + stats.injuries;
  stats.affected_locations = stats.affected_locations.size;
  
  // Calculate average severity
  if (stats.incident_count > 0) {
    stats.severity_index = stats.severity_index / stats.incident_count;
  }
  
  // Generate time series
  stats.time_series = generateTimeSeries(data);
  
  return stats;
}

/**
 * Generate time series data for a region
 */
function generateTimeSeries(data) {
  const timeSeriesMap = new Map();
  
  data.forEach(record => {
    if (!record.date) return;
    
    const date = record.date.split('T')[0]; // Normalize to YYYY-MM-DD
    
    if (!timeSeriesMap.has(date)) {
      timeSeriesMap.set(date, {
        date,
        incidents: 0,
        fatalities: 0,
        injuries: 0,
        records: 0,
      });
    }
    
    const entry = timeSeriesMap.get(date);
    entry.records++;
    
    if (record.type === 'conflict' || record.category === 'conflict') {
      entry.incidents++;
    }
    if (record.fatalities !== undefined) {
      entry.fatalities += record.fatalities || 0;
    }
    if (record.injuries !== undefined) {
      entry.injuries += record.injuries || 0;
    }
  });
  
  // Convert to array and sort by date
  return Array.from(timeSeriesMap.values())
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Aggregate data by custom geographic boundary
 */
export function aggregateByCustomBoundary(data, boundaryField) {
  const boundaries = {};
  
  data.forEach(record => {
    const boundary = record.location?.[boundaryField] || 'unknown';
    
    if (!boundaries[boundary]) {
      boundaries[boundary] = { data: [], stats: {} };
    }
    
    boundaries[boundary].data.push(record);
  });
  
  // Calculate statistics for each boundary
  Object.keys(boundaries).forEach(boundary => {
    boundaries[boundary].stats = calculateRegionStats(boundaries[boundary].data);
  });
  
  return boundaries;
}

/**
 * Get top N regions by a specific metric
 */
export function getTopRegions(aggregatedData, metric = 'incident_count', limit = 10) {
  return Object.entries(aggregatedData)
    .map(([region, data]) => ({
      region,
      value: data.stats[metric] || 0,
      stats: data.stats,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

/**
 * Compare regions by multiple metrics
 */
export function compareRegions(aggregatedData, metrics = ['incident_count', 'casualty_total']) {
  const comparison = {};
  
  Object.entries(aggregatedData).forEach(([region, data]) => {
    comparison[region] = {};
    metrics.forEach(metric => {
      comparison[region][metric] = data.stats[metric] || 0;
    });
  });
  
  return comparison;
}

export default {
  aggregateByRegion,
  aggregateByGovernorate,
  aggregateByCustomBoundary,
  getTopRegions,
  compareRegions,
};
