# Data Guide

## Overview

Palestine Pulse uses a script-based data fetching approach where data is downloaded locally and served as static JSON files. This ensures fast loading, offline support, and no runtime API dependencies.

## Data Architecture

```
External APIs
    ↓
Fetch Scripts (Node.js)
    ↓
Local JSON Files (public/data/)
    ↓
Services (Load & Transform)
    ↓
Hooks (React Query + Cache)
    ↓
Components (Display)
```

## Data Sources

### 1. Tech for Palestine
**Status**: ✅ Active  
**Update Frequency**: Real-time  
**Location**: `public/data/tech4palestine/`

**Endpoints:**
- `killed-in-gaza.min.json` - Casualties data
- `press_killed_in_gaza.json` - Press casualties
- `summary.json` - Overall statistics
- `casualties_daily.json` - Daily casualties
- `west_bank_daily.json` - West Bank incidents
- `infrastructure-damaged.json` - Infrastructure damage

**Usage:**
```typescript
import { useRecentData } from '@/hooks/useUnifiedData';

const { data } = useRecentData('casualties');
```

### 2. Good Shepherd Collective
**Status**: ✅ Active  
**Update Frequency**: Weekly  
**Location**: `public/data/goodshepherd/`

**Endpoints:**
- `child_prisoners.json` - Child prisoner data
- `prisoner_data.json` - Political prisoners
- `wb_data.json` - West Bank incidents
- `ngo_data.json` - NGO reports
- `home_demolitions.json` - Demolition data

**Usage:**
```typescript
import { usePrisonerData } from '@/hooks/useGoodShepherdData';

const { data } = usePrisonerData();
```

### 3. World Bank
**Status**: ✅ Active  
**Update Frequency**: Quarterly  
**Location**: `public/data/worldbank/`

**Indicators:**
- GDP, Unemployment, Inflation
- Trade, Poverty, Education
- Health, Infrastructure

**Usage:**
```typescript
import { useEconomicSnapshot } from '@/hooks/useWorldBankData';

const { data } = useEconomicSnapshot();
```

### 4. World Food Programme (WFP)
**Status**: ✅ Active  
**Update Frequency**: Monthly  
**Location**: `public/data/wfp/`

**Data:**
- Food prices
- Market monitoring
- Food security assessments

**Usage:**
```typescript
import { useWFPLatestPrices } from '@/hooks/useWFPData';

const { data } = useWFPLatestPrices();
```

### 5. B'Tselem
**Status**: ✅ Active  
**Update Frequency**: Weekly  
**Location**: `public/data/btselem/`

**Data:**
- Checkpoint locations
- Checkpoint status
- Access restrictions

**Usage:**
```typescript
import { BtselemService } from '@/services/btselemService';

const checkpoints = await BtselemService.getCheckpoints();
```

### 6. WHO (World Health Organization)
**Status**: ✅ Active  
**Update Frequency**: Monthly  
**Location**: `public/data/who/`

**Data:**
- Health indicators
- Mortality rates
- Healthcare infrastructure
- Disease surveillance

**Usage:**
```typescript
import { useWHOData } from '@/hooks/useWHOData';

const { data } = useWHOData();
```

### 7. PCBS (Palestinian Central Bureau of Statistics)
**Status**: ✅ Active  
**Update Frequency**: Annual  
**Location**: `public/data/pcbs/`

**Indicators:**
- Population statistics (67 indicators)
- Labor market data
- Economic indicators
- Education statistics
- Health statistics
- Poverty & inequality metrics

**Categories:**
- Population (14 indicators, 355 records)
- Labor (13 indicators, 92 records)
- Economic (11 indicators, 180 records)
- Education (11 indicators, 130 records)
- Health (11 indicators, 76 records)
- Poverty (4 indicators, 12 records)

**Usage:**
```typescript
import { usePCBSData } from '@/hooks/usePCBSData';

const { data } = usePCBSData('population');
```

**Transformed Data:**
```typescript
// Access unified PCBS data
import pcbsData from '@/public/data/unified/pcbs/all-data-transformed.json';

// Or by category
import populationData from '@/public/data/unified/pcbs/population.json';
import economicData from '@/public/data/unified/pcbs/economic.json';
```

### 8. UNRWA (UN Relief and Works Agency)
**Status**: ✅ Active  
**Update Frequency**: As available  
**Location**: `public/data/unrwa/`

**Data:**
- Refugee statistics
- Service delivery data
- Camp information

**Usage:**
```typescript
import { useUNRWAData } from '@/hooks/useUNRWAData';

const { data } = useUNRWAData();
```

## Fetching Data

### Update All Sources
```bash
npm run update-data
```

This runs:
1. `fetch-all-data` - Downloads from all sources
2. `generate-manifest` - Creates manifest.json
3. `validate-data` - Validates downloaded data

### Update Individual Sources
```bash
npm run fetch-goodshepherd
npm run fetch-worldbank
npm run fetch-hdx-data
npm run fetch-who
npm run fetch-pcbs
npm run fetch-unrwa
```

### Manual Fetch
```bash
node scripts/fetch-goodshepherd-data.js
```

## Data Storage

### File Structure
```
public/data/
├── tech4palestine/
│   ├── killed-in-gaza.min.json
│   ├── summary.json
│   └── ...
├── goodshepherd/
│   ├── prisoner_data.json
│   ├── wb_data.json
│   └── ...
├── worldbank/
│   ├── indicators.json
│   └── ...
├── wfp/
│   ├── food_prices.json
│   └── ...
└── manifest.json
```

### Manifest File
The manifest tracks all data files:
```json
{
  "generated": "2025-10-29T10:00:00Z",
  "sources": {
    "tech4palestine": {
      "files": ["killed-in-gaza.min.json", "summary.json"],
      "lastUpdated": "2025-10-29T10:00:00Z"
    }
  }
}
```

## Data Transformations

### Transformation Pipeline
```typescript
// 1. Raw data from JSON
const rawData = await fetch('/data/goodshepherd/prisoner_data.json');

// 2. Parse JSON
const parsed = await rawData.json();

// 3. Transform (utils/*Transformations.ts)
const transformed = transformPrisonerData(parsed);

// 4. Normalize (services/*Service.ts)
const normalized = normalizePrisonerData(transformed);

// 5. Cache (React Query)
// Automatic via useQuery

// 6. Display (components)
<PrisonerChart data={normalized} />
```

### Transformation Functions

Located in `src/utils/*Transformations.ts`:

**Gaza Transformations:**
```typescript
// gazaCasualtyTransformations.ts
export function transformCasualties(data: RawCasualty[]): CasualtyData {
  return {
    total: data.length,
    byAge: groupByAge(data),
    byGender: groupByGender(data),
    timeline: createTimeline(data),
  };
}
```

**West Bank Transformations:**
```typescript
// westBankPrisonerTransformations.ts
export function transformPrisonerData(data: RawPrisoner[]): PrisonerData {
  return {
    total: data.length,
    children: data.filter(p => p.age < 18),
    administrative: data.filter(p => p.type === 'administrative'),
    byRegion: groupByRegion(data),
  };
}
```

## Caching Strategy

### React Query Configuration
```typescript
// Default cache times
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 30, // 30 minutes
    },
  },
});
```

### Per-Source Cache Times
```typescript
// Real-time data (casualties)
staleTime: 1000 * 60 * 5, // 5 minutes

// Frequently updated (food security)
staleTime: 1000 * 60 * 15, // 15 minutes

// Hourly updated (infrastructure)
staleTime: 1000 * 60 * 60, // 1 hour

// Daily updated (economic)
staleTime: 1000 * 60 * 60 * 24, // 24 hours
```

### IndexedDB Storage
```typescript
// Persistent offline storage
import { IndexedDBManager } from '@/lib/indexeddb';

// Store data
await IndexedDBManager.set('casualties', data);

// Retrieve data
const cached = await IndexedDBManager.get('casualties');
```

## Data Validation

### Validation Script
```bash
npm run validate-data
```

Checks:
- File existence
- JSON validity
- Required fields
- Data types
- Date formats

### Manual Validation
```typescript
import { validateCasualties } from '@/utils/validation';

const isValid = validateCasualties(data);
if (!isValid) {
  console.error('Invalid casualty data');
}
```

## Working with Data

### Loading Data in Components
```typescript
import { useRecentData } from '@/hooks/useUnifiedData';

export function MyComponent() {
  const { data, isLoading, error } = useRecentData('casualties');
  
  if (isLoading) return <Skeleton />;
  if (error) return <Error message={error.message} />;
  
  return <Chart data={data} />;
}
```

### Transforming Data
```typescript
import { useMemo } from 'react';
import { transformCasualties } from '@/utils/gazaCasualtyTransformations';

export function CasualtyChart() {
  const { data } = useRecentData('casualties');
  
  const chartData = useMemo(() => {
    if (!data) return [];
    return transformCasualties(data);
  }, [data]);
  
  return <AreaChart data={chartData} />;
}
```

### Filtering Data
```typescript
import { useFilteredData } from '@/hooks/useFilteredData';

export function FilteredChart() {
  const { data, setFilters } = useFilteredData('casualties', {
    dateRange: { start: '2024-01-01', end: '2024-12-31' },
    region: 'gaza',
  });
  
  return (
    <>
      <Filters onChange={setFilters} />
      <Chart data={data} />
    </>
  );
}
```

## Adding New Data Sources

### 1. Create Fetch Script
```javascript
// scripts/fetch-newsource-data.js
async function fetchNewSourceData() {
  const response = await fetch('https://api.newsource.org/data');
  const data = await response.json();
  
  // Save to public/data/newsource/
  fs.writeFileSync(
    'public/data/newsource/data.json',
    JSON.stringify(data, null, 2)
  );
}
```

### 2. Create Service
```typescript
// src/services/newSourceService.ts
export async function fetchNewSourceData() {
  const response = await fetch('/data/newsource/data.json');
  return response.json();
}
```

### 3. Create Hook
```typescript
// src/hooks/useNewSource.ts
export function useNewSourceData() {
  return useQuery({
    queryKey: ['newsource'],
    queryFn: () => fetchNewSourceData(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
```

### 4. Use in Components
```typescript
import { useNewSourceData } from '@/hooks/useNewSource';

export function MyComponent() {
  const { data } = useNewSourceData();
  return <Chart data={data} />;
}
```

## Troubleshooting

### Data Not Loading
1. Check if data files exist: `ls public/data/`
2. Re-fetch data: `npm run update-data`
3. Check browser console for errors
4. Verify JSON is valid

### Stale Data
1. Clear React Query cache: Refresh page
2. Clear IndexedDB: Browser DevTools > Application > IndexedDB
3. Re-fetch data: `npm run update-data`

### Fetch Script Errors
1. Check network connection
2. Verify API endpoints are accessible
3. Check API rate limits
4. Review script logs

## Best Practices

1. **Always validate data** before using
2. **Use TypeScript types** for all data structures
3. **Memoize transformations** to avoid re-computation
4. **Handle loading and error states** in components
5. **Update data regularly** (weekly recommended)
6. **Monitor data quality** with validation scripts
7. **Cache appropriately** based on update frequency

## Next Steps

- Read [Component Guide](COMPONENTS.md) for using data in components
- Read [Development Guide](DEVELOPMENT.md) for workflow
- Check [Troubleshooting](../troubleshooting/DATA_SOURCE_TROUBLESHOOTING.md) for common issues
