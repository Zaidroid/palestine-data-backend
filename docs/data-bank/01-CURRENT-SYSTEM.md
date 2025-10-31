# Current Data System Overview

## Architecture

Palestine Pulse currently uses a **script-based data fetching and local storage** approach:

```
External APIs
    ↓
Node.js Fetch Scripts
    ↓
Local JSON Storage (public/data/)
    ↓
Services (Load & Transform)
    ↓
React Query (Cache)
    ↓
Components (Display)
```

## Active Data Sources

### 1. Tech for Palestine ✅
**Status**: Fully Integrated  
**Update Frequency**: Real-time  
**Data Quality**: High

**Endpoints**:
- Casualties (killed-in-gaza.min.json)
- Press casualties
- Daily casualties
- West Bank incidents
- Infrastructure damage
- Summary statistics

**Strengths**:
- Real-time updates
- Comprehensive casualty data
- Well-structured JSON
- Reliable API

**Current Usage**: Core data for both dashboards

---

### 2. Good Shepherd Collective ✅
**Status**: Partially Integrated (4/6 endpoints)  
**Update Frequency**: Weekly  
**Data Quality**: High

**Active Endpoints**:
- ✅ Child prisoners (~17 years of data)
- ✅ Prisoner data (6.2KB)
- ✅ West Bank data (23.7KB)
- ✅ NGO data (346KB)

**Inactive Endpoints**:
- ❌ Healthcare attacks (too large, causes timeout)
- ❌ Home demolitions (404 error)

**Strengths**:
- Historical depth
- Detailed prisoner data
- West Bank violence tracking
- NGO reports

**Weaknesses**:
- Some endpoints unavailable
- Large file sizes
- Inconsistent data structure

**Current Usage**: West Bank dashboard, prisoner statistics

---

### 3. World Bank ✅
**Status**: Fully Integrated  
**Update Frequency**: Quarterly/Annual  
**Data Quality**: Very High

**Indicators Fetched**: 70+ economic and social indicators

**Categories**:
- **Economic** (9): GDP, GNI, exports, imports, inflation
- **Population** (9): Total, growth, urban, age distribution
- **Labor** (6): Unemployment, labor force participation
- **Poverty** (9): Gini, poverty headcount, income distribution
- **Education** (6): Enrollment, completion, literacy
- **Health** (7): Mortality, physicians, hospital beds
- **Infrastructure** (10): Internet, electricity, roads, telecom
- **Trade** (9): Merchandise trade, FDI, current account
- **Financial** (3): Bank capital, credit, money supply
- **Social** (2): Suicide rate, smoking prevalence

**Strengths**:
- Authoritative source
- Long historical data (2010-2024)
- Standardized indicators
- No API key required
- Automatic categorization
- Unit detection

**Weaknesses**:
- Annual/quarterly updates only
- Some indicators have gaps
- Limited real-time data

**Current Usage**: Economic indicators, West Bank dashboard

---

### 4. HDX/OCHA ⚠️
**Status**: Partially Integrated  
**Update Frequency**: Varies by dataset  
**Data Quality**: Mixed

**Priority Datasets** (30-40 across 6 categories):

**Conflict** (8 datasets):
- ACLED conflict data
- Violent events
- Gaza conflict incidents
- West Bank violence
- Settler violence
- Military operations
- Armed clashes
- Protest events

**Education** (5 datasets):
- Education facilities
- School damage (Gaza)
- Education access (West Bank)
- Student enrollment
- Infrastructure damage

**Water** (4 datasets):
- Water/sanitation access
- Infrastructure damage
- WASH facilities
- Water quality

**Infrastructure** (6 datasets):
- Damage assessment
- Building destruction
- Critical infrastructure
- Roads & bridges
- Electricity grid
- Telecommunications

**Refugees** (5 datasets):
- Refugee statistics
- Displacement tracking
- IDP data
- Refugee camps
- Displacement movements

**Humanitarian** (6 datasets):
- Needs overview
- Response plan
- Aid delivery
- Access constraints
- Protection concerns
- Funding

**Strengths**:
- Comprehensive coverage
- Multiple data sources
- Humanitarian focus
- Organized by category
- Automatic transformation
- Data validation

**Weaknesses**:
- Dataset availability varies
- Inconsistent formats
- Some datasets not found
- Large file sizes
- Complex transformations needed

**Current Usage**: Limited (needs expansion)

---

### 5. WFP (World Food Programme) ✅
**Status**: Active  
**Update Frequency**: Monthly  
**Data Quality**: High

**Data Types**:
- Food prices
- Market monitoring
- Food security assessments
- Nutrition surveys

**Strengths**:
- Specialized food security data
- Regular updates
- Market analysis

**Current Usage**: Food security component

---

### 6. B'Tselem ✅
**Status**: Active  
**Update Frequency**: Weekly  
**Data Quality**: High

**Data Types**:
- Checkpoint locations
- Checkpoint status
- Access restrictions

**Strengths**:
- Detailed checkpoint data
- Regular updates
- Human rights focus

**Current Usage**: West Bank occupation metrics

---

## Inactive/Potential Sources

### WHO (World Health Organization) ❌
**Status**: Disabled  
**Reason**: CORS restrictions, API complexity

**Potential Data**:
- Health system status
- Disease surveillance
- Healthcare attacks
- Medical supplies

**Activation Requirements**:
- Resolve CORS issues
- API key if needed
- Data transformation logic

---

### UNRWA ❌
**Status**: Disabled  
**Reason**: No public API

**Potential Data**:
- Refugee services
- Education in camps
- Healthcare in camps
- Emergency response

**Activation Requirements**:
- Find data source
- API access
- Data structure analysis

---

### PCBS (Palestinian Central Bureau of Statistics) ❌
**Status**: Disabled  
**Reason**: No accessible API

**Potential Data**:
- Official statistics
- Census data
- Economic indicators
- Social indicators

**Activation Requirements**:
- API access or data dumps
- Data parsing
- Regular updates

---

## Data Processing Pipeline

### 1. Fetch Scripts (`scripts/`)
```javascript
// Example: fetch-worldbank-data.js
- Fetch from external API
- Rate limiting (500-1100ms delays)
- Retry logic (3 attempts)
- Error handling
- Progress logging
```

**Features**:
- Rate-limited fetching
- Automatic retries
- Error recovery
- Progress tracking
- Validation

### 2. Data Storage (`public/data/`)
```
public/data/
├── tech4palestine/
├── goodshepherd/
├── worldbank/
│   ├── metadata.json
│   ├── all-indicators.json
│   └── [indicator].json (70+ files)
├── hdx/
│   ├── conflict/
│   ├── education/
│   ├── water/
│   ├── infrastructure/
│   ├── refugees/
│   └── humanitarian/
├── wfp/
├── btselem/
└── manifest.json
```

**Organization**:
- Source-based folders
- Category subfolders (HDX)
- Metadata files
- Validation reports
- Partition files (for large datasets)

### 3. Data Transformation

**World Bank**:
```javascript
// Automatic categorization
- Economic, Population, Labor, Poverty
- Education, Health, Infrastructure
- Trade, Financial, Social, Environment

// Unit detection
- Percentage, Currency, Per capita
- Years, Metric tons, etc.

// Metadata enrichment
- Category, Unit, Data points
- Last updated, Source
```

**HDX**:
```javascript
// Category-specific transformations
- Conflict: ACLED format → standardized events
- Education: Facilities → standardized structure
- Water: WASH data → standardized format
- Infrastructure: Damage → standardized assessment
- Refugees: Displacement → standardized tracking
- Humanitarian: Needs → standardized indicators

// Common transformations
- Date normalization (YYYY-MM-DD)
- Location standardization
- Numeric parsing
- Null handling
```

### 4. Data Validation

**Validation Checks**:
- Required fields present
- Data types correct
- Date formats valid
- Numeric ranges reasonable
- Completeness score
- Consistency score
- Accuracy score

**Quality Scoring**:
```javascript
qualityScore = (completeness + consistency + accuracy) / 3

// Thresholds
- High quality: > 0.8
- Medium quality: 0.6 - 0.8
- Low quality: < 0.6
```

**Validation Output**:
```json
{
  "qualityScore": 0.85,
  "completeness": 0.90,
  "consistency": 0.85,
  "accuracy": 0.80,
  "meetsThreshold": true,
  "errors": [],
  "warnings": []
}
```

### 5. Data Partitioning

**For Large Datasets**:
```javascript
// Partition by quarter
2024-Q1.json
2024-Q2.json
2024-Q3.json
2024-Q4.json

// Recent data (last 90 days)
recent.json

// Partition index
partitions.json
```

**Benefits**:
- Faster loading
- Reduced memory usage
- Better performance
- Easier updates

---

## Current Strengths

1. **No Runtime Dependencies**: All data is local
2. **Fast Loading**: No API calls during app usage
3. **Offline Support**: Works without internet
4. **Version Control**: Data changes tracked in Git
5. **Validation**: Automatic quality checks
6. **Organization**: Clear folder structure
7. **Metadata**: Rich metadata for each source
8. **Transformation**: Standardized data formats
9. **Partitioning**: Large datasets split efficiently
10. **Logging**: Comprehensive fetch logs

---

## Current Weaknesses

1. **Manual Updates**: Requires running scripts
2. **Limited Real-time**: Data not live
3. **Incomplete Coverage**: Some sources inactive
4. **Inconsistent Quality**: Varies by source
5. **Large Repository**: Data files in Git
6. **No Automation**: Manual fetch process
7. **Limited Enrichment**: Basic transformations only
8. **No Deduplication**: Potential duplicates
9. **No Relationships**: Data sources isolated
10. **No Historical Tracking**: Limited time-series

---

## Next Steps

See:
- [Data Enrichment Strategy](02-ENRICHMENT-STRATEGY.md)
- [Source Activation Plan](03-SOURCE-ACTIVATION.md)
- [Future Improvements](04-FUTURE-IMPROVEMENTS.md)
- [Unified Data Bank Vision](05-UNIFIED-DATA-BANK.md)
