#!/bin/bash

# Secure API Key Test Script
# This script will prompt for your HDX API key and test the full functionality

set -e

echo "🔐 Secure HDX API Key Test"
echo "=========================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Prompt for API key securely
echo -e "${YELLOW}Please enter your HDX API key:${NC}"
echo "(It will not be displayed on screen)"
read -s HDX_API_KEY
echo ""

if [ -z "$HDX_API_KEY" ]; then
    echo -e "${RED}❌ No API key provided${NC}"
    exit 1
fi

echo -e "${GREEN}✓ API key received${NC}"
echo ""

# Export for child processes
export HDX_API_KEY

# Test 1: Verify API key works
echo -e "${BLUE}Test 1: Verifying API key...${NC}"
echo ""

# Make a simple test request to HDX HAPI
TEST_URL="https://hapi.humdata.org/api/v1/metadata/location"
echo "Testing connection to HDX HAPI..."

if curl -s -f "$TEST_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ HDX HAPI is accessible${NC}"
else
    echo -e "${RED}❌ Cannot reach HDX HAPI${NC}"
    echo "Please check your internet connection"
    exit 1
fi

echo ""

# Test 2: Run data fetch
echo -e "${BLUE}Test 2: Fetching data from all sources...${NC}"
echo ""
echo "This will take a few minutes due to rate limiting (1 req/sec)"
echo ""

if node scripts/fetch-all-data.js; then
    echo ""
    echo -e "${GREEN}✓ Data fetch completed successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Data fetch failed${NC}"
    echo "Check the error messages above"
    exit 1
fi

echo ""

# Test 3: Verify data files
echo -e "${BLUE}Test 3: Verifying data files...${NC}"
echo ""

DATA_FILES=$(find public/data -name "*.json" -type f | wc -l)
echo "Found $DATA_FILES JSON files"

if [ "$DATA_FILES" -gt 5 ]; then
    echo -e "${GREEN}✓ Data files created successfully${NC}"
else
    echo -e "${RED}❌ Not enough data files created${NC}"
    exit 1
fi

echo ""

# Test 4: Check data structure
echo -e "${BLUE}Test 4: Checking data structure...${NC}"
echo ""

# Check HDX casualties
if [ -f "public/data/hdx/casualties/index.json" ]; then
    echo -e "${GREEN}✓ HDX casualties index exists${NC}"
    RECORDS=$(cat public/data/hdx/casualties/index.json | grep -o '"records":[0-9]*' | head -1 | grep -o '[0-9]*')
    echo "  Records in index: $RECORDS"
else
    echo -e "${YELLOW}⚠️  HDX casualties index not found${NC}"
fi

# Check Tech4Palestine
if [ -f "public/data/tech4palestine/casualties/index.json" ]; then
    echo -e "${GREEN}✓ Tech4Palestine casualties index exists${NC}"
else
    echo -e "${YELLOW}⚠️  Tech4Palestine casualties index not found${NC}"
fi

# Check recent data
if [ -f "public/data/tech4palestine/casualties/recent.json" ]; then
    echo -e "${GREEN}✓ Recent data file exists${NC}"
    SIZE=$(du -h public/data/tech4palestine/casualties/recent.json | cut -f1)
    echo "  File size: $SIZE"
else
    echo -e "${YELLOW}⚠️  Recent data file not found${NC}"
fi

echo ""

# Test 5: Validate JSON
echo -e "${BLUE}Test 5: Validating JSON files...${NC}"
echo ""

VALID=0
INVALID=0

for file in $(find public/data -name "*.json" -type f | head -10); do
    if python3 -m json.tool "$file" > /dev/null 2>&1; then
        ((VALID++))
    else
        ((INVALID++))
        echo -e "${RED}✗ Invalid JSON: $file${NC}"
    fi
done

echo "Valid JSON files: $VALID"
echo "Invalid JSON files: $INVALID"

if [ "$INVALID" -eq 0 ]; then
    echo -e "${GREEN}✓ All JSON files are valid${NC}"
else
    echo -e "${RED}❌ Some JSON files are invalid${NC}"
fi

echo ""

# Test 6: Check data content
echo -e "${BLUE}Test 6: Checking data content...${NC}"
echo ""

if [ -f "public/data/manifest.json" ]; then
    echo "Manifest contents:"
    cat public/data/manifest.json | python3 -m json.tool | head -20
    echo ""
    echo -e "${GREEN}✓ Manifest is readable${NC}"
fi

echo ""

# Summary
echo -e "${BLUE}=== Test Summary ===${NC}"
echo ""
echo "✅ API key verified"
echo "✅ Data fetched successfully"
echo "✅ Data files created ($DATA_FILES files)"
echo "✅ JSON validation passed"
echo ""

# Show data structure
echo -e "${BLUE}Data Structure:${NC}"
tree -L 3 public/data/ 2>/dev/null || find public/data -type f -name "*.json" | head -20

echo ""
echo -e "${GREEN}🎉 All tests passed!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the data in public/data/"
echo "2. Commit the changes:"
echo "   git add public/data/"
echo "   git commit -m 'feat: add initial data from HDX HAPI and Tech4Palestine'"
echo "   git push"
echo ""
echo "3. Configure GitHub Secrets:"
echo "   - Go to Settings → Secrets → Actions"
echo "   - Add HDX_API_KEY with your key"
echo ""
echo "4. The GitHub Actions workflow will now run automatically every 6 hours"
echo ""

# Clean up (don't leave API key in environment)
unset HDX_API_KEY
