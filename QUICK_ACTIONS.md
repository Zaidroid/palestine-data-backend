# Quick Actions Guide

Fast reference for common tasks with the Palestine Data Backend.

---

## 🚀 Quick Start

```bash
# Install and fetch all data (first time)
npm install && npm run update-data

# Update all data (subsequent runs)
npm run update-data
```

---

## 📊 Fetch Individual Sources

```bash
# Real-time sources (update every 6 hours)
npm run fetch-tech4palestine     # Casualty data

# Daily sources
npm run fetch-goodshepherd       # Violence incidents
npm run fetch-btselem            # Checkpoint data

# Weekly sources
npm run fetch-hdx-ckan           # Humanitarian datasets  
npm run fetch-wfp                # Food security data

# Monthly sources
npm run fetch-worldbank          # Economic indicators
npm run fetch-who                # Health data
npm run fetch-pcbs               # Official statistics
npm run fetch-unrwa              # Refugee data
```

---

## 🔄 Data Processing

```bash
# Transform raw data to unified format
npm run populate-unified

# Validate data quality
npm run validate-data

# Generate global manifest
npm run generate-manifest

# Generate monitoring dashboard
npm run generate-status

# Complete pipeline (all steps)
npm run update-data
```

---

## 📈 Monitoring & Status

```bash
# Generate status dashboard
npm run generate-status

# View HTML dashboard
open data/status-dashboard.html
# or on Windows: start data/status-dashboard.html

# View JSON status
cat data/status-dashboard.json | jq

# Check collection summary
cat data/data-collection-summary.json | jq '.summary'

# View validation report
cat data/validation-report.json | jq '.summary'
```

---

## 🔍 Verify Data

```bash
# Check data structure
ls data/
ls data/unified/

# Count records
find data/ -name "*.json" | wc -l

# Check specific source
cat data/tech4palestine/metadata.json | jq
cat data/worldbank/metadata.json | jq

# Verify PCBS data
npm run verify-pcbs
npm run check-pcbs-coverage
```

---

## 🧪 Testing

```bash
# Test PCBS transformation
npm run test-pcbs

# Test unified pipeline
npm run test-pipeline

# Test validation
npm run test-validation
```

---

## 🛠️ Troubleshooting

```bash
# Check logs
tail -100 data-collection.log

# Re-fetch failed source
npm run fetch-[source-name]

# Clean and rebuild
rm -rf data/
npm run update-data

# Test single source
npm run fetch-tech4palestine
```

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `data/manifest.json` | Global index of all data |
| `data/status-dashboard.html` | Visual monitoring dashboard |
| `data/data-collection-summary.json` | Collection statistics |
| `data/validation-report.json` | Data quality report | 
| `config.json` | Central configuration |
| `COMPREHENSIVE_ANALYSIS.md` | Detailed project analysis |
| `IMPLEMENTATION_SUMMARY.md` | What was implemented |

---

## 🤖 GitHub Actions

### Manually Trigger Workflow
1. Go to GitHub repository
2. Click "Actions" tab
3. Select workflow (e.g., "Update Data")
4. Click "Run workflow"
5. Click green "Run workflow" button

### Check Workflow Status
```bash
# View recent runs
gh run list

# View specific run
gh run view [run-id]

# Download artifacts
gh run download [run-id]
```

### Common Workflows
- **Update Data** - Complete daily refresh
- **Update Real-Time Data** - Every 6 hours (Tech4Palestine)
- **Update Daily Data** - Daily sources (Good Shepherd, B'Tselem)
- **Update Weekly Data** - Weekly sources (HDX, WFP)
- **Update Monthly Data** - Monthly sources (World Bank, WHO, PCBS, UNRWA)

---

## 📊 Data Access Patterns

### Node.js
```javascript
// Load economic data
const economic = require('./data/unified/economic/all-data.json');

// Load specific source
const pcbs = require('./data/unified/pcbs/population.json');

// Load recent data
const recent = require('./data/unified/infrastructure/recent.json');
```

### Python
```python
import json

# Load data
with open('data/unified/economic/all-data.json') as f:
    economic = json.load(f)

# Access records
records = economic['data']
print(f"Total records: {len(records)}")
```

### Command Line
```bash
# Pretty print JSON
cat data/unified/economic/all-data.json | jq

# Count records
cat data/unified/economic/all-data.json | jq '.data | length'

# Filter data
cat data/unified/economic/all-data.json | jq '.data[] | select(.year=="2023")'
```

---

## 🔧 Configuration

### Edit Settings
```bash
# Open configuration
nano config.json

# Key settings:
# - dataDirectory: Where data is stored
# - sources.enabled: Which sources to fetch
# - automation.schedules: Update frequencies
# - validation.qualityThreshold: Quality bar
```

### Environment Variables
Create `.env` file:
```bash
DATA_DIR=./data
LOG_LEVEL=info
HDX_API_KEY=your_key_here  # Optional
```

---

## ⚡ Performance Tips

### Faster Updates
```bash
# Update only specific sources
npm run fetch-tech4palestine
npm run populate-unified

# Skip validation for speed
npm run fetch-all-data && npm run populate-unified
```

### Reduce Storage
```bash
# Remove old partitions
rm data/*/partitions/2023-*.json

# Keep only recent data
# Edit config.json: partitioning.enabled = false
```

---

## 🆘 Emergency Commands

### System Not Working
```bash
# 1. Clean everything
rm -rf data/

# 2. Fresh install
npm install

# 3. Rebuild from scratch
npm run update-data
```

### Automation Broken
```bash
# Check workflows are correct
cat .github/workflows/update-data.yml | grep "data/"

# Should say "data/" NOT "public/data/"
```

### Missing Data
```bash
# Fetch specific source
npm run fetch-[source]

# Force refresh
rm data/[source]/*
npm run fetch-[source]
```

---

## 📚 Learn More

- **Full Guide**: [README.md](README.md)
- **Setup Guide**: [QUICK_START.md](QUICK_START.md)
- **Analysis**: [COMPREHENSIVE_ANALYSIS.md](COMPREHENSIVE_ANALYSIS.md)
- **Implementation**: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
- **Changes**: [CHANGELOG.md](CHANGELOG.md)

---

**Last Updated**: November 1, 2025  
**Version**: 1.1.0
