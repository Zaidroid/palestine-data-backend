#!/bin/bash

# Complete Data Update Pipeline
# Runs the full data update workflow: fetch -> transform -> derive -> validate.
# Fatal steps exit non-zero so cron/systemd/CI can detect real failures.

set -o pipefail

echo "========================================="
echo "Palestine Data Backend - Update Pipeline"
echo "========================================="
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Fatal step: failure aborts the pipeline with a non-zero exit.
run_fatal() {
    local label="$1"; shift
    echo "$label"
    echo "-------------------------------------------"
    if "$@"; then
        print_success "$label completed"
    else
        print_error "$label FAILED — aborting pipeline"
        exit 1
    fi
    echo ""
}

# Tolerated step: failure is reported but does not abort (per-source rot
# shouldn't block the rest of the refresh).
run_tolerated() {
    local label="$1"; shift
    echo "$label"
    echo "-------------------------------------------"
    if "$@"; then
        print_success "$label completed"
    else
        print_warning "$label completed with errors (check logs)"
    fi
    echo ""
}

# Step 1: Fetch all data (fetch-all-data.js tracks per-fetcher failures
# internally and runs Tech4Palestine, historical processing and coverage
# report itself; partial upstream failures are tolerated here).
run_tolerated "Step 1: Fetching data from all sources" npm run fetch:all

# Step 2: Transform raw data to the unified canonical schema.
run_fatal "Step 2: Transforming to unified format" npm run transform

# Step 3: Post-transform sweeps — stable IDs and gazetteer.
run_fatal "Step 3a: Attaching stable IDs" node scripts/attach-stable-ids.js
run_tolerated "Step 3b: Building gazetteer" node scripts/build-gazetteer.js

# Step 4: Generated artifacts.
run_tolerated "Step 4a: Generating GeoJSON layers" npm run generate:geojson
run_fatal "Step 4b: Generating data manifest" npm run generate:manifest
run_fatal "Step 4c: Generating unified manifest" node scripts/generate-unified-manifest.js
run_fatal "Step 4d: Generating search index" npm run generate:search
run_tolerated "Step 4e: Optimizing unified data + search index" npm run optimize

# Step 5: Validation + quality snapshot (powers /api/v1/quality and the
# freshness gate's Warning: 299 headers).
run_tolerated "Step 5a: Validating data quality" npm run validate
run_fatal "Step 5b: Generating quality snapshot" node scripts/generate-quality-snapshot.js

echo "========================================="
echo "Update Pipeline Complete!"
echo "========================================="
echo ""
echo "Summary files generated:"
echo "  - public/data/data-collection-summary.json"
echo "  - public/data/validation-report.json"
echo "  - public/data/manifest.json"
echo "  - public/data/unified/unified-manifest.json"
echo "  - public/data/unified/quality.json"
echo ""
echo "Data locations:"
echo "  - Raw data: public/data/[source]/"
echo "  - Unified data: public/data/unified/"
echo "  - GeoJSON: public/data/geojson/"
echo ""
