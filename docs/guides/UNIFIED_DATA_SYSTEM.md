# Unified Data System Guide

## Overview

The Unified Data System is a comprehensive data infrastructure that standardizes data collection, transformation, storage, and access across all data sources in Palestine Pulse. It provides a consistent interface for working with data from 9+ sources including Tech4Palestine, World Bank, HDX, Good Shepherd, WHO, UNRWA, and more.

## Key Features

- **Unified Data Model**: Consistent structure across all data sources
- **Automatic Enrichment**: Geospatial, temporal, and quality enrichment
- **Data Validation**: Comprehensive quality checks and scoring
- **Smart Partitioning**: Automatic chunking for large datasets
- **Cross-Dataset Linking**: Relationships between related data
- **Multiple Export Formats**: JSON, CSV, and GeoJSON exports
- **Type Safety**: Full TypeScript support throughout

## Architecture

```
External APIs
    ↓
Fetch Scripts (Node.js)
    ↓
Transformation Pipeline
    ↓
Enrichment (Geospatial, Temporal, Quality)
    ↓
Validation & Quality Scoring
    ↓
Partitioning & Storage
    ↓
Unified Data Store (JSON)
    ↓
Data Access Layer (Services & Hooks)
    ↓
React Components
```

## Quick Start

### 1. Fetching and Transforming Data

```bash
# Fetch all data sources and transform to unified format
npm run update-data

# Or run steps individually:
npm run fetch-all-data      # Fetch raw data from sources
npm run populate-unified     # Transform to unified format
npm run generate-manifest    # Create manifest
npm run validate-data        # Validate data quality
```

**What happens during transformation:**
1. Raw data is fetched from sources (World Bank, Tech4Palestine, HDX, etc.)
2. Data is transformed to unified format with consistent structure
3. Geospatial, temporal, and quality enrichment is applied
4. Data is validated and quality scored
5. Large datasets are partitioned by quarter
6. Cross-dataset relationships are created
7. Metadata and validation reports are generated

### 2. Using Data in Components

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';

function MyComponent() {
  const { data, isLoading, error } = useConflictData({
    dateRange: { start: '2024-01-01', end: '2024-12-31' },
    region: 'gaza',
    qualityThreshold: 0.8,
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error message={error.message} />;
  
  return <Chart data={data} />;
}
```

### 3. Exporting Data

```typescript
import { exportToJSON, downloadExport } from '@/services/exportService';

const result = exportToJSON(data, metadata, {
  includeMetadata: true,
  includeRelationships: true,
});

if (result.success) {
  downloadExport(result);
}
```

## Data Model

### Core Structure

All data follows a unified structure:

```typescript
interface UnifiedDataPoint {
  // Identity
  id: string;
  type: DataType;
  category: DataCategory;
  
  // Temporal
  date: string; // ISO 8601 YYYY-MM-DD
  timestamp?: string;
  period?: {
    type: 'day' | 'week' | 'month' | 'quarter' | 'year';
    value: string;
  };
  
  // Spatial
  location: LocationData;
  
  // Data
  value: any;
  unit?: string;
  
  // Quality
  quality: QualityMetrics;
  
  // Provenance
  sources: SourceInfo[];
  
  // Relationships
  related_data?: RelatedData;
  
  // Metadata
  created_at: string;
  updated_at: string;
  version: number;
}
```

### Location Data

```typescript
interface LocationData {
  name: string;
  coordinates?: [number, number]; // [longitude, latitude]
  admin_levels: {
    level1: string; // Governorate
    level2?: string; // District
    level3?: string; // Locality
  };
  region: 'gaza' | 'west_bank' | 'east_jerusalem';
  region_type?: 'urban' | 'rural' | 'camp';
  area_classification?: 'A' | 'B' | 'C'; // West Bank only
  proximity?: {
    nearest_city?: string;
    distance_to_border?: number;
    distance_to_checkpoint?: number;
  };
  conflict_zone?: 'high' | 'medium' | 'low';
  access_level?: 'full' | 'restricted' | 'denied';
}
```

### Quality Metrics

```typescript
interface QualityMetrics {
  score: number; // 0-1 overall quality
  completeness: number; // 0-1
  consistency: number; // 0-1
  accuracy: number; // 0-1
  verified: boolean;
  confidence: number; // 0-1
}
```

## Data Categories

### 1. Conflict Data

Incidents, casualties, and conflict-related events.

```typescript
interface ConflictData extends UnifiedDataPoint {
  type: 'conflict';
  event_type: string;
  fatalities: number;
  injuries: number;
  actors: {
    actor1?: string;
    actor2?: string;
  };
  description: string;
  severity_index?: number;
}
```

**Sources**: Tech4Palestine, ACLED, HDX, Good Shepherd

**Usage**:
```typescript
import { useConflictData } from '@/hooks/useUnifiedData';

const { data } = useConflictData();
```

### 2. Economic Data

Economic indicators and financial metrics.

```typescript
interface EconomicData extends UnifiedDataPoint {
  type: 'economic';
  indicator_code: string;
  indicator_name: string;
  analysis?: {
    trend: { slope: number; direction: 'increasing' | 'decreasing' | 'stable' };
    growth_rate: number;
    volatility: number;
    recent_change: number;
    baseline_comparison: number;
  };
  comparative?: {
    regional_average: number;
    regional_rank: number;
    percentile: number;
  };
}
```

**Sources**: World Bank, PCBS

**Usage**:
```typescript
import { useEconomicData } from '@/hooks/useUnifiedData';

const { data } = useEconomicData();
```

### 3. Infrastructure Data

Buildings, facilities, and infrastructure damage.

```typescript
interface InfrastructureData extends UnifiedDataPoint {
  type: 'infrastructure';
  structure_type: string;
  damage_level: 'none' | 'minor' | 'moderate' | 'severe' | 'destroyed';
  damage_date?: string;
  estimated_cost?: number;
  people_affected?: number;
  status: 'operational' | 'damaged' | 'destroyed' | 'under_repair';
}
```

**Sources**: HDX, Tech4Palestine

**Usage**:
```typescript
import { useInfrastructureData } from '@/hooks/useUnifiedData';

const { data } = useInfrastructureData();
```

### 4. Humanitarian Data

Humanitarian needs, assistance, and displacement.

```typescript
interface HumanitarianData extends UnifiedDataPoint {
  type: 'humanitarian';
  sector: string;
  people_in_need: number;
  people_targeted: number;
  people_reached: number;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  priority?: number;
  funding?: {
    required: number;
    received: number;
    gap: number;
  };
}
```

**Sources**: HDX, UNRWA, WFP

**Usage**:
```typescript
import { useHumanitarianData } from '@/hooks/useUnifiedData';

const { data } = useHumanitarianData();
```

### 5. Health Data

Health facilities, services, and health indicators.

```typescript
interface HealthData extends UnifiedDataPoint {
  type: 'health';
  facility_type?: string;
  service_type?: string;
  capacity?: number;
  patients?: number;
  status?: 'operational' | 'partially_operational' | 'non_operational';
}
```

**Sources**: WHO, HDX

**Usage**:
```typescript
import { useHealthData } from '@/hooks/useUnifiedData';

const { data } = useHealthData();
```

### 6. Education Data

Schools, students, and education services.

```typescript
interface EducationData extends UnifiedDataPoint {
  type: 'education';
  facility_type: string;
  students?: number;
  teachers?: number;
  status: 'operational' | 'damaged' | 'closed' | 'destroyed';
}
```

**Sources**: HDX, UNRWA

**Usage**:
```typescript
import { useEducationData } from '@/hooks/useUnifiedData';

const { data } = useEducationData();
```

### 7. Water Data

Water facilities, WASH services, and water access.

```typescript
interface WaterData extends UnifiedDataPoint {
  type: 'water';
  facility_type: string;
  service_type: string;
  capacity?: number;
  population_served?: number;
  status: 'operational' | 'damaged' | 'non_operational';
}
```

**Sources**: HDX

**Usage**:
```typescript
import { useWaterData } from '@/hooks/useUnifiedData';

const { data } = useWaterData();
```

### 8. Refugee Data

Displacement, refugees, and camp data.

```typescript
interface RefugeeData extends UnifiedDataPoint {
  type: 'refugee';
  displacement_type: 'internal' | 'refugee' | 'returnee';
  population: number;
  camp_name?: string;
  registration_status?: string;
}
```

**Sources**: UNRWA, HDX

**Usage**:
```typescript
import { useRefugeeData } from '@/hooks/useUnifiedData';

const { data } = useRefugeeData();
```

## Data Access Layer

### Service Functions

Direct access to data with filtering:

```typescript
import {
  getConflictData,
  getEconomicData,
  getInfrastructureData,
  getHumanitarianData,
  getHealthData,
  getEducationData,
  getWaterData,
  getRefugeeData,
} from '@/services/unifiedDataService';

// Get conflict data with filters
const data = await getConflictData({
  dateRange: { start: '2024-01-01', end: '2024-12-31' },
  region: 'gaza',
  category: 'conflict',
  qualityThreshold: 0.8,
});
```

### React Query Hooks

Hooks with automatic caching and revalidation:

```typescript
import {
  useConflictData,
  useEconomicData,
  useInfrastructureData,
  useHumanitarianData,
  useHealthData,
  useEducationData,
  useWaterData,
  useRefugeeData,
} from '@/hooks/useUnifiedData';

function MyComponent() {
  const { data, isLoading, error, refetch } = useConflictData({
    dateRange: { start: '2024-01-01', end: '2024-12-31' },
    region: 'gaza',
  });
  
  return (
    <div>
      {isLoading && <Skeleton />}
      {error && <Error message={error.message} />}
      {data && <Chart data={data} />}
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  );
}
```

### Filtering Options

```typescript
interface DataFilters {
  dateRange?: {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
  };
  region?: 'gaza' | 'west_bank' | 'east_jerusalem';
  category?: DataCategory;
  qualityThreshold?: number; // 0-1
  limit?: number;
  offset?: number;
}
```

## Data Enrichment

### Geospatial Enrichment

Automatically adds:
- Administrative boundaries (governorate, district, locality)
- Region classification (Gaza, West Bank, East Jerusalem)
- Region type (urban, rural, camp)
- West Bank area classification (A, B, C)
- Proximity to cities, borders, checkpoints
- Conflict zone classification
- Access level assessment

### Temporal Enrichment

Automatically adds:
- Period classification (day, week, month, quarter, year)
- Baseline comparison (days since October 7, 2023)
- Conflict phase determination
- Moving averages (7-day, 30-day)

### Quality Enrichment

Automatically calculates:
- Overall quality score (0-1)
- Completeness score
- Consistency score
- Accuracy score
- Confidence level

## Data Validation

### Quality Checks

1. **Completeness**: Required fields present
2. **Consistency**: Valid formats and ranges
3. **Accuracy**: Cross-source verification
4. **Temporal**: No future dates, chronological order
5. **Spatial**: Valid coordinates, known locations

### Quality Thresholds

- **High Quality**: Score ≥ 0.9
- **Good Quality**: Score ≥ 0.8
- **Acceptable**: Score ≥ 0.7
- **Low Quality**: Score < 0.7

### Validation Results

```typescript
interface ValidationResult {
  qualityScore: number;
  completeness: number;
  consistency: number;
  accuracy: number;
  meetsThreshold: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

## Data Partitioning

### Automatic Partitioning

Datasets with >10,000 records are automatically partitioned by quarter:

```
public/data/unified/conflict/
├── metadata.json
├── all-data.json (if < 10k records)
├── recent.json (last 90 days)
├── partitions/
│   ├── 2023-Q4.json
│   ├── 2024-Q1.json
│   ├── 2024-Q2.json
│   └── index.json
└── validation.json
```

### Loading Partitions

```typescript
import { loadPartition } from '@/services/unifiedDataService';

// Load specific quarter
const data = await loadPartition('conflict', '2024-Q1');

// Load recent data (last 90 days)
const recent = await loadPartition('conflict', 'recent');
```

## Cross-Dataset Linking

### Relationship Types

1. **Conflict → Infrastructure**: Incidents linked to nearby damaged buildings
2. **Infrastructure → Humanitarian**: Damage linked to displacement
3. **Economic → Social**: Economic indicators correlated with social metrics

### Using Relationships

```typescript
// Get conflict data with related infrastructure
const conflict = await getConflictData({ includeRelated: true });

conflict.forEach(incident => {
  if (incident.related_data?.infrastructure) {
    const relatedBuildings = incident.related_data.infrastructure;
    console.log(`Incident ${incident.id} affected ${relatedBuildings.length} buildings`);
  }
});
```

## Export Functionality

### Export Formats

1. **JSON**: Full data with metadata and relationships
2. **CSV**: Flattened structure for spreadsheets
3. **GeoJSON**: Geospatial data for mapping

### Export Examples

```typescript
import { exportToJSON, exportToCSV, exportToGeoJSON, downloadExport } from '@/services/exportService';

// Export to JSON
const jsonResult = exportToJSON(data, metadata, {
  includeMetadata: true,
  includeRelationships: true,
  prettyPrint: true,
});

// Export to CSV
const csvResult = exportToCSV(data, metadata, {
  csvDelimiter: ',',
  csvIncludeHeaders: true,
});

// Export to GeoJSON
const geoResult = exportToGeoJSON(data, metadata, {
  includeMetadata: true,
});

// Download
if (jsonResult.success) {
  downloadExport(jsonResult);
}
```

### Bulk Export

```typescript
import { bulkExport } from '@/services/exportService';

const datasets = [
  { data: conflictData, metadata: conflictMetadata, format: 'json' },
  { data: economicData, metadata: economicMetadata, format: 'csv' },
  { data: infrastructureData, metadata: infrastructureMetadata, format: 'geojson' },
];

const result = await bulkExport(datasets, {
  archiveFormat: 'zip',
  includeManifest: true,
  onProgress: (progress) => {
    console.log(`${progress.percentage}% - ${progress.status}`);
  },
});
```

## Automated Updates

### GitHub Actions Workflows

Data is automatically updated on schedules:

- **Real-time** (every 6 hours): Tech4Palestine
- **Daily** (midnight UTC): Good Shepherd, B'Tselem
- **Weekly** (Sunday midnight): HDX, WFP
- **Monthly** (1st of month): World Bank, WHO, UNRWA, PCBS

### Manual Updates

```bash
# Update all sources
npm run fetch-all-data

# Update specific source
node scripts/fetch-worldbank-data.js
node scripts/fetch-hdx-ckan-data.js
```

## Directory Structure

```
public/data/
├── unified/                    # Unified data store
│   ├── conflict/
│   │   ├── metadata.json
│   │   ├── all-data.json
│   │   ├── recent.json
│   │   ├── partitions/
│   │   │   ├── 2023-Q4.json
│   │   │   ├── 2024-Q1.json
│   │   │   └── index.json
│   │   └── validation.json
│   ├── economic/
│   ├── infrastructure/
│   ├── humanitarian/
│   ├── education/
│   ├── health/
│   ├── water/
│   └── refugees/
├── sources/                    # Source-specific raw data
│   ├── tech4palestine/
│   ├── worldbank/
│   ├── hdx/
│   ├── goodshepherd/
│   ├── who/
│   ├── unrwa/
│   └── pcbs/
└── relationships/              # Cross-dataset links
    ├── conflict-infrastructure.json
    ├── infrastructure-humanitarian.json
    └── economic-social.json
```

## Best Practices

### 1. Always Check Quality

```typescript
const { data } = useConflictData();

data.forEach(record => {
  if (record.quality.score < 0.8) {
    console.warn(`Low quality data: ${record.id}`);
  }
});
```

### 2. Use Appropriate Filters

```typescript
// Filter by quality threshold
const { data } = useConflictData({
  qualityThreshold: 0.8,
});

// Filter by date range
const { data } = useConflictData({
  dateRange: { start: '2024-01-01', end: '2024-12-31' },
});
```

### 3. Handle Loading and Errors

```typescript
const { data, isLoading, error } = useConflictData();

if (isLoading) return <Skeleton />;
if (error) return <Error message={error.message} />;
if (!data || data.length === 0) return <EmptyState />;

return <Chart data={data} />;
```

### 4. Leverage Relationships

```typescript
const { data } = useConflictData({ includeRelated: true });

data.forEach(incident => {
  if (incident.related_data?.infrastructure) {
    // Show related infrastructure damage
  }
});
```

### 5. Export with Metadata

```typescript
const result = exportToJSON(data, metadata, {
  includeMetadata: true,
  includeSources: true,
  includeQuality: true,
});
```

## Performance Considerations

1. **Use Partitions**: Load only needed quarters for large datasets
2. **Cache Effectively**: React Query caches for 5 minutes by default
3. **Filter Early**: Apply filters at the service level, not in components
4. **Lazy Load**: Load data on-demand, not all at once
5. **Optimize Queries**: Use quality thresholds to reduce data volume

## Troubleshooting

### Data Not Loading

1. Check if data files exist: `ls public/data/unified/`
2. Re-fetch data: `npm run fetch-all-data`
3. Check browser console for errors
4. Verify JSON is valid

### Low Quality Scores

1. Check validation results: `data.quality`
2. Review errors and warnings
3. Verify source data quality
4. Re-fetch from source

### Missing Relationships

1. Ensure cross-dataset linking is enabled
2. Check if related datasets exist
3. Verify spatial/temporal proximity
4. Review linking configuration

## Additional Resources

- **[Export Service Documentation](../../src/services/EXPORT_SERVICE_README.md)**: Detailed export guide
- **[Pipeline Quick Start](../../scripts/utils/PIPELINE_QUICK_START.md)**: Transformation pipeline guide
- **[Data Access Layer Testing](../../scripts/DATA_ACCESS_LAYER_TESTING.md)**: Testing documentation
- **[Statistical Analysis](../../scripts/utils/STATISTICAL_ANALYSIS_README.md)**: Analysis functions
- **[Design Document](../../.kiro/specs/unified-data-system/design.md)**: Technical design
- **[Requirements](../../.kiro/specs/unified-data-system/requirements.md)**: System requirements

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the additional resources
3. Check the GitHub issues
4. Consult the design document

