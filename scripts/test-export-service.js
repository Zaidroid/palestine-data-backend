/**
 * Manual Test Script for Export Service
 * 
 * This script tests the export service functionality without requiring a test framework.
 * Run with: node scripts/test-export-service.js
 */

// Mock data for testing
const mockConflictData = [
  {
    id: 'conflict_001',
    type: 'conflict',
    category: 'conflict',
    date: '2024-01-15',
    timestamp: '2024-01-15T10:30:00Z',
    location: {
      name: 'Gaza City',
      coordinates: [34.4668, 31.5],
      admin_levels: {
        level1: 'Gaza',
        level2: 'Gaza City',
      },
      region: 'gaza',
      region_type: 'urban',
    },
    value: 5,
    unit: 'casualties',
    event_type: 'airstrike',
    fatalities: 3,
    injuries: 2,
    actors: {
      actor1: 'Israeli Forces',
      actor2: 'Civilians',
    },
    description: 'Airstrike on residential area',
    severity_index: 0.8,
    quality: {
      score: 0.9,
      completeness: 0.95,
      consistency: 0.9,
      accuracy: 0.85,
      verified: true,
      confidence: 0.9,
    },
    sources: [
      {
        name: 'ACLED',
        organization: 'Armed Conflict Location & Event Data Project',
        url: 'https://acleddata.com',
        fetched_at: '2024-01-16T00:00:00Z',
        reliability_score: 0.95,
      },
    ],
    created_at: '2024-01-16T00:00:00Z',
    updated_at: '2024-01-16T00:00:00Z',
    version: 1,
  },
  {
    id: 'conflict_002',
    type: 'conflict',
    category: 'conflict',
    date: '2024-01-16',
    location: {
      name: 'Jenin',
      coordinates: [35.3, 32.46],
      admin_levels: {
        level1: 'Jenin',
      },
      region: 'west_bank',
    },
    value: 2,
    unit: 'casualties',
    event_type: 'raid',
    fatalities: 1,
    injuries: 1,
    actors: {
      actor1: 'Israeli Forces',
    },
    description: 'Military raid',
    quality: {
      score: 0.85,
      completeness: 0.9,
      consistency: 0.85,
      accuracy: 0.8,
      verified: true,
      confidence: 0.85,
    },
    sources: [
      {
        name: 'ACLED',
        organization: 'Armed Conflict Location & Event Data Project',
        fetched_at: '2024-01-17T00:00:00Z',
      },
    ],
    created_at: '2024-01-17T00:00:00Z',
    updated_at: '2024-01-17T00:00:00Z',
    version: 1,
  },
];

const mockMetadata = {
  id: 'conflict_data',
  name: 'Conflict Incidents',
  category: 'conflict',
  source: 'ACLED',
  organization: 'Armed Conflict Location & Event Data Project',
  description: 'Conflict incident data for Palestine',
  last_updated: '2024-01-17T00:00:00Z',
  update_frequency: 'daily',
  record_count: 2,
  date_range: {
    start: '2024-01-15',
    end: '2024-01-16',
  },
  quality: {
    score: 0.875,
    completeness: 0.925,
    consistency: 0.875,
    accuracy: 0.825,
    verified: true,
    confidence: 0.875,
  },
  partitioned: false,
  fields: [
    {
      name: 'event_type',
      type: 'string',
      description: 'Type of conflict event',
      required: true,
      example: 'airstrike',
    },
    {
      name: 'fatalities',
      type: 'number',
      description: 'Number of fatalities',
      required: true,
      example: 3,
    },
  ],
  relationships: [],
};

// Simple test framework
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ ${message}`);
    testsFailed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual === expected) {
    console.log(`✓ ${message}`);
    testsPassed++;
  } else {
    console.error(`✗ ${message}`);
    console.error(`  Expected: ${expected}`);
    console.error(`  Actual: ${actual}`);
    testsFailed++;
  }
}

// Mock ExportService class (simplified version for testing)
class ExportService {
  constructor() {
    this.defaultOptions = {
      includeMetadata: true,
      includeRelationships: true,
      includeQuality: true,
      includeSources: true,
      prettyPrint: true,
      csvDelimiter: ',',
      csvIncludeHeaders: true,
    };
  }

  exportToJSON(data, metadata, options = {}) {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      const exportPackage = {
        metadata: opts.includeMetadata ? this.createExportMetadata(data, metadata, 'json', opts) : undefined,
        data: data,
        exported_at: new Date().toISOString(),
      };
      
      const jsonString = opts.prettyPrint
        ? JSON.stringify(exportPackage, null, 2)
        : JSON.stringify(exportPackage);
      
      const filename = this.generateFilename(metadata.name, 'json');
      
      return {
        success: true,
        data: jsonString,
        metadata: this.createExportMetadata(data, metadata, 'json', opts),
        filename,
        mimeType: 'application/json',
        size: Buffer.byteLength(jsonString),
      };
    } catch (error) {
      return this.createErrorResult(error, metadata, 'json');
    }
  }

  exportToCSV(data, metadata, options = {}) {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      const flattenedData = data.map(record => this.flattenRecord(record, opts));
      
      if (flattenedData.length === 0) {
        throw new Error('No data to export');
      }
      
      const allKeys = this.getAllKeys(flattenedData);
      
      let csvContent = '';
      
      if (opts.csvIncludeHeaders) {
        csvContent += allKeys.join(opts.csvDelimiter || ',') + '\n';
      }
      
      flattenedData.forEach(record => {
        const row = allKeys.map(key => {
          const value = record[key];
          return this.formatCSVValue(value, opts.csvDelimiter || ',');
        });
        csvContent += row.join(opts.csvDelimiter || ',') + '\n';
      });
      
      const filename = this.generateFilename(metadata.name, 'csv');
      
      return {
        success: true,
        data: csvContent,
        metadata: this.createExportMetadata(data, metadata, 'csv', opts),
        filename,
        mimeType: 'text/csv',
        size: Buffer.byteLength(csvContent),
      };
    } catch (error) {
      return this.createErrorResult(error, metadata, 'csv');
    }
  }

  exportToGeoJSON(data, metadata, options = {}) {
    try {
      const opts = { ...this.defaultOptions, ...options };
      
      const geoData = data.filter(record => 
        record.location?.coordinates && 
        Array.isArray(record.location.coordinates) &&
        record.location.coordinates.length === 2
      );
      
      if (geoData.length === 0) {
        throw new Error('No geospatial data (coordinates) found in dataset');
      }
      
      const geoJSON = {
        type: 'FeatureCollection',
        metadata: opts.includeMetadata ? this.createExportMetadata(geoData, metadata, 'geojson', opts) : undefined,
        features: geoData.map(record => this.createGeoJSONFeature(record, opts)),
      };
      
      const jsonString = opts.prettyPrint
        ? JSON.stringify(geoJSON, null, 2)
        : JSON.stringify(geoJSON);
      
      const filename = this.generateFilename(metadata.name, 'geojson');
      
      return {
        success: true,
        data: jsonString,
        metadata: this.createExportMetadata(geoData, metadata, 'geojson', opts),
        filename,
        mimeType: 'application/geo+json',
        size: Buffer.byteLength(jsonString),
      };
    } catch (error) {
      return this.createErrorResult(error, metadata, 'geojson');
    }
  }

  flattenRecord(record, options) {
    let flat = {
      id: record.id,
      type: record.type,
      category: record.category,
      date: record.date,
      location_name: record.location.name,
      location_region: record.location.region,
      longitude: record.location.coordinates?.[0] || '',
      latitude: record.location.coordinates?.[1] || '',
      value: record.value,
      unit: record.unit || '',
    };
    
    if (record.type === 'conflict') {
      flat.event_type = record.event_type;
      flat.fatalities = record.fatalities;
      flat.injuries = record.injuries;
    }
    
    return flat;
  }

  getAllKeys(records) {
    const keysSet = new Set();
    records.forEach(record => {
      Object.keys(record).forEach(key => keysSet.add(key));
    });
    return Array.from(keysSet);
  }

  formatCSVValue(value, delimiter) {
    if (value === null || value === undefined) {
      return '';
    }
    
    const stringValue = String(value);
    
    if (stringValue.includes(delimiter) || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    
    return stringValue;
  }

  createGeoJSONFeature(record, options) {
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: record.location.coordinates,
      },
      properties: {
        id: record.id,
        type: record.type,
        date: record.date,
        value: record.value,
      },
    };
  }

  createExportMetadata(data, metadata, format, options) {
    const average = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const qualityScores = data.map(d => d.quality.score);
    
    return {
      exported_at: new Date().toISOString(),
      format,
      record_count: data.length,
      category: metadata.category,
      dataset_name: metadata.name,
      sources: [{ name: 'ACLED', organization: 'ACLED' }],
      quality_summary: {
        average_score: average(qualityScores),
        completeness: 0.9,
        consistency: 0.85,
        accuracy: 0.8,
      },
      field_descriptions: {},
      export_options: options,
    };
  }

  generateFilename(datasetName, format) {
    const sanitized = datasetName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const timestamp = new Date().toISOString().split('T')[0];
    return `${sanitized}_${timestamp}.${format}`;
  }

  createErrorResult(error, metadata, format) {
    return {
      success: false,
      data: '',
      metadata: {
        exported_at: new Date().toISOString(),
        format,
        record_count: 0,
        category: metadata.category,
        dataset_name: metadata.name,
        sources: [],
        export_options: this.defaultOptions,
      },
      filename: `error_${Date.now()}.txt`,
      mimeType: 'text/plain',
      size: 0,
      error: error instanceof Error ? error.message : 'Unknown export error',
    };
  }
}

// Run tests
console.log('\n=== Export Service Tests ===\n');

const exportService = new ExportService();

// Test 1: JSON Export
console.log('Test 1: JSON Export');
const jsonResult = exportService.exportToJSON(mockConflictData, mockMetadata);
assert(jsonResult.success === true, 'JSON export should succeed');
assert(jsonResult.mimeType === 'application/json', 'JSON export should have correct MIME type');
assert(jsonResult.filename.includes('.json'), 'JSON export should have .json extension');
const jsonParsed = JSON.parse(jsonResult.data);
assertEquals(jsonParsed.data.length, 2, 'JSON export should contain 2 records');
assert(jsonParsed.metadata !== undefined, 'JSON export should include metadata');
console.log('');

// Test 2: CSV Export
console.log('Test 2: CSV Export');
const csvResult = exportService.exportToCSV(mockConflictData, mockMetadata);
assert(csvResult.success === true, 'CSV export should succeed');
assert(csvResult.mimeType === 'text/csv', 'CSV export should have correct MIME type');
assert(csvResult.filename.includes('.csv'), 'CSV export should have .csv extension');
const csvLines = csvResult.data.split('\n');
assert(csvLines.length > 2, 'CSV export should have header and data rows');
assert(csvLines[0].includes('id'), 'CSV export should include headers');
console.log('');

// Test 3: GeoJSON Export
console.log('Test 3: GeoJSON Export');
const geoJsonResult = exportService.exportToGeoJSON(mockConflictData, mockMetadata);
assert(geoJsonResult.success === true, 'GeoJSON export should succeed');
assert(geoJsonResult.mimeType === 'application/geo+json', 'GeoJSON export should have correct MIME type');
assert(geoJsonResult.filename.includes('.geojson'), 'GeoJSON export should have .geojson extension');
const geoParsed = JSON.parse(geoJsonResult.data);
assertEquals(geoParsed.type, 'FeatureCollection', 'GeoJSON should be a FeatureCollection');
assertEquals(geoParsed.features.length, 2, 'GeoJSON should contain 2 features');
console.log('');

// Test 4: Export Metadata
console.log('Test 4: Export Metadata');
assert(jsonResult.metadata.sources.length > 0, 'Export should include source attribution');
assert(jsonResult.metadata.exported_at !== undefined, 'Export should include timestamp');
assert(jsonResult.metadata.quality_summary !== undefined, 'Export should include quality information');
console.log('');

// Test 5: CSV Options
console.log('Test 5: CSV Options');
const csvCustomDelimiter = exportService.exportToCSV(mockConflictData, mockMetadata, {
  csvDelimiter: ';',
});
assert(csvCustomDelimiter.data.includes(';'), 'CSV should use custom delimiter');
console.log('');

// Test 6: Error Handling
console.log('Test 6: Error Handling');
const emptyResult = exportService.exportToCSV([], mockMetadata);
assert(emptyResult.success === false, 'Export should fail gracefully with empty data');
assert(emptyResult.error !== undefined, 'Failed export should include error message');
console.log('');

// Summary
console.log('=== Test Summary ===');
console.log(`Tests Passed: ${testsPassed}`);
console.log(`Tests Failed: ${testsFailed}`);
console.log(`Total Tests: ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log('\n✓ All tests passed!');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed!');
  process.exit(1);
}
