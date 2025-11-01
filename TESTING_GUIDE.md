# Testing Guide - Verify All Fixes

This guide helps you verify that all implementations are working correctly.

---

## 🧪 Quick Test (5 minutes)

Run this single command to test everything:

```bash
npm install && npm run update-data
```

**Expected Output**:
```
🚀 Palestine Pulse - Consolidated Data Fetcher
============================================================
Progress: [████████████████████] 100% (9/10)
✅ Data Collection Complete!
Total Duration: ~5-10 minutes
Successful Scripts: 9/10
Total Datasets: 300+
Total Records: 226,000+
```

**Expected Files Created**:
```
data/
├── tech4palestine/     ✅
├── hdx/               ✅
├── goodshepherd/      ✅
├── worldbank/         ✅
├── who/               ✅
├── pcbs/              ✅
├── unrwa/             ✅
├── wfp/               ✅ NEW
├── btselem/           ✅ NEW
├── unified/           ✅
├── manifest.json      ✅
├── status-dashboard.json    ✅ NEW
├── status-dashboard.html    ✅ NEW
└── data-collection-summary.json ✅
```

---

## 🔍 Detailed Testing

### Test 1: Path Fix Verification

```bash
# Test fetch-all-data uses correct path
npm run fetch-all-data 2>&1 | grep "Data Directory"
# Should show: Data Directory: /path/to/project/data
# Should NOT show: public/data

# Verify data exists
ls data/tech4palestine/
ls data/unified/
```

**Expected**: Data saved to `data/` directory ✅

---

### Test 2: Individual Source Tests

Test each of the 9 data sources individually:

```bash
# Test new Tech4Palestine fetcher
npm run fetch-tech4palestine
# Expected: data/tech4palestine/ created with summary.json, casualties/, etc.

# Test new WFP fetcher
npm run fetch-wfp
# Expected: data/wfp/ created with food security data

# Test new B'Tselem fetcher
npm run fetch-btselem
# Expected: data/btselem/ created with checkpoints.json

# Test existing sources
npm run fetch-worldbank
npm run fetch-pcbs
npm run fetch-hdx-ckan
npm run fetch-goodshepherd
npm run fetch-who
npm run fetch-unrwa
```

**Expected**: Each creates its respective `data/[source]/` directory ✅

---

### Test 3: Data Transformation

```bash
# Run unified transformation
npm run populate-unified

# Verify unified data created
ls data/unified/

# Should contain:
# - economic/
# - conflict/
# - infrastructure/
# - humanitarian/
# - health/
# - education/
# - water/
# - refugees/
# - pcbs/
```

**Expected**: All categories have `all-data.json` and `metadata.json` ✅

---

### Test 4: Validation

```bash
# Run validation
npm run validate-data

# Check validation report
cat data/validation-report.json | jq '.summary'
```

**Expected Output**:
```json
{
  "total_datasets": 8,
  "passed": 7-8,
  "failed": 0-1,
  "average_quality_score": 0.9+
}
```

---

### Test 5: Manifest Generation

```bash
# Generate manifest
npm run generate-manifest

# View manifest
cat data/manifest.json | jq
```

**Expected**: Manifest contains all 9 sources with metadata ✅

---

### Test 6: Monitoring Dashboard

```bash
# Generate dashboard
npm run generate-status

# View JSON output
cat data/status-dashboard.json | jq '.summary'

# Expected output:
# {
#   "total_sources": 9,
#   "healthy": 5-9,
#   "total_datasets": 300+,
#   "total_records": 226000+
# }

# Open HTML dashboard
open data/status-dashboard.html
# or Windows: start data/status-dashboard.html
```

**Expected**: Beautiful HTML dashboard showing all 9 sources ✅

---

### Test 7: Complete Pipeline

```bash
# Run complete pipeline
npm run update-data

# This runs:
# 1. fetch-all-data (all 9 sources)
# 2. populate-unified (transformation)
# 3. generate-manifest (index)
# 4. validate-data (quality checks)
# 5. generate-status (monitoring)

# Total time: 5-10 minutes
```

**Expected**: All steps complete successfully ✅

---

## 🤖 GitHub Actions Testing

### Test 1: Manual Workflow Trigger

1. Go to your GitHub repository
2. Click "Actions" tab
3. Select "Update Data" workflow
4. Click "Run workflow" button
5. Leave sources as "all"
6. Click green "Run workflow"

**Expected**:
- ✅ Workflow runs successfully
- ✅ Data fetched to `data/` directory
- ✅ Changes detected
- ✅ New commit created
- ✅ Artifacts uploaded

### Test 2: Check Workflow Paths

```bash
# Verify workflows reference correct paths
grep -r "public/data" .github/workflows/

# Should return: NO RESULTS
# If it returns results, paths aren't fixed
```

**Expected**: No references to `public/data/` ✅

### Test 3: Verify Commit

```bash
# Check latest commit
git log -1 --oneline

# Should see something like:
# chore: automated data update - 2025-11-01 12:00:00 UTC
```

**Expected**: Data changes committed automatically ✅

---

## 🔍 Verification Checklist

### Critical Fixes
- [ ] Data saves to `data/` not `public/data/`
- [ ] GitHub Actions workflows reference `data/`
- [ ] All 9 sources in fetch-all-data.js
- [ ] No duplicate entries in fetch scripts
- [ ] Console outputs show corr ect paths

### New Features
- [ ] Tech4Palestine separate fetcher works
- [ ] WFP fetcher retrieves food security data
- [ ] B'Tselem fetcher gets checkpoint data
- [ ] config.json exists and is valid
- [ ] Status dashboard generates HTML + JSON
- [ ] Notification workflow exists

### Documentation
- [ ] README.md updated with accurate info
- [ ] CHANGELOG.md documents v1.1.0
- [ ] All new scripts in package.json
- [ ] QUICK_ACTIONS.md provides quick reference

---

## ⚡ Quick Smoke Tests

Run these quick tests to verify everything:

```bash
# 1. Paths are correct
npm run fetch-tech4palestine && ls data/tech4palestine/
# ✅ Should show files

# 2. New fetchers work
npm run fetch-wfp && ls data/wfp/
npm run fetch-btselem && ls data/btselem/
# ✅ Should create directories

# 3. Monitoring works
npm run generate-status && ls data/status-dashboard.*
# ✅ Should show .html and .json files

# 4. Complete pipeline
npm run update-data
# ✅ Should complete without critical errors
```

---

## 📊 Expected Results Summary

### Data Volume
- **Sources**: 9 (100% implemented)
- **Datasets**: 300+
- **Records**: 226,000+
- **Storage**: ~800MB

### Automation
- **Workflows**: 7 active
- **Schedules**: Real-time, Daily, Weekly, Monthly
- **Success Rate**: >95% expected

### Quality
- **Completeness**: 95%+
- **Accuracy**: High (official sources)
- **Validation**: All data quality-checked
- **Reliability**: 0.90-0.95

---

## 🐛 Troubleshooting

### Issue: Data not in correct location
```bash
# Check current directory
pwd

# Verify relative paths work
ls $(pwd)/data/

# If public/data exists, it's old, remove it
rm -rf public/data/
```

### Issue: Fetcher fails
```bash
# Check error logs
tail -100 data-collection.log

# Try with verbose logging
LOG_LEVEL=debug npm run fetch-[source]

# Check network connectivity
curl https://data.techforpalestine.org/api/v3/summary.json
```

### Issue: GitHub Actions still broken
```bash
# Verify workflow files updated
grep "public/data" .github/workflows/*.yml

# Should return nothing
# If it returns matches, those files need updating
```

---

## ✅ Success Criteria

All tests pass when:

1. ✅ `npm run update-data` completes successfully
2. ✅ Data exists in `data/` directory (not `public/data/`)
3. ✅ All 9 sources have data directories
4. ✅ Status dashboard generates
5. ✅ Validation report shows >90% quality
6. ✅ GitHub Actions workflows complete (if enabled)
7. ✅ No errors in data-collection.log
8. ✅ manifest.json contains all sources

---

## 🎉 When Tests Pass

You'll have:
- ✅ Fully functional automated data pipeline
- ✅ All 9 data sources working
- ✅ Real-time monitoring dashboard
- ✅ Automatic failure notifications
- ✅ 226,000+ records ready to use
- ✅ API-ready data structure
- ✅ Production-ready system

---

**Test Status**: Ready for Testing  
**Expected Duration**: 10-15 minutes  
**Last Updated**: November 1, 2025