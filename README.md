# Palestine Data Backend

A standalone, production-ready data collection, processing, and transformation system for Palestine humanitarian data. This backend extracts all data infrastructure from the main Palestine Pulse project, making it easy to use independently for data analysis, API development, or integration with other applications.

## Overview

This backend system collects data from 9+ trusted sources, processes and transforms it into unified formats, and provides structured data output for any use case. It's designed to be used independently or integrated with frontend applications.

## Features

- **9 Active Data Sources**: Tech4Palestine, HDX, Good Shepherd, World Bank, WHO, PCBS, UNRWA, WFP, B'Tselem
- **Automated Data Collection**: Scheduled fetching from all sources
- **Data Transformation**: Unified data format across all sources
- **Data Validation**: Quality checks and validation reports
- **API Ready**: Structured data output for API consumption
- **Comprehensive Documentation**: Full guides and references
- **No Frontend Dependencies**: Pure Node.js backend system

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Fetch All Data

```bash
npm run update-data
```

This will:
- Download data from all 9 sources
- Transform to unified format
- Validate data quality
- Generate manifests and reports

**Time**: ~5-10 minutes  
**Output**: `data/` directory with all processed data

### 3. Access Data

Data is stored in `data/` directory:
- Raw data: `data/sources/`
- Unified data: `data/unified/`
- Manifests: `data/manifest.json`

See [QUICK_START.md](QUICK_START.md) for detailed examples.

## Project Structure

```
palestine-data-backend/
├── scripts/              # Data fetching and processing
│   ├── fetch-*.js       # Individual source fetchers
│   ├── fetch-all-data.js
│   ├── populate-unified-data.js
│   ├── validate-data.js
│   ├── generate-manifest.js
│   └── utils/           # Transformation utilities
│       ├── base-transformer.js
│       ├── pcbs-transformer.js
│       ├── economic-transformer.js
│       ├── conflict-transformer.js
│       ├── data-validator.js
│       ├── data-partitioner.js
│       ├── geospatial-enricher.js
│       ├── temporal-enricher.js
│       └── unified-pipeline.js
├── data/                # Data storage (generated)
│   ├── sources/         # Raw data by source
│   ├── unified/         # Transformed unified data
│   ├── relationships/   # Data relationships
│   └── manifest.json    # Global data index
├── docs/                # Documentation
│   ├── START_HERE.md
│   ├── DATA_SOURCES_SUMMARY.md
│   ├── guides/          # Detailed guides
│   └── data-bank/       # Data bank documentation
├── .github/workflows/   # GitHub Actions (optional)
├── package.json         # Dependencies and scripts
├── QUICK_START.md       # 5-minute setup guide
└── README.md            # This file
```

## Available Scripts

### Data Collection
```bash
npm run fetch-all-data        # Fetch from all sources
npm run fetch-pcbs            # PCBS official statistics
npm run fetch-worldbank       # World Bank indicators
npm run fetch-who             # WHO health data
npm run fetch-unrwa           # UNRWA refugee data
npm run fetch-hdx-ckan        # HDX humanitarian data
npm run fetch-goodshepherd    # Good Shepherd data
```

### Data Processing
```bash
npm run populate-unified      # Transform to unified format
npm run validate-data         # Validate data quality
npm run generate-manifest     # Generate data manifest
npm run update-data           # Complete pipeline (fetch + process + validate)
```

### Testing & Verification
```bash
npm run verify-pcbs           # Verify PCBS data
npm run check-pcbs-coverage   # Check PCBS coverage
npm run test-pcbs             # Test PCBS transformation
npm run test-pipeline         # Test unified pipeline
npm run test-validation       # Test validation
```

## Data Sources

| Source | Type | Update Frequency | Records |
|--------|------|------------------|---------|
| Tech4Palestine | Casualties, conflict | Daily | 10,000+ |
| HDX | Humanitarian | Daily | 40+ datasets |
| Good Shepherd | Violence, detentions | Weekly | 1,000+ |
| World Bank | Economic | Quarterly | 1,500+ |
| WHO | Health | Monthly | Multiple datasets |
| PCBS | Official statistics | Annual | 845 |
| UNRWA | Refugees | As available | 100+ |
| WFP | Food security | Monthly | Market data |
| B'Tselem | Checkpoints | Weekly | Location data |

**Total**: 9 sources, 300+ indicators, 18,000+ data points

## Data Access

### File-Based Access

```javascript
// Node.js
const economicData = require('./data/unified/economic/all-data.json');
const pcbsPopulation = require('./data/unified/pcbs/population.json');
const manifest = require('./data/manifest.json');

console.log(`Economic indicators: ${economicData.length}`);
```

### Python Access

```python
import json

with open('data/unified/economic/all-data.json') as f:
    economic_data = json.load(f)

print(f"Economic indicators: {len(economic_data)}")
```

### API Integration

The data structure is designed for easy API integration:

```javascript
// Express.js example
import express from 'express';
import fs from 'fs';

const app = express();

app.get('/api/economic', (req, res) => {
  const data = JSON.parse(
    fs.readFileSync('./data/unified/economic/all-data.json')
  );
  res.json(data);
});

app.get('/api/pcbs/population', (req, res) => {
  const data = JSON.parse(
    fs.readFileSync('./data/unified/pcbs/population.json')
  );
  res.json(data);
});

app.listen(3000);
```

## Data Quality

- **Completeness**: 95%+ across all sources
- **Accuracy**: High (official sources)
- **Validation**: Automated quality checks
- **Reliability**: 0.90-0.95 reliability scores

## Automation

### GitHub Actions (Optional)

Set up automated daily updates:

```yaml
# .github/workflows/update-data.yml (already included)
name: Update Data
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run update-data
      - uses: stefanzweifel/git-auto-commit-action@v4
```

### Manual Updates

```bash
# Update all data
npm run update-data

# Or run individual steps
npm run fetch-all-data
npm run populate-unified
npm run validate-data
```

### Scheduled Updates (Cron)

```bash
# Linux/Mac cron job (daily at midnight)
0 0 * * * cd /path/to/palestine-data-backend && npm run update-data

# Windows Task Scheduler
# Run: npm run update-data
# Schedule: Daily at midnight
```

## Documentation

- **[Quick Start](QUICK_START.md)** - 5-minute setup guide
- **[Getting Started](docs/START_HERE.md)** - Complete setup guide
- **[Data Sources](docs/DATA_SOURCES_SUMMARY.md)** - Source overview
- **[Data Guide](docs/guides/DATA_GUIDE.md)** - Working with data
- **[Unified Data System](docs/guides/UNIFIED_DATA_SYSTEM.md)** - System architecture
- **[Data Transformation](docs/guides/DATA_TRANSFORMATION.md)** - Transformation logic
- **[Data Bank Vision](docs/data-bank/README.md)** - Long-term roadmap

## Use Cases

### 1. Data Analysis & Research
```bash
# Fetch latest data
npm run update-data

# Analyze with your tools
python analyze.py data/unified/economic/
R -e "source('analyze.R')"
```

### 2. API Backend Development
```javascript
// Build REST API
// Build GraphQL API
// Build WebSocket real-time API
```

### 3. Data Pipeline Integration
```bash
# Integrate into your pipeline
npm run fetch-all-data
./your-processing-script.sh
npm run populate-unified
```

### 4. Reporting & Visualization
- Access validated, structured data
- Generate reports and dashboards
- Export to various formats (JSON, CSV, GeoJSON)

### 5. Machine Learning & AI
- Use structured data for training models
- Time-series analysis
- Predictive analytics

## Requirements

- Node.js 18+ (for native fetch API)
- npm or yarn
- 500MB disk space for data
- Internet connection for data fetching

## Environment Variables

Optional configuration:

```bash
# .env
DATA_DIR=./data                    # Data storage directory
LOG_LEVEL=info                     # Logging level
FETCH_TIMEOUT=30000                # Fetch timeout (ms)
```

## Troubleshooting

### Data Not Fetching
```bash
# Check internet connection
# Verify source APIs are accessible
# Check logs in console output
```

### Validation Errors
```bash
# Re-fetch data
npm run fetch-all-data

# Check validation report
cat data/validation-report.json
```

### Disk Space
```bash
# Check space usage
du -sh data/

# Clean old data
rm -rf data/sources/*
npm run fetch-all-data
```

## Contributing

Contributions welcome! Areas for improvement:
- Additional data sources
- Enhanced transformations
- API implementations
- Documentation improvements

## License

MIT License - See LICENSE file for details

## Support

- **Issues**: GitHub Issues
- **Documentation**: `docs/` directory
- **Data Quality Reports**: `data/validation-report.json`
- **Quick Start**: [QUICK_START.md](QUICK_START.md)

## What Makes This Different?

### vs. Full Palestine Pulse Project
- **No Frontend**: Pure backend, no React/UI dependencies
- **Smaller**: ~50MB vs ~500MB (without node_modules)
- **Focused**: Data collection and processing only
- **Portable**: Easy to integrate anywhere

### vs. Manual Data Collection
- **Automated**: Scheduled updates, no manual work
- **Validated**: Quality checks on all data
- **Unified**: Consistent format across sources
- **Documented**: Comprehensive guides

### vs. Other Data APIs
- **Self-Hosted**: You control the data
- **Offline**: Works without internet (after initial fetch)
- **Free**: No API keys or rate limits
- **Comprehensive**: 9 sources, 300+ indicators

---

**Status**: Production Ready ✅  
**Last Updated**: October 31, 2025  
**Data Sources**: 9 active, fully automated  
**Total Indicators**: 300+  
**Total Records**: 18,000+

**Get Started**: Run `npm install && npm run update-data`
