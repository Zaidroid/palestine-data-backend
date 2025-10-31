# Data Transformation Logic

## Overview

This document explains the data transformation pipeline used in the Unified Data System. It covers how raw data from various sources is transformed into a standardized format with enrichment and validation.

## Transformation Pipeline

```
Raw Data (API Response)
    ↓
Category-Specific Transformer
    ↓
Base Transformation (Normalize)
    ↓
Geospatial Enrichment
    ↓
Temporal Enrichment
    ↓
Quality Calculation
    ↓
Validation
    ↓
Cross-Dataset Linking
    ↓
Partitioning
    ↓
Unified Data (Stored)
```

## Transformers

### Base Transformer

All transformers extend the `BaseTransformer` class which provides common functionality:

**Location**: `scripts/utils/base-transformer.js`

**Features:**
- Date normalization (ISO 8601 YYYY-MM-DD)
- Coordinate extraction and validation
- ID generation
- Quality score calculation
- Source information creation

**Example:**
```javascript
class BaseTransformer {
  transform(rawData, metadata) {
    // Override in subclass
  }
  
  validate(data) {
    // Validate completeness, consistency, accuracy
    return {
      qualityScore: 0.9,
      completeness: 0.95,
      consistency: 0.88,
      accuracy: 0.87,
      meetsThreshold: true,
      errors: [],
      warnings: [],
    };
  }
  
  enrich(data) {
    // Add enrichment (override in subclass)
    return data;
  }
}
```

### Conflict Transformer

Transforms conflict and incident data from ACLED, HDX, Tech4Palestine, and Good Shepherd.

**Location**: `scripts/utils/conflict-transformer.js`

**Input Sources:**
- ACLED conflict events
- HDX conflict datasets
- Tech4Palestine casualties
- Good Shepherd incidents

**Transformation Logic:**
```javascript
{
  id: generateId('conflict', record),
  type: 'conflict',
  category: 'conflict',
  date: normalizeDate(record.event_date || record.date),
  location: {
    name: record.location || record.admin1,
    coordinates: extractCoordinates(record),
    admin_levels: {
      level1: record.admin1 || inferGovernorate(record.location),
      level2: record.admin2,
      level3: record.admin3,
    },
    region: classifyRegion(record.location),
  },
  value: record.fatalities || 0,
  unit: 'casualties',
  event_type: record.event_type || 'unknown',
  fatalities: parseInt(record.fatalities || 0),
  injuries: parseInt(record.injuries || 0),
  actors: {
    actor1: record.actor1 || record.perpetrator,
    actor2: record.actor2 || record.target,
  },
  description: record.notes || record.description || '',
  quality: calculateQuality(record),
  sources: [createSourceInfo(metadata)],
}
```

**Enrichment:**
- Severity index based on casualties
- Conflict zone classification
- Proximity to infrastructure

### Economic Transformer

Transforms economic indicators from World Bank and PCBS.

**Location**: `scripts/utils/economic-transformer.js`

**Input Sources:**
- World Bank indicators (120+ indicators)
- PCBS official statistics

**Transformation Logic:**
```javascript
{
  id: generateId('economic', record),
  type: 'economic',
  category: 'economic',
  date: `${record.year}-01-01`,
  location: createPalestineLocation(),
  value: record.value,
  unit: detectUnit(metadata.indicator_name),
  indicator_code: record.indicator,
  indicator_name: metadata.indicator_name,
  quality: calculateQuality(record),
  sources: [createSourceInfo(metadata)],
}
```

**Enrichment:**
- Trend analysis (slope, direction, growth rate)
- Volatility calculation
- Baseline comparison (pre/post Oct 7, 2023)
- Comparative context (regional averages, rankings)

**Trend Analysis:**
```javascript
analysis: {
  trend: {
    slope: calculateLinearTrend(timeSeries),
    direction: 'increasing' | 'decreasing' | 'stable',
  },
  growth_rate: calculateAverageGrowth(timeSeries),
  volatility: calculateStdDev(timeSeries),
  recent_change: calculateRecentChange(timeSeries, 1),
  baseline_comparison: compareToBaseline(timeSeries, '2023-10-07'),
}
```

### Infrastructure Transformer

Transforms infrastructure and building damage data from HDX and Tech4Palestine.

**Location**: `scripts/utils/hdx-transformers.js`

**Input Sources:**
- HDX infrastructure datasets
- Tech4Palestine infrastructure damage

**Transformation Logic:**
```javascript
{
  id: generateId('infrastructure', record),
  type: 'infrastructure',
  category: 'infrastructure',
  date: normalizeDate(record.damage_date || record.date),
  location: transformLocation(record),
  value: record.damage_level,
  structure_type: record.structure_type || record.building_type,
  damage_level: normalizeDamageLevel(record.damage_level),
  damage_date: record.damage_date,
  estimated_cost: record.estimated_cost,
  people_affected: record.people_affected,
  status: determineStatus(record),
  quality: calculateQuality(record),
  sources: [createSourceInfo(metadata)],
}
```

**Damage Level Normalization:**
```javascript
function normalizeDamageLevel(level) {
  const mapping = {
    'total': 'destroyed',
    'complete': 'destroyed',
    'major': 'severe',
    'significant': 'severe',
    'partial': 'moderate',
    'light': 'minor',
    'minimal': 'minor',
  };
  return mapping[level.toLowerCase()] || level;
}
```

### Humanitarian Transformer

Transforms humanitarian needs and assistance data from HDX, UNRWA, and WFP.

**Location**: `scripts/utils/hdx-transformers.js`

**Input Sources:**
- HDX humanitarian datasets
- UNRWA assistance data
- WFP food security data

**Transformation Logic:**
```javascript
{
  id: generateId('humanitarian', record),
  type: 'humanitarian',
  category: 'humanitarian',
  date: normalizeDate(record.date),
  location: transformLocation(record),
  value: record.people_in_need,
  sector: record.sector || record.cluster,
  people_in_need: record.people_in_need,
  people_targeted: record.people_targeted,
  people_reached: record.people_reached,
  severity: classifySeverity(record),
  priority: record.priority,
  funding: {
    required: record.funding_required,
    received: record.funding_received,
    gap: record.funding_required - record.funding_received,
  },
  quality: calculateQuality(record),
  sources: [createSourceInfo(metadata)],
}
```

### Health, Education, Water, Refugee Transformers

Similar transformers for other categories following the same pattern.

**Locations:**
- `scripts/utils/hdx-transformers.js` (Health, Education, Water, Shelter)
- `scripts/utils/unrwa-transformer.js` (Refugee)

## Enrichment

### Geospatial Enrichment

**Location**: `scripts/utils/geospatial-enricher.js`

**Adds:**
- Administrative boundaries (governorate, district, locality)
- Region classification (Gaza, West Bank, East Jerusalem)
- Region type (urban, rural, camp)
- West Bank area classification (A, B, C)
- Proximity calculations (nearest city, border, checkpoint)
- Conflict zone classification
- Access level assessment

**Example:**
```javascript
location: {
  name: 'Gaza City',
  coordinates: [34.4668, 31.5],
  admin_levels: {
    level1: 'Gaza', // Governorate
    level2: 'Gaza', // District
    level3: 'Gaza City', // Locality
  },
  region: 'gaza',
  region_type: 'urban',
  proximity: {
    nearest_city: 'Gaza City',
    distance_to_border: 5000, // meters
    distance_to_checkpoint: 2000,
  },
  conflict_zone: 'high',
  access_level: 'restricted',
}
```

**Governorate Boundaries:**
```javascript
const GOVERNORATES = {
  gaza: ['Gaza', 'North Gaza', 'Deir al-Balah', 'Khan Yunis', 'Rafah'],
  west_bank: ['Jenin', 'Tubas', 'Tulkarm', 'Nablus', 'Qalqilya', 'Salfit',
               'Ramallah', 'Jericho', 'Jerusalem', 'Bethlehem', 'Hebron'],
};
```

### Temporal Enrichment

**Location**: `scripts/utils/temporal-enricher.js`

**Adds:**
- Period classification (day, week, month, quarter, year)
- Baseline comparison (days since October 7, 2023)
- Conflict phase determination
- Moving averages (7-day, 30-day)

**Example:**
```javascript
{
  date: '2024-01-15',
  period: {
    type: 'day',
    value: '2024-01-15',
  },
  temporal_context: {
    days_since_baseline: 100,
    baseline_period: 'during_conflict',
    conflict_phase: 'active-conflict',
    season: 'winter',
    moving_average_7d: 45.2,
    moving_average_30d: 38.7,
  },
}
```

**Conflict Phases:**
- `pre-escalation`: Before October 7, 2023
- `active-conflict`: October 7, 2023 - Present
- `ceasefire`: During ceasefire periods
- `post-conflict`: After conflict ends

### Quality Enrichment

**Calculates:**
- Overall quality score (0-1)
- Completeness score
- Consistency score
- Accuracy score
- Confidence level

**Quality Score Calculation:**
```javascript
function calculateQualityScore(record) {
  const completeness = calculateCompleteness(record);
  const consistency = calculateConsistency(record);
  const accuracy = calculateAccuracy(record);
  
  return (completeness + consistency + accuracy) / 3;
}

function calculateCompleteness(record) {
  const requiredFields = ['id', 'type', 'date', 'location', 'value'];
  const presentFields = requiredFields.filter(f => 
    record[f] !== null && record[f] !== undefined
  );
  return presentFields.length / requiredFields.length;
}
```

## Validation

**Location**: `scripts/utils/base-transformer.js`

**Checks:**
1. **Completeness**: Required fields present
2. **Consistency**: Valid formats and ranges
3. **Accuracy**: Cross-source verification
4. **Temporal**: No future dates, chronological order
5. **Spatial**: Valid coordinates, known locations

**Validation Result:**
```javascript
{
  qualityScore: 0.92,
  completeness: 0.95,
  consistency: 0.90,
  accuracy: 0.91,
  meetsThreshold: true, // >= 0.8
  errors: [
    { field: 'coordinates', message: 'Invalid coordinates' },
  ],
  warnings: [
    { field: 'date', message: 'Date is very recent, may be preliminary' },
  ],
}
```

## Cross-Dataset Linking

**Location**: `scripts/utils/data-linker.js`

**Links:**
1. Conflict → Infrastructure (1km radius, 7-day window)
2. Infrastructure → Humanitarian (same location, 7-day window)
3. Economic → Social (correlation analysis)

**Example:**
```javascript
{
  id: 'conflict_001',
  // ... other fields
  related_data: {
    infrastructure: ['infra_123', 'infra_456'], // Nearby damaged buildings
    humanitarian: ['human_789'], // Related displacement
  },
}
```

**Linking Logic:**
```javascript
function findNearbyInfrastructure(incident, infrastructure, radius, days) {
  return infrastructure.filter(infra => {
    const spatialMatch = isWithinRadius(
      incident.location.coordinates,
      infra.location.coordinates,
      radius
    );
    
    const temporalMatch = isWithinDays(
      incident.date,
      infra.date,
      days
    );
    
    return spatialMatch && temporalMatch;
  });
}
```

## Partitioning

**Location**: `scripts/utils/data-partitioner.js`

**Rules:**
- Datasets < 10,000 records: No partitioning
- Datasets ≥ 10,000 records: Partition by quarter
- Always create `recent.json` (last 90 days)

**Partition Structure:**
```
public/data/unified/conflict/
├── metadata.json
├── recent.json (last 90 days)
├── partitions/
│   ├── 2023-Q4.json
│   ├── 2024-Q1.json
│   ├── 2024-Q2.json
│   └── index.json
└── validation.json
```

**Partition Index:**
```javascript
{
  partitions: [
    {
      id: '2023-Q4',
      filename: '2023-Q4.json',
      record_count: 2500,
      date_range: {
        start: '2023-10-01',
        end: '2023-12-31',
      },
    },
    // ... more partitions
  ],
  total_records: 15000,
  total_partitions: 6,
}
```

## Normalization Functions

### Date Normalization

```javascript
function normalizeDate(dateStr) {
  if (!dateStr) return null;
  
  // Handle various formats
  const date = new Date(dateStr);
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Return ISO 8601 YYYY-MM-DD
  return date.toISOString().split('T')[0];
}
```

### Coordinate Extraction

```javascript
function extractCoordinates(record) {
  // Try various field names
  if (record.longitude && record.latitude) {
    return [parseFloat(record.longitude), parseFloat(record.latitude)];
  }
  
  if (record.lon && record.lat) {
    return [parseFloat(record.lon), parseFloat(record.lat)];
  }
  
  if (record.coordinates) {
    return record.coordinates;
  }
  
  // Try to geocode location name
  if (record.location) {
    return geocodeLocation(record.location);
  }
  
  return null;
}
```

### Value Normalization

```javascript
function normalizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  
  if (typeof value === 'number') {
    return value;
  }
  
  if (typeof value === 'string') {
    // Remove commas and parse
    const cleaned = value.replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  
  return null;
}
```

## Error Handling

### Transformation Errors

```javascript
try {
  const transformed = transformer.transform(rawData, metadata);
} catch (error) {
  logger.error('Transformation failed', {
    source: metadata.source,
    error: error.message,
  });
  
  // Save raw data for debugging
  await saveRawData(rawData, metadata);
  
  // Continue with other records
  return [];
}
```

### Validation Errors

```javascript
const validation = transformer.validate(data);

if (!validation.meetsThreshold) {
  logger.warn('Data quality below threshold', {
    score: validation.qualityScore,
    errors: validation.errors,
  });
  
  // Still save data but flag it
  metadata.quality_warning = true;
}
```

## Best Practices

1. **Always normalize dates** to ISO 8601 YYYY-MM-DD
2. **Validate coordinates** before using
3. **Handle null values** gracefully
4. **Log transformation errors** for debugging
5. **Calculate quality scores** for all data
6. **Enrich incrementally** (geo → temporal → quality)
7. **Partition large datasets** for performance
8. **Link related data** for context
9. **Save validation reports** for monitoring
10. **Document transformation logic** for maintainability

## Testing Transformations

```bash
# Test individual transformer
node scripts/test-conflict-transformer.js
node scripts/test-economic-transformer.js

# Test complete pipeline
node scripts/test-unified-pipeline.js

# Test with real data
node scripts/test-e2e-pipeline.js
```

## Additional Resources

- [Unified Data System Guide](./UNIFIED_DATA_SYSTEM.md)
- [API Reference](./UNIFIED_DATA_API.md)
- [Pipeline Quick Start](../../scripts/utils/PIPELINE_QUICK_START.md)
- [Design Document](../../.kiro/specs/unified-data-system/design.md)

