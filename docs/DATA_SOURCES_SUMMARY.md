# Data Sources Summary

**Last Updated**: October 30, 2025

## Overview

Palestine Pulse integrates data from **9 active sources**, providing comprehensive coverage of humanitarian, economic, social, and conflict-related indicators for Palestine.

## Active Data Sources

### 1. Tech for Palestine
- **Status**: ✅ Active & Automated
- **Update Frequency**: Daily
- **Data Type**: Casualties, conflict incidents
- **Location**: `public/data/tech4palestine/`
- **Records**: 10,000+ casualties, daily updates
- **Automation**: ✅ Fully automated

**Datasets**:
- Killed in Gaza (detailed records)
- Press casualties
- Daily casualties (Gaza)
- West Bank daily incidents
- Infrastructure damage
- Summary statistics

### 2. HDX (Humanitarian Data Exchange)
- **Status**: ✅ Active & Automated
- **Update Frequency**: Daily
- **Data Type**: Humanitarian indicators
- **Location**: `public/data/hdx/`
- **Records**: 40+ datasets
- **Automation**: ✅ Fully automated

**Categories**:
- Conflict (15 datasets)
- Infrastructure (10 datasets)
- Education (8 datasets)
- Water & Sanitation (7 datasets)
- Health (15 datasets)
- Shelter (12 datasets)

### 3. Good Shepherd Collective
- **Status**: ✅ Active & Automated
- **Update Frequency**: Weekly
- **Data Type**: Violence, detentions, demolitions
- **Location**: `public/data/goodshepherd/`
- **Records**: 1,000+ incidents
- **Automation**: ✅ Fully automated

**Datasets**:
- Child prisoners
- Political prisoners
- West Bank incidents
- NGO reports
- Home demolitions

### 4. World Bank
- **Status**: ✅ Active & Automated
- **Update Frequency**: Annual/Quarterly
- **Data Type**: Economic indicators
- **Location**: `public/data/worldbank/`
- **Records**: 120+ indicators, 1,500+ data points
- **Automation**: ✅ Fully automated

**Categories**:
- Economic (GDP, trade, inflation)
- Population & Demographics
- Labor & Employment
- Poverty & Inequality
- Education
- Health
- Infrastructure
- Environment
- Financial

### 5. WHO (World Health Organization)
- **Status**: ✅ Active & Automated
- **Update Frequency**: Monthly
- **Data Type**: Health indicators
- **Location**: `public/data/who/`
- **Records**: Multiple health datasets
- **Automation**: ✅ Fully automated
- **Source**: Via HDX (WHO GHO API deprecated)

**Data**:
- Health system indicators
- Mortality rates
- Healthcare infrastructure
- Disease surveillance
- Vaccination coverage

### 6. PCBS (Palestinian Central Bureau of Statistics)
- **Status**: ✅ Active & Automated ⭐ NEW
- **Update Frequency**: Annual
- **Data Type**: Official statistics
- **Location**: `public/data/pcbs/`
- **Records**: 67 indicators, 845 data points
- **Automation**: ✅ Fully automated
- **Coverage**: 98.5%

**Categories**:
- **Population** (14 indicators, 355 records)
  - Total population and growth
  - Age distribution
  - Urban/rural population
  - Life expectancy
  - Birth and death rates
  - Fertility rates
  - Dependency ratios

- **Labor** (13 indicators, 92 records)
  - Unemployment rates
  - Labor force participation
  - Employment ratios
  - Vulnerable employment

- **Economic** (11 indicators, 180 records)
  - GDP and growth
  - Sector composition
  - Inflation
  - Trade statistics

- **Education** (11 indicators, 130 records)
  - School enrollment
  - Completion rates
  - Literacy rates
  - Pupil-teacher ratios

- **Health** (10 indicators, 76 records)
  - Mortality rates
  - Healthcare workforce
  - Immunization coverage
  - Health expenditure

- **Poverty** (4 indicators, 12 records)
  - Gini index
  - Poverty rates
  - Income distribution

### 7. UNRWA (UN Relief and Works Agency)
- **Status**: ✅ Active & Automated
- **Update Frequency**: As available
- **Data Type**: Refugee statistics
- **Location**: `public/data/unrwa/`
- **Records**: Refugee and service data
- **Automation**: ✅ Fully automated

**Data**:
- Refugee population statistics
- Service delivery data
- Camp information
- Assistance programs

### 8. WFP (World Food Programme)
- **Status**: ✅ Active
- **Update Frequency**: Monthly
- **Data Type**: Food security
- **Location**: `public/data/wfp/`
- **Records**: Food prices, market data
- **Automation**: ✅ Automated

**Data**:
- Food prices
- Market monitoring
- Food security assessments

### 9. B'Tselem
- **Status**: ✅ Active
- **Update Frequency**: Weekly
- **Data Type**: Checkpoints, restrictions
- **Location**: `public/data/btselem/`
- **Records**: Checkpoint locations and status
- **Automation**: ✅ Automated

**Data**:
- Checkpoint locations
- Checkpoint status
- Access restrictions

## Data Coverage Summary

| Category | Sources | Indicators | Records | Status |
|----------|---------|------------|---------|--------|
| Conflict & Casualties | 3 | 20+ | 10,000+ | ✅ Excellent |
| Humanitarian | 3 | 40+ | 5,000+ | ✅ Excellent |
| Economic | 2 | 130+ | 1,680+ | ✅ Excellent |
| Population | 1 | 14 | 355 | ✅ Excellent |
| Labor | 1 | 13 | 92 | ✅ Excellent |
| Education | 3 | 19+ | 200+ | ✅ Good |
| Health | 3 | 25+ | 200+ | ✅ Good |
| Infrastructure | 2 | 20+ | 1,000+ | ✅ Good |
| Poverty | 2 | 8+ | 30+ | ✅ Good |
| Refugees | 1 | 10+ | 100+ | ✅ Good |

**Total**: 9 sources, 300+ indicators, 18,000+ data points

## Automation Status

### Fully Automated ✅
All 9 data sources are fully automated with:
- Daily scheduled updates (GitHub Actions)
- Automatic data fetching
- Automatic transformation to unified format
- Automatic validation
- Automatic deployment

### Update Schedule
- **Daily**: Tech4Palestine, HDX, Good Shepherd
- **Weekly**: B'Tselem
- **Monthly**: WHO, WFP
- **Quarterly**: World Bank (checks for updates)
- **Annual**: PCBS (checks for updates)
- **As Available**: UNRWA

### Automation Pipeline
```
GitHub Actions (Daily at midnight UTC)
    ↓
Fetch from all 9 sources
    ↓
Transform to unified format
    ↓
Validate data quality
    ↓
Generate manifests
    ↓
Commit changes
    ↓
Auto-deploy
```

## Data Quality

### Quality Metrics
- **Completeness**: 95%+ across all sources
- **Accuracy**: High (official sources)
- **Timeliness**: Daily to annual updates
- **Reliability**: 0.90-0.95 reliability scores

### Validation
- Automated validation on every update
- Quality scoring for each dataset
- Completeness checks
- Consistency verification
- Format validation

## Usage

### Fetch All Data
```bash
npm run update-data
```

### Fetch Individual Sources
```bash
npm run fetch-pcbs           # PCBS official statistics
npm run fetch-worldbank      # World Bank indicators
npm run fetch-who            # WHO health data
npm run fetch-unrwa          # UNRWA refugee data
npm run fetch-hdx-data       # HDX humanitarian data
npm run fetch-goodshepherd   # Good Shepherd data
```

### Access Data in App
```typescript
// PCBS data
import { usePCBSData } from '@/hooks/usePCBSData';
const { data } = usePCBSData('population');

// World Bank data
import { useEconomicSnapshot } from '@/hooks/useWorldBankData';
const { data } = useEconomicSnapshot();

// Unified data
import { useUnifiedData } from '@/hooks/useUnifiedData';
const { data } = useUnifiedData('economic');
```

## Data Locations

### Raw Data
```
public/data/
├── tech4palestine/      # Casualties & conflict
├── hdx/                 # Humanitarian data
├── goodshepherd/        # Violence & detentions
├── worldbank/           # Economic indicators
├── who/                 # Health indicators
├── pcbs/                # Official statistics ⭐
├── unrwa/               # Refugee data
├── wfp/                 # Food security
├── btselem/             # Checkpoints
└── manifest.json        # Global index
```

### Transformed Data
```
public/data/unified/
├── economic/            # Economic indicators
├── conflict/            # Conflict data
├── infrastructure/      # Infrastructure
├── education/           # Education
├── health/              # Health
├── water/               # Water & sanitation
├── humanitarian/        # Humanitarian aid
└── pcbs/                # PCBS transformed ⭐
    ├── population.json
    ├── economic.json
    ├── labor.json
    ├── education.json
    ├── health.json
    └── poverty.json
```

## Documentation

- **[Data Guide](guides/DATA_GUIDE.md)** - Detailed data guide
- **[Source Activation](data-bank/03-SOURCE-ACTIVATION.md)** - Activation status
- **[PCBS README](../public/data/pcbs/README.md)** - PCBS usage guide
- **[PCBS Verification Report](../public/data/pcbs/DATA_VERIFICATION_REPORT.md)** - Quality report
- **[Automation Guide](../AUTOMATION_READY.md)** - Automation details

## Recent Updates

### October 2025
- ✅ Activated PCBS data source (67 indicators, 845 records)
- ✅ Activated WHO data source (via HDX)
- ✅ Activated UNRWA data source
- ✅ Integrated all sources into automation pipeline
- ✅ Created GitHub Actions workflow for daily updates
- ✅ Achieved 100% automation coverage

### Future Enhancements
- Additional PCBS indicators via manual entry
- More granular geographic data
- Historical data backfill (pre-2010)
- Real-time data streaming for select sources
- Enhanced data quality monitoring

---

**Status**: All 9 data sources active and fully automated ✅

**Last Verified**: October 30, 2025
