# PCBS Data Source

## Overview

This directory contains official statistics from the **Palestinian Central Bureau of Statistics (PCBS)** for Palestine. PCBS is the official statistical authority for Palestine, providing comprehensive demographic, economic, and social data.

## Data Sources

### 1. World Bank Open Data API
- **URL**: https://api.worldbank.org/v2
- **Description**: PCBS indicators republished by World Bank
- **Coverage**: 67 indicators with data from 2010-2024
- **Update Frequency**: Annual (most indicators)

### 2. Manual Data Entry (Template Available)
- **File**: `manual-data-template.json`
- **Description**: Template for entering data from PCBS official reports (PDF/Excel)
- **Usage**: Edit the template file and re-run the fetch script

## Data Coverage

### Statistics Available (67 indicators, 845 data points)

#### Population Statistics (14 indicators)
- Total population and growth rates
- Age distribution (0-14, 15-64, 65+)
- Urban/rural population
- Life expectancy (total, male, female)
- Birth and death rates
- Fertility rates
- Dependency ratios

#### Labor Statistics (13 indicators)
- Unemployment rates (total, male, female, youth)
- Labor force participation rates
- Employment to population ratios
- Vulnerable employment

#### Economic Statistics (11 indicators)
- GDP and GDP per capita
- GDP growth rates
- Economic sector composition (agriculture, industry, services)
- Inflation rates
- Trade (exports and imports as % of GDP)

#### Poverty & Inequality (4 indicators)
- Gini index
- Poverty headcount ratio
- Income distribution (lowest 20%, highest 20%)

#### Education Statistics (11 indicators)
- School enrollment rates (primary, secondary, tertiary)
- Gender-disaggregated enrollment
- Primary completion rates
- Adult literacy rates
- Pupil-teacher ratios
- Government education expenditure

#### Health Statistics (11 indicators)
- Mortality rates (under-5, neonatal, maternal)
- Healthcare workforce (physicians, nurses, midwives)
- Hospital beds per capita
- Immunization coverage (DPT, measles)
- Health expenditure
- Access to water and sanitation

#### Housing/Infrastructure (1 indicator)
- Access to electricity

## File Structure

```
public/data/pcbs/
├── README.md                          # This file
├── metadata.json                      # Dataset metadata and summary
├── all-indicators.json                # All data combined
├── manual-data-template.json          # Template for manual data entry
├── [indicator_code].json              # Individual indicator files (67 files)
└── ...
```

## Transformed Data

Transformed data in unified format is available at:
```
public/data/unified/pcbs/
├── all-data-transformed.json          # All transformed data
├── population.json                    # Population indicators (355 records)
├── labor.json                         # Labor indicators (92 records)
├── economic.json                      # Economic indicators (180 records)
├── poverty.json                       # Poverty indicators (12 records)
├── education.json                     # Education indicators (130 records)
└── health.json                        # Health indicators (76 records)
```

## Data Quality

- **Source Reliability**: 0.95 (Official government statistics)
- **Data Quality**: High
- **Completeness**: 100% for available indicators
- **Update Frequency**: Annual for most indicators, quarterly for labor statistics

## Transformation Features

Each transformed record includes:
- **Unified format**: Consistent structure across all data sources
- **Trend analysis**: Linear trend, growth rate, volatility
- **Baseline comparison**: Change since October 7, 2023
- **Quality metrics**: Completeness, consistency, accuracy scores
- **Temporal context**: Period classification, conflict phase
- **Source attribution**: Full provenance tracking

## Usage

### Fetching Data
```bash
node scripts/fetch-pcbs-data.js
```

### Testing Transformer
```bash
node scripts/test-pcbs-transformer.js
node scripts/test-pcbs-comprehensive.js
```

### Adding Manual Data
1. Edit `manual-data-template.json`
2. Add data entries following the example format
3. Re-run the fetch script

## Notes

- PCBS official website (www.pcbs.gov.ps) primarily publishes data in PDF/Excel format
- Most indicators are available through World Bank API (republished PCBS data)
- For indicators not available via API, use the manual data entry template
- Data is updated annually, typically in Q1 of the following year

## References

- **PCBS Official Website**: https://www.pcbs.gov.ps
- **World Bank Open Data**: https://data.worldbank.org
- **API Documentation**: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392

## Last Updated

2025-10-30
