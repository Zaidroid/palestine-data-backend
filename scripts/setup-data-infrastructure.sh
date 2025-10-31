#!/bin/bash

# Data Infrastructure Setup Script
# This script helps you set up the new data infrastructure

set -e

echo "🚀 Palestine Pulse - Data Infrastructure Setup"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if HDX_API_KEY is set
if [ -z "$HDX_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  HDX_API_KEY environment variable is not set${NC}"
    echo ""
    echo "To get an HDX API key:"
    echo "1. Go to https://data.humdata.org"
    echo "2. Sign up or log in"
    echo "3. Go to your profile settings"
    echo "4. Generate an API key"
    echo ""
    echo "Then run:"
    echo "  export HDX_API_KEY='your-key-here'"
    echo "  ./scripts/setup-data-infrastructure.sh"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} HDX_API_KEY is set"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js from https://nodejs.org"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js is installed ($(node --version))"
echo ""

# Check if npm dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo -e "${GREEN}✓${NC} Dependencies installed"
    echo ""
fi

# Create data directories
echo "📁 Creating data directories..."
mkdir -p public/data/{hdx/{casualties,displacement,humanitarian/{food-security,health-facilities,water-sanitation},infrastructure/{damage-assessment,schools,hospitals},conflict},tech4palestine/{casualties,killed-in-gaza},goodshepherd/{prisoners,demolitions},worldbank,btselem}
echo -e "${GREEN}✓${NC} Data directories created"
echo ""

# Fetch initial data
echo "📡 Fetching initial data..."
echo "This may take a few minutes due to rate limiting (1 req/sec)..."
echo ""

node scripts/fetch-all-data.js

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓${NC} Data fetched successfully!"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Data fetch failed${NC}"
    echo "Please check the error messages above"
    exit 1
fi

# Check data files
echo "📊 Checking data files..."
DATA_FILES=$(find public/data -name "*.json" | wc -l)
echo -e "${GREEN}✓${NC} Found $DATA_FILES JSON files"
echo ""

# Show data structure
echo "📂 Data structure:"
tree -L 3 public/data/ 2>/dev/null || find public/data -type f -name "*.json" | head -20
echo ""

# Git status
echo "📝 Git status:"
git status public/data/ --short
echo ""

# Next steps
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the data in public/data/"
echo "2. Commit the changes:"
echo "   git add public/data/"
echo "   git commit -m 'feat: add initial data infrastructure'"
echo "   git push"
echo ""
echo "3. Configure GitHub Secrets:"
echo "   - Go to your repository → Settings → Secrets"
echo "   - Add HDX_API_KEY secret"
echo "   - Add NETLIFY_BUILD_HOOK secret (optional)"
echo ""
echo "4. The GitHub Actions workflow will run automatically every 6 hours"
echo "   You can also trigger it manually from the Actions tab"
echo ""
echo "5. Read DATA_INFRASTRUCTURE_README.md for usage instructions"
echo ""
echo "Happy coding! 🎉"
