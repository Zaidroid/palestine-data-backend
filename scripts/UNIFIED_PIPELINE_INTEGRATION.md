# Unified Pipeline Integration Guide

This document explains how the existing fetch scripts have been updated to use the unified data pipeline.

## Overview

The unified pipeline provides:
1. **Transformation**: Convert raw data to unified format
2. **Enrichment**: Add geospatial and temporal context
3. **Validation**: Check data quality
4. **Linking**: Connect related data across datasets
5. **Partitioning**: Split large datasets for performance

## New Utilities Created

### Transformers
- `scripts/utils/economic-transformer.js` - World Bank data
- `scripts/utils/conflict-transformer.js` - Conflict/incident data
- `scripts/utils/hdx-transformers.js` - All HDX categories (infrastructure, education, health, water, humanitarian, refugee, shelter)

### Pipeline Components
- `scripts/utils/unified-pipeline.js` - Main pipeline orchestrator
- `scripts/utils/data-partitioner.js` - Dataset partitioning
- `scripts/utils/geospatial-enricher.js` - Location enrichment
- `scripts/utils/temporal-enricher.js` - Time-based enrichment
- `scripts/utils/data-linker.js` - Cross-dataset linking

## Integration Pattern

### Before (Old Pattern)
```javascript
// Fetch data
const data = await fetchData();

// Basic transformation
const transformed = data.map(record => ({
  date: record.date,
  value: record.value,
  // ... manual field mapping
}));

// Save directly
await writeJSON('output.json', transformed);
```

### After (Unified Pipeline)
```javascript
import { EconomicTransformer } from './utils/economic-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';

// Create transformer
const transformer = new EconomicTransformer();

// Create pipeline
const pipeline = new UnifiedPipeline({
  logger: logger,
  baselineDate: '2023-10-07',
});

// Process data through pipeline
const results = await pipeline.process(rawData, metadata, transformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: DATA_DIR,
});

// Save processed data
const output = pipeline.createOutputPackage(results, metadata);
await writeJSON('output.json', output);
```

## How to Update Fetch Scripts

### 1. World Bank Fetcher (`fetch-worldbank-data.js`)

**Add imports:**
```javascript
import { EconomicTransformer } from './utils/economic-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
```

**Replace transformation logic:**
```javascript
// OLD: Manual transformation
const transformed = data.map(item => ({
  year: item.date,
  value: item.value,
  // ...
}));

// NEW: Use transformer
const transformer = new EconomicTransformer();
const pipeline = new UnifiedPipeline({ logger });

const results = await pipeline.process(data, {
  source: 'World Bank',
  organization: 'World Bank',
  indicator_code: indicatorCode,
  indicator_name: indicatorName,
}, transformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: path.join(DATA_DIR, indicatorCode),
});
```

### 2. HDX Fetcher (`fetch-hdx-ckan-data.js`)

**Add imports:**
```javascript
import {
  ConflictTransformer,
  InfrastructureTransformer,
  EducationTransformer,
  HealthTransformer,
  WaterTransformer,
  HumanitarianTransformer,
  RefugeeTransformer,
  ShelterTransformer,
} from './utils/hdx-transformers.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
```

**Create transformer factory:**
```javascript
function getTransformerForCategory(category) {
  const transformers = {
    conflict: new ConflictTransformer(),
    infrastructure: new InfrastructureTransformer(),
    education: new EducationTransformer(),
    health: new HealthTransformer(),
    water: new WaterTransformer(),
    humanitarian: new HumanitarianTransformer(),
    refugees: new RefugeeTransformer(),
    shelter: new ShelterTransformer(),
  };
  
  return transformers[category] || transformers.humanitarian;
}
```

**Replace transformation logic:**
```javascript
// Get appropriate transformer
const transformer = getTransformerForCategory(category);
const pipeline = new UnifiedPipeline({ logger });

// Process through pipeline
const results = await pipeline.process(rawData, metadata, transformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: datasetDir,
});

// Save with validation info
const output = pipeline.createOutputPackage(results, metadata);
await writeJSON(path.join(datasetDir, 'transformed.json'), output);
```

### 3. Good Shepherd Fetcher (`fetch-goodshepherd-data.js`)

**Add imports:**
```javascript
import { ConflictTransformer } from './utils/conflict-transformer.js';
import { InfrastructureTransformer } from './utils/hdx-transformers.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
```

**Update each dataset fetch:**
```javascript
// For casualties/conflict data
const transformer = new ConflictTransformer();
const pipeline = new UnifiedPipeline({ logger });

const results = await pipeline.process(rawData, {
  source: 'Good Shepherd Collective',
  organization: 'Good Shepherd Collective',
  dataset: 'casualties',
}, transformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: path.join(DATA_DIR, 'casualties'),
});

// For demolitions (infrastructure)
const infraTransformer = new InfrastructureTransformer();
const infraResults = await pipeline.process(demolitionsData, {
  source: 'Good Shepherd Collective',
  organization: 'Good Shepherd Collective',
  dataset: 'demolitions',
}, infraTransformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: path.join(DATA_DIR, 'demolitions'),
});
```

## Benefits

### 1. Consistency
- All data follows the same unified format
- Standardized field names and structures
- Consistent quality metrics

### 2. Quality
- Automatic validation with quality scores
- Completeness, consistency, and accuracy checks
- Error and warning reporting

### 3. Enrichment
- Geospatial context (admin levels, proximity, regions)
- Temporal context (baseline comparisons, conflict phases)
- Cross-dataset relationships

### 4. Performance
- Automatic partitioning for large datasets
- Recent data files for quick access
- Partition indexes for efficient loading

### 5. Maintainability
- Centralized transformation logic
- Reusable components
- Easy to add new data sources

## Validation Output

The pipeline provides detailed validation information:

```json
{
  "metadata": {
    "source": "World Bank",
    "processed_at": "2024-01-15T10:30:00Z",
    "record_count": 150,
    "processing_time_ms": 1250
  },
  "data": [...],
  "validation": {
    "qualityScore": 0.92,
    "completeness": 0.95,
    "consistency": 0.90,
    "accuracy": 0.91,
    "meetsThreshold": true,
    "errorCount": 2,
    "warningCount": 5
  },
  "partition_info": {
    "partitioned": true,
    "partitionCount": 4,
    "totalRecords": 150,
    "recentRecords": 45
  }
}
```

## Partition Structure

For large datasets, the pipeline creates:

```
public/data/worldbank/ny_gdp_mktp_cd/
├── metadata.json
├── transformed.json (full dataset)
├── recent.json (last 90 days)
├── validation.json
└── partitions/
    ├── index.json
    ├── 2023-Q1.json
    ├── 2023-Q2.json
    ├── 2023-Q3.json
    └── 2023-Q4.json
```

## Next Steps

1. **Update fetch-worldbank-data.js** - Integrate EconomicTransformer
2. **Update fetch-hdx-ckan-data.js** - Integrate category transformers
3. **Update fetch-goodshepherd-data.js** - Integrate ConflictTransformer
4. **Test each integration** - Verify data quality and structure
5. **Update documentation** - Document any source-specific considerations

## Testing

After integration, verify:

1. **Data Structure**: Check that output matches unified format
2. **Quality Scores**: Ensure validation passes (score > 0.8)
3. **Enrichment**: Verify geospatial and temporal context added
4. **Partitioning**: Confirm large datasets are partitioned correctly
5. **Performance**: Measure processing time improvements

## Troubleshooting

### Low Quality Scores
- Check for missing required fields
- Verify date formats are correct
- Ensure coordinates are valid

### Transformation Errors
- Review raw data structure
- Check field name mappings
- Add custom transformation logic if needed

### Partitioning Issues
- Verify date fields exist
- Check output directory permissions
- Ensure sufficient disk space

## Support

For questions or issues:
1. Check the transformer source code in `scripts/utils/`
2. Review the unified data types in `src/types/unified-data.types.ts`
3. Examine existing integration examples
4. Consult the design document at `.kiro/specs/unified-data-system/design.md`
