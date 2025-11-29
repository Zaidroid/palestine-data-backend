/**
 * Data Validator Utility
 * 
 * Validates datasets against specific schemas.
 * Supports: healthcare, demolitions, casualties, ngo, prisoners
 */

const SCHEMAS = {
  healthcare: {
    required: ['date', 'facility_name', 'facility_type'],
    optional: ['location', 'incident_type', 'casualties', 'latitude', 'longitude'],
    types: {
      date: 'string',
      casualties: 'object'
    }
  },
  demolitions: {
    required: ['date', 'location', 'homes_demolished'],
    optional: ['people_affected', 'reason', 'structure_type'],
    types: {
      date: 'string',
      homes_demolished: 'number'
    }
  },
  casualties: {
    required: ['date', 'killed', 'injured'],
    optional: ['location', 'incident_type', 'description'],
    types: {
      date: 'string',
      killed: 'number',
      injured: 'number'
    }
  },
  prisoners: {
    required: ['date'],
    optional: ['detained', 'location', 'prison', 'age', 'gender', 'status', 'killed', 'injured'],
    types: {
      date: 'string'
    }
  },
  ngo: {
    required: ['name', 'filing_year'],
    optional: ['ein', 'total_revenue', 'total_assets', 'total_expenses'],
    types: {
      filing_year: 'number'
    }
  },
  worldbank: {
    required: ['year', 'value', 'indicator'],
    optional: ['indicator_name', 'country', 'source'],
    types: {
      year: 'number',
      value: 'number',
      indicator: 'string'
    }
  },
  economic: {
    required: ['year', 'value'],
    optional: ['indicator', 'indicator_name', 'country', 'region', 'source', 'unit'],
    types: {
      year: 'number',
      value: 'number'
    }
  },
  statistical: {
    required: ['date', 'value'],
    optional: ['indicator', 'region', 'source', 'unit', 'category'],
    types: {
      date: 'string',
      value: 'number'
    }
  },
  generic: {
    required: ['id'],
    optional: ['date', 'value'],
    types: {}
  }
};

export async function validateDataset(dataset, schemaName = 'generic') {
  const schema = SCHEMAS[schemaName] || SCHEMAS.generic;
  const errors = [];
  const warnings = [];
  let validCount = 0;

  if (!Array.isArray(dataset)) {
    return {
      meetsThreshold: false,
      qualityScore: 0,
      completeness: 0,
      errors: [{ message: 'Dataset is not an array' }],
      warnings: []
    };
  }

  dataset.forEach((record, index) => {
    let isValid = true;
    const recordErrors = [];

    // Check required fields
    for (const field of schema.required) {
      if (record[field] === undefined || record[field] === null || record[field] === '') {
        isValid = false;
        recordErrors.push({ field, message: `Missing required field: ${field}`, recordIndex: index });
      }
    }

    // Check types
    for (const [field, type] of Object.entries(schema.types)) {
      if (record[field] !== undefined && record[field] !== null) {
        if (typeof record[field] !== type) {
          // Allow string dates to pass as 'string' check, but maybe add date validation later
          isValid = false;
          recordErrors.push({ field, message: `Invalid type for field ${field}: expected ${type}, got ${typeof record[field]}`, recordIndex: index });
        }
      }
    }

    if (isValid) {
      validCount++;
    } else {
      errors.push(...recordErrors);
    }
  });

  const qualityScore = dataset.length > 0 ? validCount / dataset.length : 0;
  const completeness = 1; // Placeholder

  return {
    meetsThreshold: qualityScore > 0.8,
    qualityScore,
    completeness,
    errors,
    warnings
  };
}
