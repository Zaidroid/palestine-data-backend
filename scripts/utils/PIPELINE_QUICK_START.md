# Unified Pipeline Quick Start Guide

## Installation

No installation needed - all utilities are in `scripts/utils/`.

## Basic Usage

### 1. Import Components

```javascript
import { EconomicTransformer } from './utils/economic-transformer.js';
import { ConflictTransformer } from './utils/conflict-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
```

### 2. Create Transformer

```javascript
// For economic data (World Bank)
const transformer = new EconomicTransformer();

// For conflict data (ACLED, HDX, Good Shepherd)
const transformer = new ConflictTransformer();

// For HDX categories
import { InfrastructureTransformer, EducationTransformer } from './utils/hdx-transformers.js';
const transformer = new InfrastructureTransformer();
```

### 3. Create Pipeline

```javascript
const pipeline = new UnifiedPipeline({
  logger: logger, // Your logger instance
  baselineDate: '2023-10-07', // Optional, defaults to 2023-10-07
});
```

### 4. Process Data

```javascript
const results = await pipeline.process(
  rawData,      // Your raw data from API
  metadata,     // Dataset metadata
  transformer,  // Transformer instance
  {
    enrich: true,           // Add geospatial/temporal context
    validate: true,         // Run quality checks
    partition: true,        // Partition large datasets
    outputDir: DATA_DIR,    // Where to save partitions
  }
);
```

### 5. Save Results

```javascript
// Create output package with metadata
const output = pipeline.createOutputPackage(results, metadata);

// Save to file
await writeJSON('output.json', output);
```

## Complete Example

```javascript
import { EconomicTransformer } from './utils/economic-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
import { createLogger } from './utils/logger.js';
import fs from 'fs/promises';

async function fetchAndProcess() {
  const logger = createLogger({ context: 'DataFetch' });
  
  // 1. Fetch raw data
  const rawData = await fetch('https://api.worldbank.org/...')
    .then(r => r.json());
  
  // 2. Create transformer and pipeline
  const transformer = new EconomicTransformer();
  const pipeline = new UnifiedPipeline({ logger });
  
  // 3. Process through pipeline
  const results = await pipeline.process(
    rawData,
    {
      source: 'World Bank',
      organization: 'World Bank',
      indicator_code: 'NY.GDP.MKTP.CD',
      indicator_name: 'GDP (current US$)',
    },
    transformer,
    {
      enrich: true,
      validate: true,
      partition: true,
      outputDir: './public/data/worldbank',
    }
  );
  
  // 4. Check results
  if (results.success) {
    logger.success(`Processed ${results.stats.recordCount} records`);
    logger.info(`Quality score: ${(results.validated.qualityScore * 100).toFixed(1)}%`);
    
    if (results.partitioned) {
      logger.info(`Created ${results.partitioned.partitionCount} partitions`);
    }
  } else {
    logger.error('Processing failed', results.errors);
  }
  
  // 5. Save output
  const output = pipeline.createOutputPackage(results, {
    source: 'World Bank',
    dataset: 'GDP',
  });
  
  await fs.writeFile(
    './output.json',
    JSON.stringify(output, null, 2),
    'utf-8'
  );
}
```

## Available Transformers

### Economic Data
```javascript
import { EconomicTransformer } from './utils/economic-transformer.js';
const transformer = new EconomicTransformer();
```
**Use for**: World Bank indicators, PCBS statistics

### Conflict Data
```javascript
import { ConflictTransformer } from './utils/conflict-transformer.js';
const transformer = new ConflictTransformer();
```
**Use for**: ACLED, HDX conflict datasets, Tech4Palestine, Good Shepherd casualties

### HDX Categories
```javascript
import {
  InfrastructureTransformer,
  EducationTransformer,
  HealthTransformer,
  WaterTransformer,
  HumanitarianTransformer,
  RefugeeTransformer,
  ShelterTransformer,
} from './utils/hdx-transformers.js';

// Pick the appropriate one
const transformer = new InfrastructureTransformer();
```

## Pipeline Options

```javascript
{
  // Enable/disable enrichment
  enrich: true,              // Default: true
  enrichGeospatial: true,    // Default: true
  enrichTemporal: true,      // Default: true
  
  // Enable/disable validation
  validate: true,            // Default: true
  
  // Enable/disable partitioning
  partition: true,           // Default: true (if >1000 records)
  outputDir: './data',       // Required if partition: true
  
  // Cross-dataset linking
  linkData: false,           // Default: false
  allDatasets: new Map(),    // Required if linkData: true
  
  // Pass transformer for category-specific enrichment
  transformer: transformer,
}
```

## Output Structure

```javascript
{
  metadata: {
    source: 'World Bank',
    processed_at: '2024-01-15T10:30:00Z',
    record_count: 150,
    processing_time_ms: 1250
  },
  data: [
    {
      id: 'economic-abc123',
      type: 'economic',
      category: 'economic',
      date: '2023-01-01',
      location: { ... },
      value: 12345.67,
      unit: 'currency_usd',
      indicator_code: 'NY.GDP.MKTP.CD',
      indicator_name: 'GDP (current US$)',
      quality: {
        score: 0.95,
        completeness: 0.98,
        consistency: 0.92,
        verified: false,
        confidence: 0.8
      },
      sources: [ ... ],
      analysis: {
        trend: { slope: 0.05, direction: 'increasing' },
        growth_rate: 3.2,
        volatility: 1.5,
        recent_change: 2.8,
        baseline_comparison: 5.5
      }
    },
    // ... more records
  ],
  validation: {
    qualityScore: 0.92,
    completeness: 0.95,
    consistency: 0.90,
    accuracy: 0.91,
    meetsThreshold: true,
    errorCount: 2,
    warningCount: 5
  },
  partition_info: {
    partitioned: true,
    partitionCount: 4,
    totalRecords: 150,
    recentRecords: 45
  }
}
```

## Common Patterns

### Pattern 1: Simple Transformation
```javascript
const transformer = new EconomicTransformer();
const transformed = transformer.transform(rawData, metadata);
// Use transformed data directly
```

### Pattern 2: Transform + Validate
```javascript
const transformer = new EconomicTransformer();
const transformed = transformer.transform(rawData, metadata);
const validation = transformer.validate(transformed);

if (validation.meetsThreshold) {
  // Data is good quality
} else {
  // Handle low quality data
}
```

### Pattern 3: Full Pipeline
```javascript
const pipeline = new UnifiedPipeline({ logger });
const results = await pipeline.process(rawData, metadata, transformer, {
  enrich: true,
  validate: true,
  partition: true,
  outputDir: DATA_DIR,
});
```

### Pattern 4: Custom Enrichment
```javascript
const transformer = new EconomicTransformer();
let data = transformer.transform(rawData, metadata);

// Add custom enrichment
data = transformer.enrich(data);

// Or use enrichers directly
import { GeospatialEnricher } from './utils/geospatial-enricher.js';
const geoEnricher = new GeospatialEnricher();
data = data.map(record => ({
  ...record,
  location: geoEnricher.enrichLocation(record.location),
}));
```

## Troubleshooting

### Issue: Low Quality Score
```javascript
// Check validation details
if (results.validated.qualityScore < 0.8) {
  console.log('Errors:', results.validated.errors);
  console.log('Warnings:', results.validated.warnings);
  console.log('Completeness:', results.validated.completeness);
  console.log('Consistency:', results.validated.consistency);
}
```

### Issue: No Records After Transformation
```javascript
// Check raw data structure
console.log('Raw data type:', typeof rawData);
console.log('Is array:', Array.isArray(rawData));
console.log('Keys:', Object.keys(rawData));

// Check if data is nested
if (rawData.data) console.log('Found nested data');
if (rawData.results) console.log('Found results array');
```

### Issue: Partitioning Not Working
```javascript
// Check record count
console.log('Record count:', results.stats.recordCount);
// Partitioning only happens if > 1000 records

// Check output directory
console.log('Output dir exists:', await fs.access(outputDir).then(() => true).catch(() => false));
```

## Tips

1. **Always use logger**: Pass a logger to the pipeline for better debugging
2. **Check validation**: Review quality scores and errors before saving
3. **Test with small datasets**: Start with a few records to verify transformation
4. **Use partitioning**: Enable for datasets > 1000 records for better performance
5. **Enrich selectively**: Disable enrichment if not needed to speed up processing

## Next Steps

1. Read the full integration guide: `scripts/UNIFIED_PIPELINE_INTEGRATION.md`
2. Check transformer source code for customization options
3. Review the design document: `.kiro/specs/unified-data-system/design.md`
4. Test with your data source
5. Integrate into your fetch script
