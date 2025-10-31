#!/bin/bash

# Complete Data Update Pipeline
# This script runs the full data update workflow

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
if npm run fetch-all-data; then
    print_success "Data fetching completed"
else
    print_warning "Data fetching completed with some errors (check logs)"
fi
echo ""

# Step 2: Transform to unified format
echo "Step 2: Transforming to unified format..."
echo "-------------------------------------------"
if npm run populate-unified; then
    print_success "Data transformation completed"
else
    print_warning "Data transformation completed with some errors"
fi
echo ""

# Step 3: Generate manifest
echo "Step 3: Generating data manifest..."
echo "-------------------------------------------"
if npm run generate-manifest; then
    print_success "Manifest generation completed"
else
    print_error "Manifest generation failed"
fi
echo ""

# Step 4: Validate data
echo "Step 4: Validating data quality..."
echo "-------------------------------------------"
if npm run validate-data; then
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
echo ""
echo "Data locations:"
echo "  - Raw data: public/data/[source]/"
echo "  - Unified data: public/data/unified/"
echo ""
echo "Next steps:"
echo "  1. Review summary: cat public/data/data-collection-summary.json | jq"
echo "  2. Check validation: cat public/data/validation-report.json | jq"
echo "  3. Test in app: npm run dev"
echo ""
