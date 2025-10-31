# Data Source Troubleshooting Guide

## Quick Reference

This guide provides step-by-step troubleshooting procedures for common data source issues in the Palestine Pulse dashboard.

## Table of Contents

1. [Tech4Palestine Issues](#tech4palestine-issues)
2. [Good Shepherd Collective Issues](#good-shepherd-collective-issues)
3. [UN OCHA (HDX) Issues](#un-ocha-hdx-issues)
4. [World Bank Issues](#world-bank-issues)
5. [WFP Issues](#wfp-issues)
6. [B'Tselem Issues](#btselem-issues)
7. [General Connectivity Issues](#general-connectivity-issues)
8. [Performance Issues](#performance-issues)
9. [Data Quality Issues](#data-quality-issues)

---

## Tech4Palestine Issues

### Issue: Casualty Data Not Loading

**Symptoms**:
- Empty casualty counts
- "Loading..." state persists
- Console errors mentioning Tech4Palestine

**Diagnostic Steps**:

1. Check API connectivity:
```typescript
const response = await apiOrchestrator.fetch('tech4palestine', '/v3/summary.json', {
  useCache: false,
  bypassRateLimit: true,
});
console.log('Response:', response);
```

2. Verify endpoint availability:
```bash
curl https://data.techforpalestine.org/api/v3/summary.json
```

3. Check rate limit status:
```typescript
const rateLimitStatus = apiOrchestrator.getRateLimitStatus('tech4palestine');
console.log('Rate Limit:', rateLimitStatus);
```

**Common Causes**:
- API rate limiting
- Network connectivity issues
- API endpoint changes
- CORS configuration problems

**Solutions**:

1. **Rate Limiting**:
   - Wait for rate limit reset
   - Increase cache TTL
   - Implement request queuing

2. **Network Issues**:
   - Check internet connection
   - Verify proxy configuration
   - Test with different network

3. **Endpoint Changes**:
   - Check API documentation
   - Update endpoint URLs
   - Verify API version

4. **CORS Issues**:
   - Verify proxy configuration
   - Check CORS headers
   - Update proxy rules

---

### Issue: Press Casualty Data Missing

**Symptoms**:
- Press casualty widget shows zero
- Missing press casualty list
- Incomplete press data

**Diagnostic Steps**:

1. Test press endpoint:
```typescript
const response = await apiOrchestrator.fetch('tech4palestine', '/v2/press_killed_in_gaza.json');
console.log('Press Data:', response.data);
```

2. Verify data structure:
```typescript
if (response.data && Array.isArray(response.data)) {
  console.log('Press casualties count:', response.data.length);
} else {
  console.error('Invalid data structure');
}
```

**Solutions**:
- Verify endpoint URL
- Check data transformation logic
- Update data parser if format changed
- Clear cache and retry

---

## Good Shepherd Collective Issues

### Issue: West Bank Data Not Loading

**Symptoms**:
- Empty West Bank statistics
- Missing violence incidents
- No demolition data

**Diagnostic Steps**:

1. Test Good Shepherd service:
```typescript
import { goodShepherdService } from '@/services/goodShepherdService';

const allData = await goodShepherdService.fetchAllDatasets();
console.log('Datasets:', Object.keys(allData));
```

2. Check specific dataset:
```typescript
const wbData = await apiOrchestrator.fetch('goodshepherd', 'wb_data.json');
console.log('WB Data:', wbData);
```

**Common Causes**:
- API endpoint changes
- Data format modifications
- Authentication issues
- Server maintenance

**Solutions**:

1. **Endpoint Changes**:
   - Review API documentation
   - Update endpoint URLs
   - Test with curl/Postman

2. **Format Changes**:
   - Inspect response structure
   - Update data transformations
   - Add backward compatibility

3. **Authentication**:
   - Verify API keys
   - Check authentication headers
   - Renew credentials if needed

---

### Issue: Prisoner Data Incomplete

**Symptoms**:
- Missing child prisoner statistics
- Incomplete political prisoner data
- Zero counts where data should exist

**Diagnostic Steps**:

1. Test prisoner endpoints:
```typescript
const childPrisoners = await apiOrchestrator.fetch('goodshepherd', 'child_prisoners.json');
const prisonerData = await apiOrchestrator.fetch('goodshepherd', 'prisoner_data.json');

console.log('Child Prisoners:', childPrisoners.data);
console.log('Prisoner Data:', prisonerData.data);
```

2. Validate data completeness:
```typescript
const hasRequiredFields = prisonerData.data.every(record => 
  record.name && record.date && record.status
);
console.log('Data Complete:', hasRequiredFields);
```

**Solutions**:
- Check for API updates
- Verify data field mappings
- Update transformation logic
- Contact data provider

---

## UN OCHA (HDX) Issues

### Issue: Displacement Data Not Available

**Symptoms**:
- Missing displacement statistics
- Empty humanitarian indicators
- "No data available" messages

**Diagnostic Steps**:

1. Test HDX connectivity:
```typescript
const response = await apiOrchestrator.fetch('un_ocha', '/package_search?q=organization:un-ocha');
console.log('HDX Response:', response);
```

2. Check dataset availability:
```typescript
if (response.data && response.data.results) {
  console.log('Available datasets:', response.data.results.length);
  response.data.results.forEach(dataset => {
    console.log('- ', dataset.title);
  });
}
```

**Common Causes**:
- Dataset temporarily unavailable
- HDX platform maintenance
- Dataset URL changes
- Access restrictions

**Solutions**:

1. **Dataset Unavailable**:
   - Check HDX platform status
   - Use cached data temporarily
   - Display data age warning

2. **Platform Maintenance**:
   - Monitor HDX announcements
   - Implement retry logic
   - Use fallback data sources

3. **URL Changes**:
   - Update dataset URLs
   - Verify resource IDs
   - Test new endpoints

---

## World Bank Issues

### Issue: Economic Indicators Missing

**Symptoms**:
- Empty economic charts
- Missing GDP/unemployment data
- Stale economic indicators

**Diagnostic Steps**:

1. Test World Bank API:
```typescript
const response = await apiOrchestrator.fetch('world_bank', '/countries/PSE/indicators');
console.log('Indicators:', response.data);
```

2. Check indicator availability:
```typescript
const indicators = ['NY.GDP.MKTP.CD', 'SL.UEM.TOTL.ZS'];
indicators.forEach(async (indicator) => {
  const data = await apiOrchestrator.fetch('world_bank', `/countries/PSE/indicators/${indicator}`);
  console.log(`${indicator}:`, data);
});
```

**Common Causes**:
- Indicator deprecation
- Data publication delays
- API version changes
- Regional data gaps

**Solutions**:

1. **Deprecated Indicators**:
   - Find replacement indicators
   - Update indicator codes
   - Document changes

2. **Data Delays**:
   - Display last available data
   - Show data age clearly
   - Set expectations with users

3. **API Changes**:
   - Review API documentation
   - Update API version
   - Test thoroughly

---

## WFP Issues

### Issue: Food Security Data Outdated

**Symptoms**:
- Old food security assessments
- Missing recent surveys
- Stale nutrition data

**Diagnostic Steps**:

1. Check data freshness:
```typescript
const foodSecurity = await apiOrchestrator.fetch('wfp', 'food_security_assessment.json');
const lastUpdate = new Date(foodSecurity.data.lastUpdated);
const daysOld = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);
console.log('Data age (days):', daysOld);
```

2. Verify update frequency:
```typescript
const metadata = dataSourceMetadataService.getSourceMetadata('wfp');
console.log('Expected frequency:', metadata.updateFrequency);
```

**Solutions**:
- Contact WFP for update schedule
- Display data age prominently
- Use most recent available data
- Implement data age warnings

---

## B'Tselem Issues

### Issue: Checkpoint Data Not Updating

**Symptoms**:
- Static checkpoint counts
- Missing new checkpoints
- Outdated restriction data

**Diagnostic Steps**:

1. Test B'Tselem endpoint:
```typescript
const response = await apiOrchestrator.fetch('btselem', '/statistics');
console.log('B\'Tselem Data:', response);
```

2. Check scraping status (if applicable):
```typescript
// Check last successful scrape
const lastScrape = localStorage.getItem('btselem_last_scrape');
console.log('Last scrape:', lastScrape);
```

**Common Causes**:
- Website structure changes
- Rate limiting
- Scraping logic errors
- Data format changes

**Solutions**:

1. **Structure Changes**:
   - Inspect website HTML
   - Update scraping selectors
   - Test scraping logic

2. **Rate Limiting**:
   - Implement delays
   - Respect robots.txt
   - Use caching aggressively

3. **Format Changes**:
   - Update parsers
   - Add error handling
   - Implement fallbacks

---

## General Connectivity Issues

### Issue: Multiple Sources Failing

**Symptoms**:
- Multiple data sources unavailable
- Widespread connectivity errors
- Dashboard mostly empty

**Diagnostic Steps**:

1. Run system health check:
```typescript
import { systemIntegrationTestingService } from '@/services/systemIntegrationTestingService';

const healthReport = await systemIntegrationTestingService.runFullSystemTest();
console.log('System Health:', healthReport);
```

2. Check network connectivity:
```bash
# Test internet connection
ping 8.8.8.8

# Test DNS resolution
nslookup data.techforpalestine.org

# Test specific endpoints
curl -I https://data.techforpalestine.org/api/v3/summary.json
```

**Common Causes**:
- Internet connectivity issues
- Firewall blocking requests
- DNS resolution problems
- Proxy configuration errors

**Solutions**:

1. **Network Issues**:
   - Check internet connection
   - Restart network services
   - Test with different network

2. **Firewall**:
   - Check firewall rules
   - Whitelist required domains
   - Configure proxy if needed

3. **DNS Issues**:
   - Flush DNS cache
   - Use alternative DNS servers
   - Check DNS configuration

4. **Proxy Issues**:
   - Verify proxy configuration
   - Test proxy connectivity
   - Update proxy rules

---

## Performance Issues

### Issue: Slow Data Loading

**Symptoms**:
- Long loading times (>5 seconds)
- Delayed dashboard rendering
- Poor user experience

**Diagnostic Steps**:

1. Check performance metrics:
```typescript
import { performanceMonitor } from '@/services/performanceMonitor';

const summary = performanceMonitor.getSummary();
console.log('Average Response Time:', summary.averageResponseTime);
console.log('Peak Response Time:', summary.peakResponseTime);
```

2. Identify slow sources:
```typescript
const metrics = performanceMonitor.getAllSourcesMetrics();
Object.entries(metrics).forEach(([source, metric]) => {
  if (metric.averageResponseTime > 2000) {
    console.log(`Slow source: ${source} (${metric.averageResponseTime}ms)`);
  }
});
```

**Solutions**:

1. **Optimize Caching**:
```typescript
// Increase cache TTL for slow sources
apiOrchestrator.updateSourceConfig('slow_source', {
  cache_ttl: 60 * 60 * 1000, // 1 hour
});
```

2. **Implement Request Batching**:
```typescript
// Fetch multiple sources in parallel
const results = await apiOrchestrator.fetchMultiple([
  { source: 'tech4palestine', endpoint: '/v3/summary.json' },
  { source: 'goodshepherd', endpoint: 'wb_data.json' },
]);
```

3. **Use Lazy Loading**:
   - Load critical data first
   - Defer non-critical data
   - Implement progressive enhancement

---

### Issue: High Memory Usage

**Symptoms**:
- Browser slowdown
- Tab crashes
- Memory warnings

**Diagnostic Steps**:

1. Check cache size:
```typescript
const cacheStats = apiOrchestrator.getCacheStats();
console.log('Cache size:', cacheStats.size);
console.log('Cached keys:', cacheStats.keys.length);
```

2. Monitor memory usage:
```javascript
// In browser console
console.log('Memory:', performance.memory);
```

**Solutions**:

1. **Clear Cache**:
```typescript
apiOrchestrator.clearCache();
```

2. **Reduce Cache Size**:
```typescript
// Implement cache size limits
// Evict old entries
// Use LRU cache strategy
```

3. **Optimize Data Structures**:
   - Minimize data duplication
   - Use efficient data formats
   - Implement data compression

---

## Data Quality Issues

### Issue: Inconsistent Data

**Symptoms**:
- Conflicting statistics
- Data doesn't match sources
- Unexpected values

**Diagnostic Steps**:

1. Validate data quality:
```typescript
const consolidatedData = await dataConsolidationService.getConsolidatedData();
console.log('Data Quality:', consolidatedData.metadata.dataQuality);
```

2. Compare with source data:
```typescript
// Fetch raw data
const rawData = await apiOrchestrator.fetch('tech4palestine', '/v3/summary.json', {
  useCache: false,
});

// Compare with transformed data
console.log('Raw:', rawData.data);
console.log('Transformed:', consolidatedData.gaza.humanitarianCrisis);
```

**Solutions**:

1. **Verify Transformations**:
   - Review transformation logic
   - Add validation checks
   - Test with sample data

2. **Check Data Sources**:
   - Verify source data accuracy
   - Contact data providers
   - Document discrepancies

3. **Implement Validation**:
   - Add data validation rules
   - Implement sanity checks
   - Log validation errors

---

### Issue: Missing Data Fields

**Symptoms**:
- Undefined values
- Null fields
- Incomplete records

**Diagnostic Steps**:

1. Inspect data structure:
```typescript
const data = await apiOrchestrator.fetch('goodshepherd', 'wb_data.json');
console.log('Sample record:', data.data[0]);
console.log('Available fields:', Object.keys(data.data[0]));
```

2. Check for required fields:
```typescript
const requiredFields = ['date', 'location', 'type'];
const missingFields = requiredFields.filter(field => 
  !data.data[0].hasOwnProperty(field)
);
console.log('Missing fields:', missingFields);
```

**Solutions**:

1. **Update Field Mappings**:
   - Review API documentation
   - Update field names
   - Add field aliases

2. **Implement Defaults**:
   - Provide default values
   - Handle missing fields gracefully
   - Document assumptions

3. **Contact Provider**:
   - Report missing fields
   - Request data completeness
   - Clarify data schema

---

## Emergency Contacts

### Internal Team
- **On-Call Engineer**: oncall@palestinepulse.org
- **Data Team**: data@palestinepulse.org
- **DevOps**: devops@palestinepulse.org

### External Support
- **Tech4Palestine**: Contact via website
- **Good Shepherd**: Contact via website
- **UN OCHA**: https://www.ochaopt.org/contact
- **World Bank**: https://data.worldbank.org/contact

---

## Escalation Procedures

### Level 1: Minor Issues
- **Response Time**: 4 hours
- **Handler**: On-duty engineer
- **Examples**: Single source temporarily unavailable, minor performance degradation

### Level 2: Moderate Issues
- **Response Time**: 1 hour
- **Handler**: Senior engineer + Data team
- **Examples**: Multiple sources failing, significant performance issues

### Level 3: Critical Issues
- **Response Time**: 15 minutes
- **Handler**: Full incident response team
- **Examples**: Complete system failure, data integrity issues, security breaches

---

*Last Updated: October 22, 2025*
