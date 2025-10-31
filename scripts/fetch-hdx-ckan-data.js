#!/usr/bin/env node

/**
 * HDX CKAN Data Fetcher
 * 
 * Fetches data from HDX CKAN API (public, no auth required)
 * Focuses on Palestine-related datasets
 * 
 * Usage: node scripts/fetch-hdx-ckan-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry, createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import { createLogger } from './utils/logger.js';
import { validateDataset } from './utils/data-validator.js';
import { downloadAndExtractZip, parseExtractedFile } from './utils/zip-extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logger
const logger = createLogger({ 
  context: 'HDX-Fetcher',
  logLevel: 'INFO',
});

// Configuration
const HDX_CKAN_BASE = 'https://data.humdata.org/api/3/action';
const DATA_DIR = path.join(__dirname, '../public/data/hdx');
const BASELINE_DATE = '2023-10-07';
const RATE_LIMIT_DELAY = 1100; // 1.1 seconds

// Priority HDX Datasets Configuration (80+ datasets across categories)
const PRIORITY_HDX_DATASETS = {
  // Expanded Conflict (15 datasets - 7 new)
  conflict: [
    { id: 'acled-data-for-palestine', name: 'ACLED Conflict Data', priority: 1 },
    { id: 'violent-events-in-palestine', name: 'Violent Events Palestine', priority: 2 },
    { id: 'conflict-incidents-gaza-strip', name: 'Gaza Conflict Incidents', priority: 3 },
    { id: 'west-bank-violence-incidents', name: 'West Bank Violence', priority: 4 },
    { id: 'settler-violence-incidents', name: 'Settler Violence Data', priority: 5 },
    { id: 'military-operations-palestine', name: 'Military Operations', priority: 6 },
    { id: 'armed-clashes-palestine', name: 'Armed Clashes Data', priority: 7 },
    { id: 'protest-events-palestine', name: 'Protest Events', priority: 8 },
    { id: 'detention-arrests-data-palestine', name: 'Detention & Arrests', priority: 9 },
    { id: 'home-raids-incidents-palestine', name: 'Home Raids', priority: 10 },
    { id: 'live-ammunition-use-palestine', name: 'Live Ammunition Use', priority: 11 },
    { id: 'tear-gas-incidents-palestine', name: 'Tear Gas Incidents', priority: 12 },
    { id: 'checkpoint-closures-palestine', name: 'Checkpoint Closures', priority: 13 },
    { id: 'explosive-remnants-war-palestine', name: 'Explosive Remnants', priority: 14 },
    { id: 'civilian-casualties-detailed-palestine', name: 'Detailed Civilian Casualties', priority: 15 },
  ],
  
  // Expanded Education (8 datasets - 3 new)
  education: [
    { id: 'education-facilities-palestine', name: 'Education Facilities', priority: 1 },
    { id: 'school-damage-assessment-gaza', name: 'School Damage Gaza', priority: 2 },
    { id: 'education-access-west-bank', name: 'Education Access WB', priority: 3 },
    { id: 'student-enrollment-palestine', name: 'Student Enrollment', priority: 4 },
    { id: 'education-infrastructure-damage', name: 'Education Infrastructure', priority: 5 },
    { id: 'teacher-casualties-palestine', name: 'Teacher Casualties', priority: 6 },
    { id: 'education-funding-palestine', name: 'Education Funding', priority: 7 },
    { id: 'school-attendance-rates-palestine', name: 'School Attendance', priority: 8 },
  ],
  
  // Expanded Water (7 datasets - 3 new)
  water: [
    { id: 'water-sanitation-access-palestine', name: 'Water Access', priority: 1 },
    { id: 'water-infrastructure-damage-gaza', name: 'Water Infrastructure', priority: 2 },
    { id: 'wash-facilities-palestine', name: 'WASH Facilities', priority: 3 },
    { id: 'water-quality-monitoring', name: 'Water Quality', priority: 4 },
    { id: 'water-network-damage-palestine', name: 'Water Network Damage', priority: 5 },
    { id: 'sewage-system-status-palestine', name: 'Sewage System Status', priority: 6 },
    { id: 'water-trucking-operations-palestine', name: 'Water Trucking', priority: 7 },
  ],
  
  // Expanded Infrastructure (10 datasets - 4 new)
  infrastructure: [
    { id: 'infrastructure-damage-assessment-gaza', name: 'Infrastructure Damage', priority: 1 },
    { id: 'building-destruction-data-palestine', name: 'Building Destruction', priority: 2 },
    { id: 'critical-infrastructure-status', name: 'Critical Infrastructure', priority: 3 },
    { id: 'roads-bridges-damage', name: 'Roads & Bridges', priority: 4 },
    { id: 'electricity-infrastructure', name: 'Electricity Grid', priority: 5 },
    { id: 'telecommunications-infrastructure', name: 'Telecom Infrastructure', priority: 6 },
    { id: 'public-buildings-damage-palestine', name: 'Public Buildings Damage', priority: 7 },
    { id: 'industrial-facilities-damage-palestine', name: 'Industrial Facilities', priority: 8 },
    { id: 'agricultural-infrastructure-palestine', name: 'Agricultural Infrastructure', priority: 9 },
    { id: 'cultural-heritage-damage-palestine', name: 'Cultural Heritage Damage', priority: 10 },
  ],
  
  refugees: [
    { id: 'refugee-statistics-palestine', name: 'Refugee Statistics', priority: 1 },
    { id: 'displacement-tracking-gaza', name: 'Displacement Tracking', priority: 2 },
    { id: 'idp-data-palestine', name: 'IDP Data', priority: 3 },
    { id: 'refugee-camp-populations', name: 'Refugee Camps', priority: 4 },
    { id: 'displacement-movements', name: 'Displacement Movements', priority: 5 },
  ],
  
  humanitarian: [
    { id: 'humanitarian-needs-overview-palestine', name: 'Humanitarian Needs', priority: 1 },
    { id: 'humanitarian-response-plan', name: 'Response Plan', priority: 2 },
    { id: 'aid-delivery-tracking', name: 'Aid Delivery', priority: 3 },
    { id: 'humanitarian-access-constraints', name: 'Access Constraints', priority: 4 },
    { id: 'protection-concerns-palestine', name: 'Protection Concerns', priority: 5 },
    { id: 'humanitarian-funding-palestine', name: 'Humanitarian Funding', priority: 6 },
  ],
  
  // NEW: Health Category (15 datasets)
  health: [
    { id: 'health-facilities-status-palestine', name: 'Health Facilities Status', priority: 1 },
    { id: 'medical-supplies-availability-gaza', name: 'Medical Supplies Gaza', priority: 2 },
    { id: 'healthcare-worker-casualties-palestine', name: 'Healthcare Worker Casualties', priority: 3 },
    { id: 'ambulance-attacks-palestine', name: 'Ambulance Attacks', priority: 4 },
    { id: 'hospital-bed-capacity-palestine', name: 'Hospital Bed Capacity', priority: 5 },
    { id: 'disease-surveillance-palestine', name: 'Disease Surveillance', priority: 6 },
    { id: 'vaccination-coverage-palestine', name: 'Vaccination Coverage', priority: 7 },
    { id: 'maternal-health-services-palestine', name: 'Maternal Health Services', priority: 8 },
    { id: 'mental-health-services-palestine', name: 'Mental Health Services', priority: 9 },
    { id: 'pharmaceutical-access-palestine', name: 'Pharmaceutical Access', priority: 10 },
    { id: 'emergency-medical-services-palestine', name: 'Emergency Medical Services', priority: 11 },
    { id: 'chronic-disease-management-palestine', name: 'Chronic Disease Management', priority: 12 },
    { id: 'health-workforce-palestine', name: 'Health Workforce Data', priority: 13 },
    { id: 'medical-equipment-status-palestine', name: 'Medical Equipment Status', priority: 14 },
    { id: 'health-facility-damage-assessment', name: 'Health Facility Damage', priority: 15 },
  ],
  
  // NEW: Shelter Category (12 datasets)
  shelter: [
    { id: 'housing-damage-assessment-gaza', name: 'Housing Damage Assessment', priority: 1 },
    { id: 'temporary-shelter-locations-palestine', name: 'Temporary Shelter Locations', priority: 2 },
    { id: 'shelter-needs-assessment-palestine', name: 'Shelter Needs Assessment', priority: 3 },
    { id: 'housing-reconstruction-palestine', name: 'Housing Reconstruction', priority: 4 },
    { id: 'building-permits-palestine', name: 'Building Permits', priority: 5 },
    { id: 'demolition-orders-west-bank', name: 'Demolition Orders', priority: 6 },
    { id: 'eviction-notices-palestine', name: 'Eviction Notices', priority: 7 },
    { id: 'housing-affordability-palestine', name: 'Housing Affordability', priority: 8 },
    { id: 'collective-centers-palestine', name: 'Collective Centers', priority: 9 },
    { id: 'host-family-arrangements-palestine', name: 'Host Family Arrangements', priority: 10 },
    { id: 'shelter-materials-availability', name: 'Shelter Materials', priority: 11 },
    { id: 'housing-density-palestine', name: 'Housing Density', priority: 12 },
  ],
};

// Create rate-limited fetcher
const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

// Helper: Fetch with retry (using new utility)
async function fetchWithRetry(url, retries = 3) {
  try {
    const data = await fetchJSONWithRetry(url, {}, {
      maxRetries: retries,
      initialDelay: 1000,
      backoffMultiplier: 2,
      onRetry: async (attempt, delay, reason) => {
        await logger.warn(`Retry ${attempt}/${retries} for ${url} (${reason}), waiting ${delay}ms`);
      },
    });
    return data;
  } catch (error) {
    await logger.error(`Failed to fetch ${url} after ${retries} retries`, error);
    throw error;
  }
}

// Helper: Ensure directory exists
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

// Helper: Write JSON file
async function writeJSON(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    await logger.debug(`Wrote file: ${filePath}`);
  } catch (error) {
    await logger.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
}

// Create organized folder structure for all categories
async function createCategoryFolders() {
  await logger.info('Creating organized folder structure...');
  
  const categories = Object.keys(PRIORITY_HDX_DATASETS);
  
  for (const category of categories) {
    try {
      const categoryDir = path.join(DATA_DIR, category);
      await ensureDir(categoryDir);
      await logger.success(`Created ${category}/ directory`);
    } catch (error) {
      await logger.error(`Failed to create ${category}/ directory`, error);
      throw error;
    }
  }
  
  await logger.info(`Total categories: ${categories.length}`);
}

// Fetch dataset by category
async function fetchDatasetByCategory(category, datasets) {
  const categoryLogger = logger.child(category);
  await categoryLogger.info(`Processing ${category} datasets...`);
  
  const categoryConfig = PRIORITY_HDX_DATASETS[category];
  if (!categoryConfig) {
    await categoryLogger.warn(`No configuration found for category: ${category}`);
    return { downloaded: 0, failed: 0, datasets: [] };
  }
  
  const categoryDir = path.join(DATA_DIR, category);
  
  try {
    await ensureDir(categoryDir);
  } catch (error) {
    await categoryLogger.error(`Failed to create category directory: ${categoryDir}`, error);
    return { downloaded: 0, failed: 0, datasets: [] };
  }
  
  let downloaded = 0;
  let failed = 0;
  const downloadedDatasets = [];
  const errors = [];
  
  // Sort by priority
  const sortedDatasets = [...categoryConfig].sort((a, b) => a.priority - b.priority);
  
  for (const datasetConfig of sortedDatasets) {
    await categoryLogger.info(`[${datasetConfig.priority}] ${datasetConfig.name}`);
    
    try {
      // Try to find dataset by ID or search by name
      let dataset = datasets.find(ds => ds.id === datasetConfig.id || ds.name === datasetConfig.id);
      
      if (!dataset) {
        // Search for dataset
        try {
          const searchUrl = `${HDX_CKAN_BASE}/package_search?q=${encodeURIComponent(datasetConfig.name)}&rows=5`;
          const searchResult = await fetchWithRetry(searchUrl);
          
          if (searchResult.success && searchResult.result.results.length > 0) {
            dataset = searchResult.result.results[0];
            await categoryLogger.info(`Found via search: ${dataset.title}`);
          } else {
            await categoryLogger.warn(`Dataset not found: ${datasetConfig.name}, skipping`);
            failed++;
            errors.push({ dataset: datasetConfig.name, error: 'Not found' });
            continue;
          }
        } catch (searchError) {
          await categoryLogger.error(`Search failed for ${datasetConfig.name}`, searchError);
          failed++;
          errors.push({ dataset: datasetConfig.name, error: searchError.message });
          continue;
        }
      }
      
      // Get full dataset details
      let fullDataset;
      try {
        fullDataset = await getDatasetDetails(dataset.id);
        if (!fullDataset) {
          await categoryLogger.error(`Failed to get dataset details for ${dataset.id}`);
          failed++;
          errors.push({ dataset: dataset.id, error: 'Failed to get details' });
          continue;
        }
      } catch (detailsError) {
        await categoryLogger.error(`Error getting dataset details for ${dataset.id}`, detailsError);
        failed++;
        errors.push({ dataset: dataset.id, error: detailsError.message });
        continue;
      }
      
      // Extract and store metadata
      let metadata;
      try {
        metadata = extractDatasetMetadata(fullDataset, category);
      } catch (metadataError) {
        await categoryLogger.error(`Failed to extract metadata for ${fullDataset.id}`, metadataError);
        failed++;
        errors.push({ dataset: fullDataset.id, error: `Metadata extraction failed: ${metadataError.message}` });
        continue;
      }
      
      // Find downloadable resources (CSV, JSON, or ZIP with size limits)
      const dataResources = fullDataset.resources?.filter(r => {
        const format = r.format?.toLowerCase() || '';
        const name = r.name?.toLowerCase() || '';
        
        // Allow CSV, JSON, GeoJSON, or ZIP
        const isValidFormat = format === 'csv' || format === 'json' || format === 'geojson' || format === 'zip' || name.endsWith('.zip');
        
        // Block other archive formats
        const isNotOtherArchive = format !== 'rar' && format !== '7z' && format !== 'tar' &&
                                  !name.endsWith('.rar') && !name.endsWith('.7z');
        
        // Skip files larger than 50MB
        const isReasonableSize = !r.size || (r.size / (1024 * 1024)) <= 50;
        
        return isValidFormat && isNotOtherArchive && isReasonableSize;
      }) || [];
      
      if (dataResources.length === 0) {
        await categoryLogger.warn(`No downloadable resources found for ${fullDataset.name} (only large files or unsupported formats)`);
        failed++;
        errors.push({ dataset: fullDataset.name, error: 'No downloadable resources' });
        continue;
      }
      
      // Download first suitable resource
      const resource = dataResources[0];
      await categoryLogger.info(`Downloading: ${resource.name} (${resource.format})`);
      
      let data;
      try {
        data = await downloadResource(resource);
      } catch (downloadError) {
        await categoryLogger.error(`Failed to download resource ${resource.name}`, downloadError);
        failed++;
        errors.push({ dataset: fullDataset.name, resource: resource.name, error: downloadError.message });
        continue;
      }
      
      if (data) {
        try {
          // Create dataset-specific directory
          const datasetDir = path.join(categoryDir, sanitizeFilename(fullDataset.name));
          await ensureDir(datasetDir);
          
          // Save metadata
          await writeJSON(path.join(datasetDir, 'metadata.json'), metadata);
          
          // Transform data based on category
          const rawDataContent = data.format === 'csv' ? { csv: data.data } : data;
          let transformed;
          try {
            transformed = transformDataByCategory(rawDataContent, category, metadata);
          } catch (transformError) {
            await categoryLogger.error(`Failed to transform data for ${fullDataset.name}`, transformError);
            failed++;
            errors.push({ dataset: fullDataset.name, error: `Transformation failed: ${transformError.message}` });
            continue;
          }
          
          // Save raw data
          const dataFile = data.format === 'csv' ? 'data.csv.json' : 'data.json';
          await writeJSON(path.join(datasetDir, dataFile), {
            source: 'hdx-ckan',
            downloaded_at: new Date().toISOString(),
            resource: {
              id: resource.id,
              name: resource.name,
              format: resource.format,
              url: resource.url,
            },
            data: rawDataContent,
          });
          
          // Save transformed data and partition if necessary
          let partitionInfo = null;
          let validationResult = null;
          if (transformed.format === 'json' && transformed.data) {
            // Validate transformed data
            try {
              validationResult = await validateDataset(transformed.data, category);
              
              // Log validation results
              if (validationResult.meetsThreshold) {
                await categoryLogger.success(`Validation passed (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
              } else {
                await categoryLogger.warn(`Validation quality below threshold (score: ${(validationResult.qualityScore * 100).toFixed(1)}%)`);
              }
              
              // Log errors and warnings summary
              if (validationResult.errors.length > 0) {
                await categoryLogger.warn(`Found ${validationResult.errors.length} validation errors`);
              }
              if (validationResult.warnings.length > 0) {
                await categoryLogger.debug(`Found ${validationResult.warnings.length} validation warnings`);
              }
            } catch (validationError) {
              await categoryLogger.warn(`Validation failed for ${fullDataset.name}`, validationError);
              // Continue anyway - validation failure shouldn't stop the download
            }
            
            await writeJSON(path.join(datasetDir, 'transformed.json'), {
              source: 'hdx-ckan',
              category,
              transformed_at: new Date().toISOString(),
              record_count: transformed.recordCount,
              validation: validationResult ? {
                qualityScore: validationResult.qualityScore,
                completeness: validationResult.completeness,
                consistency: validationResult.consistency,
                accuracy: validationResult.accuracy,
                meetsThreshold: validationResult.meetsThreshold,
                errorCount: validationResult.errors.length,
                warningCount: validationResult.warnings.length,
              } : null,
              data: transformed.data,
            });
            await categoryLogger.success(`Transformed ${transformed.recordCount} records`);
            
            // Save validation report if available
            if (validationResult) {
              await writeJSON(path.join(datasetDir, 'validation.json'), validationResult);
              await categoryLogger.debug(`Saved validation report`);
            }
            
            // Partition data if needed
            try {
              partitionInfo = await partitionAndSaveDataset(datasetDir, transformed, fullDataset.name);
            } catch (partitionError) {
              await categoryLogger.warn(`Failed to partition data for ${fullDataset.name}`, partitionError);
              // Continue anyway - partitioning is not critical
            }
          }
          
          downloaded++;
          downloadedDatasets.push({
            id: fullDataset.id,
            name: fullDataset.name,
            title: fullDataset.title,
            recordCount: transformed.recordCount || 0,
            partitioned: partitionInfo?.partitioned || false,
            partitionCount: partitionInfo?.partitionCount || 0,
            validation: validationResult ? {
              qualityScore: validationResult.qualityScore,
              completeness: validationResult.completeness,
              meetsThreshold: validationResult.meetsThreshold,
              errorCount: validationResult.errors.length,
              warningCount: validationResult.warnings.length,
            } : null,
            metadata,
          });
          
          await categoryLogger.success(`Downloaded to ${category}/${sanitizeFilename(fullDataset.name)}/`);
        } catch (saveError) {
          await categoryLogger.error(`Failed to save dataset ${fullDataset.name}`, saveError);
          failed++;
          errors.push({ dataset: fullDataset.name, error: `Save failed: ${saveError.message}` });
        }
      } else {
        await categoryLogger.warn(`No data downloaded for ${fullDataset.name}`);
        failed++;
        errors.push({ dataset: fullDataset.name, error: 'No data downloaded' });
      }
      
    } catch (error) {
      await categoryLogger.error(`Unexpected error processing ${datasetConfig.name}`, error);
      failed++;
      errors.push({ dataset: datasetConfig.name, error: error.message, stack: error.stack });
    }
  }
  
  await categoryLogger.info(`Summary: ${downloaded} downloaded, ${failed} failed`);
  
  if (errors.length > 0) {
    await categoryLogger.warn(`Errors encountered:`, { count: errors.length, errors });
  }
  
  return { downloaded, failed, datasets: downloadedDatasets, errors };
}

// Extract dataset metadata with Palestine-specific context
function extractDatasetMetadata(dataset, category) {
  const regions = extractRegions(dataset);
  const governorates = extractGovernorates(dataset);
  const conflictRelated = isConflictRelated(dataset);
  const reliability = assessSourceReliability(dataset.organization);
  
  return {
    id: dataset.id,
    name: dataset.name,
    title: dataset.title,
    description: dataset.notes || '',
    category,
    organization: {
      name: dataset.organization?.name || 'unknown',
      title: dataset.organization?.title || 'Unknown',
    },
    tags: dataset.tags?.map(t => t.name) || [],
    license: dataset.license_title || dataset.license_id || 'Unknown',
    dataset_date: dataset.dataset_date || null,
    last_modified: dataset.metadata_modified || new Date().toISOString(),
    data_update_frequency: dataset.data_update_frequency || 'unknown',
    num_resources: dataset.num_resources || 0,
    resources: dataset.resources?.map(r => ({
      id: r.id,
      name: r.name,
      format: r.format,
      size: r.size,
      last_modified: r.last_modified,
      url: r.url,
    })) || [],
    source_url: `https://data.humdata.org/dataset/${dataset.name}`,
    extracted_at: new Date().toISOString(),
    // Palestine-specific context
    palestine_context: {
      regions_covered: regions,
      governorates: governorates,
      conflict_related: conflictRelated,
      baseline_comparison_available: dataset.dataset_date && dataset.dataset_date < BASELINE_DATE,
    },
    data_quality: {
      update_frequency: dataset.data_update_frequency || 'unknown',
      last_updated: dataset.metadata_modified || new Date().toISOString(),
      source_reliability: reliability,
    },
  };
}

// Sanitize filename
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 100);
}

// Data Transformation Functions

// Transform conflict/ACLED data
function transformConflictData(rawData, metadata) {
  try {
    let records = [];
    
    // Handle different data formats
    if (Array.isArray(rawData)) {
      records = rawData;
    } else if (rawData.csv && Array.isArray(rawData.csv)) {
      records = rawData.csv;
    } else if (rawData.data && Array.isArray(rawData.data)) {
      records = rawData.data;
    }
    
    // Filter out empty records
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      console.log(`    ℹ️  No records found in conflict data`);
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    console.log(`    ℹ️  Transforming ${records.length} conflict records`);
    console.log(`    ℹ️  Sample fields: ${Object.keys(records[0]).slice(0, 5).join(', ')}`);
    
    // Transform to standardized format - keep original data if transformation fields don't exist
    const transformed = records.map(record => {
      const base = {
        date: normalizeDate(record.event_date || record.date || record.timestamp || record.year),
        event_type: record.event_type || record.type || record.event_type_name || 'unknown',
        location: {
          name: record.location || record.admin1 || record.region || record.governorate || 'unknown',
          latitude: parseFloat(record.latitude || record.lat) || null,
          longitude: parseFloat(record.longitude || record.lon || record.long) || null,
          admin1: record.admin1 || record.governorate || null,
          admin2: record.admin2 || record.locality || null,
        },
        fatalities: parseInt(record.fatalities || record.killed || record.deaths || record.casualties || 0),
        injuries: parseInt(record.injuries || record.injured || record.wounded || 0),
        actors: {
          actor1: record.actor1 || record.perpetrator || null,
          actor2: record.actor2 || record.target || null,
        },
        description: record.notes || record.description || record.event_description || '',
        source: record.source || metadata.organization.title,
        source_url: record.source_url || metadata.source_url,
      };
      
      // Keep all original fields as well
      return { ...record, ...base, _original: record };
    });
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    console.log(`    ⚠️  Conflict data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: Array.isArray(rawData) ? rawData.length : 0 };
  }
}

// Transform education facility data
function transformEducationData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : 
                  (rawData.csv && Array.isArray(rawData.csv)) ? rawData.csv :
                  (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    console.log(`    ℹ️  Transforming ${records.length} education records`);
    
    const transformed = records.map(record => {
      const base = {
        facility_id: record.id || record.facility_id || null,
        name: record.name || record.facility_name || record.school_name || 'unknown',
        type: record.type || record.facility_type || 'school',
        location: {
          name: record.location || record.governorate || record.region || 'unknown',
          latitude: parseFloat(record.latitude || record.lat) || null,
          longitude: parseFloat(record.longitude || record.lon) || null,
        },
        status: record.status || record.operational_status || 'unknown',
        damage_level: record.damage || record.damage_level || record.damage_assessment || null,
        students: parseInt(record.students || record.enrollment || record.capacity || 0),
        staff: parseInt(record.staff || record.teachers || 0),
        last_assessed: normalizeDate(record.assessment_date || record.last_updated),
        source: metadata.organization.title,
      };
      
      // Keep all original fields
      return { ...record, ...base };
    });
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    console.log(`    ⚠️  Education data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: Array.isArray(rawData) ? rawData.length : 0 };
  }
}

// Transform water/sanitation data
function transformWaterData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      facility_id: record.id || record.facility_id || null,
      name: record.name || record.facility_name || 'unknown',
      type: record.type || record.facility_type || 'water',
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      status: record.status || record.operational_status || 'unknown',
      capacity: parseFloat(record.capacity || record.daily_capacity || 0),
      population_served: parseInt(record.population_served || record.beneficiaries || 0),
      water_quality: record.water_quality || record.quality_status || null,
      last_assessed: normalizeDate(record.assessment_date || record.last_updated),
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Water data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Transform infrastructure damage data
function transformInfrastructureData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      structure_id: record.id || record.structure_id || null,
      name: record.name || record.building_name || 'unknown',
      type: record.type || record.structure_type || record.building_type || 'building',
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      damage_level: record.damage || record.damage_level || record.damage_assessment || 'unknown',
      damage_date: normalizeDate(record.damage_date || record.incident_date || record.date),
      estimated_cost: parseFloat(record.cost || record.damage_cost || 0),
      people_affected: parseInt(record.people_affected || record.affected_population || 0),
      status: record.status || record.current_status || 'damaged',
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Infrastructure data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Transform refugee/displacement data
function transformRefugeeData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      date: normalizeDate(record.date || record.reporting_date || record.timestamp),
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        type: record.location_type || 'area',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      displaced_population: parseInt(record.idps || record.displaced || record.population || 0),
      refugees: parseInt(record.refugees || 0),
      displacement_type: record.displacement_type || record.type || 'internal',
      origin: record.origin || record.origin_location || null,
      destination: record.destination || record.current_location || null,
      reason: record.reason || record.displacement_reason || null,
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Refugee data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Transform humanitarian needs data
function transformHumanitarianData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      date: normalizeDate(record.date || record.reporting_date || record.assessment_date),
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      sector: record.sector || record.cluster || 'multi-sector',
      people_in_need: parseInt(record.people_in_need || record.pin || record.affected || 0),
      people_targeted: parseInt(record.people_targeted || record.target || 0),
      people_reached: parseInt(record.people_reached || record.reached || 0),
      severity: record.severity || record.severity_level || null,
      priority: record.priority || record.priority_level || null,
      funding_required: parseFloat(record.funding_required || record.budget || 0),
      funding_received: parseFloat(record.funding_received || record.funded || 0),
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Humanitarian data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Normalize date formats
function normalizeDate(dateValue) {
  if (!dateValue) return null;
  
  try {
    // Handle various date formats
    const date = new Date(dateValue);
    if (isNaN(date.getTime())) return dateValue; // Return original if invalid
    
    // Return ISO format YYYY-MM-DD
    return date.toISOString().split('T')[0];
  } catch (error) {
    return dateValue;
  }
}

// Transform health facility data
function transformHealthData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      facility_id: record.id || record.facility_id || null,
      name: record.name || record.facility_name || record.hospital_name || 'unknown',
      type: record.type || record.facility_type || 'health_facility',
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      status: record.status || record.operational_status || 'unknown',
      damage_level: record.damage || record.damage_level || null,
      bed_capacity: parseInt(record.beds || record.bed_capacity || record.capacity || 0),
      staff_count: parseInt(record.staff || record.healthcare_workers || 0),
      services: record.services || record.available_services || [],
      supplies_status: record.supplies || record.medical_supplies || null,
      patients_served: parseInt(record.patients || record.daily_patients || 0),
      casualties: {
        staff: parseInt(record.staff_casualties || record.healthcare_worker_casualties || 0),
        patients: parseInt(record.patient_casualties || 0),
      },
      last_assessed: normalizeDate(record.assessment_date || record.last_updated),
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Health data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Transform shelter/housing data
function transformShelterData(rawData, metadata) {
  try {
    let records = Array.isArray(rawData) ? rawData : (rawData.data || []);
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    const transformed = records.map(record => ({
      shelter_id: record.id || record.shelter_id || record.building_id || null,
      name: record.name || record.shelter_name || record.building_name || 'unknown',
      type: record.type || record.shelter_type || record.housing_type || 'housing',
      location: {
        name: record.location || record.governorate || record.area || 'unknown',
        latitude: parseFloat(record.latitude || record.lat) || null,
        longitude: parseFloat(record.longitude || record.lon) || null,
      },
      status: record.status || record.housing_status || 'unknown',
      damage_level: record.damage || record.damage_level || record.damage_assessment || null,
      damage_date: normalizeDate(record.damage_date || record.incident_date || record.date),
      capacity: parseInt(record.capacity || record.housing_units || 0),
      occupancy: parseInt(record.occupancy || record.residents || record.population || 0),
      displaced_persons: parseInt(record.idps || record.displaced || 0),
      shelter_type_detail: record.shelter_type_detail || record.accommodation_type || null,
      reconstruction_status: record.reconstruction || record.repair_status || null,
      estimated_cost: parseFloat(record.cost || record.reconstruction_cost || 0),
      last_assessed: normalizeDate(record.assessment_date || record.last_updated),
      source: metadata.organization.title,
    }));
    
    return { format: 'json', data: transformed, recordCount: transformed.length };
    
  } catch (error) {
    logger.warn(`Shelter data transformation error: ${error.message}`);
    return { format: 'raw', data: rawData, recordCount: 0 };
  }
}

// Generic transformation for any CSV/JSON data
function transformGenericData(rawData, category, metadata) {
  try {
    let records = [];
    
    // Handle different data formats
    if (Array.isArray(rawData)) {
      records = rawData;
    } else if (rawData.csv && Array.isArray(rawData.csv)) {
      // CSV data from papaparse
      records = rawData.csv;
    } else if (rawData.data && Array.isArray(rawData.data)) {
      records = rawData.data;
    } else if (typeof rawData === 'object' && rawData !== null) {
      // Try to find any array property
      const arrayProp = Object.keys(rawData).find(key => Array.isArray(rawData[key]));
      if (arrayProp) {
        records = rawData[arrayProp];
        console.log(`    ℹ️  Found data in property: ${arrayProp}`);
      }
    }
    
    // Filter out empty records
    records = records.filter(record => record && Object.keys(record).length > 0);
    
    if (records.length === 0) {
      console.log(`    ℹ️  No records found in ${category} data`);
      console.log(`    ℹ️  Raw data type: ${typeof rawData}, keys: ${Object.keys(rawData || {}).join(', ')}`);
      return { format: 'json', data: [], recordCount: 0 };
    }
    
    console.log(`    ℹ️  Found ${records.length} records in ${category} data`);
    console.log(`    ℹ️  Sample fields: ${Object.keys(records[0]).slice(0, 10).join(', ')}`);
    
    // Add metadata to each record
    const enriched = records.map(record => ({
      ...record,
      _category: category,
      _source: metadata.organization.title,
      _source_url: metadata.source_url,
      _dataset_id: metadata.id,
      _dataset_name: metadata.name,
    }));
    
    return { format: 'json', data: enriched, recordCount: enriched.length };
    
  } catch (error) {
    console.log(`    ⚠️  Generic transformation error: ${error.message}`);
    // Return raw data with count
    const count = Array.isArray(rawData) ? rawData.length : 
                  (rawData.csv && Array.isArray(rawData.csv)) ? rawData.csv.length :
                  (rawData.data && Array.isArray(rawData.data)) ? rawData.data.length : 0;
    return { format: 'raw', data: rawData, recordCount: count };
  }
}

// Transform data based on category
function transformDataByCategory(rawData, category, metadata) {
  try {
    // Try category-specific transformation first
    let result;
    switch (category) {
      case 'conflict':
        result = transformConflictData(rawData, metadata);
        break;
      case 'education':
        result = transformEducationData(rawData, metadata);
        break;
      case 'water':
        result = transformWaterData(rawData, metadata);
        break;
      case 'infrastructure':
        result = transformInfrastructureData(rawData, metadata);
        break;
      case 'refugees':
        result = transformRefugeeData(rawData, metadata);
        break;
      case 'humanitarian':
        result = transformHumanitarianData(rawData, metadata);
        break;
      case 'health':
        result = transformHealthData(rawData, metadata);
        break;
      case 'shelter':
        result = transformShelterData(rawData, metadata);
        break;
      default:
        console.log(`    ℹ️  No specific transformation for ${category}, using generic`);
        result = transformGenericData(rawData, category, metadata);
    }
    
    // If category-specific transformation returned 0 records, try generic
    if (result.recordCount === 0 && result.format !== 'raw') {
      console.log(`    ℹ️  Category transformation returned 0 records, trying generic`);
      result = transformGenericData(rawData, category, metadata);
    }
    
    return result;
  } catch (error) {
    console.log(`    ⚠️  Error transforming data for category ${category}: ${error.message}`);
    return transformGenericData(rawData, category, metadata);
  }
}

// Data Partitioning Functions

// Partition data by quarter
function partitionByQuarter(data, dateField = 'date') {
  const partitions = new Map();
  
  for (const record of data) {
    const dateValue = record[dateField];
    if (!dateValue) continue;
    
    try {
      const date = new Date(dateValue);
      const year = date.getFullYear();
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      const quarterKey = `${year}-Q${quarter}`;
      
      if (!partitions.has(quarterKey)) {
        partitions.set(quarterKey, []);
      }
      partitions.get(quarterKey).push(record);
    } catch (error) {
      // Skip records with invalid dates
      continue;
    }
  }
  
  return partitions;
}

// Generate recent.json file (last 90 days)
function generateRecentData(data, dateField = 'date', days = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const recentData = data.filter(record => {
    const dateValue = record[dateField];
    if (!dateValue) return false;
    
    try {
      const recordDate = new Date(dateValue);
      return recordDate >= cutoffDate;
    } catch (error) {
      return false;
    }
  });
  
  return recentData;
}

// Create partition index
function createPartitionIndex(partitions, datasetName) {
  const partitionList = Array.from(partitions.entries()).map(([quarter, records]) => ({
    quarter,
    recordCount: records.length,
    dateRange: getDateRange(records),
    fileName: `${quarter}.json`,
  }));
  
  // Sort by quarter
  partitionList.sort((a, b) => a.quarter.localeCompare(b.quarter));
  
  const totalRecords = Array.from(partitions.values()).reduce((sum, records) => sum + records.length, 0);
  
  return {
    dataset: datasetName,
    totalPartitions: partitionList.length,
    totalRecords,
    partitions: partitionList,
    hasRecentFile: true,
    recentFileName: 'recent.json',
    generated_at: new Date().toISOString(),
  };
}

// Get date range from records
function getDateRange(records, dateField = 'date') {
  if (records.length === 0) return { start: null, end: null };
  
  const dates = records
    .map(r => r[dateField])
    .filter(d => d)
    .map(d => new Date(d))
    .filter(d => !isNaN(d.getTime()))
    .sort((a, b) => a - b);
  
  if (dates.length === 0) return { start: null, end: null };
  
  return {
    start: dates[0].toISOString().split('T')[0],
    end: dates[dates.length - 1].toISOString().split('T')[0],
  };
}

// Partition and save dataset
async function partitionAndSaveDataset(datasetDir, transformedData, datasetName) {
  if (!transformedData.data || transformedData.data.length === 0) {
    console.log('    ⚠️  No data to partition');
    return null;
  }
  
  const recordCount = transformedData.data.length;
  console.log(`    Partitioning ${recordCount} records...`);
  
  // Only partition if > 1000 records
  if (recordCount > 1000) {
    const partitions = partitionByQuarter(transformedData.data);
    
    // Save each partition
    for (const [quarter, records] of partitions.entries()) {
      const partitionFile = path.join(datasetDir, `${quarter}.json`);
      await writeJSON(partitionFile, {
        quarter,
        recordCount: records.length,
        dateRange: getDateRange(records),
        data: records,
      });
      console.log(`      ✓ Saved ${quarter}.json (${records.length} records)`);
    }
    
    // Generate recent.json
    const recentData = generateRecentData(transformedData.data);
    if (recentData.length > 0) {
      await writeJSON(path.join(datasetDir, 'recent.json'), {
        description: 'Last 90 days of data',
        recordCount: recentData.length,
        dateRange: getDateRange(recentData),
        data: recentData,
      });
      console.log(`      ✓ Saved recent.json (${recentData.length} records)`);
    }
    
    // Create index
    const index = createPartitionIndex(partitions, datasetName);
    await writeJSON(path.join(datasetDir, 'index.json'), index);
    console.log(`      ✓ Saved index.json (${partitions.size} partitions)`);
    
    return {
      partitioned: true,
      partitionCount: partitions.size,
      totalRecords: recordCount,
      hasRecent: recentData.length > 0,
    };
  } else {
    console.log(`    ℹ️  Dataset has ${recordCount} records (< 1000), skipping partitioning`);
    return {
      partitioned: false,
      totalRecords: recordCount,
    };
  }
}

// Palestine-specific filtering functions
function filterPalestineRelevant(datasets) {
  const palestineKeywords = [
    'palestine', 'palestinian', 'gaza', 'west bank', 'westbank',
    'opt', 'occupied palestinian territory', 'pse',
    'jerusalem', 'hebron', 'nablus', 'jenin', 'ramallah',
    'rafah', 'khan yunis', 'deir al-balah', 'tulkarm', 'qalqilya',
  ];
  
  // Keywords that indicate OTHER countries (not Palestine)
  const excludeKeywords = [
    'philippines', 'philippine', 'manila', 'mindanao',
    'syria', 'syrian', 'lebanon', 'lebanese', 'jordan', 'jordanian',
    'yemen', 'yemeni', 'iraq', 'iraqi', 'afghanistan', 'afghan',
    'somalia', 'somali', 'sudan', 'sudanese', 'ethiopia', 'ethiopian',
    'myanmar', 'burma', 'bangladesh', 'rohingya',
    'ukraine', 'ukrainian', 'venezuela', 'venezuelan',
  ];
  
  return datasets.filter(dataset => {
    const searchText = `${dataset.title || ''} ${dataset.notes || ''} ${dataset.tags?.map(t => t.name).join(' ') || ''}`.toLowerCase();
    
    // Must contain Palestine keywords
    const hasPalestineKeyword = palestineKeywords.some(keyword => searchText.includes(keyword));
    
    // Must NOT contain exclude keywords
    const hasExcludeKeyword = excludeKeywords.some(keyword => searchText.includes(keyword));
    
    return hasPalestineKeyword && !hasExcludeKeyword;
  });
}

// Extract regions covered by dataset
function extractRegions(dataset) {
  const regions = new Set();
  const text = `${dataset.title || ''} ${dataset.notes || ''}`.toLowerCase();
  
  if (text.includes('gaza')) regions.add('gaza');
  if (text.includes('west bank') || text.includes('westbank')) regions.add('west_bank');
  if (text.includes('jerusalem')) regions.add('east_jerusalem');
  if (text.includes('palestine') && regions.size === 0) {
    // If only "palestine" mentioned, assume both regions
    regions.add('gaza');
    regions.add('west_bank');
  }
  
  return Array.from(regions);
}

// Extract governorates mentioned in dataset
function extractGovernorates(dataset) {
  const governorates = [
    'Gaza', 'North Gaza', 'Deir al-Balah', 'Khan Yunis', 'Rafah',
    'Jenin', 'Tubas', 'Tulkarm', 'Nablus', 'Qalqilya', 'Salfit',
    'Ramallah', 'Jericho', 'Jerusalem', 'Bethlehem', 'Hebron',
  ];
  
  const text = `${dataset.title || ''} ${dataset.notes || ''}`.toLowerCase();
  return governorates.filter(gov => text.includes(gov.toLowerCase()));
}

// Check if dataset is conflict-related
function isConflictRelated(dataset) {
  const conflictKeywords = [
    'conflict', 'violence', 'casualties', 'killed', 'injured', 'attack',
    'military', 'armed', 'clash', 'incident', 'fatalities', 'deaths',
    'war', 'hostilities', 'bombardment', 'strike', 'raid',
  ];
  
  const text = `${dataset.title || ''} ${dataset.notes || ''} ${dataset.tags?.map(t => t.name).join(' ') || ''}`.toLowerCase();
  return conflictKeywords.some(keyword => text.includes(keyword));
}

// Assess source reliability based on organization
function assessSourceReliability(organization) {
  const highReliability = ['unocha', 'who', 'unicef', 'unhcr', 'wfp', 'unrwa', 'undp'];
  const mediumReliability = ['ngo', 'humanitarian', 'international'];
  
  const orgName = (organization?.name || '').toLowerCase();
  
  if (highReliability.some(name => orgName.includes(name))) {
    return 'high';
  } else if (mediumReliability.some(name => orgName.includes(name))) {
    return 'medium';
  }
  return 'unknown';
}

// Search for Palestine datasets with more comprehensive queries
async function searchPalestineDatasets() {
  console.log('\n🔍 Searching for Palestine datasets...');
  
  // More specific queries with location filters
  const queries = [
    'groups:pse',  // Palestine country group
    'vocab_Topics:"conflict-violence" AND groups:pse',
    'vocab_Topics:"displacement" AND groups:pse',
    'vocab_Topics:"health" AND groups:pse',
    'vocab_Topics:"education" AND groups:pse',
    'vocab_Topics:"water-sanitation" AND groups:pse',
    'vocab_Topics:"food-security" AND groups:pse',
    'gaza strip',
    'west bank',
    'occupied palestinian territory',
    'state of palestine',
    'palestinian territories',
  ];
  
  const allDatasets = new Map();
  
  for (const query of queries) {
    try {
      const url = `${HDX_CKAN_BASE}/package_search?fq=${encodeURIComponent(query)}&rows=50`;
      const response = await fetchWithRetry(url);
      
      if (response.success && response.result.results) {
        console.log(`  ✓ Found ${response.result.results.length} datasets for "${query}"`);
        
        response.result.results.forEach(dataset => {
          if (!allDatasets.has(dataset.id)) {
            allDatasets.set(dataset.id, dataset);
          }
        });
      }
    } catch (error) {
      console.error(`  ❌ Failed to search for "${query}":`, error.message);
    }
  }
  
  // Filter to only Palestine-relevant datasets
  const allDatasetsArray = Array.from(allDatasets.values());
  const palestineDatasets = filterPalestineRelevant(allDatasetsArray);
  
  console.log(`\n  Total unique datasets found: ${allDatasets.size}`);
  console.log(`  Palestine-relevant datasets: ${palestineDatasets.length}`);
  
  // Log some examples
  if (palestineDatasets.length > 0) {
    console.log(`\n  Sample datasets:`);
    palestineDatasets.slice(0, 5).forEach(ds => {
      console.log(`    - ${ds.title}`);
    });
  }
  
  return palestineDatasets;
}

// Get dataset details
async function getDatasetDetails(datasetId) {
  try {
    const url = `${HDX_CKAN_BASE}/package_show?id=${datasetId}`;
    const response = await fetchWithRetry(url);
    
    if (response.success) {
      return response.result;
    }
  } catch (error) {
    console.error(`  ❌ Failed to get dataset ${datasetId}:`, error.message);
  }
  return null;
}

// Download and process resource
async function downloadResource(resource) {
  try {
    const format = resource.format?.toLowerCase() || '';
    const name = resource.name?.toLowerCase() || '';
    
    // Check file size before downloading (if available)
    if (resource.size) {
      const sizeInMB = resource.size / (1024 * 1024);
      if (sizeInMB > 50) {
        console.log(`    ⚠️  Skipping large file: ${resource.name} (${sizeInMB.toFixed(1)} MB)`);
        return null;
      }
    }
    
    // Handle ZIP files with safe extraction
    if (format === 'zip' || name.endsWith('.zip')) {
      console.log(`    📦 Extracting ZIP: ${resource.name}`);
      try {
        const extractedFiles = await downloadAndExtractZip(resource.url, {
          maxDownloadSize: 50 * 1024 * 1024, // 50 MB compressed
          maxSize: 100 * 1024 * 1024, // 100 MB uncompressed
          maxFileSize: 50 * 1024 * 1024, // 50 MB per file
          maxFiles: 50, // Max 50 files
        });
        
        if (extractedFiles.length === 0) {
          console.log(`    ⚠️  No valid files in ZIP`);
          return null;
        }
        
        // Find the first CSV or JSON file
        const dataFile = extractedFiles.find(f => {
          const ext = path.extname(f.name).toLowerCase();
          return ext === '.csv' || ext === '.json' || ext === '.geojson';
        });
        
        if (!dataFile) {
          console.log(`    ⚠️  No CSV/JSON files found in ZIP`);
          return null;
        }
        
        console.log(`    ✓ Using: ${dataFile.name} from ZIP`);
        
        // Parse the extracted file
        const parsed = parseExtractedFile(dataFile);
        
        if (parsed.format === 'csv') {
          // Parse CSV using papaparse
          const csvParsed = Papa.parse(parsed.data, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            transformHeader: (header) => {
              return header.toLowerCase().trim().replace(/\s+/g, '_');
            },
          });
          
          return { 
            format: 'csv', 
            data: csvParsed.data, 
            meta: csvParsed.meta,
            fromZip: true,
            zipFileName: dataFile.name,
          };
        } else {
          return {
            ...parsed,
            fromZip: true,
            zipFileName: dataFile.name,
          };
        }
      } catch (zipError) {
        console.log(`    ⚠️  ZIP extraction failed: ${zipError.message}`);
        return null;
      }
    }
    
    // Block other archive formats
    if (format === 'rar' || format === '7z' || format === 'tar' || format === 'gz' ||
        name.endsWith('.rar') || name.endsWith('.7z')) {
      console.log(`    ⚠️  Skipping unsupported archive: ${resource.name} (${format})`);
      return null;
    }
    
    // Only allow CSV, JSON, and GeoJSON for direct download
    if (format !== 'csv' && format !== 'json' && format !== 'geojson') {
      console.log(`    ⚠️  Skipping unsupported format: ${format}`);
      return null;
    }
    
    console.log(`    Downloading: ${resource.name} (${format})`);
    const response = await fetch(resource.url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // Check content type
    const contentType = response.headers.get('content-type') || '';
    
    // Check content length
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeInMB = parseInt(contentLength) / (1024 * 1024);
      if (sizeInMB > 50) {
        console.log(`    ⚠️  Skipping large download: ${sizeInMB.toFixed(1)} MB`);
        return null;
      }
    }
    
    if (contentType.includes('json') || format === 'json' || format === 'geojson') {
      return await response.json();
    } else if (contentType.includes('csv') || format === 'csv') {
      const text = await response.text();
      
      // Parse CSV using papaparse
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        transformHeader: (header) => {
          return header.toLowerCase().trim().replace(/\s+/g, '_');
        },
      });
      
      if (parsed.errors.length > 0) {
        console.log(`    ⚠️  CSV parsing warnings: ${parsed.errors.length} errors`);
      }
      
      return { format: 'csv', data: parsed.data, meta: parsed.meta };
    } else {
      console.log(`    ⚠️  Unsupported content type: ${contentType}`);
      return null;
    }
  } catch (error) {
    console.error(`    ❌ Failed to download resource:`, error.message);
    return null;
  }
}

// Save dataset catalog
async function saveDatasetCatalog(datasets) {
  console.log('\n💾 Saving dataset catalog...');
  
  await ensureDir(DATA_DIR);
  
  const catalog = {
    generated_at: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    total_datasets: datasets.length,
    datasets: datasets.map(ds => ({
      id: ds.id,
      name: ds.name,
      title: ds.title,
      organization: ds.organization?.title || 'Unknown',
      last_modified: ds.metadata_modified,
      num_resources: ds.num_resources,
      tags: ds.tags?.map(t => t.name) || [],
      dataset_date: ds.dataset_date,
      data_update_frequency: ds.data_update_frequency,
    })),
  };
  
  await writeJSON(path.join(DATA_DIR, 'catalog.json'), catalog);
  console.log(`  ✓ Saved catalog with ${datasets.length} datasets`);
}

// Update HDX catalog with downloaded datasets
async function updateHDXCatalog(categoriesData) {
  console.log('\n📋 Updating HDX catalog with downloaded datasets...');
  
  const categories = {};
  let totalDatasets = 0;
  let totalRecords = 0;
  let totalPartitioned = 0;
  
  for (const [category, categoryData] of Object.entries(categoriesData)) {
    const datasets = categoryData.datasets.map(ds => ({
      id: ds.id,
      name: ds.name,
      title: ds.title,
      recordCount: ds.recordCount || 0,
      partitioned: ds.partitioned || false,
      partitionCount: ds.partitionCount || 0,
      dateRange: ds.metadata.dataset_date || null,
      lastModified: ds.metadata.last_modified,
      organization: ds.metadata.organization.title,
      tags: ds.metadata.tags,
      sourceUrl: ds.metadata.source_url,
    }));
    
    categories[category] = {
      name: category,
      datasetCount: datasets.length,
      totalRecords: datasets.reduce((sum, ds) => sum + ds.recordCount, 0),
      partitionedDatasets: datasets.filter(ds => ds.partitioned).length,
      datasets,
    };
    
    totalDatasets += datasets.length;
    totalRecords += categories[category].totalRecords;
    totalPartitioned += categories[category].partitionedDatasets;
  }
  
  const catalog = {
    source: 'hdx-ckan',
    generated_at: new Date().toISOString(),
    baseline_date: BASELINE_DATE,
    summary: {
      totalCategories: Object.keys(categories).length,
      totalDatasets,
      totalRecords,
      totalPartitioned,
    },
    categories,
  };
  
  await writeJSON(path.join(DATA_DIR, 'catalog.json'), catalog);
  console.log(`  ✓ Updated catalog with ${totalDatasets} datasets across ${Object.keys(categories).length} categories`);
  console.log(`  ✓ Total records: ${totalRecords}`);
  console.log(`  ✓ Partitioned datasets: ${totalPartitioned}`);
  
  return catalog;
}

// Process key datasets
async function processKeyDatasets(datasets) {
  console.log('\n📊 Processing key datasets...');
  
  // Look for specific datasets
  const keyDatasets = {
    casualties: datasets.filter(ds => 
      ds.name.includes('casualties') || 
      ds.name.includes('killed') ||
      ds.title.toLowerCase().includes('casualties')
    ),
    displacement: datasets.filter(ds =>
      ds.name.includes('displacement') ||
      ds.name.includes('idp') ||
      ds.title.toLowerCase().includes('displaced')
    ),
    conflict: datasets.filter(ds =>
      ds.name.includes('conflict') ||
      ds.name.includes('acled') ||
      ds.title.toLowerCase().includes('violence')
    ),
  };
  
  console.log(`  Found ${keyDatasets.casualties.length} casualty datasets`);
  console.log(`  Found ${keyDatasets.displacement.length} displacement datasets`);
  console.log(`  Found ${keyDatasets.conflict.length} conflict datasets`);
  
  // Save summaries
  for (const [category, categoryDatasets] of Object.entries(keyDatasets)) {
    if (categoryDatasets.length > 0) {
      const categoryDir = path.join(DATA_DIR, category);
      await ensureDir(categoryDir);
      
      const summary = {
        category,
        generated_at: new Date().toISOString(),
        datasets: categoryDatasets.map(ds => ({
          id: ds.id,
          name: ds.name,
          title: ds.title,
          organization: ds.organization?.title,
          last_modified: ds.metadata_modified,
          resources: ds.resources?.map(r => ({
            id: r.id,
            name: r.name,
            format: r.format,
            url: r.url,
            last_modified: r.last_modified,
          })) || [],
        })),
      };
      
      await writeJSON(path.join(categoryDir, 'datasets.json'), summary);
      console.log(`  ✓ Saved ${category} datasets summary`);
    }
  }
  
  return keyDatasets;
}

// Download priority datasets
async function downloadPriorityDatasets(datasets) {
  console.log('\n📥 Downloading priority datasets...');
  
  // Priority keywords for datasets we want to download
  const priorities = [
    { keywords: ['casualties', 'killed', 'fatalities'], category: 'casualties', limit: 3 },
    { keywords: ['displacement', 'idp', 'internally displaced'], category: 'displacement', limit: 3 },
    { keywords: ['food security', 'nutrition', 'hunger'], category: 'food-security', limit: 2 },
    { keywords: ['health', 'medical', 'hospital'], category: 'health', limit: 2 },
    { keywords: ['water', 'sanitation', 'wash'], category: 'water', limit: 2 },
  ];
  
  let totalDownloaded = 0;
  
  for (const priority of priorities) {
    console.log(`\n  Category: ${priority.category}`);
    
    // Find matching datasets
    const matching = datasets.filter(ds => 
      priority.keywords.some(kw => 
        ds.title.toLowerCase().includes(kw) || 
        ds.name.toLowerCase().includes(kw)
      )
    ).slice(0, priority.limit);
    
    for (const dataset of matching) {
      console.log(`    Dataset: ${dataset.title}`);
      
      // Find CSV or JSON resources
      const dataResources = dataset.resources?.filter(r => 
        r.format?.toLowerCase() === 'csv' || 
        r.format?.toLowerCase() === 'json'
      ) || [];
      
      if (dataResources.length === 0) {
        console.log(`      ⚠️  No CSV/JSON resources found`);
        continue;
      }
      
      // Download first resource
      const resource = dataResources[0];
      console.log(`      Downloading: ${resource.name} (${resource.format})`);
      
      try {
        const data = await downloadResource(resource);
        if (data) {
          // Save to category directory
          const categoryDir = path.join(DATA_DIR, priority.category);
          await ensureDir(categoryDir);
          
          const fileName = `${dataset.name.substring(0, 50)}.json`;
          await writeJSON(path.join(categoryDir, fileName), {
            metadata: {
              source: 'hdx-ckan',
              dataset_id: dataset.id,
              dataset_title: dataset.title,
              resource_name: resource.name,
              last_modified: resource.last_modified,
              downloaded_at: new Date().toISOString(),
            },
            data: data.format === 'csv' ? { csv: data.data } : data,
          });
          
          totalDownloaded++;
          console.log(`      ✓ Saved to ${priority.category}/${fileName}`);
        }
      } catch (error) {
        console.log(`      ❌ Download failed: ${error.message}`);
      }
    }
  }
  
  console.log(`\n  Total datasets downloaded: ${totalDownloaded}`);
  return totalDownloaded;
}

// Main execution
async function main() {
  await logger.info('🚀 HDX CKAN Data Fetcher (Enhanced - Priority Datasets)');
  await logger.info('======================================================');
  await logger.info(`Baseline Date: ${BASELINE_DATE}`);
  await logger.info(`Data Directory: ${DATA_DIR}`);
  
  try {
    // Create organized folder structure
    await createCategoryFolders();
    
    // Search for datasets
    await logger.info('🔍 Searching for Palestine datasets...');
    const datasets = await searchPalestineDatasets();
    
    if (datasets.length === 0) {
      await logger.warn('No datasets found');
      await logger.logSummary();
      return;
    }
    
    await logger.success(`Found ${datasets.length} total datasets`);
    
    // Download priority datasets by category
    const categoriesData = {};
    const categories = Object.keys(PRIORITY_HDX_DATASETS);
    
    for (const category of categories) {
      const result = await fetchDatasetByCategory(category, datasets);
      categoriesData[category] = result;
    }
    
    // Calculate totals
    const totalDownloaded = Object.values(categoriesData).reduce((sum, cat) => sum + cat.downloaded, 0);
    const totalFailed = Object.values(categoriesData).reduce((sum, cat) => sum + cat.failed, 0);
    const totalRecords = Object.values(categoriesData)
      .flatMap(cat => cat.datasets)
      .reduce((sum, ds) => sum + (ds.recordCount || 0), 0);
    
    // Update HDX catalog
    const catalog = await updateHDXCatalog(categoriesData);
    
    // Save metadata
    const metadata = {
      source: 'hdx-ckan',
      last_updated: new Date().toISOString(),
      baseline_date: BASELINE_DATE,
      api_base: HDX_CKAN_BASE,
      summary: {
        totalCategories: categories.length,
        totalDatasets: totalDownloaded,
        totalRecords,
        failedDownloads: totalFailed,
      },
      categories: Object.entries(categoriesData).reduce((acc, [cat, data]) => {
        acc[cat] = {
          downloaded: data.downloaded,
          failed: data.failed,
          datasets: data.datasets.length,
        };
        return acc;
      }, {}),
    };
    
    await writeJSON(path.join(DATA_DIR, 'metadata.json'), metadata);
    
    await logger.success('✅ HDX CKAN data fetch completed successfully!');
    await logger.info('📊 Summary:');
    await logger.info(`  Categories processed: ${categories.length}`);
    await logger.info(`  Datasets downloaded: ${totalDownloaded}`);
    await logger.info(`  Failed downloads: ${totalFailed}`);
    await logger.info(`  Total records: ${totalRecords}`);
    await logger.info('📁 Category breakdown:');
    for (const [category, data] of Object.entries(categoriesData)) {
      const categoryRecords = data.datasets.reduce((sum, ds) => sum + (ds.recordCount || 0), 0);
      await logger.info(`  ${category}: ${data.downloaded} datasets, ${categoryRecords} records`);
    }
    
    // Log operation summary
    await logger.logSummary();
    
  } catch (error) {
    await logger.error('Fatal error in HDX fetch script', error);
    await logger.logSummary();
    process.exit(1);
  }
}

// Run
main();
