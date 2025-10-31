# Implementation Guide

## Overview

Practical guide for implementing the Palestine Data Bank enhancements.

---

## Quick Start

### 1. Set Up Development Environment

```bash
# Clone repository
git clone https://github.com/your-org/palestine-pulse.git
cd palestine-pulse

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### 2. Understand Current System

```bash
# Review current data structure
ls -R public/data/

# Check existing scripts
ls scripts/

# Review services
ls src/services/

# Read documentation
cat docs/data-bank/01-CURRENT-SYSTEM.md
```

### 3. Run Existing Fetchers

```bash
# Fetch all data
npm run update-data

# Or fetch individually
npm run fetch-worldbank
npm run fetch-goodshepherd
npm run fetch-hdx-data

# Validate data
npm run validate-data
```

---

## Phase 1: Enrichment (Weeks 1-4)

### Week 1: World Bank Enrichment

**Task 1.1: Add New Indicators**

```javascript
// scripts/fetch-worldbank-data.js

// Add to INDICATORS object
const NEW_INDICATORS = {
  // Conflict-related
  'VC.IHR.PSRC.P5': 'Intentional homicides (per 100,000)',
  'MS.MIL.XPND.GD.ZS': 'Military expenditure (% of GDP)',
  
  // Food security
  'SN.ITK.DEFC.ZS': 'Prevalence of undernourishment (%)',
  'AG.PRD.FOOD.XD': 'Food production index',
  
  // Infrastructure resilience
  'EG.ELC.RNEW.ZS': 'Renewable electricity output (%)',
  'IS.VEH.NVEH.P3': 'Vehicles per 1,000 people',
  
  // Social vulnerability
  'SH.STA.DIAB.ZS': 'Diabetes prevalence (%)',
  'SH.STA.STNT.ZS': 'Prevalence of stunting (%)',
};

// Merge with existing INDICATORS
Object.assign(INDICATORS, NEW_INDICATORS);
```

**Task 1.2: Implement Trend Analysis**

```javascript
// src/utils/worldBankAnalysis.ts

export function calculateTrends(indicatorData: IndicatorData) {
  const data = indicatorData.data.sort((a, b) => a.year - b.year);
  
  return {
    ...indicatorData,
    analysis: {
      // Linear trend
      trend: calculateLinearTrend(data.map(d => d.value)),
      
      // Growth rate
      growth_rate: calculateAverageGrowth(data),
      
      // Volatility
      volatility: calculateStdDev(data.map(d => d.value)),
      
      // Recent change (1 year)
      recent_change: data.length >= 2 
        ? ((data[data.length - 1].value - data[data.length - 2].value) / 
           data[data.length - 2].value) * 100
        : null,
      
      // Baseline comparison
      baseline_comparison: compareToBaseline(data, '2023-10-07'),
    },
  };
}

function calculateLinearTrend(values: number[]): { slope: number; direction: string } {
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const direction = slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable';
  
  return { slope, direction };
}
```

**Task 1.3: Add Comparative Context**

```javascript
// scripts/fetch-worldbank-data.js

const COMPARISON_COUNTRIES = ['JOR', 'LBN', 'EGY', 'SYR'];

async function fetchComparativeData(indicator: string) {
  const comparisons = await Promise.all(
    COMPARISON_COUNTRIES.map(country =>
      fetchIndicator(indicator, country)
    )
  );
  
  return {
    palestine: await fetchIndicator(indicator, 'PSE'),
    regional: comparisons,
    regional_average: calculateAverage(comparisons),
    palestine_rank: calculateRank('PSE', comparisons),
  };
}
```

### Week 2: HDX Enrichment

**Task 2.1: Add Health Category**

```javascript
// scripts/fetch-hdx-ckan-data.js

// Add to PRIORITY_HDX_DATASETS
const PRIORITY_HDX_DATASETS = {
  // ... existing categories
  
  health: [
    { id: 'health-facilities-status-palestine', name: 'Health Facilities Status', priority: 1 },
    { id: 'medical-supplies-availability', name: 'Medical Supplies', priority: 2 },
    { id: 'healthcare-worker-casualties', name: 'Healthcare Workers', priority: 3 },
    { id: 'ambulance-attacks-palestine', name: 'Ambulance Attacks', priority: 4 },
    { id: 'hospital-bed-capacity', name: 'Hospital Capacity', priority: 5 },
    { id: 'disease-surveillance-palestine', name: 'Disease Surveillance', priority: 6 },
    { id: 'vaccination-coverage-palestine', name: 'Vaccination Coverage', priority: 7 },
    { id: 'maternal-health-services', name: 'Maternal Health', priority: 8 },
    { id: 'mental-health-services-palestine', name: 'Mental Health', priority: 9 },
    { id: 'pharmaceutical-access', name: 'Pharmaceutical Access', priority: 10 },
  ],
};

// Add transformation function
function transformHealthData(rawData, metadata) {
  let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
  
  return {
    format: 'json',
    data: records.map(record => ({
      facility_id: record.id || record.facility_id,
      name: record.name || record.facility_name,
      type: record.type || record.facility_type || 'health',
      location: {
        name: record.location || record.governorate,
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      status: record.status || record.operational_status,
      services: record.services || [],
      capacity: {
        beds: parseInt(record.beds || record.bed_capacity || 0),
        staff: parseInt(record.staff || record.healthcare_workers || 0),
        patients_per_day: parseInt(record.patients_per_day || 0),
      },
      supplies: {
        medical: record.medical_supplies_status || 'unknown',
        pharmaceutical: record.pharmaceutical_status || 'unknown',
        equipment: record.equipment_status || 'unknown',
      },
      damage: {
        level: record.damage_level || null,
        date: normalizeDate(record.damage_date),
        description: record.damage_description || '',
      },
      last_assessed: normalizeDate(record.assessment_date || record.last_updated),
      source: metadata.organization.title,
    })),
    recordCount: records.length,
  };
}
```

**Task 2.2: Implement Geospatial Enrichment**

```javascript
// src/utils/geospatialEnrichment.ts

export function enrichWithGeospatial(data: any[]) {
  return data.map(record => ({
    ...record,
    location: {
      ...record.location,
      
      // Administrative boundaries
      admin_level_1: getGovernorate(record.location),
      admin_level_2: getDistrict(record.location),
      admin_level_3: getLocality(record.location),
      
      // Region classification
      region: classifyRegion(record.location), // gaza/west_bank/east_jerusalem
      region_type: classifyRegionType(record.location), // urban/rural/camp
      
      // Area classification (West Bank only)
      area_classification: record.location.region === 'west_bank' 
        ? classifyWestBankArea(record.location) // A/B/C
        : null,
      
      // Proximity analysis
      nearest_city: findNearestCity(record.location),
      distance_to_border: calculateDistanceToBorder(record.location),
      distance_to_checkpoint: findNearestCheckpoint(record.location),
      
      // Conflict zone classification
      conflict_zone: classifyConflictZone(record.location),
      access_level: assessAccessLevel(record.location),
    },
  }));
}

function classifyRegion(location: Location): string {
  // Implement based on coordinates or location name
  if (location.name.toLowerCase().includes('gaza')) return 'gaza';
  if (location.name.toLowerCase().includes('jerusalem')) return 'east_jerusalem';
  return 'west_bank';
}
```

### Week 3: Good Shepherd Fixes

**Task 3.1: Fix Healthcare Attacks (Streaming)**

```javascript
// scripts/fetch-goodshepherd-data.js

async function fetchHealthcareAttacksStreaming() {
  const CHUNK_SIZE = 10000;
  const outputDir = 'public/data/goodshepherd/healthcare_attacks';
  
  await ensureDir(outputDir);
  
  let offset = 0;
  let chunkIndex = 0;
  let totalRecords = 0;
  
  while (true) {
    try {
      // Fetch chunk
      const url = `${GOODSHEPHERD_BASE}/healthcare_attacks.json?limit=${CHUNK_SIZE}&offset=${offset}`;
      const chunk = await fetchWithRetry(url);
      
      if (!chunk || chunk.length === 0) break;
      
      // Process chunk
      const processed = chunk.map(record => transformHealthcareAttack(record));
      
      // Save chunk
      await writeJSON(
        path.join(outputDir, `chunk_${chunkIndex}.json`),
        {
          chunk_index: chunkIndex,
          offset,
          count: processed.length,
          data: processed,
        }
      );
      
      totalRecords += processed.length;
      offset += CHUNK_SIZE;
      chunkIndex++;
      
      logger.info(`Processed chunk ${chunkIndex}: ${processed.length} records`);
      
    } catch (error) {
      logger.error(`Error fetching chunk at offset ${offset}`, error);
      break;
    }
  }
  
  // Create index
  await writeJSON(
    path.join(outputDir, 'index.json'),
    {
      total_records: totalRecords,
      total_chunks: chunkIndex,
      chunk_size: CHUNK_SIZE,
      last_updated: new Date().toISOString(),
    }
  );
  
  logger.success(`Healthcare attacks: ${totalRecords} records in ${chunkIndex} chunks`);
}
```

### Week 4: Cross-Dataset Linking

**Task 4.1: Link Related Data**

```javascript
// src/utils/dataLinking.ts

export function linkRelatedDatasets(
  primaryData: any[],
  relatedDatasets: Record<string, any[]>
) {
  return primaryData.map(record => {
    const related: any = {};
    
    // Link by location and date
    if (relatedDatasets.infrastructure) {
      related.infrastructure_damage = findNearbyInfrastructure(
        record,
        relatedDatasets.infrastructure,
        1000 // 1km radius
      );
    }
    
    if (relatedDatasets.displacement) {
      related.displacement_impact = findRelatedDisplacement(
        record,
        relatedDatasets.displacement,
        7 // 7 days window
      );
    }
    
    if (relatedDatasets.humanitarian) {
      related.humanitarian_needs = findRelatedNeeds(
        record,
        relatedDatasets.humanitarian
      );
    }
    
    return {
      ...record,
      related_data: related,
    };
  });
}

function findNearbyInfrastructure(
  record: any,
  infrastructure: any[],
  radiusMeters: number
) {
  return infrastructure.filter(infra => {
    const distance = calculateDistance(
      record.location.coordinates,
      infra.location.coordinates
    );
    return distance <= radiusMeters;
  });
}
```

---

## Phase 2: Source Activation (Weeks 5-12)

### WHO Activation (Weeks 5-7)

```javascript
// scripts/fetch-who-data.js

const WHO_API_BASE = 'https://ghoapi.azureedge.net/api';

const WHO_INDICATORS = {
  'WHOSIS_000001': 'Life expectancy at birth',
  'WHOSIS_000015': 'Maternal mortality ratio',
  'MDG_0000000001': 'Infant mortality rate',
  'WHS4_100': 'Hospital beds per 10,000',
  'HWF_0001': 'Physicians per 10,000',
  // Add more indicators
};

async function fetchWHOIndicator(indicatorCode: string) {
  const url = `${WHO_API_BASE}/${indicatorCode}?$filter=SpatialDim eq 'PSE'`;
  const data = await fetchWithRetry(url);
  
  return {
    indicator: indicatorCode,
    data: data.value.map((item: any) => ({
      year: parseInt(item.TimeDim),
      value: parseFloat(item.NumericValue),
      source: 'WHO',
    })),
  };
}
```

### UNRWA Activation (Weeks 8-10)

```javascript
// scripts/fetch-unrwa-data.js

// Option 1: HDX datasets
const UNRWA_HDX_DATASETS = [
  'unrwa-registered-refugees',
  'unrwa-education-facilities',
  'unrwa-health-centers',
  'unrwa-emergency-response',
];

// Option 2: Web scraping
async function scrapeUNRWAData() {
  const pages = [
    'https://www.unrwa.org/palestine-refugees',
    'https://www.unrwa.org/resources/reports',
  ];
  
  // Implement scraping logic
}
```

### PCBS Activation (Weeks 11-12)

```javascript
// scripts/fetch-pcbs-data.js

// Manual data entry from reports
const PCBS_DATA_SOURCES = {
  reports: [
    'http://www.pcbs.gov.ps/Downloads/book2474.pdf',
    'http://www.pcbs.gov.ps/Downloads/book2475.pdf',
  ],
  database: 'http://www.pcbs.gov.ps/Portals/_Rainbow/Documents/',
};

// Create manual entry template
const PCBS_TEMPLATE = {
  year: 2023,
  indicators: {
    population: {
      total: 5400000,
      gaza: 2300000,
      west_bank: 3100000,
    },
    // Add more indicators
  },
};
```

---

## Phase 3: Automation (Weeks 13-16)

### GitHub Actions Setup

```yaml
# .github/workflows/update-data.yml
name: Update Data

on:
  schedule:
    # Real-time sources (every 6 hours)
    - cron: '0 */6 * * *'
  workflow_dispatch:

jobs:
  update-realtime:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm ci
      
      - name: Fetch Tech4Palestine
        run: npm run fetch-tech4palestine
      
      - name: Validate data
        run: npm run validate-data
      
      - name: Commit changes
        run: |
          git config user.name "Data Bot"
          git config user.email "bot@example.com"
          git add public/data/
          git commit -m "chore: update real-time data" || echo "No changes"
          git push

  update-daily:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 0 * * *'
    steps:
      # Similar to above for daily sources
      
  update-weekly:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 0 * * 0'
    steps:
      # Similar to above for weekly sources
```

---

## Testing

### Unit Tests

```typescript
// tests/utils/worldBankAnalysis.test.ts

describe('calculateTrends', () => {
  it('should calculate linear trend correctly', () => {
    const data = {
      indicator: 'NY.GDP.MKTP.CD',
      data: [
        { year: 2020, value: 100 },
        { year: 2021, value: 110 },
        { year: 2022, value: 120 },
      ],
    };
    
    const result = calculateTrends(data);
    
    expect(result.analysis.trend.direction).toBe('increasing');
    expect(result.analysis.growth_rate).toBeCloseTo(10, 1);
  });
});
```

### Integration Tests

```typescript
// tests/integration/dataFetch.test.ts

describe('Data Fetching', () => {
  it('should fetch and validate World Bank data', async () => {
    const data = await fetchWorldBankData();
    
    expect(data).toBeDefined();
    expect(data.indicators).toBeGreaterThan(70);
    expect(data.validation.qualityScore).toBeGreaterThan(0.8);
  });
});
```

---

## Deployment

### Production Checklist

- [ ] All data sources fetching successfully
- [ ] Validation passing (>90% quality score)
- [ ] No duplicate records
- [ ] Cross-dataset links working
- [ ] API endpoints tested
- [ ] Documentation updated
- [ ] Performance optimized
- [ ] Monitoring set up

### Monitoring

```javascript
// Setup monitoring
const monitoring = {
  dataQuality: {
    metric: 'validation_pass_rate',
    threshold: 0.9,
    alert: 'email',
  },
  fetchSuccess: {
    metric: 'fetch_success_rate',
    threshold: 0.95,
    alert: 'slack',
  },
  apiPerformance: {
    metric: 'response_time_p95',
    threshold: 500, // ms
    alert: 'pagerduty',
  },
};
```

---

## Resources

- [Current System](01-CURRENT-SYSTEM.md)
- [Enrichment Strategy](02-ENRICHMENT-STRATEGY.md)
- [Source Activation](03-SOURCE-ACTIVATION.md)
- [Future Improvements](04-FUTURE-IMPROVEMENTS.md)
- [Unified Data Bank Vision](05-UNIFIED-DATA-BANK.md)

---

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: [Contact email]
- **Slack**: [Slack channel]
