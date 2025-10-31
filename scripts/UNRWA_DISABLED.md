# UNRWA Data Source - DISABLED

## Status: ❌ DISABLED

The UNRWA data source has been disabled due to lack of accessible data.

## Investigation Results

### Tested Sources

1. **HDX - UNRWA Organization** ❌
   - No datasets found under UNRWA organization

2. **HDX - UNRWA Keyword Search** ⚠️
   - Found 8 datasets
   - Most resources have broken links (404 errors)
   - Primary issue: Google Drive source file no longer accessible

3. **HDX - Palestine Refugees** ⚠️
   - Found 10 datasets
   - Limited UNRWA-specific data
   - Most are OCHA datasets, not UNRWA

4. **UN Data API** ❌
   - Returns 500 Internal Server Error
   - Service appears to be down or deprecated

### Specific Dataset Issues

#### Gaza Displacement Data
- **Dataset**: "Escalations in Gaza - Displaced Persons in UNRWA Shelters"
- **Issue**: All resources (CSV, JSON, XLSX) return 404 errors
- **Root Cause**: Source Google Drive file (ID: 19a3KG3J5FcOkrz9l72D3e-ifpicEZ7nY) is no longer accessible
- **Impact**: Cannot fetch displacement data

#### Lebanon Schools Data
- **Dataset**: "Lebanon - Public Schools and UNRWA Schools for Palestine Refugees"
- **Status**: ✓ Downloadable
- **Issue**: Not relevant for Palestine (Lebanon data only)

## Why Disabled

1. **No Palestine-Specific Data Available**: The only working dataset is for Lebanon, not Palestine
2. **Broken Links**: All Palestine-related UNRWA datasets have 404 errors
3. **Google Drive Dependency**: HDX datasets rely on external Google Drive files that are no longer accessible
4. **No Alternative Sources**: UN Data API is down, UNRWA website has no structured data API

## Alternative Approaches Considered

### 1. PDF Parsing
- **Status**: Not implemented
- **Reason**: UNRWA reports are narrative-heavy with limited structured data
- **Effort**: High (would require OCR and complex parsing)

### 2. Web Scraping
- **Status**: Not implemented
- **Reason**: UNRWA website doesn't have structured data tables
- **Effort**: High (would require maintaining scraper for HTML changes)

### 3. Manual Data Entry
- **Status**: Not implemented
- **Reason**: Would require ongoing manual updates
- **Effort**: High (not sustainable)

### 4. Direct UNRWA Partnership
- **Status**: Not pursued
- **Reason**: Beyond scope of current implementation
- **Effort**: Very High (requires organizational coordination)

## Recommendation

**Disable UNRWA source** until:
1. HDX fixes the broken Google Drive links
2. UNRWA publishes data through a reliable API
3. Alternative structured data sources become available

## Files Created (For Future Use)

The following files were created and can be reactivated when data becomes available:

1. `scripts/fetch-unrwa-data.js` - Fetcher script
2. `scripts/utils/unrwa-transformer.js` - Data transformer
3. `scripts/utils/base-transformer.js` - Base transformer (reusable for other sources)
4. `scripts/test-unrwa-transformer.js` - Test script

## Impact on Requirements

**Requirement 6.2**: "Implement an UNRWA data fetcher"
- **Status**: ⚠️ Partially Met
- **Explanation**: Fetcher is implemented but cannot fetch data due to source unavailability
- **Recommendation**: Mark as "Blocked - External Dependency"

## Next Steps

1. ✅ Disable UNRWA source in data collection
2. ✅ Document the issue
3. 📋 Monitor HDX for data availability
4. 📋 Check quarterly for UNRWA API updates
5. 📋 Consider using refugee data from other sources (OCHA, UNHCR)
