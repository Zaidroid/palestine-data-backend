#!/bin/bash

# Data Infrastructure Test Script
# Verifies that the data infrastructure is working correctly

set -e

echo "🧪 Palestine Pulse - Data Infrastructure Test Suite"
echo "===================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0

# Test function
test_case() {
    local name="$1"
    local command="$2"
    
    echo -n "Testing: $name... "
    
    if eval "$command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED++))
        return 1
    fi
}

# Test with output
test_with_output() {
    local name="$1"
    local command="$2"
    local expected="$3"
    
    echo -n "Testing: $name... "
    
    local output=$(eval "$command" 2>&1)
    
    if [[ "$output" == *"$expected"* ]]; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        echo "  Expected: $expected"
        echo "  Got: $output"
        ((FAILED++))
        return 1
    fi
}

echo -e "${BLUE}=== Environment Tests ===${NC}"
echo ""

test_case "Node.js installed" "command -v node"
test_case "npm installed" "command -v npm"
test_case "git installed" "command -v git"

echo ""
echo -e "${BLUE}=== Directory Structure Tests ===${NC}"
echo ""

test_case "public/data exists" "[ -d public/data ]"
test_case "public/data/hdx exists" "[ -d public/data/hdx ]"
test_case "public/data/tech4palestine exists" "[ -d public/data/tech4palestine ]"
test_case "public/data/manifest.json exists" "[ -f public/data/manifest.json ]"

echo ""
echo -e "${BLUE}=== Script Tests ===${NC}"
echo ""

test_case "fetch-hdx-hapi-data.js exists" "[ -f scripts/fetch-hdx-hapi-data.js ]"
test_case "fetch-all-data.js exists" "[ -f scripts/fetch-all-data.js ]"
test_case "setup script exists" "[ -f scripts/setup-data-infrastructure.sh ]"
test_case "setup script is executable" "[ -x scripts/setup-data-infrastructure.sh ]"

echo ""
echo -e "${BLUE}=== GitHub Actions Tests ===${NC}"
echo ""

test_case "update-data.yml exists" "[ -f .github/workflows/update-data.yml ]"
test_case "workflow has cron schedule" "grep -q 'cron:' .github/workflows/update-data.yml"
test_case "workflow uses HDX_API_KEY" "grep -q 'HDX_API_KEY' .github/workflows/update-data.yml"

echo ""
echo -e "${BLUE}=== Frontend Hook Tests ===${NC}"
echo ""

test_case "useLocalData.ts exists" "[ -f src/hooks/useLocalData.ts ]"
test_case "useRecentData exported" "grep -q 'export function useRecentData' src/hooks/useLocalData.ts"
test_case "useDateRangeData exported" "grep -q 'export function useDateRangeData' src/hooks/useLocalData.ts"
test_case "DATE_RANGES exported" "grep -q 'export const DATE_RANGES' src/hooks/useLocalData.ts"

echo ""
echo -e "${BLUE}=== Package.json Tests ===${NC}"
echo ""

test_case "fetch-hdx-data script exists" "grep -q 'fetch-hdx-data' package.json"
test_case "fetch-all-data script exists" "grep -q 'fetch-all-data' package.json"
test_case "update-data script exists" "grep -q 'update-data' package.json"

echo ""
echo -e "${BLUE}=== Documentation Tests ===${NC}"
echo ""

test_case "DATA_INFRASTRUCTURE_PLAN.md exists" "[ -f DATA_INFRASTRUCTURE_PLAN.md ]"
test_case "DATA_INFRASTRUCTURE_README.md exists" "[ -f DATA_INFRASTRUCTURE_README.md ]"
test_case "IMPLEMENTATION_SUMMARY.md exists" "[ -f IMPLEMENTATION_SUMMARY.md ]"
test_case "DATA_QUICK_REFERENCE.md exists" "[ -f DATA_QUICK_REFERENCE.md ]"
test_case "NEXT_STEPS.md exists" "[ -f NEXT_STEPS.md ]"

echo ""
echo -e "${BLUE}=== Data File Tests ===${NC}"
echo ""

# Check if data has been fetched
if [ -f "public/data/manifest.json" ]; then
    test_case "manifest.json is valid JSON" "cat public/data/manifest.json | python3 -m json.tool"
    test_case "manifest has baseline_date" "grep -q 'baseline_date' public/data/manifest.json"
    test_case "manifest has version" "grep -q 'version' public/data/manifest.json"
fi

# Check for data files (if they exist)
if [ -d "public/data/tech4palestine/casualties" ]; then
    echo ""
    echo -e "${YELLOW}Data files found! Running additional tests...${NC}"
    echo ""
    
    test_case "casualties index exists" "[ -f public/data/tech4palestine/casualties/index.json ]"
    test_case "casualties recent exists" "[ -f public/data/tech4palestine/casualties/recent.json ]"
    
    if [ -f "public/data/tech4palestine/casualties/recent.json" ]; then
        test_case "recent.json is valid JSON" "cat public/data/tech4palestine/casualties/recent.json | python3 -m json.tool"
        test_case "recent.json has metadata" "grep -q 'metadata' public/data/tech4palestine/casualties/recent.json"
        test_case "recent.json has data array" "grep -q '\"data\"' public/data/tech4palestine/casualties/recent.json"
    fi
fi

echo ""
echo -e "${BLUE}=== API Key Tests ===${NC}"
echo ""

if [ -z "$HDX_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  HDX_API_KEY not set (this is OK for initial setup)${NC}"
    echo "   To test with real data, run:"
    echo "   export HDX_API_KEY='your-key' && ./scripts/test-data-infrastructure.sh"
else
    echo -e "${GREEN}✓ HDX_API_KEY is set${NC}"
    ((PASSED++))
fi

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo ""

TOTAL=$((PASSED + FAILED))
PERCENTAGE=$((PASSED * 100 / TOTAL))

echo "Tests Run: $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo "Success Rate: $PERCENTAGE%"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Get HDX API key from https://data.humdata.org"
    echo "2. Run: export HDX_API_KEY='your-key'"
    echo "3. Run: ./scripts/setup-data-infrastructure.sh"
    echo "4. Commit and push the data"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    echo ""
    echo "Please fix the failing tests before proceeding."
    echo "Check the output above for details."
    exit 1
fi
