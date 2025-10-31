# Source Activation Plan

## Overview

Plan to activate currently inactive data sources (WHO, UNRWA, PCBS) and expand existing ones.

---

## WHO (World Health Organization)

### Current Status
✅ **ACTIVE** - Integrated via HDX

### Implementation Summary

**Completed**: October 2025

#### Data Source
**HDX Integration** ✅
- WHO publishes health data on HDX
- CORS issues solved by using HDX API
- Server-side fetching implemented
- Data categorized and transformed

#### Data Available
```javascript
const WHO_ACTIVE_DATA = {
  health_indicators: 'Available via HDX',
  mortality_rates: 'Maternal, infant, under-5',
  healthcare_infrastructure: 'Facilities, workforce',
  disease_surveillance: 'Various health metrics',
  vaccination_coverage: 'Immunization data'
};
```

#### Automation Status
✅ **Fully Automated**
- Integrated into `fetch-all-data.js`
- Fetches from HDX where WHO publishes data
- Daily automated updates
- Categorized by health indicators

#### Files Created
- `scripts/fetch-who-data.js` - Fetcher script
- `public/data/who/` - WHO health data

#### Usage
```bash
# Fetch WHO data
npm run fetch-who

# Complete pipeline
npm run update-data
```

#### Note
WHO GHO API (ghoapi.azureedge.net) has been deprecated. Data is now sourced from HDX where WHO publishes their datasets.

---

## UNRWA

### Current Status
✅ **ACTIVE** - Integrated and automated

### Implementation Summary

**Completed**: October 2025

#### Data Source
**HDX Integration** ✅
- UNRWA publishes refugee data on HDX
- Server-side fetching implemented
- Data categorized and transformed

#### Data Available
```javascript
const UNRWA_ACTIVE_DATA = {
  refugee_statistics: 'Population and demographics',
  service_delivery: 'Education, health, relief services',
  camp_information: 'Camp locations and populations',
  assistance_data: 'Aid distribution and services'
};
```

#### Automation Status
✅ **Fully Automated**
- Integrated into `fetch-all-data.js`
- Fetches from HDX and other sources
- Daily automated updates
- Transformer created for refugee data

#### Files Created
- `scripts/fetch-unrwa-data.js` - Fetcher script
- `scripts/utils/unrwa-transformer.js` - Transformer
- `public/data/unrwa/` - UNRWA refugee data

#### Usage
```bash
# Fetch UNRWA data
npm run fetch-unrwa

# Complete pipeline
npm run update-data
```
- Use existing UNRWA data on HDX

#### 2. Data to Collect
```javascript
const UNRWA_DATA = {
  refugees: {
    total_registered: 'number',
    by_field: 'Gaza, West Bank, Jordan, Lebanon, Syria',
    by_camp: 'camp-level statistics',
    demographics: 'age, gender distribution',
  },
  education: {
    schools: 'number and locations',
    students: 'enrollment numbers',
    teachers: 'staff numbers',
    facilities_damaged: 'conflict impact',
  },
  health: {
    health_centers: 'number and locations',
    patients: 'patient numbers',
    services: 'types of services',
    medical_supplies: 'availability',
  },
  emergency_response: {
    food_assistance: 'beneficiaries',
    cash_assistance: 'beneficiaries',
    shelter: 'temporary shelter provided',
  },
};
```

#### 3. Implementation Plan
1. Investigate data availability
2. Choose best approach (scraping/API/HDX)
3. Create fetch script
4. Implement transformations
5. Add to dashboard

**Timeline**: 3-4 weeks

---

## PCBS (Palestinian Central Bureau of Statistics)

### Current Status
✅ **ACTIVE** - Fully integrated and automated!

### Implementation Summary

**Completed**: October 2025

#### Data Source
**World Bank API Integration** ✅
- PCBS indicators republished by World Bank
- 67 indicators successfully fetched
- 845 data points (2010-2024)
- 98.5% data coverage

#### Data Categories Activated
```javascript
const PCBS_ACTIVE_DATA = {
  population: {
    indicators: 14,
    records: 355,
    coverage: '100%',
    metrics: [
      'Total population and growth',
      'Age distribution (0-14, 15-64, 65+)',
      'Urban/rural population',
      'Life expectancy (total, male, female)',
      'Birth and death rates',
      'Fertility rates',
      'Dependency ratios'
    ]
  },
  labor: {
    indicators: 13,
    records: 92,
    coverage: '100%',
    metrics: [
      'Unemployment rates (total, male, female, youth)',
      'Labor force participation rates',
      'Employment to population ratios',
      'Vulnerable employment'
    ]
  },
  economic: {
    indicators: 11,
    records: 180,
    coverage: '100%',
    metrics: [
      'GDP and GDP per capita',
      'GDP growth rates',
      'Economic sector composition',
      'Inflation rates',
      'Trade statistics'
    ]
  },
  education: {
    indicators: 11,
    records: 130,
    coverage: '100%',
    metrics: [
      'School enrollment (all levels)',
      'Gender-disaggregated enrollment',
      'Primary completion rates',
      'Adult literacy rates',
      'Pupil-teacher ratios'
    ]
  },
  health: {
    indicators: 10,
    records: 76,
    coverage: '90.9%',
    metrics: [
      'Mortality rates (under-5, neonatal, maternal)',
      'Healthcare workforce',
      'Immunization coverage',
      'Health expenditure'
    ]
  },
  poverty: {
    indicators: 4,
    records: 12,
    coverage: '100%',
    metrics: [
      'Gini index',
      'Poverty headcount ratio',
      'Income distribution'
    ]
  }
};
```

#### Automation Status
✅ **Fully Automated**
- Integrated into `fetch-all-data.js`
- Integrated into `populate-unified-data.js`
- GitHub Actions workflow configured
- Daily automated updates
- Automatic transformation to unified format
- Trend analysis applied to all records

#### Files Created
- `scripts/fetch-pcbs-data.js` - Fetcher script
- `scripts/utils/pcbs-transformer.js` - Transformer
- `scripts/test-pcbs-comprehensive.js` - Test suite
- `scripts/verify-pcbs-data.js` - Verification
- `public/data/pcbs/` - Raw data (70 files)
- `public/data/unified/pcbs/` - Transformed data (7 files)

#### Usage
```bash
# Fetch PCBS data
npm run fetch-pcbs

# Transform to unified format
npm run populate-unified

# Complete pipeline
npm run update-data
```

```typescript
// Access PCBS data in app
import { usePCBSData } from '@/hooks/usePCBSData';

const { data } = usePCBSData('population');
```

#### Documentation
- `public/data/pcbs/README.md` - Usage guide
- `public/data/pcbs/DATA_VERIFICATION_REPORT.md` - Verification report
- `AUTOMATION_READY.md` - Automation guide
- `INTEGRATION_COMPLETE.md` - Integration details

---

## Expanding Existing Sources

### Tech for Palestine
**Current**: 6 endpoints  
**Expansion Opportunities**:
- Historical data archives
- Additional metrics
- Real-time updates API
- Demographic breakdowns

### Good Shepherd
**Current**: 4/6 endpoints  
**Expansion**:
- Fix healthcare attacks (streaming)
- Fix home demolitions (alternative source)
- Add new endpoints if available
- Historical data backfill

### HDX/OCHA
**Current**: 30-40 datasets  
**Expansion**:
- Add 50+ more datasets
- New categories (health, shelter)
- Better coverage per category
- More frequent updates

### World Bank
**Current**: 70 indicators  
**Expansion**:
- Add 50+ more indicators
- Sub-national data if available
- More frequent updates
- Historical data (pre-2010)

---

## Implementation Priority

### Phase 1 (Immediate - 1 month) ✅ COMPLETED
1. ✅ Fix Good Shepherd inactive endpoints
2. ✅ Expand World Bank indicators (+50)
3. ✅ Activate WHO data source (via HDX)
4. ✅ Activate PCBS data source (67 indicators, 845 records)
5. ✅ Activate UNRWA data source
6. ✅ Integrate all sources into automation pipeline
7. ✅ Create GitHub Actions workflow for daily updates
3. ✅ Add HDX health category (10 datasets)
4. ✅ Add HDX shelter category (8 datasets)

### Phase 2 (Short-term - 2-3 months)
1. ⏳ Activate WHO data source
2. ⏳ Expand HDX coverage (+30 datasets)
3. ⏳ Implement advanced transformations
4. ⏳ Add cross-dataset linking

### Phase 3 (Medium-term - 3-6 months)
1. ⏳ Activate UNRWA data source
2. ⏳ Activate PCBS data source
3. ⏳ Implement unified data bank
4. ⏳ Add automation and scheduling

---

## Success Metrics

### Coverage
- [ ] 10+ active data sources
- [ ] 100+ datasets
- [ ] 200+ indicators
- [ ] 6+ data categories

### Quality
- [ ] 90%+ data validation pass rate
- [ ] < 5% missing data
- [ ] < 1% duplicate records
- [ ] Weekly updates for all sources

### Usability
- [ ] Standardized data formats
- [ ] Comprehensive metadata
- [ ] Cross-dataset relationships
- [ ] Easy-to-use APIs

---

## Next Steps

1. Review and prioritize sources
2. Assign implementation tasks
3. Set up development environment
4. Begin Phase 1 implementation
5. Track progress and adjust

See:
- [Enrichment Strategy](02-ENRICHMENT-STRATEGY.md)
- [Future Improvements](04-FUTURE-IMPROVEMENTS.md)
- [Unified Data Bank Vision](05-UNIFIED-DATA-BANK.md)
