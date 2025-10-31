# Quick Start Guide

Get up and running with Palestine Data Backend in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- npm or yarn
- 500MB free disk space
- Internet connection

## Installation

```bash
# Clone or download this repository
cd palestine-data-backend

# Install dependencies
npm install
```

## Fetch Data

### Option 1: Fetch All Data (Recommended)

```bash
npm run update-data
```

This runs the complete pipeline:
1. Fetches data from all 9 sources
2. Transforms to unified format
3. Validates data quality
4. Generates manifests

**Time**: ~5-10 minutes  
**Output**: `data/` directory with all data

### Option 2: Fetch Individual Sources

```bash
# Fetch specific sources
npm run fetch-worldbank    # World Bank economic indicators
npm run fetch-pcbs          # PCBS official statistics
npm run fetch-hdx-ckan      # HDX humanitarian data
npm run fetch-goodshepherd  # Good Shepherd violence data
npm run fetch-who           # WHO health data
npm run fetch-unrwa         # UNRWA refugee data
```

## Access Data

### File-Based Access

```javascript
// Node.js
const economicData = require('./data/unified/economic/all-data.json');
const pcbsPopulation = require('./data/unified/pcbs/population.json');
const manifest = require('./data/manifest.json');

console.log(`Economic indicators: ${economicData.length}`);
console.log(`PCBS population records: ${pcbsPopulation.length}`);
```

### Python Access

```python
import json

# Load economic data
with open('data/unified/economic/all-data.json') as f:
    economic_data = json.load(f)

# Load PCBS data
with open('data/unified/pcbs/population.json') as f:
    population_data = json.load(f)

print(f"Economic indicators: {len(economic_data)}")
print(f"Population records: {len(population_data)}")
```

## Data Structure

```
data/
├── sources/              # Raw data from each source
│   ├── worldbank/
│   ├── pcbs/
│   ├── hdx/
│   ├── goodshepherd/
│   ├── who/
│   ├── unrwa/
│   ├── tech4palestine/
│   ├── wfp/
│   └── btselem/
├── unified/              # Transformed unified data
│   ├── economic/
│   ├── conflict/
│   ├── infrastructure/
│   ├── humanitarian/
│   ├── health/
│   ├── education/
│   ├── water/
│   ├── refugees/
│   └── pcbs/
├── relationships/        # Cross-dataset links
└── manifest.json         # Global data index
```

## Verify Data

```bash
# Verify PCBS data
npm run verify-pcbs

# Check PCBS coverage
npm run check-pcbs-coverage

# Test complete pipeline
npm run test-pipeline

# Validate all data
npm run validate-data
```

## Next Steps

1. **Explore Data**: Browse the `data/` directory
2. **Read Documentation**: Check `docs/` for detailed guides
3. **Build API**: Use data files to create REST/GraphQL APIs
4. **Analyze Data**: Import into your analysis tools
5. **Automate Updates**: Set up scheduled data fetching

## Common Use Cases

### 1. Data Analysis

```bash
# Fetch latest data
npm run update-data

# Analyze with your tools
python analyze.py data/unified/economic/
R -e "source('analyze.R')"
```

### 2. API Development

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

app.listen(3000);
```

### 3. Scheduled Updates

```bash
# Linux/Mac cron job (daily at midnight)
0 0 * * * cd /path/to/palestine-data-backend && npm run update-data

# Windows Task Scheduler
# Run: npm run update-data
# Schedule: Daily at midnight
```

### 4. Data Export

```bash
# Data is already in JSON format
# Convert to CSV if needed:
node -e "
const data = require('./data/unified/economic/all-data.json');
const csv = data.map(row => Object.values(row).join(',')).join('\\n');
require('fs').writeFileSync('economic.csv', csv);
"
```

## Troubleshooting

### Data Not Fetching

```bash
# Check internet connection
ping google.com

# Try individual sources
npm run fetch-worldbank

# Check logs
cat data-collection.log
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

## Support

- **Documentation**: See `docs/` directory
- **Issues**: Check GitHub issues
- **Data Sources**: See `docs/DATA_SOURCES_SUMMARY.md`

## What's Next?

- **[Full Documentation](docs/START_HERE.md)** - Complete setup guide
- **[Data Guide](docs/guides/DATA_GUIDE.md)** - Working with data
- **[API Examples](docs/guides/API_EXAMPLES.md)** - Building APIs
- **[Automation](docs/guides/AUTOMATION.md)** - Scheduled updates

---

**You're ready to go!** 🚀

Run `npm run update-data` to fetch all data and start building.
