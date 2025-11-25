/**
 * Data Validation Utility
 * 
 * Provides comprehensive data validation, quality scoring, and schema validation
 * for all data sources (HDX, Good Shepherd, World Bank)
 */

import { createLogger } from './logger.js';

const logger = createLogger({ context: 'DataValidator' });

/**
 * Validation schemas for different dataset types
 */
export const VALIDATION_SCHEMAS = {
  casualties: {
    requiredFields: ['date', 'killed', 'injured'],
    optionalFields: ['location', 'region', 'incident_type', 'source'],
    fieldTypes: {
      date: 'string',
      killed: 'number',
      injured: 'number',
      location: 'object',
      region: 'string',
      incident_type: 'string',
      source: 'string',
    },
    numericRanges: {
      killed: { min: 0, max: 100000 },
      injured: { min: 0, max: 500000 },
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  demolitions: {
    requiredFields: ['date', 'location', 'structures'],
    optionalFields: ['structure_type', 'people_affected', 'reason', 'demolished_by', 'region'],
    fieldTypes: {
      date: 'string',
      location: 'object',
      structures: 'number',
      structure_type: 'string',
      people_affected: 'number',
      reason: 'string',
      demolished_by: 'string',
      region: 'string',
    },
    numericRanges: {
      structures: { min: 0, max: 10000 },
      people_affected: { min: 0, max: 100000 },
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  healthcare: {
    requiredFields: ['date'],
    optionalFields: ['facility_name', 'incident_type', 'facility_type', 'location', 'casualties', 'damage_level', 'region'],
    fieldTypes: {
      date: 'string',
      facility_name: 'string',
      incident_type: 'string',
      facility_type: 'string',
      location: 'object',
      casualties: 'number',
      damage_level: 'string',
      region: 'string',
    },
    numericRanges: {
      casualties: { min: 0, max: 10000 },
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
    enumValues: {
      facility_type: ['hospital', 'clinic', 'pharmacy', 'ambulance', 'medical_center', 'health_facility'],
      damage_level: ['destroyed', 'damaged', 'minor', 'severe', 'unknown'],
    },
  },

  ngo: {
    requiredFields: ['name', 'type'],
    optionalFields: ['sector', 'funding', 'funding_year', 'location', 'beneficiaries'],
    fieldTypes: {
      name: 'string',
      type: 'string',
      sector: 'array',
      funding: 'number',
      funding_year: 'number',
      location: 'object',
      beneficiaries: 'number',
    },
    numericRanges: {
      funding: { min: 0, max: 1000000000 },
      funding_year: { min: 1990, max: 2030 },
      beneficiaries: { min: 0, max: 10000000 },
    },
  },

  worldbank: {
    requiredFields: ['year', 'value', 'country'],
    optionalFields: ['countryiso3code', 'indicator', 'unit'],
    fieldTypes: {
      year: 'number',
      value: 'number',
      country: 'string',
      countryiso3code: 'string',
      indicator: 'string',
      unit: 'string',
    },
    numericRanges: {
      year: { min: 1960, max: 2030 },
    },
  },

  conflict: {
    requiredFields: ['date', 'event_type', 'location'],
    optionalFields: ['fatalities', 'region', 'actor1', 'actor2', 'notes', 'source'],
    fieldTypes: {
      date: 'string',
      event_type: 'string',
      location: 'object',
      fatalities: 'number',
      region: 'string',
      actor1: 'string',
      actor2: 'string',
      notes: 'string',
      source: 'string',
    },
    numericRanges: {
      fatalities: { min: 0, max: 100000 },
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  infrastructure: {
    requiredFields: ['date', 'metrics', 'status'],
    optionalFields: ['location', 'region', 'value', 'unit'],
    fieldTypes: {
      date: 'string',
      metrics: 'object',
      status: 'string',
      location: 'object',
      region: 'string',
      value: 'number',
      unit: 'string',
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  water: {
    requiredFields: ['date', 'value', 'unit'],
    optionalFields: ['location', 'indicator', 'status', 'source_dataset'],
    fieldTypes: {
      date: 'string',
      value: 'number',
      unit: 'string',
      location: 'object',
      indicator: 'object',
      status: 'string',
      source_dataset: 'string',
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  humanitarian: {
    requiredFields: ['date', 'value'],
    optionalFields: ['indicator', 'region', 'category', 'unit', 'source'],
    fieldTypes: {
      date: 'string',
      indicator: 'string',
      value: 'number',
      region: 'string',
      category: 'string',
      unit: 'string',
      source: 'string',
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  news: {
    requiredFields: ['title', 'date', 'link'],
    optionalFields: ['description', 'source', 'category', 'language', 'reliability', 'location'],
    fieldTypes: {
      title: 'string',
      date: 'string',
      link: 'string',
      description: 'string',
      source: 'string',
      category: 'string',
      language: 'string',
      reliability: 'string',
      location: 'string',
    },
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },

  // Generic schema for unknown dataset types
  generic: {
    requiredFields: [],
    optionalFields: [],
    fieldTypes: {},
    numericRanges: {},
    dateFormats: ['YYYY-MM-DD', 'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm:ss.sssZ'],
  },
};

/**
 * Quality thresholds for validation
 */
export const QUALITY_THRESHOLDS = {
  completeness: 0.95,  // 95% of required fields must be present
  consistency: 0.90,   // 90% of records must have valid formats
  accuracy: 0.85,      // 85% must pass validation rules
  overall: 0.90,       // 90% overall quality score
};

/**
 * Validate date format
 */
function isValidDate(dateString, formats) {
  if (!dateString || typeof dateString !== 'string') {
    return false;
  }

  // ISO 8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3}Z?)?)?$/;

  if (!isoDateRegex.test(dateString)) {
    return false;
  }

  // Try to parse the date
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * Validate field type
 */
function validateFieldType(value, expectedType) {
  if (value === null || value === undefined) {
    return false;
  }

  switch (expectedType) {
    case 'string':
      return typeof value === 'string' && value.trim().length > 0;
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Validate numeric range
 */
function validateNumericRange(value, range) {
  if (typeof value !== 'number' || isNaN(value)) {
    return false;
  }

  if (range.min !== undefined && value < range.min) {
    return false;
  }

  if (range.max !== undefined && value > range.max) {
    return false;
  }

  return true;
}

/**
 * Validate enum value
 */
function validateEnumValue(value, allowedValues) {
  if (!value) return false;
  return allowedValues.includes(value.toLowerCase());
}

/**
 * Validate data structure against schema
 * 
 * @param {Array} data - Array of data records
 * @param {Object} schema - Validation schema
 * @returns {Object} - Validation result
 */
export function validateDataStructure(data, schema) {
  const errors = [];
  const warnings = [];
  let validRecords = 0;

  if (!Array.isArray(data)) {
    errors.push({
      field: 'root',
      message: 'Data must be an array',
      severity: 'critical',
      affectedRecords: 0,
    });

    return {
      isValid: false,
      errors,
      warnings,
      qualityScore: 0,
      validRecords: 0,
      totalRecords: 0,
    };
  }

  if (data.length === 0) {
    warnings.push({
      field: 'root',
      message: 'Data array is empty',
      severity: 'warning',
      affectedRecords: 0,
    });
  }

  // Validate each record
  data.forEach((record, index) => {
    let recordValid = true;

    // Check required fields
    schema.requiredFields.forEach(field => {
      if (!(field in record) || record[field] === null || record[field] === undefined) {
        errors.push({
          field,
          message: `Missing required field: ${field}`,
          severity: 'error',
          affectedRecords: 1,
          recordIndex: index,
        });
        recordValid = false;
      }
    });

    // Check field types
    Object.keys(schema.fieldTypes).forEach(field => {
      if (field in record && record[field] !== null && record[field] !== undefined) {
        const expectedType = schema.fieldTypes[field];
        if (!validateFieldType(record[field], expectedType)) {
          errors.push({
            field,
            message: `Invalid type for field ${field}: expected ${expectedType}, got ${typeof record[field]}`,
            severity: 'error',
            affectedRecords: 1,
            recordIndex: index,
          });
          recordValid = false;
        }
      }
    });

    // Check numeric ranges
    if (schema.numericRanges) {
      Object.keys(schema.numericRanges).forEach(field => {
        if (field in record && record[field] !== null && record[field] !== undefined) {
          const range = schema.numericRanges[field];
          if (!validateNumericRange(record[field], range)) {
            warnings.push({
              field,
              message: `Value out of range for ${field}: ${record[field]} (expected ${range.min}-${range.max})`,
              severity: 'warning',
              affectedRecords: 1,
              recordIndex: index,
            });
          }
        }
      });
    }

    // Check date formats
    if (schema.dateFormats && 'date' in record) {
      if (!isValidDate(record.date, schema.dateFormats)) {
        errors.push({
          field: 'date',
          message: `Invalid date format: ${record.date}`,
          severity: 'error',
          affectedRecords: 1,
          recordIndex: index,
        });
        recordValid = false;
      }
    }

    // Check enum values
    if (schema.enumValues) {
      Object.keys(schema.enumValues).forEach(field => {
        if (field in record && record[field] !== null && record[field] !== undefined) {
          const allowedValues = schema.enumValues[field];
          if (!validateEnumValue(record[field], allowedValues)) {
            warnings.push({
              field,
              message: `Invalid enum value for ${field}: ${record[field]} (expected one of: ${allowedValues.join(', ')})`,
              severity: 'warning',
              affectedRecords: 1,
              recordIndex: index,
            });
          }
        }
      });
    }

    if (recordValid) {
      validRecords++;
    }
  });

  const qualityScore = data.length > 0 ? (validRecords / data.length) : 0;

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    qualityScore,
    validRecords,
    totalRecords: data.length,
  };
}

/**
 * Validate data completeness
 * 
 * @param {Array} data - Array of data records
 * @param {Array} requiredFields - List of required fields
 * @returns {Object} - Completeness result
 */
export function validateDataCompleteness(data, requiredFields) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      completeness: 0,
      missingFields: {},
      totalRecords: 0,
      completeRecords: 0,
    };
  }

  const missingFields = {};
  let completeRecords = 0;

  requiredFields.forEach(field => {
    missingFields[field] = 0;
  });

  data.forEach(record => {
    let recordComplete = true;

    requiredFields.forEach(field => {
      if (!(field in record) || record[field] === null || record[field] === undefined || record[field] === '') {
        missingFields[field]++;
        recordComplete = false;
      }
    });

    if (recordComplete) {
      completeRecords++;
    }
  });

  const completeness = data.length > 0 ? (completeRecords / data.length) : 0;

  return {
    completeness,
    missingFields,
    totalRecords: data.length,
    completeRecords,
  };
}

/**
 * Calculate data quality score
 * 
 * @param {Array} data - Array of data records
 * @param {Object} schema - Validation schema
 * @returns {Object} - Quality result
 */
export function validateDataQuality(data, schema) {
  // Validate structure
  const structureResult = validateDataStructure(data, schema);

  // Validate completeness
  const completenessResult = validateDataCompleteness(data, schema.requiredFields);

  // Calculate consistency score (% of records with valid formats)
  const consistency = structureResult.qualityScore;

  // Calculate accuracy score (% of records passing all validation rules)
  const accuracy = structureResult.validRecords / Math.max(data.length, 1);

  // Calculate overall quality score (weighted average)
  const overallScore = (
    completenessResult.completeness * 0.4 +  // 40% weight on completeness
    consistency * 0.3 +                       // 30% weight on consistency
    accuracy * 0.3                            // 30% weight on accuracy
  );

  return {
    completeness: completenessResult.completeness,
    consistency,
    accuracy,
    overallScore,
    details: {
      structure: structureResult,
      completeness: completenessResult,
    },
    meetsThreshold: overallScore >= QUALITY_THRESHOLDS.overall,
  };
}

/**
 * Get schema for dataset type
 * 
 * @param {string} datasetType - Type of dataset
 * @returns {Object} - Validation schema
 */
export function getSchemaForDatasetType(datasetType) {
  if (!datasetType) {
    logger.warn('No dataset type provided, using generic schema');
    return VALIDATION_SCHEMAS.generic;
  }

  const normalizedType = datasetType.toLowerCase();

  if (VALIDATION_SCHEMAS[normalizedType]) {
    return VALIDATION_SCHEMAS[normalizedType];
  }

  // Try to match partial type names
  for (const [schemaType, schema] of Object.entries(VALIDATION_SCHEMAS)) {
    if (normalizedType.includes(schemaType) || schemaType.includes(normalizedType)) {
      return schema;
    }
  }

  // Return generic schema if no match found
  logger.warn(`No specific schema found for dataset type: ${datasetType}, using generic schema`);
  return VALIDATION_SCHEMAS.generic;
}

/**
 * Validate dataset with automatic schema detection
 * 
 * @param {Array} data - Array of data records
 * @param {string} datasetType - Type of dataset
 * @returns {Object} - Validation result
 */
export async function validateDataset(data, datasetType) {
  await logger.info(`Validating dataset: ${datasetType} (${data.length} records)`);

  const schema = getSchemaForDatasetType(datasetType);
  const qualityResult = validateDataQuality(data, schema);

  // Log validation results
  if (qualityResult.meetsThreshold) {
    await logger.success(`Dataset ${datasetType} passed validation (score: ${(qualityResult.overallScore * 100).toFixed(1)}%)`);
  } else {
    await logger.warn(`Dataset ${datasetType} quality below threshold (score: ${(qualityResult.overallScore * 100).toFixed(1)}%)`);
  }

  // Log errors and warnings
  if (qualityResult.details.structure.errors.length > 0) {
    await logger.warn(`Found ${qualityResult.details.structure.errors.length} validation errors in ${datasetType}`);
  }

  if (qualityResult.details.structure.warnings.length > 0) {
    await logger.debug(`Found ${qualityResult.details.structure.warnings.length} validation warnings in ${datasetType}`);
  }

  return {
    datasetType,
    recordCount: data.length,
    qualityScore: qualityResult.overallScore,
    completeness: qualityResult.completeness,
    consistency: qualityResult.consistency,
    accuracy: qualityResult.accuracy,
    meetsThreshold: qualityResult.meetsThreshold,
    errors: qualityResult.details.structure.errors,
    warnings: qualityResult.details.structure.warnings,
    missingFields: qualityResult.details.completeness.missingFields,
    timestamp: new Date().toISOString(),
  };
}

export default {
  validateDataStructure,
  validateDataCompleteness,
  validateDataQuality,
  validateDataset,
  getSchemaForDatasetType,
  VALIDATION_SCHEMAS,
  QUALITY_THRESHOLDS,
};
