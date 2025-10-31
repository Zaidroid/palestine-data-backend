/**
 * Unified Data Pipeline
 * 
 * Provides a complete pipeline for transforming, enriching, validating,
 * and partitioning data from various sources.
 */

import { validateDataset } from './data-validator.js';
import { DataPartitioner } from './data-partitioner.js';
import { GeospatialEnricher } from './geospatial-enricher.js';
import { TemporalEnricher } from './temporal-enricher.js';
import { DataLinker } from './data-linker.js';

/**
 * Unified Data Pipeline
 * 
 * Orchestrates the complete data processing workflow:
 * 1. Transform raw data to unified format
 * 2. Enrich with geospatial and temporal context
 * 3. Validate data quality
 * 4. Link related data across datasets
 * 5. Partition large datasets
 */
export class UnifiedPipeline {
  constructor(options = {}) {
    this.partitioner = new DataPartitioner(options.partitionOptions);
    this.geospatialEnricher = new GeospatialEnricher();
    this.temporalEnricher = new TemporalEnricher(options.baselineDate);
    this.dataLinker = new DataLinker();
    this.logger = options.logger || console;
  }

  /**
   * Process data through the complete pipeline
   * 
   * @param {Object} rawData - Raw data from source
   * @param {Object} metadata - Dataset metadata
   * @param {Object} transformer - Transformer instance
   * @param {Object} options - Processing options
   * @returns {Object} Processed data with metadata
   */
  async process(rawData, metadata, transformer, options = {}) {
    const startTime = Date.now();
    const results = {
      success: false,
      transformed: null,
      enriched: null,
      validated: null,
      partitioned: null,
      errors: [],
      warnings: [],
      stats: {},
    };

    try {
      // Step 1: Transform
      await this.logger.info?.('🔄 Transforming data...');
      const transformed = transformer.transform(rawData, metadata);
      results.transformed = transformed;
      results.stats.recordCount = transformed.length;
      await this.logger.success?.(`Transformed ${transformed.length} records`);

      if (transformed.length === 0) {
        results.warnings.push('No records after transformation');
        return results;
      }

      // Step 2: Enrich
      if (options.enrich !== false) {
        await this.logger.info?.('✨ Enriching data...');
        const enriched = await this.enrichData(transformed, options);
        results.enriched = enriched;
        await this.logger.success?.('Data enriched');
      } else {
        results.enriched = transformed;
      }

      // Step 3: Validate
      if (options.validate !== false) {
        await this.logger.info?.('✅ Validating data...');
        const validation = await this.validateData(results.enriched, transformer.category);
        results.validated = validation;
        
        if (validation.meetsThreshold) {
          await this.logger.success?.(
            `Validation passed (score: ${(validation.qualityScore * 100).toFixed(1)}%)`
          );
        } else {
          await this.logger.warn?.(
            `Validation quality below threshold (score: ${(validation.qualityScore * 100).toFixed(1)}%)`
          );
        }

        if (validation.errors.length > 0) {
          results.warnings.push(`${validation.errors.length} validation errors`);
        }
      }

      // Step 4: Link related data (if other datasets provided)
      if (options.linkData && options.allDatasets) {
        await this.logger.info?.('🔗 Linking related data...');
        const linked = await this.linkData(results.enriched, options.allDatasets);
        results.enriched = linked;
        await this.logger.success?.('Data linked');
      }

      // Step 5: Partition (if needed)
      if (options.partition !== false && results.enriched.length > 1000) {
        await this.logger.info?.('📦 Partitioning data...');
        const partitionInfo = await this.partitionData(
          results.enriched,
          metadata.name || 'dataset',
          options.outputDir
        );
        results.partitioned = partitionInfo;
        await this.logger.success?.(
          `Partitioned into ${partitionInfo.partitionCount} partitions`
        );
      }

      results.success = true;
      results.stats.processingTime = Date.now() - startTime;

      return results;

    } catch (error) {
      results.errors.push({
        message: error.message,
        stack: error.stack,
      });
      await this.logger.error?.('Pipeline processing failed', error);
      return results;
    }
  }

  /**
   * Enrich data with geospatial and temporal context
   */
  async enrichData(data, options = {}) {
    let enriched = [...data];

    // Geospatial enrichment
    if (options.enrichGeospatial !== false) {
      enriched = enriched.map(record => {
        if (record.location) {
          const enrichedLocation = this.geospatialEnricher.enrichLocation(record.location);
          return { ...record, location: enrichedLocation };
        }
        return record;
      });
    }

    // Temporal enrichment
    if (options.enrichTemporal !== false) {
      enriched = enriched.map(record => {
        const temporalContext = this.temporalEnricher.enrichTemporal(record, enriched);
        return { ...record, ...temporalContext };
      });
    }

    // Category-specific enrichment (e.g., trend analysis for economic data)
    if (options.transformer && typeof options.transformer.enrich === 'function') {
      enriched = options.transformer.enrich(enriched);
    }

    return enriched;
  }

  /**
   * Validate data quality
   */
  async validateData(data, category) {
    return await validateDataset(data, category);
  }

  /**
   * Link related data across datasets
   */
  async linkData(data, allDatasets) {
    return this.dataLinker.linkRelatedData(data, allDatasets);
  }

  /**
   * Partition large datasets
   */
  async partitionData(data, datasetName, outputDir) {
    if (!outputDir) {
      throw new Error('Output directory required for partitioning');
    }

    return await this.partitioner.partitionDataset(data, datasetName, outputDir);
  }

  /**
   * Create a complete output package
   */
  createOutputPackage(results, metadata) {
    return {
      metadata: {
        ...metadata,
        processed_at: new Date().toISOString(),
        record_count: results.stats.recordCount,
        processing_time_ms: results.stats.processingTime,
      },
      data: results.enriched,
      validation: results.validated ? {
        qualityScore: results.validated.qualityScore,
        completeness: results.validated.completeness,
        consistency: results.validated.consistency,
        accuracy: results.validated.accuracy,
        meetsThreshold: results.validated.meetsThreshold,
        errorCount: results.validated.errors.length,
        warningCount: results.validated.warnings.length,
      } : null,
      partition_info: results.partitioned,
    };
  }
}

/**
 * Helper function to process data with a transformer
 * 
 * @param {Object} rawData - Raw data from source
 * @param {Object} metadata - Dataset metadata
 * @param {Object} transformer - Transformer instance
 * @param {Object} options - Processing options
 * @returns {Object} Processed data
 */
export async function processWithPipeline(rawData, metadata, transformer, options = {}) {
  const pipeline = new UnifiedPipeline(options);
  return await pipeline.process(rawData, metadata, transformer, options);
}

export default UnifiedPipeline;
