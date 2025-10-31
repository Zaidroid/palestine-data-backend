# Unified Data System API Reference

## Overview

This document provides a complete API reference for the Unified Data System, including service functions, React hooks, types, and utilities.

## Table of Contents

- [Service Functions](#service-functions)
- [React Query Hooks](#react-query-hooks)
- [Type Definitions](#type-definitions)
- [Filtering and Querying](#filtering-and-querying)
- [Export Functions](#export-functions)
- [Utility Functions](#utility-functions)

## Service Functions

### getConflictData

Fetch conflict and incident data.

```typescript
function getConflictData(filters?: DataFilters): Promise<UnifiedDataResponse<ConflictData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to conflict data with metadata

**Example:**
```typescript
import { getConflictData } from '@/services/unifiedDataService';

const response = await getConflictData({
  dateRange: { start: '2024-01-01', end: '2024-12-31' },
  region: 'gaza',
  qualityThreshold: 0.8,
});

console.log(`Found ${response.data.length} incidents`);
console.log(`Quality score: ${response.metadata.quality.average_score}`);
```

---

### getEconomicData

Fetch economic indicators and financial data.

```typescript
function getEconomicData(filters?: DataFilters): Promise<UnifiedDataResponse<EconomicData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to economic data with metadata

**Example:**
```typescript
import { getEconomicData } from '@/services/unifiedDataService';

const response = await getEconomicData({
  dateRange: { start: '2020-01-01', end: '2024-12-31' },
});

response.data.forEach(indicator => {
  console.log(`${indicator.indicator_name}: ${indicator.value}`);
  if (indicator.analysis) {
    console.log(`Trend: ${indicator.analysis.trend.direction}`);
  }
});
```

---

### getInfrastructureData

Fetch infrastructure and building damage data.

```typescript
function getInfrastructureData(filters?: DataFilters): Promise<UnifiedDataResponse<InfrastructureData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to infrastructure data with metadata

**Example:**
```typescript
import { getInfrastructureData } from '@/services/unifiedDataService';

const response = await getInfrastructureData({
  region: 'gaza',
  qualityThreshold: 0.8,
});

const destroyed = response.data.filter(d => d.damage_level === 'destroyed');
console.log(`${destroyed.length} buildings destroyed`);
```

---

### getHumanitarianData

Fetch humanitarian needs and assistance data.

```typescript
function getHumanitarianData(filters?: DataFilters): Promise<UnifiedDataResponse<HumanitarianData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to humanitarian data with metadata

**Example:**
```typescript
import { getHumanitarianData } from '@/services/unifiedDataService';

const response = await getHumanitarianData({
  region: 'gaza',
});

const totalInNeed = response.data.reduce((sum, d) => sum + d.people_in_need, 0);
console.log(`${totalInNeed} people in need`);
```

---

### getHealthData

Fetch health facilities and health indicator data.

```typescript
function getHealthData(filters?: DataFilters): Promise<UnifiedDataResponse<HealthData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to health data with metadata

**Example:**
```typescript
import { getHealthData } from '@/services/unifiedDataService';

const response = await getHealthData({
  region: 'gaza',
});

const operational = response.data.filter(d => d.status === 'operational');
console.log(`${operational.length} health facilities operational`);
```

---

### getEducationData

Fetch education facilities and education data.

```typescript
function getEducationData(filters?: DataFilters): Promise<UnifiedDataResponse<EducationData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to education data with metadata

**Example:**
```typescript
import { getEducationData } from '@/services/unifiedDataService';

const response = await getEducationData({
  region: 'west_bank',
});

const schools = response.data.filter(d => d.facility_type === 'school');
console.log(`${schools.length} schools`);
```

---

### getWaterData

Fetch water facilities and WASH data.

```typescript
function getWaterData(filters?: DataFilters): Promise<UnifiedDataResponse<WaterData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to water data with metadata

**Example:**
```typescript
import { getWaterData } from '@/services/unifiedDataService';

const response = await getWaterData({
  region: 'gaza',
});

const damaged = response.data.filter(d => d.status === 'damaged');
console.log(`${damaged.length} water facilities damaged`);
```

---

### getRefugeeData

Fetch displacement and refugee data.

```typescript
function getRefugeeData(filters?: DataFilters): Promise<UnifiedDataResponse<RefugeeData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- Promise resolving to refugee data with metadata

**Example:**
```typescript
import { getRefugeeData } from '@/services/unifiedDataService';

const response = await getRefugeeData();

const totalDisplaced = response.data.reduce((sum, d) => sum + d.population, 0);
console.log(`${totalDisplaced} people displaced`);
```

---

## React Query Hooks

### useConflictData

React Query hook for conflict data with automatic caching.

```typescript
function useConflictData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<ConflictData>>
```

**Parameters:**
- `filters` (optional): Filtering options

**Returns:**
- React Query result with data, loading state, and error

**Example:**
```typescript
import { useConflictData } from '@/hooks/useUnifiedData';

function ConflictChart() {
  const { data, isLoading, error, refetch } = useConflictData({
    dateRange: { start: '2024-01-01', end: '2024-12-31' },
    region: 'gaza',
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error message={error.message} />;
  
  return (
    <div>
      <Chart data={data.data} />
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  );
}
```

---

### useEconomicData

React Query hook for economic data.

```typescript
function useEconomicData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<EconomicData>>
```

**Example:**
```typescript
import { useEconomicData } from '@/hooks/useUnifiedData';

function EconomicDashboard() {
  const { data, isLoading } = useEconomicData();
  
  if (isLoading) return <Skeleton />;
  
  return (
    <div>
      {data.data.map(indicator => (
        <IndicatorCard key={indicator.id} data={indicator} />
      ))}
    </div>
  );
}
```

---

### useInfrastructureData

React Query hook for infrastructure data.

```typescript
function useInfrastructureData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<InfrastructureData>>
```

**Example:**
```typescript
import { useInfrastructureData } from '@/hooks/useUnifiedData';

function InfrastructureMap() {
  const { data } = useInfrastructureData({
    region: 'gaza',
    qualityThreshold: 0.8,
  });
  
  return <Map markers={data?.data || []} />;
}
```

---

### useHumanitarianData

React Query hook for humanitarian data.

```typescript
function useHumanitarianData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<HumanitarianData>>
```

---

### useHealthData

React Query hook for health data.

```typescript
function useHealthData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<HealthData>>
```

---

### useEducationData

React Query hook for education data.

```typescript
function useEducationData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<EducationData>>
```

---

### useWaterData

React Query hook for water data.

```typescript
function useWaterData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<WaterData>>
```

---

### useRefugeeData

React Query hook for refugee data.

```typescript
function useRefugeeData(filters?: DataFilters): UseQueryResult<UnifiedDataResponse<RefugeeData>>
```

---

## Type Definitions

### UnifiedDataPoint

Base interface for all unified data.

```typescript
interface UnifiedDataPoint {
  id: string;
  type: DataType;
  category: DataCategory;
  date: string;
  timestamp?: string;
  period?: {
    type: 'day' | 'week' | 'month' | 'quarter' | 'year';
    value: string;
  };
  location: LocationData;
  value: any;
  unit?: string;
  quality: QualityMetrics;
  sources: SourceInfo[];
  related_data?: RelatedData;
  created_at: string;
  updated_at: string;
  version: number;
}
```

---

### LocationData

Location information with enrichment.

```typescript
interface LocationData {
  name: string;
  coordinates?: [number, number];
  admin_levels: {
    level1: string;
    level2?: string;
    level3?: string;
  };
  region: 'gaza' | 'west_bank' | 'east_jerusalem';
  region_type?: 'urban' | 'rural' | 'camp';
  area_classification?: 'A' | 'B' | 'C';
  proximity?: {
    nearest_city?: string;
    distance_to_border?: number;
    distance_to_checkpoint?: number;
  };
  conflict_zone?: 'high' | 'medium' | 'low';
  access_level?: 'full' | 'restricted' | 'denied';
}
```

---

### QualityMetrics

Data quality information.

```typescript
interface QualityMetrics {
  score: number; // 0-1
  completeness: number; // 0-1
  consistency: number; // 0-1
  accuracy: number; // 0-1
  verified: boolean;
  confidence: number; // 0-1
}
```

---

### DataFilters

Filtering options for data queries.

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

---

### UnifiedDataResponse

Response format for data queries.

```typescript
interface UnifiedDataResponse<T extends UnifiedDataPoint> {
  data: T[];
  metadata: {
    total: number;
    filtered: number;
    category: DataCategory;
    quality: {
      average_score: number;
      min_score: number;
      max_score: number;
    };
    date_range: {
      start: string;
      end: string;
    };
    sources: string[];
  };
  validation?: ValidationResult;
  relationships?: RelationshipInfo[];
}
```

---

## Filtering and Querying

### filterByDateRange

Filter data by date range.

```typescript
function filterByDateRange<T extends UnifiedDataPoint>(
  data: T[],
  start: string,
  end: string
): T[]
```

**Example:**
```typescript
import { filterByDateRange } from '@/utils/dataFiltering';

const filtered = filterByDateRange(data, '2024-01-01', '2024-12-31');
```

---

### filterByRegion

Filter data by region.

```typescript
function filterByRegion<T extends UnifiedDataPoint>(
  data: T[],
  region: 'gaza' | 'west_bank' | 'east_jerusalem'
): T[]
```

**Example:**
```typescript
import { filterByRegion } from '@/utils/dataFiltering';

const gazaData = filterByRegion(data, 'gaza');
```

---

### filterByQuality

Filter data by quality threshold.

```typescript
function filterByQuality<T extends UnifiedDataPoint>(
  data: T[],
  threshold: number
): T[]
```

**Example:**
```typescript
import { filterByQuality } from '@/utils/dataFiltering';

const highQuality = filterByQuality(data, 0.8);
```

---

### filterByCategory

Filter data by category.

```typescript
function filterByCategory<T extends UnifiedDataPoint>(
  data: T[],
  category: DataCategory
): T[]
```

**Example:**
```typescript
import { filterByCategory } from '@/utils/dataFiltering';

const conflictData = filterByCategory(data, 'conflict');
```

---

## Export Functions

### exportToJSON

Export data to JSON format.

```typescript
function exportToJSON<T extends UnifiedDataPoint>(
  data: T[],
  metadata: DatasetMetadata,
  options?: ExportOptions
): ExportResult
```

**Parameters:**
- `data`: Array of unified data points
- `metadata`: Dataset metadata
- `options`: Export options

**Returns:**
- Export result with data and metadata

**Example:**
```typescript
import { exportToJSON, downloadExport } from '@/services/exportService';

const result = exportToJSON(data, metadata, {
  includeMetadata: true,
  includeRelationships: true,
  prettyPrint: true,
});

if (result.success) {
  downloadExport(result);
}
```

---

### exportToCSV

Export data to CSV format.

```typescript
function exportToCSV<T extends UnifiedDataPoint>(
  data: T[],
  metadata: DatasetMetadata,
  options?: ExportOptions
): ExportResult
```

**Example:**
```typescript
import { exportToCSV, downloadExport } from '@/services/exportService';

const result = exportToCSV(data, metadata, {
  csvDelimiter: ',',
  csvIncludeHeaders: true,
});

if (result.success) {
  downloadExport(result);
}
```

---

### exportToGeoJSON

Export geospatial data to GeoJSON format.

```typescript
function exportToGeoJSON<T extends UnifiedDataPoint>(
  data: T[],
  metadata: DatasetMetadata,
  options?: ExportOptions
): ExportResult
```

**Example:**
```typescript
import { exportToGeoJSON, downloadExport } from '@/services/exportService';

const result = exportToGeoJSON(data, metadata, {
  includeMetadata: true,
});

if (result.success) {
  downloadExport(result);
}
```

---

### bulkExport

Export multiple datasets at once.

```typescript
function bulkExport(
  datasets: Array<{
    data: UnifiedDataPoint[];
    metadata: DatasetMetadata;
    format: 'json' | 'csv' | 'geojson';
  }>,
  options?: BulkExportOptions
): Promise<ExportResult>
```

**Example:**
```typescript
import { bulkExport } from '@/services/exportService';

const result = await bulkExport([
  { data: conflictData, metadata: conflictMeta, format: 'json' },
  { data: economicData, metadata: economicMeta, format: 'csv' },
], {
  archiveFormat: 'zip',
  includeManifest: true,
  onProgress: (progress) => {
    console.log(`${progress.percentage}%`);
  },
});
```

---

### downloadExport

Trigger browser download of export result.

```typescript
function downloadExport(result: ExportResult): void
```

**Example:**
```typescript
import { exportToJSON, downloadExport } from '@/services/exportService';

const result = exportToJSON(data, metadata);
downloadExport(result);
```

---

## Utility Functions

### createDataResponse

Create a standardized data response.

```typescript
function createDataResponse<T extends UnifiedDataPoint>(
  data: T[],
  category: DataCategory,
  validation?: ValidationResult,
  relationships?: RelationshipInfo[]
): UnifiedDataResponse<T>
```

---

### calculateQualityStats

Calculate quality statistics for a dataset.

```typescript
function calculateQualityStats<T extends UnifiedDataPoint>(
  data: T[]
): {
  average_score: number;
  min_score: number;
  max_score: number;
}
```

---

### extractDateRange

Extract date range from dataset.

```typescript
function extractDateRange<T extends UnifiedDataPoint>(
  data: T[]
): {
  start: string;
  end: string;
}
```

---

### extractSources

Extract unique sources from dataset.

```typescript
function extractSources<T extends UnifiedDataPoint>(
  data: T[]
): string[]
```

---

## Error Handling

All functions return results with error information:

```typescript
interface ExportResult {
  success: boolean;
  data: string;
  metadata: ExportMetadata;
  filename: string;
  mimeType: string;
  size: number;
  error?: string;
}
```

**Example:**
```typescript
const result = exportToJSON(data, metadata);

if (!result.success) {
  console.error('Export failed:', result.error);
  // Handle error
} else {
  console.log('Export successful');
  downloadExport(result);
}
```

## Cache Configuration

React Query hooks use the following cache configuration:

```typescript
{
  staleTime: 5 * 60 * 1000,  // 5 minutes
  cacheTime: 30 * 60 * 1000, // 30 minutes
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
}
```

## Best Practices

1. **Always handle loading and error states**
```typescript
const { data, isLoading, error } = useConflictData();

if (isLoading) return <Skeleton />;
if (error) return <Error />;
if (!data) return <EmptyState />;
```

2. **Use quality thresholds**
```typescript
const { data } = useConflictData({
  qualityThreshold: 0.8, // Only high-quality data
});
```

3. **Filter at the service level**
```typescript
// Good: Filter in query
const { data } = useConflictData({
  region: 'gaza',
  dateRange: { start: '2024-01-01', end: '2024-12-31' },
});

// Avoid: Filter in component
const filtered = data?.data.filter(d => d.location.region === 'gaza');
```

4. **Check export success**
```typescript
const result = exportToJSON(data, metadata);

if (result.success) {
  downloadExport(result);
} else {
  showError(result.error);
}
```

5. **Use TypeScript types**
```typescript
import type { ConflictData, UnifiedDataResponse } from '@/types/unified-data.types';

const response: UnifiedDataResponse<ConflictData> = await getConflictData();
```

## Additional Resources

- [Unified Data System Guide](./UNIFIED_DATA_SYSTEM.md)
- [Export Service Documentation](../../src/services/EXPORT_SERVICE_README.md)
- [Type Definitions](../../src/types/unified-data.types.ts)
- [Design Document](../../.kiro/specs/unified-data-system/design.md)

