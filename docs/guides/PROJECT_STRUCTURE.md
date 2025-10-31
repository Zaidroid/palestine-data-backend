# Project Structure Guide

## Overview

Palestine Pulse V3 follows a feature-based architecture with clear separation of concerns.

## Directory Structure

```
palestine-pulse/
├── src/
│   ├── components/           # React components
│   ├── pages/               # Page-level components
│   ├── services/            # Data services
│   ├── hooks/               # Custom React hooks
│   ├── utils/               # Utility functions
│   ├── store/               # State management
│   ├── types/               # TypeScript definitions
│   ├── lib/                 # Library utilities
│   ├── i18n/                # Internationalization
│   └── data/                # Static data & help content
├── public/
│   ├── data/                # Local data files (JSON)
│   └── assets/              # Static assets
├── scripts/                 # Data fetching scripts
└── docs/                    # Documentation
```

## Key Directories

### `/src/pages/v3`
Main dashboard pages:
- `GazaWarDashboard.tsx` - Gaza dashboard with 4 tabs
- `WestBankDashboard.tsx` - West Bank dashboard with 4 tabs

### `/src/components/v3`
Dashboard-specific components organized by region:

```
v3/
├── gaza/                    # Gaza-specific components
│   ├── HumanitarianCrisis.tsx
│   ├── InfrastructureDestruction.tsx
│   ├── PopulationImpact.tsx
│   └── AidAndSurvival.tsx
├── westbank/                # West Bank-specific components
│   ├── OccupationMetrics.tsx
│   ├── SettlerViolence.tsx
│   ├── EconomicStrangulation.tsx
│   └── PrisonersDetention.tsx
└── shared/                  # Shared V3 components
    ├── EnhancedDataSourceBadge.tsx
    ├── AnalyticsPanel.tsx
    └── PerformanceDashboard.tsx
```

### `/src/services`
Data services that load and transform data:

**Core Services:**
- `apiOrchestrator.ts` - Coordinates all data sources
- `dataConsolidationService.ts` - Aggregates data
- `dataTransformService.ts` - Data transformations

**Data Source Services:**
- `goodShepherdService.ts` - Good Shepherd Collective API
- `worldBankService.ts` - World Bank indicators
- `wfpService.ts` - World Food Programme
- `btselemService.ts` - B'Tselem checkpoints
- `healthFacilitiesService.ts` - Health facilities
- `populationService.ts` - Population data

**Utility Services:**
- `analyticsService.ts` - Analytics and insights
- `exportService.ts` - Export functionality
- `performanceMonitor.ts` - Performance tracking
- `rateLimitManager.ts` - API rate limiting

### `/src/hooks`
Custom React hooks for data fetching:

**Unified Data:**
- `useUnifiedData.ts` - Main data hook

**Specific Data Sources:**
- `useGoodShepherdData.ts` - Good Shepherd data
- `useWorldBankData.ts` - World Bank data
- `useWFPData.ts` - WFP data
- `usePopulation.ts` - Population data
- `useHealthFacilities.ts` - Health facilities
- `useSchools.ts` - Schools data

**Utility Hooks:**
- `useDataRefresh.ts` - Data refresh management
- `useFilteredData.ts` - Data filtering
- `useShareableState.ts` - Shareable state

### `/src/utils`
Transformation utilities for different data types:

**Gaza Transformations:**
- `gazaCasualtyTransformations.ts`
- `gazaHumanitarianTransformations.ts`
- `gazaInfrastructureTransformations.ts`

**West Bank Transformations:**
- `westBankDemolitionTransformations.ts`
- `westBankEconomicTransformations.ts`
- `westBankPrisonerTransformations.ts`
- `westBankSettlementTransformations.ts`
- `westBankViolenceTransformations.ts`

**General Utilities:**
- `dataTransformation.ts`
- `dataNormalization.ts`
- `dataAggregation.ts`
- `statistics.ts`

### `/src/store`
Zustand state management:
- `v3Store.ts` - V3 dashboard state
- `globalStore.ts` - Global application state

### `/public/data`
Local JSON data files fetched by scripts:
```
data/
├── tech4palestine/          # Tech4Palestine data
├── goodshepherd/           # Good Shepherd data
├── worldbank/              # World Bank data
├── wfp/                    # WFP data
└── manifest.json           # Data manifest
```

### `/scripts`
Node.js scripts for fetching data:
- `fetch-all-data.js` - Fetch from all sources
- `fetch-goodshepherd-data.js` - Good Shepherd
- `fetch-worldbank-data.js` - World Bank
- `fetch-hdx-data.js` - HDX/OCHA data
- `validate-data.js` - Validate downloaded data
- `generate-manifest.js` - Generate manifest

## Component Architecture

### Dashboard Pages
```typescript
// pages/v3/GazaWarDashboard.tsx
export default function GazaWarDashboard() {
  // 1. State management (Zustand)
  const { data, loading } = useV3Store();
  
  // 2. Data fetching (React Query)
  const casualties = useRecentData('casualties');
  
  // 3. Tab-based layout
  return (
    <Tabs>
      <TabsList>
        <TabsTrigger value="humanitarian">Humanitarian Crisis</TabsTrigger>
        {/* ... */}
      </TabsList>
      <TabsContent value="humanitarian">
        <HumanitarianCrisis data={casualties} />
      </TabsContent>
    </Tabs>
  );
}
```

### Feature Components
```typescript
// components/v3/gaza/HumanitarianCrisis.tsx
export function HumanitarianCrisis() {
  // 1. Get data from hooks
  const { data, isLoading } = useRecentData('casualties');
  
  // 2. Transform data
  const chartData = useMemo(() => 
    transformCasualties(data), [data]
  );
  
  // 3. Render with charts
  return (
    <div className="grid gap-4">
      <CasualtyChart data={chartData} />
      <DemographicBreakdown data={data} />
    </div>
  );
}
```

### Data Services
```typescript
// services/goodShepherdService.ts
export async function fetchPrisonerData() {
  // 1. Load from local JSON
  const response = await fetch('/data/goodshepherd/prisoner_data.json');
  const data = await response.json();
  
  // 2. Transform and normalize
  return transformPrisonerData(data);
}
```

### Custom Hooks
```typescript
// hooks/useGoodShepherdData.ts
export function usePrisonerData() {
  return useQuery({
    queryKey: ['prisoners'],
    queryFn: () => fetchPrisonerData(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}
```

## Data Flow

```
1. Scripts fetch data
   scripts/fetch-*.js
   ↓
2. Store in public/data/
   public/data/*.json
   ↓
3. Services load data
   services/*Service.ts
   ↓
4. Hooks provide data
   hooks/use*.ts
   ↓
5. Components display
   components/v3/*
```

## File Naming Conventions

- **Components**: PascalCase - `HumanitarianCrisis.tsx`
- **Hooks**: camelCase with 'use' prefix - `useGoodShepherdData.ts`
- **Services**: camelCase with 'Service' suffix - `goodShepherdService.ts`
- **Utils**: camelCase - `dataTransformation.ts`
- **Types**: PascalCase - `data.types.ts`

## Import Aliases

```typescript
// Use @ alias for src imports
import { Button } from '@/components/ui/button';
import { useV3Store } from '@/store/v3Store';
import { fetchPrisonerData } from '@/services/goodShepherdService';
```

## Best Practices

1. **Colocate related files** - Keep components, hooks, and utils together
2. **Use TypeScript** - Define types for all data structures
3. **Memoize expensive computations** - Use `useMemo` and `useCallback`
4. **Keep components small** - Break down large components
5. **Use custom hooks** - Extract data fetching logic
6. **Follow naming conventions** - Consistent naming across project

## Adding New Features

### Adding a New Chart
1. Create component in `src/components/v3/[region]/`
2. Import data from hooks
3. Add to dashboard page

### Adding a New Data Source
1. Create fetch script in `scripts/`
2. Create service in `src/services/`
3. Create hook in `src/hooks/`
4. Use in components

### Adding a New Dashboard Tab
1. Create tab component in `src/components/v3/[region]/`
2. Add to dashboard page's `<Tabs>`
3. Update navigation

## Next Steps

- Read [Data Guide](DATA_GUIDE.md) to understand data flow
- Read [Component Guide](COMPONENTS.md) for component patterns
- Read [Development Guide](DEVELOPMENT.md) for workflow
