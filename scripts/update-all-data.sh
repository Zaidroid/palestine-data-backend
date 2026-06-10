#!/bin/bash

# Complete Data Update Pipeline
# This script runs the full data update workflow with monitoring

set -e  # Exit on error

echo "========================================="
echo "Palestine Pulse - Data Update Pipeline"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Step 1: Fetch all data
echo "Step 1: Fetching data from all sources..."
echo "-------------------------------------------"

echo "  > Fetching all data sources (Core, News, Historical, Water, Infrastructure, Culture, Land)..."
if npm run fetch:all; then
    print_success "All data fetching completed"
else
    print_warning "Data fetching completed with some errors (check logs)"
fi
echo ""
echo ""

# Step 1.5: Fetch per-source datasets not covered by fetch:all
echo "Step 1.5: Fetching per-source datasets (UN, conflict, indicators)..."
echo "-------------------------------------------"
for fetcher in \
    sources/unhcr.js sources/unfts.js sources/imf.js sources/ucdp-conflict.js \
    sources/idmc.js sources/insecurity-insight.js sources/cod-ab.js sources/osm-pse.js \
    sources/ipc-food-insecurity.js sources/unhcr-pop-pse.js sources/idmc-stocks-pse.js \
    sources/fao-diem-pse.js sources/world-bank-wbg.js sources/ocha-hpc.js \
    sources/global-healthsites-pse.js sources/hdx-hapi-pse.js sources/awsd-pse.js \
    sources/acled-pse.js sources/wfp-food-prices-pse.js sources/ioda-connectivity-pse.js \
    sources/palopenmaps-places.js sources/unrwa-aid-trucks.js sources/who-ssa-attacks.js \
    sources/unosat-gaza-damage.js sources/reliefweb-pse.js sources/ocha-casualties.js \
    sources/ocha-demolitions.js sources/peacenow-settlements.js sources/hamoked-detention.js \
    sources/pcbs-indicators.js fetch-culture-data.js; do
    if node "scripts/$fetcher"; then
        print_success "$fetcher"
    else
        print_warning "$fetcher failed (continuing)"
    fi
done
echo ""

# Step 2: Transform to unified format
echo "Step 2: Transforming to unified format..."
echo "-------------------------------------------"
if npm run transform; then
    print_success "Data transformation completed"
else
    print_warning "Data transformation completed with some errors"
fi
echo ""

# Step 2.6: Generate Coverage Report
echo "Step 2.6: Generating coverage report..."
echo "-------------------------------------------"
if node scripts/generate-coverage-report.js; then
    print_success "Coverage report generated"
else
    print_error "Coverage report generation failed"
fi
echo ""

# Step 3: Generate GeoJSON layers
echo "Step 3: Generating GeoJSON layers..."
echo "-------------------------------------------"
if npm run generate:geojson; then
    print_success "GeoJSON generation completed"
else
    print_error "GeoJSON generation failed"
fi
echo ""

# Step 4: Generate manifests + quality snapshot
echo "Step 4: Generating data manifest + quality snapshot..."
echo "-------------------------------------------"
if npm run generate:manifest && node scripts/generate-unified-manifest.js && node scripts/generate-quality-snapshot.js && npm run generate:search; then
    print_success "Manifest + quality generation completed"
else
    print_error "Manifest/quality generation failed"
fi
echo ""

# Step 5: Validate data
echo "Step 5: Validating data quality..."
echo "-------------------------------------------"
if npm run validate; then
    print_success "Data validation completed"
else
    print_warning "Data validation found issues (check validation-report.json)"
fi
echo ""

# Summary
echo "========================================="
echo "Update Pipeline Complete!"
echo "========================================="
echo ""
echo "Summary files generated:"
echo "  - public/data/data-collection-summary.json"
echo "  - public/data/validation-report.json"
echo "  - public/data/manifest.json"
echo "  - public/data/unified/unified-manifest.json"
echo "  - public/data/historical/coverage-report.md"
echo ""
echo "Data locations:"
echo "  - Raw data: public/data/[source]/"
echo "  - Unified data: public/data/unified/"
echo "  - GeoJSON: public/data/geojson/"
echo ""
echo "Next steps:"
echo "  1. Review summary: cat public/data/data-collection-summary.json | jq"
echo "  2. Check validation: cat public/data/validation-report.json | jq"
echo "  3. Test in app: npm run dev"
echo ""
