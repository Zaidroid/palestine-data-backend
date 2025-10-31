# Unified Data System - Quick Reference

## 🚀 Quick Start

```typescript
import { useConflictData } from '@/hooks/useUnifiedData';

function MyComponent() {
  const { data, isLoading, error } = useConflictData({
    region: 'gaza',
    qualityThreshold: 0.8,
  });
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error />;
  
  return <Chart data={data.data} />;
}
```

## 📊 Data Categories

| Category | Hook | Service | Type |
|----------|------|---------|------|
| Conflict | `useConflictData()` | `getConflictData()` | `ConflictData` |
| Economic | `useEconomicData()` | `getEconomicData()` | `EconomicData` |
| Infrastructure | `useInfrastructureData()` | `getInfrastructureData()` | `InfrastructureData` |
| Humanitarian | `useHumanitarianData()` | `getHumanitarianData()` | `HumanitarianData` |
| Health | `useHealthData()` | `getHealthData()` | `HealthData` |
| Education | `useEducationData()` | `getEducationData()` | `EducationData` |
| Water | `useWaterData()` | `getWaterData()` | `WaterData` |
| Refugee | `useRefugeeData()` | `getRefugeeData()` | `RefugeeData` |

## 🔍 Filtering

```typescript
const { data } = useConflictData({
  dateRange: { start: '2024-01-01', end: '2024-12-31' },
  region: 'gaza' | 'west_bank' | 'east_jerusalem',
  qualityThreshold: 0.8, // 0-1
  limit: 100,
  offset: 0,
});
```

## 📤 Export

```typescript
import { exportToJSON, exportToCSV, exportToGeoJSON, downloadExport } from '@/services/exportService';

// JSON
const result = exportToJSON(data, metadata);
downloadExport(result);

// CSV
const result = exportToCSV(data, metadata);
downloadExport(result);

// GeoJSON
const result = exportToGeoJSON(data, metadata);
downloadExport(result);
```

## 📍 Location Data

```typescript
location: {
  name: string;
  coordinates?: [lon, lat];
  admin_levels: {
    level1: string; // Governorate
    level2?: string; // District
    level3?: string; // Locality
  };
  region: 'gaza' | 'west_bank' | 'east_jerusalem';
  region_type?: 'urban' | 'rural' | 'camp';
  proximity?: {
    nearest_city?: string;
    distance_to_border?: number;
    distance_to_checkpoint?: number;
  };
  conflict_zone?: 'high' | 'medium' | 'low';
  access_level?: 'full' | 'restricted' | 'denied';
}
```

## ✅ Quality Metrics

```typescript
quality: {
  score: number; // 0-1 overall
  completeness: number; // 0-1
  consistency: number; // 0-1
  accuracy: number; // 0-1
  verified: boolean;
  confidence: number; // 0-1
}
```

**Quality Thresholds:**
- High: ≥ 0.9
- Good: ≥ 0.8
- Acceptable: ≥ 0.7
- Low: < 0.7

## 🔗 Relationships

```typescript
related_data?: {
  casualties?: string[]; // IDs
  incidents?: string[]; // IDs
  infrastructure?: string[]; // IDs
  economic?: string[]; // IDs
  humanitarian?: string[]; // IDs
}
```

## 📦 Data Structure

```
public/data/unified/
├── conflict/
│   ├── metadata.json
│   ├── recent.json (last 90 days)
│   ├── partitions/
│   │   ├── 2024-Q1.json
│   │   └── index.json
│   └── validation.json
├── economic/
├── infrastructure/
└── ... (other categories)
```

## 🛠️ Common Patterns

### Loading with Error Handling
```typescript
const { data, isLoading, error } = useConflictData();

if (isLoading) return <Skeleton />;
if (error) return <Error message={error.message} />;
if (!data || data.data.length === 0) return <EmptyState />;

return <Chart data={data.data} />;
```

### Filtering by Quality
```typescript
const highQuality = data?.data.filter(d => d.quality.score >= 0.8);
```

### Grouping by Region
```typescript
const byRegion = data?.data.reduce((acc, d) => {
  const region = d.location.region;
  if (!acc[region]) acc[region] = [];
  acc[region].push(d);
  return acc;
}, {});
```

### Time Series Data
```typescript
const timeSeries = data?.data
  .sort((a, b) => a.date.localeCompare(b.date))
  .map(d => ({ date: d.date, value: d.value }));
```

## 📝 Scripts

```bash
# Fetch and transform all data
npm run update-data

# Individual steps:
npm run fetch-all-data      # Fetch raw data
npm run populate-unified     # Transform to unified format
npm run validate-data        # Validate quality
npm run generate-manifest    # Create manifest
```

## 🔄 Automated Updates

- **Real-time** (6 hours): Tech4Palestine
- **Daily** (midnight): Good Shepherd, B'Tselem
- **Weekly** (Sunday): HDX, WFP
- **Monthly** (1st): World Bank, WHO, UNRWA, PCBS

## 📚 Full Documentation

- [Unified Data System Guide](guides/UNIFIED_DATA_SYSTEM.md)
- [API Reference](guides/UNIFIED_DATA_API.md)
- [Component Examples](guides/UNIFIED_DATA_EXAMPLES.md)
- [Data Transformation](guides/DATA_TRANSFORMATION.md)

## 🐛 Troubleshooting

**Data not loading?**
1. Check if files exist: `ls public/data/unified/`
2. Re-fetch: `npm run fetch-all-data`
3. Check console for errors

**Low quality scores?**
1. Check validation: `data.quality`
2. Review errors and warnings
3. Re-fetch from source

**Missing relationships?**
1. Ensure linking is enabled
2. Check spatial/temporal proximity
3. Verify related datasets exist

## 💡 Tips

1. Always check quality scores
2. Use appropriate filters
3. Handle loading and errors
4. Leverage relationships
5. Export with metadata
6. Use partitions for large datasets
7. Cache effectively with React Query

