/**
 * Standardized Data Schema for Palestine Data Backend
 * 
 * This schema ensures consistency across all data sources (HDX, PCBS, UNRWA, WHO, World Bank, etc.)
 * Version: 1.0.0
 * Updated: 2025-10-31
 */

const standardizedSchema = {
  // Root level metadata structure
  metadata: {
    // Source identification
    source: {
      id: "string", // e.g., "hdx-ckan", "pcbs", "unrwa", "worldbank"
      name: "string", // Human readable name
      organization: "string", // Data provider organization
      api_endpoint: "string", // API endpoint if available
      documentation_url: "string" // Link to source documentation
    },
    
    // Dataset information
    dataset: {
      id: "string", // Unique dataset identifier
      name: "string", // Dataset name/filename
      title: "string", // Human readable title
      description: "string", // Detailed description
      category: "string", // Primary category (conflict, education, health, etc.)
      subcategory: "string", // Secondary categorization
      tags: ["string"], // Array of relevant tags
      license: "string", // Data license information
      keywords: ["string"], // Searchable keywords
      language: "string", // Primary language of data
      coverage: {
        geographic: "string", // Geographic coverage
        temporal: {
          start_date: "string", // ISO date format
          end_date: "string", // ISO date format
          frequency: "string" // Update frequency (daily, monthly, yearly, etc.)
        }
      }
    },
    
    // Quality and reliability
    quality: {
      completeness: "number", // 0-1 score
      accuracy: "number", // 0-1 score
      timeliness: "number", // 0-1 score
      reliability: "number", // 0-1 score
      validation_errors: "number", // Count of validation issues
      last_validated: "string", // ISO timestamp
      validation_details: {
        schema_compliance: "number", // 0-1
        data_integrity: "number", // 0-1
        cross_reference_consistency: "number", // 0-1
        missing_data_percentage: "number" // 0-100
      }
    },
    
    // Processing information
    processing: {
      extracted_at: "string", // ISO timestamp when data was extracted
      transformed_at: "string", // ISO timestamp when data was transformed
      validated_at: "string", // ISO timestamp when data was validated
      pipeline_version: "string", // Version of processing pipeline
      transformation_steps: ["string"], // Array of transformation steps applied
      data_format_version: "string", // Version of this schema
      record_count: "number", // Total number of records
      partition_info: {
        is_partitioned: "boolean",
        partition_count: "number",
        partition_strategy: "string" // e.g., "yearly", "monthly", "by_region"
      }
    },
    
    // Relationships and context
    relationships: {
      related_datasets: ["string"], // Array of related dataset IDs
      parent_dataset: "string", // ID of parent dataset if this is a partition
      child_datasets: ["string"], // IDs of child datasets if any
      external_references: [
        {
          source: "string",
          reference_id: "string",
          reference_url: "string"
        }
      ]
    },
    
    // Palestine-specific context
    palestine_context: {
      regions_covered: ["string"], // Array of regions (Gaza, West Bank, etc.)
      governorates: ["string"], // Array of governorates
      demographic_breakdown: "boolean", // Whether data includes demographic breakdowns
      conflict_related: "boolean", // Whether data is conflict-related
      humanitarian_relevance: "number", // 0-1 relevance score
      baseline_available: "boolean", // Whether baseline comparison is available
      baseline_date: "string" // ISO date of baseline if available
    }
  },

  // Data structure - standardized records
  data_structure: {
    // All data records should follow this pattern
    records: [
      {
        // Required identification
        id: "string", // Unique record identifier
        dataset_id: "string", // Reference to dataset
        source_record_id: "string", // Original source record ID
        
        // Temporal information
        date: {
          recorded: "string", // ISO date when data was recorded
          start_date: "string", // Start of period covered
          end_date: "string", // End of period covered
          is_single_date: "boolean", // Whether this is a single point in time
          period_type: "string" // "daily", "monthly", "yearly", "cumulative"
        },
        
        // Geographic information
        location: {
          country: "string",
          region: "string", // Gaza, West Bank, etc.
          governorate: "string",
          city: "string",
          coordinates: {
            latitude: "number",
            longitude: "number"
          },
          administrative_level: "string" // "country", "region", "governorate", "city"
        },
        
        // Demographic breakdowns (when applicable)
        demographics: {
          gender: "string", // "male", "female", "combined"
          age_group: "string", // Age range or category
          population_type: "string" // "general", "refugee", "idp", etc.
        },
        
        // Data values - flexible structure for different data types
        values: {
          primary_value: "number|string|boolean", // Main data value
          unit: "string", // Unit of measurement
          original_value: "string", // Value as it appeared in source
          original_unit: "string", // Original unit if different
          confidence_interval: {
            lower: "number",
            upper: "number"
          },
          uncertainty: "string", // Description of uncertainty
          normalized_value: "number", // Value normalized to standard units
          rate_per_population: "number" // Rate per 1000/10000/100000 population
        },
        
        // Data source and methodology
        methodology: {
          collection_method: "string", // How data was collected
          sample_size: "number",
          margin_of_error: "number",
          methodology_notes: "string",
          data_source_type: "string" // "survey", "administrative", "satellite", etc.
        },
        
        // Validation and quality flags
        validation: {
          is_validated: "boolean",
          validation_date: "string",
          quality_score: "number", // 0-1
          flags: ["string"], // Array of quality flags
          notes: "string"
        },
        
        // Additional metadata
        metadata: {
          category_specific: "object", // Category-specific fields
          custom_fields: "object", // Additional custom fields
          notes: "string", // Additional notes
          confidential: "boolean", // Whether data is confidential
          published: "boolean" // Whether this record is published
        }
      }
    ]
  },

  // Validation schemas for different data types
  validation_schemas: {
    // Time series validation
    time_series: {
      required_fields: ["id", "date", "values", "location"],
      date_validation: {
        format: "ISO 8601",
        range_check: true,
        continuity_check: true
      },
      value_validation: {
        type_check: true,
        range_check: true,
        outlier_detection: true
      }
    },
    
    // Geographic data validation
    geographic: {
      required_fields: ["id", "location", "values"],
      coordinate_validation: {
        bounds_check: {
          lat: { min: 31.2, max: 33.5 }, // Palestine bounds
          lng: { min: 34.2, max: 35.9 }
        },
        administrative_boundaries: true
      }
    },
    
    // Demographic data validation
    demographic: {
      required_fields: ["id", "demographics", "values"],
      population_validation: {
        total_check: true,
        gender_ratio_check: true,
        age_distribution_check: true
      }
    }
  },

  // Category-specific schemas
  category_schemas: {
    conflict: {
      specific_fields: {
        incident_type: "string",
        severity_level: "number",
        casualties: {
          killed: "number",
          wounded: "number",
          missing: "number"
        },
        involved_parties: ["string"],
        weapons_used: ["string"],
        location_precision: "string"
      }
    },
    
    health: {
      specific_fields: {
        disease_condition: "string",
        affected_population: "number",
        health_facility_type: "string",
        medical_supply_status: "string",
        outbreak_status: "string"
      }
    },
    
    education: {
      specific_fields: {
        education_level: "string", // primary, secondary, tertiary
        school_type: "string", // public, private, UNRWA
        enrollment_count: "number",
        dropout_rate: "number",
        infrastructure_status: "string"
      }
    },
    
    humanitarian: {
      specific_fields: {
        aid_type: "string",
        beneficiary_count: "number",
        assistance_category: "string",
        delivery_status: "string",
        funding_source: "string"
      }
    },
    
    infrastructure: {
      specific_fields: {
        facility_type: "string",
        damage_level: "number",
        repair_status: "string",
        capacity: "number",
        operational_status: "string"
      }
    },
    
    refugees: {
      specific_fields: {
        registration_status: "string",
        camp_name: "string",
        family_size: "number",
        displacement_type: "string",
        assistance_received: ["string"]
      }
    },
    
    water: {
      specific_fields: {
        water_source: "string",
        quality_level: "string",
        access_type: "string",
        scarcity_level: "string",
        contamination_status: "string"
      }
    },
    
    economic: {
      specific_fields: {
        economic_indicator: "string",
        currency: "string",
        inflation_adjusted: "boolean",
        seasonal_adjustment: "boolean",
        market_sector: "string"
      }
    }
  }
};

// Export utilities for working with the schema
const schemaUtils = {
  /**
   * Validate a dataset against the standardized schema
   */
  validateDataset: (dataset, schema = standardizedSchema) => {
    const errors = [];
    const warnings = [];
    
    // Check required metadata fields
    const requiredMetadataFields = ['source', 'dataset', 'quality', 'processing'];
    requiredMetadataFields.forEach(field => {
      if (!dataset.metadata || !dataset.metadata[field]) {
        errors.push(`Missing required metadata field: ${field}`);
      }
    });
    
    // Check data structure
    if (!dataset.data_structure || !dataset.data_structure.records) {
      errors.push('Missing data_structure.records');
    } else {
      const records = dataset.data_structure.records;
      if (records.length === 0) {
        warnings.push('Dataset contains no records');
      }
      
      // Validate record structure
      records.forEach((record, index) => {
        if (!record.id) {
          errors.push(`Record ${index}: Missing required field 'id'`);
        }
        if (!record.date) {
          errors.push(`Record ${index}: Missing required field 'date'`);
        }
        if (!record.values) {
          errors.push(`Record ${index}: Missing required field 'values'`);
        }
      });
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      score: Math.max(0, 1 - (errors.length * 0.1) - (warnings.length * 0.05))
    };
  },

  /**
   * Transform existing dataset to standardized format
   */
  transformToStandard: (sourceData, sourceType) => {
    const transformers = {
      'hdx-ckan': transformHDXData,
      'pcbs': transformPCBSData,
      'unrwa': transformUNRWAData,
      'worldbank': transformWorldBankData
    };
    
    const transformer = transformers[sourceType];
    if (!transformer) {
      throw new Error(`No transformer available for source type: ${sourceType}`);
    }
    
    return transformer(sourceData);
  },

  /**
   * Get category-specific schema
   */
  getCategorySchema: (category) => {
    return standardizedSchema.category_schemas[category] || null;
  },

  /**
   * Merge data from multiple sources while preserving standardized structure
   */
  mergeDatasets: (datasets) => {
    // Implementation for merging multiple datasets
    const merged = {
      metadata: {
        sources: datasets.map(d => d.metadata.source),
        combined_at: new Date().toISOString(),
        record_count: datasets.reduce((sum, d) => sum + (d.data_structure?.records?.length || 0), 0)
      },
      data_structure: {
        records: []
      }
    };
    
    datasets.forEach(dataset => {
      if (dataset.data_structure && dataset.data_structure.records) {
        merged.data_structure.records.push(...dataset.data_structure.records);
      }
    });
    
    return merged;
  }
};

// Transformer stub functions (to be implemented)
function transformHDXData(data) {
  // TODO: Implement HDX data transformation
  return data;
}

function transformPCBSData(data) {
  // TODO: Implement PCBS data transformation
  return data;
}

function transformUNRWAData(data) {
  // TODO: Implement UNRWA data transformation
  return data;
}

function transformWorldBankData(data) {
  // TODO: Implement World Bank data transformation
  return data;
}

export { standardizedSchema, schemaUtils };
export default standardizedSchema;
