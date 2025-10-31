# Data Enrichment Strategy

## Overview

This document outlines strategies to enrich existing data sources with more accurate, relatable datasets and better parsing/transformation.

---

## World Bank Enrichment

### Current State
- 70+ indicators across 10 categories
- Annual/quarterly updates
- Basic categorization and unit detection
- Individual indicator files

### Enrichment Opportunities

#### 1. Add More Relevant Indicators

**Conflict-Related Economic Indicators**:
```javascript
// Add to INDICATORS object
'VC.IHR.PSRC.P5': 'Intentional homicides (per 100,000 people)',
'MS.MIL.XPND.GD.ZS': 'Military expenditure (% of GDP)',
'VC.BTL.DETH': 'Battle-related deaths',
'IC.LGL.CRED.XQ': 'Strength of legal rights index',
'SG.GEN.PARL.ZS': 'Proportion of seats held by women in parliament',
```

**Infrastructure Resilience**:
```javascript
'EG.ELC.RNEW.ZS': 'Renewable electricity output (% of total)',
'EG.USE.COMM.GD.PP.KD': 'Energy use per GDP',
'IS.VEH.NVEH.P3': 'Vehicles per 1,000 people',
'IT.NET.SECR.P6': 'Secure Internet servers',
```

**Social Vulnerability**:
```javascript
'SH.STA.DIAB.ZS': 'Diabetes prevalence',
'SH.STA.OWAD.ZS': 'Prevalence of overweight',
'SH.STA.STNT.ZS': 'Prevalence of stunting',
'SH.STA.WASH.P5': 'Mortality from unsafe WASH',
```

**Food Security**:
```javascript
'SN.ITK.DEFC.ZS': 'Prevalence of undernourishment',
'AG.PRD.FOOD.XD': 'Food production index',
'AG.LND.AGRI.ZS': 'Agricultural land (% of land area)',
'AG.YLD.CREL.KG': 'Cereal yield (kg per hectare)',
```

#### 2. Enhanced Categorization

**Create Sub-Categories**:
```javascript
const ENHANCED_CATEGORIES = {
  economic: {
    gdp: ['NY.GDP.MKTP.CD', 'NY.GDP.MKTP.KD.ZG', ...],
    trade: ['NE.EXP.GNFS.ZS', 'NE.IMP.GNFS.ZS', ...],
    inflation: ['FP.CPI.TOTL.ZG', ...],
    investment: ['BX.KLT.DINV.WD.GD.ZS', ...],
  },
  social: {
    poverty: ['SI.POV.GINI', 'SI.POV.DDAY', ...],
    inequality: ['SI.DST.FRST.20', 'SI.DST.05TH.20', ...],
    health: ['SH.DYN.MORT', 'SH.STA.MMRT', ...],
    education: ['SE.PRM.ENRR', 'SE.ADT.LITR.ZS', ...],
  },
  infrastructure: {
    digital: ['IT.NET.USER.ZS', 'IT.CEL.SETS.P2', ...],
    energy: ['EG.ELC.ACCS.ZS', 'EG.USE.ELEC.KH.PC', ...],
    transport: ['IS.ROD.PAVE.ZP', 'IS.AIR.DPRT', ...],
  },
};
```

#### 3. Time-Series Analysis

**Add Trend Calculations**:
```javascript
function calculateTrends(indicatorData) {
  return {
    ...indicatorData,
    analysis: {
      trend: calculateLinearTrend(indicatorData.data),
      growth_rate: calculateAverageGrowth(indicatorData.data),
      volatility: calculateVolatility(indicatorData.data),
      recent_change: calculateRecentChange(indicatorData.data, 1), // 1 year
      baseline_comparison: compareToBaseline(indicatorData.data, '2023-10-07'),
    },
  };
}
```

#### 4. Cross-Indicator Relationships

**Calculate Derived Indicators**:
```javascript
// GDP per capita growth vs unemployment
function calculateEconomicHealth(gdpGrowth, unemployment) {
  return {
    indicator: 'economic_health_index',
    value: (gdpGrowth - unemployment) / 2,
    components: { gdpGrowth, unemployment },
  };
}

// Poverty gap analysis
function analyzePovertyGap(gini, povertyRate, incomeShare) {
  return {
    indicator: 'poverty_gap_analysis',
    inequality_severity: gini * povertyRate,
    income_concentration: incomeShare.top20 / incomeShare.bottom20,
  };
}
```

#### 5. Comparative Analysis

**Add Regional Comparisons**:
```javascript
// Fetch data for comparison countries
const COMPARISON_COUNTRIES = {
  regional: ['JOR', 'LBN', 'EGY', 'SYR'], // Jordan, Lebanon, Egypt, Syria
  income_level: ['LMC'], // Lower-middle income countries
  conflict_affected: ['YEM', 'IRQ', 'AFG'], // Yemen, Iraq, Afghanistan
};

function addComparativeContext(palestineData, indicator) {
  return {
    ...palestineData,
    comparative: {
      regional_average: calculateRegionalAverage(indicator),
      regional_rank: calculateRegionalRank(indicator),
      income_level_average: calculateIncomeLevelAverage(indicator),
      percentile: calculatePercentile(indicator),
    },
  };
}
```

#### 6. Data Quality Improvements

**Enhanced Validation**:
```javascript
function validateWorldBankData(data) {
  return {
    // Existing checks
    ...basicValidation(data),
    
    // New checks
    temporal_consistency: checkTemporalConsistency(data),
    outlier_detection: detectOutliers(data),
    missing_data_pattern: analyzeMissingData(data),
    data_freshness: checkDataFreshness(data),
    source_reliability: assessSourceReliability(data),
  };
}
```

**Gap Filling**:
```javascript
function fillDataGaps(indicatorData) {
  return {
    ...indicatorData,
    data: indicatorData.data.map((point, index) => {
      if (point.value === null && index > 0 && index < indicatorData.data.length - 1) {
        // Linear interpolation
        return {
          ...point,
          value: interpolate(
            indicatorData.data[index - 1].value,
            indicatorData.data[index + 1].value
          ),
          interpolated: true,
        };
      }
      return point;
    }),
  };
}
```

---

## HDX/OCHA Enrichment

### Current State
- 30-40 priority datasets across 6 categories
- Category-specific transformations
- Basic validation
- Partitioning for large datasets

### Enrichment Opportunities

#### 1. Expand Dataset Coverage

**Add More Datasets Per Category**:

**Conflict** (expand from 8 to 15):
```javascript
// Add
'civilian-casualties-palestine',
'explosive-remnants-war',
'detention-arrests-data',
'home-raids-incidents',
'live-ammunition-use',
'tear-gas-incidents',
'checkpoint-closures',
```

**Health** (new category, 10 datasets):
```javascript
'health-facilities-status',
'medical-supplies-availability',
'healthcare-worker-casualties',
'ambulance-attacks',
'hospital-bed-capacity',
'disease-surveillance',
'vaccination-coverage',
'maternal-health-services',
'mental-health-services',
'pharmaceutical-access',
```

**Shelter** (new category, 8 datasets):
```javascript
'housing-damage-assessment',
'temporary-shelter-locations',
'shelter-needs-assessment',
'housing-reconstruction',
'building-permits',
'demolition-orders',
'eviction-notices',
'housing-affordability',
```

#### 2. Enhanced Transformations

**Geospatial Enrichment**:
```javascript
function enrichWithGeospatial(data) {
  return data.map(record => ({
    ...record,
    location: {
      ...record.location,
      // Add administrative boundaries
      admin_level_1: getAdminLevel1(record.location),
      admin_level_2: getAdminLevel2(record.location),
      admin_level_3: getAdminLevel3(record.location),
      
      // Add proximity analysis
      nearest_city: findNearestCity(record.location),
      distance_to_border: calculateDistanceToBorder(record.location),
      region_type: classifyRegion(record.location), // urban/rural/camp
      
      // Add conflict zone classification
      conflict_zone: classifyConflictZone(record.location),
      access_level: assessAccessLevel(record.location),
    },
  }));
}
```

**Temporal Enrichment**:
```javascript
function enrichWithTemporal(data) {
  return data.map(record => ({
    ...record,
    temporal: {
      // Baseline comparison
      days_since_baseline: calculateDaysSince(record.date, BASELINE_DATE),
      baseline_period: classifyPeriod(record.date, BASELINE_DATE),
      
      // Conflict phase
      conflict_phase: determineConflictPhase(record.date),
      
      // Seasonal factors
      season: getSeason(record.date),
      month_name: getMonthName(record.date),
      
      // Trend context
      trend_direction: calculateTrendDirection(data, record.date),
      moving_average_7d: calculateMovingAverage(data, record.date, 7),
      moving_average_30d: calculateMovingAverage(data, record.date, 30),
    },
  }));
}
```

**Cross-Dataset Linking**:
```javascript
function linkRelatedDatasets(primaryData, relatedDatasets) {
  return primaryData.map(record => ({
    ...record,
    related_data: {
      // Link conflict events to infrastructure damage
      infrastructure_damage: findRelatedInfrastructure(
        record,
        relatedDatasets.infrastructure
      ),
      
      // Link to displacement
      displacement_impact: findRelatedDisplacement(
        record,
        relatedDatasets.refugees
      ),
      
      // Link to humanitarian needs
      humanitarian_needs: findRelatedNeeds(
        record,
        relatedDatasets.humanitarian
      ),
    },
  }));
}
```

#### 3. Data Quality Improvements

**Deduplication**:
```javascript
function deduplicateRecords(data) {
  const seen = new Map();
  
  return data.filter(record => {
    // Create unique key
    const key = `${record.date}_${record.location.name}_${record.event_type}`;
    
    if (seen.has(key)) {
      // Merge if duplicate found
      const existing = seen.get(key);
      seen.set(key, mergeRecords(existing, record));
      return false;
    }
    
    seen.set(key, record);
    return true;
  });
}
```

**Source Reconciliation**:
```javascript
function reconcileSources(datasets) {
  // When multiple sources report same event
  return datasets.map(dataset => ({
    ...dataset,
    data: dataset.data.map(record => ({
      ...record,
      source_confidence: calculateSourceConfidence(record, datasets),
      corroborated_by: findCorroboratingRecords(record, datasets),
      discrepancies: findDiscrepancies(record, datasets),
    })),
  }));
}
```

#### 4. Aggregation & Statistics

**Spatial Aggregation**:
```javascript
function aggregateByRegion(data) {
  const regions = groupBy(data, 'location.admin_level_1');
  
  return Object.entries(regions).map(([region, records]) => ({
    region,
    statistics: {
      total_incidents: records.length,
      total_casualties: sum(records, 'fatalities'),
      total_injuries: sum(records, 'injuries'),
      incident_types: countBy(records, 'event_type'),
      trend: calculateTrend(records),
      severity_index: calculateSeverityIndex(records),
    },
    time_series: createTimeSeries(records),
    recent_incidents: records.slice(-10),
  }));
}
```

**Temporal Aggregation**:
```javascript
function aggregateByPeriod(data, period = 'month') {
  const periods = groupByPeriod(data, period);
  
  return Object.entries(periods).map(([periodKey, records]) => ({
    period: periodKey,
    statistics: {
      incidents: records.length,
      casualties: sum(records, 'fatalities'),
      injuries: sum(records, 'injuries'),
      affected_locations: unique(records, 'location.name').length,
      severity_average: average(records, 'severity'),
    },
    comparison: {
      vs_previous_period: compareToP revious(records, periods),
      vs_baseline: compareToBaseline(records, BASELINE_DATE),
    },
  }));
}
```

---

## Good Shepherd Enrichment

### Current State
- 4/6 endpoints active
- Historical depth (17 years for some data)
- Basic transformation

### Enrichment Opportunities

#### 1. Fix Inactive Endpoints

**Healthcare Attacks**:
```javascript
// Problem: Too large (1M+ records)
// Solution: Implement streaming or pagination

async function fetchHealthcareAttacksStreaming() {
  const CHUNK_SIZE = 10000;
  let offset = 0;
  let allData = [];
  
  while (true) {
    const chunk = await fetchChunk(offset, CHUNK_SIZE);
    if (chunk.length === 0) break;
    
    // Process and save chunk immediately
    await processAndSaveChunk(chunk, offset);
    
    offset += CHUNK_SIZE;
  }
  
  return { success: true, totalRecords: offset };
}
```

**Home Demolitions**:
```javascript
// Problem: 404 error
// Solution: Find alternative endpoint or data source

// Check if data available elsewhere
const ALTERNATIVE_SOURCES = [
  'https://goodshepherdcollective.org/api/v2/demolitions',
  'https://goodshepherdcollective.org/data/demolitions.json',
  // Try HDX
  'hdx:home-demolitions-palestine',
];
```

#### 2. Enhanced Prisoner Data

**Add Demographic Analysis**:
```javascript
function enrichPrisonerData(prisoners) {
  return {
    ...prisoners,
    demographics: {
      age_distribution: calculateAgeDistribution(prisoners),
      gender_breakdown: calculateGenderBreakdown(prisoners),
      children_percentage: calculateChildrenPercentage(prisoners),
      administrative_detention_rate: calculateAdminDetentionRate(prisoners),
    },
    trends: {
      monthly_arrests: calculateMonthlyTrends(prisoners),
      detention_duration_average: calculateAverageDuration(prisoners),
      release_rate: calculateReleaseRate(prisoners),
    },
    geographic: {
      by_region: groupByRegion(prisoners),
      by_city: groupByCity(prisoners),
      hotspots: identifyArrestHotspots(prisoners),
    },
  };
}
```

#### 3. West Bank Violence Analysis

**Incident Classification**:
```javascript
function classifyWestBankIncidents(incidents) {
  return incidents.map(incident => ({
    ...incident,
    classification: {
      // Type classification
      primary_type: classifyIncidentType(incident),
      severity_level: calculateSeverityLevel(incident),
      
      // Actor classification
      perpetrator_type: classifyPerpetrator(incident),
      victim_type: classifyVictim(incident),
      
      // Location classification
      area_classification: classifyArea(incident.location), // A/B/C
      settlement_proximity: calculateSettlementProximity(incident.location),
      
      // Temporal classification
      time_of_day: classifyTimeOfDay(incident.timestamp),
      day_of_week: getDayOfWeek(incident.date),
    },
  }));
}
```

---

## Next Steps

1. **Implement World Bank Enrichments**
   - Add 50+ new indicators
   - Implement trend analysis
   - Add comparative context

2. **Expand HDX Coverage**
   - Add health and shelter categories
   - Implement geospatial enrichment
   - Add cross-dataset linking

3. **Fix Good Shepherd Issues**
   - Implement streaming for large datasets
   - Find alternative sources
   - Enhance prisoner analytics

4. **Create Unified Transformations**
   - Standardize all data formats
   - Implement common enrichments
   - Build transformation pipeline

See:
- [Source Activation Plan](03-SOURCE-ACTIVATION.md)
- [Future Improvements](04-FUTURE-IMPROVEMENTS.md)
