# Unified Data System Structure

This document describes the unified data directory structure for Palestine Pulse.

## Directory Structure

```
public/data/
├── unified/                    # Unified data store
│   ├── conflict/
│   │   ├── metadata.json      # Dataset metadata
│   │   ├── all-data.json      # Complete dataset
│   │   ├── recent.json        # Last 90 days
│   │   └── partitions/        # Quarterly partitions
│   │       └── index.json     # Partition index
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
│   ├── pcbs/
│   ├── wfp/
│   └── btselem/
└── relationships/              # Cross-dataset links
    ├── conflict-infrastructure.json
    ├── infrastructure-humanitarian.json
    ├── economic-social.json
    └── README.md
```

## Data Categories

### Unified Data Categories

1. **conflict**: Conflict incidents, violence, and security events
2. **economic**: Economic indicators and financial data
3. **infrastructure**: Infrastructure status, damage, and capacity
4. **humanitarian**: Humanitarian needs, assistance, and displacement
5. **education**: Education facilities, enrollment, and access
6. **health**: Health facilities, services, and health indicators
7. **water**: Water and sanitation infrastructure and access
8. **refugees**: Refugee statistics and services

### Data Sources

1. **tech4palestine**: Real-time conflict and casualty data
2. **worldbank**: Economic and development indicators
3. **hdx**: Humanitarian data exchange datasets
4. **goodshepherd**: Healthcare attacks and home demolitions
5. **who**: World Health Organization health indicators
6. **unrwa**: UN Relief and Works Agency refugee data
7. **pcbs**: Palestinian Central Bureau of Statistics
8. **wfp**: World Food Programme food security data
9. **btselem**: Israeli human rights organization data

## File Formats

### metadata.json

Contains dataset metadata including:
- Dataset identification and description
- Update frequency and last update timestamp
- Record count and date range
- Quality metrics
- Field definitions
- Relationship information
- Source attribution

### all-data.json

Contains the complete dataset with:
- `data`: Array of all data points
- `metadata`: Generation metadata

### recent.json

Contains recent data (last 90 days) for quick access with the same structure as all-data.json.

### partitions/

Contains quarterly partitions (YYYY-Q1, YYYY-Q2, etc.) for large datasets:
- Individual partition files (e.g., 2024-Q1.json)
- index.json with partition metadata

### Relationship Files

Contains cross-dataset links with:
- `relationship_type`: Type of relationship
- `description`: Relationship description
- `links`: Array of relationship links
- `metadata`: Relationship metadata

## Usage

### Accessing Unified Data

Use the unified data service:

```typescript
import { getConflictData, getEconomicData } from '@/services/unifiedDataService';

// Get conflict data
const conflictData = await getConflictData({
  startDate: '2024-01-01',
  endDate: '2024-12-31',
  region: 'gaza'
});

// Get economic data
const economicData = await getEconomicData({
  indicators: ['GDP', 'unemployment'],
  qualityThreshold: 0.8
});
```

### Using React Query Hooks

```typescript
import { useConflictData, useEconomicData } from '@/hooks/useUnifiedData';

function MyComponent() {
  const { data: conflicts, isLoading } = useConflictData({
    startDate: '2024-01-01',
    region: 'gaza'
  });
  
  return <div>{/* Use data */}</div>;
}
```

## Data Pipeline

1. **Fetch**: Scripts fetch raw data from external sources
2. **Transform**: Data is transformed to unified format
3. **Enrich**: Additional fields and relationships are added
4. **Validate**: Data quality is checked
5. **Partition**: Large datasets are split into chunks
6. **Store**: Data is saved to appropriate directories
7. **Access**: Services and hooks provide typed access

## Maintenance

- Raw data is preserved in `sources/` for reference
- Unified data is regenerated when sources are updated
- Relationships are recalculated during data updates
- Quality metrics are tracked over time

## Related Documentation

- [Requirements Document](.kiro/specs/unified-data-system/requirements.md)
- [Design Document](.kiro/specs/unified-data-system/design.md)
- [Implementation Tasks](.kiro/specs/unified-data-system/tasks.md)
