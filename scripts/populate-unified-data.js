/**
 * Populate Unified Data
 * 
 * This script transforms raw data from all sources into the unified data format.
 * It processes data through the transformation pipeline with enrichment and validation.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import transformers
import { EconomicTransformer } from './utils/economic-transformer.js';
import { ConflictTransformer } from './utils/conflict-transformer.js';
import { PCBSTransformer } from './utils/pcbs-transformer.js';
import { WHOTransformer } from './utils/who-transformer.js';
import { MartyrsTransformer } from './utils/martyrs-transformer.js';
import {
    EducationTransformer,
    HealthTransformer,
    HumanitarianTransformer,
    RefugeeTransformer,
} from './utils/hdx-transformers.js';
import { InfrastructureTransformer } from './utils/infrastructure-transformer.js';
import { WaterTransformer } from './utils/water-transformer.js';
import { NewsTransformer } from './utils/news-transformer.js';
import { CultureTransformer } from './utils/culture-transformer.js';
import { LandTransformer } from './utils/land-transformer.js';
import {
    WestBankSchoolsTransformer,
    WestBankVillagesTransformer,
    WestBankBarrierTransformer
} from './utils/westbank-transformer.js';
import { HistoricalTransformer } from './utils/historical-transformer.js';
import { GoodShepherdTransformer } from './utils/goodshepherd-transformer.js';
import { WHOHealthTransformer } from './utils/who-health-transformer.js';
import { FundingTransformer } from './utils/funding-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';
import { validateDataset } from './utils/data-validator.js';

// Simple logger
const logger = {
    info:    (msg, data) => console.log(`[INFO]  ${msg}`, data ?? ''),
    success: (msg, data) => console.log(`[OK]    ${msg}`, data ?? ''),
    warn:    (msg, data) => console.warn(`[WARN]  ${msg}`, data ?? ''),
    error:   (msg, data) => console.error(`[ERROR] ${msg}`, data ?? ''),
};

const DATA_DIR = path.join(__dirname, '../public/data');
const UNIFIED_DIR = path.join(DATA_DIR, 'unified');

/**
 * Process World Bank economic data
 */
async function processEconomicData() {
    logger.info('Processing economic data...');

    try {
        // World Bank data is in public/data/worldbank
        const allIndicatorsPath = path.join(DATA_DIR, 'worldbank', 'all-indicators.json');

        // Check if file exists
        try {
            await fs.access(allIndicatorsPath);
        } catch {
            throw new Error('World Bank data not found, skipping economic data');
        }

        const fileContent = JSON.parse(await fs.readFile(allIndicatorsPath, 'utf-8'));

        // Extract data array from the file structure
        const rawData = fileContent.data || fileContent;

        if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No World Bank data available');
            return;
        }

        const transformer = new EconomicTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            rawData,
            {
                source: 'World Bank',
                organization: 'World Bank',
                category: 'economic',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true,
                outputDir: path.join(UNIFIED_DIR, 'economic'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} economic indicators`);

            // Save all-data.json
            const outputPath = path.join(UNIFIED_DIR, 'economic', 'all-data.json');
            await fs.writeFile(
                outputPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'World Bank',
                        category: 'economic',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'economic', 'metadata.json'),
                JSON.stringify({
                    category: 'economic',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: ['World Bank'],
                    quality: results.validated ? {
                        average_score: results.validated.qualityScore,
                        completeness: results.validated.completeness,
                        consistency: results.validated.consistency,
                        accuracy: results.validated.accuracy,
                    } : null,
                }, null, 2),
                'utf-8'
            );
        } else {
            logger.error('Economic data processing failed', results.errors);
        }
    } catch (error) {
        logger.error('Error processing economic data:', error.message);
    }
}

/**
 * Process Tech4Palestine conflict data
 */
/**
 * Process Tech4Palestine conflict data
 */
async function processConflictData() {
    logger.info('Processing conflict data...');

    try {
        const t4pDir = path.join(DATA_DIR, 'tech4palestine');
        const summaryPath = path.join(t4pDir, 'summary.json');

        // Check if summary exists (as a base check)
        try {
            await fs.access(summaryPath);
        } catch {
            throw new Error('Tech4Palestine data not found, skipping conflict data');
        }

        const dataArray = [];

        // 1. Process Summary Data
        try {
            const fileContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
            const rawData = fileContent.data || fileContent;

            if (rawData) {
                if (rawData.gaza) {
                    dataArray.push({
                        ...rawData.gaza,
                        region: 'gaza',
                        date: rawData.gaza.last_update || new Date().toISOString().split('T')[0],
                        location: 'Gaza',
                        event_type: 'summary',
                        fatalities: rawData.gaza.killed?.total || 0,
                        injuries: rawData.gaza.injured?.total || 0,
                    });
                }
                if (rawData.west_bank) {
                    dataArray.push({
                        ...rawData.west_bank,
                        region: 'west_bank',
                        date: rawData.west_bank.last_update || new Date().toISOString().split('T')[0],
                        location: 'West Bank',
                        event_type: 'summary',
                        fatalities: rawData.west_bank.killed?.total || 0,
                        injuries: rawData.west_bank.injured?.total || 0,
                    });
                }
            }
        } catch (e) {
            logger.warn('Error processing summary data', e.message);
        }

        // Helper to read partitioned data
        const readPartitioned = async (subDir, defaultLocation) => {
            const dirPath = path.join(t4pDir, subDir);
            try {
                const indexPath = path.join(dirPath, 'index.json');
                await fs.access(indexPath);
                const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

                if (index.files) {
                    for (const fileEntry of index.files) {
                        const filePath = path.join(dirPath, fileEntry.file);
                        const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                        if (content.data && Array.isArray(content.data)) {
                            // Add location and event type if missing
                            const records = content.data.map(r => ({
                                ...r,
                                location: r.location || defaultLocation,
                                event_type: r.event_type || 'daily_casualty_report',
                                fatalities: r.killed || 0,
                                injuries: r.injured || 0
                            }));
                            dataArray.push(...records);
                        }
                    }
                }
            } catch (e) {
                // Directory might not exist or be empty, which is fine
                // logger.warn(`Could not read ${subDir}`, e.message);
            }
        };

        // 2. Process Gaza Casualties
        await readPartitioned('casualties', 'Gaza');

        // 3. Process West Bank Casualties
        await readPartitioned('westbank', 'West Bank');

        if (dataArray.length === 0) {
            logger.warn('No conflict data to process');
            return;
        }

        logger.info(`Found ${dataArray.length} total conflict records (summary + daily)`);

        const transformer = new ConflictTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            dataArray,
            {
                source: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                category: 'conflict',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true, // Partitioning is good now that we have hundreds of records
                outputDir: path.join(UNIFIED_DIR, 'conflict'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} conflict records`);

            // Save all-data.json
            const outputPath = path.join(UNIFIED_DIR, 'conflict', 'all-data.json');
            await fs.writeFile(
                outputPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'Tech4Palestine',
                        category: 'conflict',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'conflict', 'metadata.json'),
                JSON.stringify({
                    category: 'conflict',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: ['Tech4Palestine'],
                    quality: results.validated ? {
                        average_score: results.validated.qualityScore,
                        completeness: results.validated.completeness,
                        consistency: results.validated.consistency,
                        accuracy: results.validated.accuracy,
                    } : null,
                }, null, 2),
                'utf-8'
            );
        } else {
            logger.error('Conflict data processing failed', results.errors);
        }
    } catch (error) {
        logger.error('Error processing conflict data:', error.message);
    }
}

/**
 * Process Tech4Palestine Infrastructure Data
 */
async function processTech4PalestineInfrastructure() {
    logger.info('Processing Tech4Palestine infrastructure data...');
    try {
        const t4pDir = path.join(DATA_DIR, 'tech4palestine');
        const infraDir = path.join(t4pDir, 'infrastructure');

        try {
            await fs.access(infraDir);
        } catch {
            throw new Error('Tech4Palestine infrastructure data not found, skipping');
        }

        const dataArray = [];
        const indexPath = path.join(infraDir, 'index.json');

        try {
            const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
            if (index.files) {
                for (const fileEntry of index.files) {
                    const filePath = path.join(infraDir, fileEntry.file);
                    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                    if (content.data && Array.isArray(content.data)) {
                        dataArray.push(...content.data);
                    }
                }
            }
        } catch (e) {
            logger.warn('Error reading infrastructure index', e.message);
        }

        if (dataArray.length === 0) return;

        logger.info(`Found ${dataArray.length} T4P infrastructure records`);

        // Use InfrastructureTransformer but map T4P fields to what it expects
        // T4P: { report_date, civic_buildings: { ext_destroyed: 5 }, ... }
        // We need to flatten this into multiple records or map it to a summary record

        // Strategy: Create a record for each damage type per day
        const flattenedRecords = [];

        dataArray.forEach(record => {
            const date = record.report_date || record.date;

            // Residential
            if (record.residential?.ext_destroyed) {
                flattenedRecords.push({
                    date,
                    location: 'Gaza',
                    type: 'residential',
                    damage_level: 'destroyed',
                    value: record.residential.ext_destroyed,
                    unit: 'units',
                    source: 'Tech4Palestine'
                });
            }

            // Educational
            if (record.educational_buildings?.ext_destroyed) {
                flattenedRecords.push({
                    date,
                    location: 'Gaza',
                    type: 'educational',
                    damage_level: 'destroyed',
                    value: record.educational_buildings.ext_destroyed,
                    unit: 'buildings',
                    source: 'Tech4Palestine'
                });
            }

            // Mosques
            if (record.places_of_worship?.ext_mosques_destroyed) {
                flattenedRecords.push({
                    date,
                    location: 'Gaza',
                    type: 'religious',
                    damage_level: 'destroyed',
                    value: record.places_of_worship.ext_mosques_destroyed,
                    unit: 'buildings',
                    source: 'Tech4Palestine'
                });
            }
        });

        const transformer = new InfrastructureTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        // We need to merge this with existing HDX infrastructure data
        // For now, we'll just process it into the infrastructure directory
        // The pipeline handles appending if we configure it right, or we can merge manually
        // But since pipeline overwrites by default unless we load existing...

        // Let's load existing infrastructure data first
        const infraUnifiedDir = path.join(UNIFIED_DIR, 'infrastructure');
        let existingData = [];
        try {
            const existingPath = path.join(infraUnifiedDir, 'all-data.json');
            const existingContent = JSON.parse(await fs.readFile(existingPath, 'utf-8'));
            existingData = existingContent.data || [];
        } catch { }

        const results = await pipeline.process(
            flattenedRecords,
            {
                source: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                category: 'infrastructure',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true,
                outputDir: infraUnifiedDir,
            }
        );

        if (results.success) {
            const mergedData = [...existingData, ...(results.enriched || [])];

            // Save merged
            await fs.writeFile(
                path.join(infraUnifiedDir, 'all-data.json'),
                JSON.stringify({
                    data: mergedData,
                    metadata: {
                        total_records: mergedData.length,
                        generated_at: new Date().toISOString(),
                        sources: ['HDX', 'Tech4Palestine'],
                        category: 'infrastructure',
                    },
                }, null, 2),
                'utf-8'
            );

            logger.success(`Merged T4P infrastructure data: ${mergedData.length} total records`);
        }

    } catch (error) {
        logger.error('Error processing T4P infrastructure:', error.message);
    }
}

/**
 * Process Tech4Palestine Press Killed
 */
async function processPressData() {
    logger.info('Processing press killed data...');
    try {
        const t4pDir = path.join(DATA_DIR, 'tech4palestine');
        const pressPath = path.join(t4pDir, 'press-killed.json');

        try {
            await fs.access(pressPath);
        } catch { 
            throw new Error('Tech4Palestine press data not found, skipping');
        }

        const content = JSON.parse(await fs.readFile(pressPath, 'utf-8'));
        const rawData = content.data || content;

        if (!rawData || rawData.length === 0) return;

        logger.info(`Found ${rawData.length} press casualty records`);

        // Map to conflict records
        const conflictRecords = rawData.map(record => {
            // Attempt to extract date from notes
            let extractedDate = '2023-10-07'; // Fallback
            let isExact = false;
            if (record.notes) {
                // Regex for formats like "Oct 13, 2023", "October 13, 2023", "2023-10-13"
                const dateMatch = record.notes.match(/\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b/i) || record.notes.match(/\\b\\d{4}-\\d{2}-\\d{2}\\b/);
                if (dateMatch) {
                    const parsedDate = new Date(dateMatch[0]);
                    if (!isNaN(parsedDate.getTime())) {
                        extractedDate = parsedDate.toISOString().split('T')[0];
                        isExact = true;
                    }
                }
            }
            
            return {
                date: extractedDate,
                date_precision: isExact ? 'day' : 'unknown',
                event_type: 'killing of journalist',
                fatalities: 1,
                injuries: 0,
                location: 'Gaza', // Most are in Gaza
                description: `Journalist killed: ${record.name} (${record.name_en}). ${record.notes || ''}`,
                actor2: record.name_en
            };
        });

        const transformer = new ConflictTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        // Load existing conflict data
        const conflictDir = path.join(UNIFIED_DIR, 'conflict');
        let existingData = [];
        try {
            const existingPath = path.join(conflictDir, 'all-data.json');
            const existingContent = JSON.parse(await fs.readFile(existingPath, 'utf-8'));
            existingData = existingContent.data || [];
        } catch { }

        const results = await pipeline.process(
            conflictRecords,
            {
                source: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                category: 'conflict',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true,
                outputDir: conflictDir,
            }
        );

        if (results.success) {
            const mergedData = [...existingData, ...(results.enriched || [])];

            await fs.writeFile(
                path.join(conflictDir, 'all-data.json'),
                JSON.stringify({
                    data: mergedData,
                    metadata: {
                        total_records: mergedData.length,
                        generated_at: new Date().toISOString(),
                        sources: ['Tech4Palestine'],
                        category: 'conflict',
                    },
                }, null, 2),
                'utf-8'
            );
            logger.success(`Merged press data: ${mergedData.length} total conflict records`);
        }

    } catch (error) {
        logger.error('Error processing press data:', error.message);
    }
}

/**
 * Process Tech4Palestine Martyrs (Killed in Gaza)
 */
async function processMartyrsData() {
    logger.info('Processing martyrs data...');
    try {
        const t4pDir = path.join(DATA_DIR, 'tech4palestine');
        const killedDir = path.join(t4pDir, 'killed-in-gaza');

        try {
            await fs.access(killedDir);
        } catch { 
            throw new Error('Tech4Palestine martyrs directory not found, skipping');
        }

        const dataArray = [];
        const indexPath = path.join(killedDir, 'index.json');

        try {
            const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
            if (index.files) {
                for (const fileEntry of index.files) {
                    const filePath = path.join(killedDir, fileEntry.file);
                    const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                    if (content.data && Array.isArray(content.data)) {
                        dataArray.push(...content.data);
                    }
                }
            }
        } catch (e) { }

        if (dataArray.length === 0) return;

        logger.info(`Found ${dataArray.length} martyr records`);

        const transformer = new MartyrsTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const martyrsDir = path.join(UNIFIED_DIR, 'martyrs_snapshot_2023');

        const results = await pipeline.process(
            dataArray,
            {
                source: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                category: 'martyrs_snapshot_2023',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true,
                outputDir: martyrsDir,
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} martyr records`);

            // Frozen snapshot — Tech4Palestine stopped publishing this dataset on 2023-10-07.
            await fs.writeFile(
                path.join(martyrsDir, 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'Tech4Palestine',
                        category: 'martyrs_snapshot_2023',
                        active: false,
                        frozen_at: '2023-10-07',
                        notice: 'Historical baseline only — upstream stopped publishing on 2023-10-07.',
                    },
                }, null, 2),
                'utf-8'
            );

            await fs.writeFile(
                path.join(martyrsDir, 'metadata.json'),
                JSON.stringify({
                    category: 'martyrs_snapshot_2023',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    active: false,
                    frozen_at: '2023-10-07',
                    sources: ['Tech4Palestine'],
                }, null, 2),
                'utf-8'
            );
        }

    } catch (error) {
        logger.error('Error processing martyrs data:', error.message);
    }
}

/**
 * Process HDX data for various categories
 */
async function processHDXData() {
    logger.info('Processing HDX data...');

    const categories = [
        { name: 'infrastructure', transformer: new InfrastructureTransformer() },
        { name: 'education', transformer: new EducationTransformer() },
        { name: 'health', transformer: new HealthTransformer() },
        { name: 'water', transformer: new WaterTransformer() },
        { name: 'refugees', transformer: new RefugeeTransformer() },
    ];

    for (const category of categories) {
        try {
            const hdxCategoryDir = path.join(DATA_DIR, 'hdx', category.name);

            // Check if category directory exists
            try {
                await fs.access(hdxCategoryDir);
            } catch {
                throw new Error(`HDX ${category.name} directory not found, skipping`);
            }

            // Read all subdirectories in the category
            const subdirs = await fs.readdir(hdxCategoryDir, { withFileTypes: true });
            const datasetDirs = subdirs.filter(d => d.isDirectory());

            if (datasetDirs.length === 0) {
                logger.warn(`No HDX ${category.name} datasets found`);
                continue;
            }

            // Collect all data from all datasets in this category
            let allData = [];

            for (const datasetDir of datasetDirs) {
                const datasetPath = path.join(hdxCategoryDir, datasetDir.name);
                const dataFiles = await fs.readdir(datasetPath);

                // Look for unified-*.json files (saved by hdx fetcher after transformation)
                // Fall back to raw-*.json if no unified files exist
                const unifiedFiles = dataFiles.filter(f => f.startsWith('unified-') && f.endsWith('.json'));
                const rawFiles = dataFiles.filter(f => f.startsWith('raw-') && f.endsWith('.json'));
                const targetFiles = unifiedFiles.length > 0 ? unifiedFiles : rawFiles;

                for (const dataFile of targetFiles) {
                    try {
                        const dataPath = path.join(datasetPath, dataFile);
                        const fileContent = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
                        let data = [];
                        if (fileContent?.data?.data?.results && Array.isArray(fileContent.data.data.results)) {
                            data = fileContent.data.data.results; // Fix for hrp-projects-pse nested structure
                        } else {
                            data = fileContent.data || (Array.isArray(fileContent) ? fileContent : []);
                        }

                        if (Array.isArray(data) && data.length > 0) {
                            allData = allData.concat(data);
                        }
                    } catch { /* skip unparseable files */ }
                }
            }

            if (allData.length === 0) {
                logger.warn(`No HDX ${category.name} data available`);
                continue;
            }

            logger.info(`Processing ${allData.length} ${category.name} records from ${datasetDirs.length} datasets`);

            // Detect whether data was already transformed by the HDX fetcher's schemaUtils.createEvent()
            // (those records already have id/date/category/metrics — use transformer only for raw data)
            const firstRecord = allData[0] || {};
            const alreadyTransformed = firstRecord.id && firstRecord.category && firstRecord.metrics !== undefined;

            let enriched;
            if (alreadyTransformed) {
                // Canonicalize already-transformed records to v3 shape
                enriched = allData.map(r => ({
                    id: r.id,
                    date: r.date?.split('T')[0] || null,
                    category: r.category || category.name,
                    event_type: r.event_type || 'indicator_measurement',
                    schema_version: '3.0.0',
                    location: {
                        name: r.location?.city || r.location?.name || r.location?.governorate || 'Palestine',
                        governorate: r.location?.governorate || null,
                        region: r.location?.region || 'Palestine',
                        lat: r.location?.lat || null,
                        lon: r.location?.lon || null,
                        precision: r.location?.precision || 'unknown',
                    },
                    metrics: {
                        killed:     r.metrics?.killed     || 0,
                        injured:    r.metrics?.injured    || 0,
                        displaced:  r.metrics?.displaced  || 0,
                        affected:   r.metrics?.affected   || 0,
                        demolished: r.metrics?.demolished || 0,
                        detained:   r.metrics?.detained   || 0,
                        count:      r.metrics?.count      || 0,
                        value:      r.metrics?.value      || 0,
                        unit:       r.metrics?.unit       || null,
                    },
                    description:      r.details || r.description || '',
                    actors:           r.actors   || [],
                    severity_index:   r.severity_index || 0,
                    temporal_context: r.temporal_context || { days_since_baseline: null, baseline_date: '2023-10-07', conflict_phase: null },
                    quality:          r.quality  || { score: 0.7, completeness: 0.7, consistency: 1, accuracy: 0.8, confidence: 'medium', verified: false },
                    sources: r.sources || [{ name: 'HDX', organization: 'UN OCHA', url: r.source_link || null, license: 'varies', fetched_at: new Date().toISOString() }],
                }));
            } else {
                // Raw data — run through the category transformer
                const pipeline = new UnifiedPipeline({ logger });
                const results = await pipeline.process(
                    allData,
                    { source: 'HDX', organization: 'UN OCHA', category: category.name },
                    category.transformer,
                    { enrich: true, validate: true, partition: false, outputDir: path.join(UNIFIED_DIR, category.name) }
                );
                enriched = results.enriched || [];
            }

            const fakeResults = { success: true, enriched, stats: { recordCount: enriched.length } };
            const results = fakeResults;

            if (results.success) {
                logger.success(`Processed ${results.stats.recordCount} ${category.name} records`);

                // Save all-data.json
                const outputPath = path.join(UNIFIED_DIR, category.name, 'all-data.json');
                await fs.writeFile(
                    outputPath,
                    JSON.stringify({
                        data: results.enriched || [],
                        metadata: {
                            total_records: results.stats.recordCount,
                            generated_at: new Date().toISOString(),
                            source: 'HDX',
                            category: category.name,
                        },
                    }, null, 2),
                    'utf-8'
                );

                // Save metadata.json
                await fs.writeFile(
                    path.join(UNIFIED_DIR, category.name, 'metadata.json'),
                    JSON.stringify({
                        category: category.name,
                        total_records: results.stats.recordCount,
                        last_updated: new Date().toISOString(),
                        sources: ['HDX'],
                        quality: results.validated ? {
                            average_score: results.validated.qualityScore,
                            completeness: results.validated.completeness,
                            consistency: results.validated.consistency,
                            accuracy: results.validated.accuracy,
                        } : null,
                    }, null, 2),
                    'utf-8'
                );
            } else {
                logger.error(`${category.name} data processing failed`, results.errors);
            }
        } catch (error) {
            logger.error(`Error processing ${category.name} data:`, error.message);
        }
    }
}

/**
 * Process PCBS official statistics data
 */
async function processPCBSData() {
    logger.info('Processing PCBS official statistics...');

    try {
        const pcbsDir = path.join(DATA_DIR, 'pcbs');
        const allIndicatorsPath = path.join(pcbsDir, 'all-indicators.json');

        // Check if file exists
        try {
            await fs.access(allIndicatorsPath);
        } catch {
            throw new Error('PCBS data not found, skipping');
        }

        const fileContent = JSON.parse(await fs.readFile(allIndicatorsPath, 'utf-8'));
        const rawData = fileContent.data || fileContent;

        if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No PCBS data available');
            return;
        }

        const transformer = new PCBSTransformer();

        // Transform all data
        const transformed = transformer.transform(rawData, {
            source: 'PCBS',
            organization: 'Palestinian Central Bureau of Statistics',
        });

        // Enrich with trend analysis
        const enriched = transformer.enrich(transformed);

        // Validate
        const validation = await validateDataset(transformed, 'pcbs');
        if (!validation.meetsThreshold) {
            logger.warn(`PCBS validation quality below threshold (score: ${(validation.qualityScore * 100).toFixed(1)}%)`);
        }

        // Group by category
        const byCategory = {};
        enriched.forEach(record => {
            const cat = record.category || 'general';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(record);
        });

        const pcbsUnifiedDir = path.join(UNIFIED_DIR, 'pcbs');
        await fs.mkdir(pcbsUnifiedDir, { recursive: true });

        // Save category-specific files
        for (const [cat, records] of Object.entries(byCategory)) {
            await fs.writeFile(
                path.join(pcbsUnifiedDir, `${cat.toLowerCase().replace(/\s+/g, '-')}.json`),
                JSON.stringify({ category: cat, data: records, metadata: { source: 'PCBS', count: records.length } }, null, 2),
                'utf-8'
            );
        }

        // Also write the unified all-data.json for API consumption
        await fs.writeFile(
            path.join(pcbsUnifiedDir, 'all-data.json'),
            JSON.stringify({
                data: enriched,
                metadata: {
                    category: 'pcbs',
                    source: 'PCBS',
                    organization: 'Palestinian Central Bureau of Statistics',
                    total_records: enriched.length,
                    generated_at: new Date().toISOString(),
                },
            }, null, 2),
            'utf-8'
        );

        logger.success(`Processed ${enriched.length} PCBS records`);
        return { count: enriched.length };

    } catch (error) {
        logger.error('Error processing PCBS data:', error.message);
    }
}

/**
 * Process News Data
 */
async function processNewsData() {
    logger.info('Processing news data...');

    try {
        const newsDir = path.join(DATA_DIR, 'news');
        const allArticlesPath = path.join(newsDir, 'all-articles.json');

        try {
            await fs.access(allArticlesPath);
        } catch {
            throw new Error('News data not found, skipping');
        }

        const fileContent = JSON.parse(await fs.readFile(allArticlesPath, 'utf-8'));
        const rawData = fileContent.articles || [];

        if (rawData.length === 0) {
            logger.warn('No news articles available');
            return;
        }

        const transformer = new NewsTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const unifiedNewsDir = path.join(UNIFIED_DIR, 'news');
        await fs.mkdir(unifiedNewsDir, { recursive: true });

        const results = await pipeline.process(
            rawData,
            {
                source: 'Multiple (RSS)',
                organization: 'Various',
                category: 'news',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true, // Partition by date/month is useful for news
                outputDir: unifiedNewsDir,
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} news articles`);

            // Save all-data.json (careful with size, but news is text heavy)
            await fs.writeFile(
                path.join(unifiedNewsDir, 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'RSS Feeds',
                        category: 'news',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata
            await fs.writeFile(
                path.join(unifiedNewsDir, 'metadata.json'),
                JSON.stringify({
                    category: 'news',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: fileContent.sources || [],
                }, null, 2),
                'utf-8'
            );
        }

    } catch (error) {
        logger.error('Error processing news data:', error.message);
    }
}

/**
 * Process WHO health data from HDX
 */
async function processWHOData() {
    logger.info('Processing WHO health data from HDX...');

    try {
        const whoDatasetDir = path.join(DATA_DIR, 'hdx', 'health', 'who-data-for-pse');

        // Check if directory exists
        try {
            await fs.access(whoDatasetDir);
        } catch {
            throw new Error('WHO data directory not found, skipping');
        }

        // Read all raw WHO files
        const files = await fs.readdir(whoDatasetDir);
        const rawFiles = files.filter(f => f.startsWith('raw-') && f.endsWith('.json'));

        if (rawFiles.length === 0) {
            logger.warn('No WHO raw data files found');
            return;
        }

        logger.info(`Found ${rawFiles.length} WHO datasets`);

        // Combine all WHO data
        let allWHOData = [];
        for (const file of rawFiles) {
            try {
                const filePath = path.join(whoDatasetDir, file);
                const fileContent = JSON.parse(await fs.readFile(filePath, 'utf-8'));

                // WHO data structure: { data: { csv: [...] } }
                if (fileContent.data && fileContent.data.csv && Array.isArray(fileContent.data.csv)) {
                    allWHOData = allWHOData.concat(fileContent.data.csv);
                    logger.info(`  Loaded ${fileContent.data.csv.length} records from ${file}`);
                }
            } catch (error) {
                logger.warn(`  Could not read ${file}: ${error.message}`);
            }
        }

        if (allWHOData.length === 0) {
            logger.warn('No WHO data records found');
            return;
        }

        logger.info(`Processing ${allWHOData.length} total WHO health records...`);

        const transformer = new WHOHealthTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        // Read existing health data to merge
        const healthDir = path.join(UNIFIED_DIR, 'health');
        await fs.mkdir(healthDir, { recursive: true });

        let existingHealthData = [];
        try {
            const existingPath = path.join(healthDir, 'all-data.json');
            const existingContent = JSON.parse(await fs.readFile(existingPath, 'utf-8'));
            existingHealthData = existingContent.data || [];
            logger.info(`Found ${existingHealthData.length} existing health records`);
        } catch {
            logger.info('No existing health data found');
        }

        const results = await pipeline.process(
            { data: { csv: allWHOData } }, // Wrap in WHO structure
            {
                source: 'WHO',
                organization: 'World Health Organization',
                category: 'health',
            },
            transformer,
            {
                enrich: true,
                validate: false, // Skip validation for now (WHO data has unique schema)
                partition: allWHOData.length > 10000,
                outputDir: healthDir,
            }
        );

        if (results.success && results.enriched) {
            logger.success(`Processed ${results.stats.recordCount} WHO health records`);

            // Merge with existing HDX/GoodShepherd health data
            const mergedData = [...existingHealthData, ...results.enriched];
            logger.info(`Total merged health records: ${mergedData.length}`);

            // Save merged data
            const outputPath = path.join(healthDir, 'all-data.json');
            await fs.writeFile(
                outputPath,
                JSON.stringify({
                    data: mergedData,
                    metadata: {
                        total_records: mergedData.length,
                        generated_at: new Date().toISOString(),
                        sources: ['WHO', 'HDX', 'GoodShepherd'],
                        category: 'health',
                    },
                }, null, 2),
                'utf-8'
            );

            // Update metadata
            await fs.writeFile(
                path.join(healthDir, 'metadata.json'),
                JSON.stringify({
                    category: 'health',
                    total_records: mergedData.length,
                    last_updated: new Date().toISOString(),
                    sources: ['WHO', 'HDX', 'GoodShepherd'],
                }, null, 2),
                'utf-8'
            );

            logger.success(`[OK] Merged health data saved: ${mergedData.length} total records`);
        } else {
            logger.error('WHO data processing failed');
            if (results.errors) {
                console.error(results.errors);
            }
        }
    } catch (error) {
        logger.error('Error processing WHO data:', error.message);
        console.error(error);
    }
}


/**
 * Process GoodShepherd Healthcare Data
 */
async function processGoodShepherdHealthcare() {
    logger.info('Processing GoodShepherd healthcare data...');

    try {
        const gsDir = path.join(DATA_DIR, 'goodshepherd', 'healthcare');

        // Check if directory exists
        try {
            await fs.access(gsDir);
        } catch {
            throw new Error('GoodShepherd healthcare data not found, skipping');
        }

        // Find all JSON files
        const files = await fs.readdir(gsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        if (jsonFiles.length === 0) {
            logger.warn('No GoodShepherd healthcare JSON files found');
            return;
        }

        const pipeline = new UnifiedPipeline({ logger });
        const transformer = new HealthTransformer();
        let totalProcessed = 0;

        // Load existing health data
        const healthDir = path.join(UNIFIED_DIR, 'health');
        const existingPath = path.join(healthDir, 'all-data.json');
        let existingData = [];
        try {
            const existing = JSON.parse(await fs.readFile(existingPath, 'utf-8'));
            existingData = existing.data || [];
        } catch (e) {
            // No existing data
        }

        let newData = [];

        for (const file of jsonFiles) {
            const filePath = path.join(gsDir, file);
            const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            const rawData = content.data || [];

            const results = await pipeline.process(
                rawData,
                {
                    source: 'GoodShepherd',
                    category: 'health',
                    dataset: 'healthcare-incidents'
                },
                transformer,
                { partition: false, outputDir: healthDir }
            );

            if (results.success && results.enriched) {
                newData = [...newData, ...results.enriched];
                totalProcessed += results.stats.recordCount;
            }
        }

        if (newData.length > 0) {
            // Merge and save
            const mergedData = [...existingData, ...newData];

            await fs.writeFile(
                existingPath,
                JSON.stringify({
                    data: mergedData,
                    metadata: {
                        total_records: mergedData.length,
                        generated_at: new Date().toISOString(),
                        source: 'HDX, WHO, GoodShepherd',
                        category: 'health',
                    },
                }, null, 2),
                'utf-8'
            );

            logger.success(`Processed and merged ${totalProcessed} GoodShepherd healthcare records`);
        }

    } catch (error) {
        logger.error('Error processing GoodShepherd healthcare data:', error.message);
    }
}

/**
 * Process Cultural Heritage Data
 */
async function processCultureData() {
    logger.info('Processing cultural heritage data...');

    try {
        const cultureDir = path.join(DATA_DIR, 'culture');
        const heritageFile = path.join(cultureDir, 'heritage-sites.json');

        // Check if file exists
        try {
            await fs.access(heritageFile);
        } catch {
            throw new Error('Cultural heritage data not found, skipping');
        }

        const fileContent = JSON.parse(await fs.readFile(heritageFile, 'utf-8'));
        const rawData = fileContent.sites || fileContent.data || fileContent;

        if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No cultural heritage data available');
            return;
        }

        const transformer = new CultureTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            rawData,
            {
                source: 'UNESCO, Ministry of Tourism, NGO Reports',
                organization: 'Multiple',
                category: 'culture',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: path.join(UNIFIED_DIR, 'culture'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} cultural heritage sites`);

            // Save all-data.json
            const outputPath = path.join(UNIFIED_DIR, 'culture', 'all-data.json');
            await fs.writeFile(
                outputPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'UNESCO, Ministry of Tourism, NGO Reports',
                        category: 'culture',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'culture', 'metadata.json'),
                JSON.stringify({
                    category: 'culture',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: ['UNESCO', 'Ministry of Tourism', 'NGO Reports'],
                    quality: results.validated ? {
                        average_score: results.validated.qualityScore,
                        completeness: results.validated.completeness,
                        consistency: results.validated.consistency,
                        accuracy: results.validated.accuracy,
                    } : null,
                }, null, 2),
                'utf-8'
            );
        } else {
            logger.error('Cultural heritage data processing failed', results.errors);
        }
    } catch (error) {
        logger.error('Error processing cultural heritage data:', error.message);
    }
}

/**
 * Process Land & Settlements Data
 */
async function processLandData() {
    logger.info('Processing land and settlements data...');

    try {
        const landDir = path.join(DATA_DIR, 'land');

        // Check if land directory exists
        try {
            await fs.access(landDir);
        } catch {
            throw new Error('Land data not found, skipping');
        }

        const allData = [];

        // Load settlements
        try {
            const settlementsPath = path.join(landDir, 'settlements', 'settlements.json');
            const content = JSON.parse(await fs.readFile(settlementsPath, 'utf-8'));
            const records = content.records || content.data || [];
            records.forEach(r => r.type = 'settlement');
            allData.push(...records);
            logger.info(`  Loaded ${records.length} settlement records`);
        } catch (e) {
            logger.warn('Settlements data not found');
        }

        // Load checkpoints
        try {
            const checkpointsPath = path.join(landDir, 'checkpoints', 'checkpoints.json');
            const content = JSON.parse(await fs.readFile(checkpointsPath, 'utf-8'));
            const records = content.records || content.data || [];
            records.forEach(r => r.type = 'checkpoint');
            allData.push(...records);
            logger.info(`  Loaded ${records.length} checkpoint records`);
        } catch (e) {
            logger.warn('Checkpoints data not found');
        }

        // Load demolitions from Good Shepherd
        try {
            const demolitionsDir = path.join(DATA_DIR, 'goodshepherd', 'demolitions');
            const indexPath = path.join(demolitionsDir, 'index.json');

            // Check if index exists
            await fs.access(indexPath);
            const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));

            if (index.files && Array.isArray(index.files)) {
                let loadedCount = 0;
                for (const fileEntry of index.files) {
                    const filePath = path.join(demolitionsDir, fileEntry.file);
                    try {
                        const fileContent = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                        const records = fileContent.data || [];

                        records.forEach(r => {
                            r.type = 'demolition';
                            // Ensure date is present (Good Shepherd uses 'date')
                            if (!r.date && r.demolition_date) r.date = r.demolition_date;
                        });

                        allData.push(...records);
                        loadedCount += records.length;
                    } catch (err) {
                        logger.warn(`Failed to load demolition file ${fileEntry.file}: ${err.message}`);
                    }
                }
                logger.info(`  Loaded ${loadedCount} demolition records from Good Shepherd`);
            }
        } catch (e) {
            logger.warn('Good Shepherd demolitions data not found');
        }

        // Load wall segments
        try {
            const wallPath = path.join(landDir, 'wall', 'wall-segments.json');
            const content = JSON.parse(await fs.readFile(wallPath, 'utf-8'));
            const records = content.records || content.data || [];
            records.forEach(r => r.type = 'wall');
            allData.push(...records);
            logger.info(`  Loaded ${records.length} wall segment records`);
        } catch (e) {
            logger.warn('Wall segments data not found');
        }

        if (allData.length === 0) {
            logger.warn('No land data available');
            return;
        }

        logger.info(`Processing ${allData.length} total land records`);

        const transformer = new LandTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            allData,
            {
                source: 'OCHA, B\'Tselem, Peace Now',
                organization: 'Multiple',
                category: 'land',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: path.join(UNIFIED_DIR, 'land'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} land records`);

            // Save all-data.json
            const outputPath = path.join(UNIFIED_DIR, 'land', 'all-data.json');
            await fs.writeFile(
                outputPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'OCHA, B\'Tselem, Peace Now',
                        category: 'land',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'land', 'metadata.json'),
                JSON.stringify({
                    category: 'land',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: ['OCHA', 'B\'Tselem', 'Peace Now'],
                    quality: results.validated ? {
                        average_score: results.validated.qualityScore,
                        completeness: results.validated.completeness,
                        consistency: results.validated.consistency,
                        accuracy: results.validated.accuracy,
                    } : null,
                }, null, 2),
                'utf-8'
            );
        } else {
            logger.error('Land data processing failed', results.errors);
        }
    } catch (error) {
        logger.error('Error processing land data:', error.message);
    }
}

/**
 * Process Water/WASH data
 */
async function processWaterData() {
    logger.info('Processing Water/WASH data...');

    try {
        const washDataPath = path.join(DATA_DIR, 'water', 'raw-wash-data.json');

        try {
            await fs.access(washDataPath);
        } catch {
            throw new Error('Water data not found, skipping');
        }

        const fileContent = JSON.parse(await fs.readFile(washDataPath, 'utf-8'));
        const rawData = fileContent.data || [];

        if (rawData.length === 0) {
            logger.warn('No water data available');
            return;
        }

        const transformer = new WaterTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            rawData,
            {
                source: 'HDX',
                organization: 'UN Agencies',
                category: 'water',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: path.join(UNIFIED_DIR, 'water'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} water records`);

            // Save all-data.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'water', 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'HDX',
                        category: 'water'
                    }
                }, null, 2),
                'utf-8'
            );
        }
    } catch (error) {
        logger.error('Error processing water data:', error.message);
    }
}

/**
 * Process Infrastructure data
 */
async function processInfrastructureData() {
    logger.info('Processing Infrastructure data...');

    try {
        const infraDataPath = path.join(DATA_DIR, 'infrastructure', 'raw-damage-reports.json');

        try {
            await fs.access(infraDataPath);
        } catch {
            throw new Error('Infrastructure data not found, skipping');
        }

        const fileContent = JSON.parse(await fs.readFile(infraDataPath, 'utf-8'));
        const rawData = fileContent.data || [];

        if (rawData.length === 0) {
            logger.warn('No infrastructure data available');
            return;
        }

        const transformer = new InfrastructureTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const results = await pipeline.process(
            rawData,
            {
                source: 'TechForPalestine',
                organization: 'GMO',
                category: 'infrastructure',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: path.join(UNIFIED_DIR, 'infrastructure'),
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} infrastructure records`);

            // Load existing infrastructure data (e.g. from T4P flattening step)
            const infraDir = path.join(UNIFIED_DIR, 'infrastructure');
            let existingData = [];
            try {
                const existing = JSON.parse(await fs.readFile(path.join(infraDir, 'all-data.json'), 'utf-8'));
                existingData = existing.data || [];
            } catch { /* no existing data */ }

            // Merge and deduplicate by id
            const newRecords = results.enriched || [];
            const existingIds = new Set(existingData.map(r => r.id));
            const deduped = [
                ...existingData,
                ...newRecords.filter(r => !existingIds.has(r.id))
            ];

            // Save merged all-data.json
            await fs.writeFile(
                path.join(infraDir, 'all-data.json'),
                JSON.stringify({
                    data: deduped,
                    metadata: {
                        total_records: deduped.length,
                        generated_at: new Date().toISOString(),
                        sources: ['HDX', 'TechForPalestine'],
                        category: 'infrastructure'
                    }
                }, null, 2),
                'utf-8'
            );

            logger.success(`Infrastructure merged: ${deduped.length} total records`);
        }
    } catch (error) {
        logger.error('Error processing infrastructure data:', error.message);
    }
}

/**
 * Create empty unified data structure for missing categories
 */
async function createEmptyStructures() {
    const categories = [
        'conflict',
        'economic',
        'infrastructure',
        'health',
        'education',
        'refugees',
        'culture',
        'land',
    ];

    for (const category of categories) {
        const categoryDir = path.join(UNIFIED_DIR, category);
        const allDataPath = path.join(categoryDir, 'all-data.json');

        try {
            // Check if all-data.json exists and has data
            const stats = await fs.stat(allDataPath);
            const content = JSON.parse(await fs.readFile(allDataPath, 'utf-8'));

            if (content.data && content.data.length > 0) {
                // Data exists, skip
                continue;
            }
        } catch {
            // File doesn't exist or is empty, create structure
        }

        // Create empty structure
        await fs.mkdir(categoryDir, { recursive: true });
        await fs.mkdir(path.join(categoryDir, 'partitions'), { recursive: true });

        const emptyData = {
            data: [],
            metadata: {
                total_records: 0,
                generated_at: new Date().toISOString(),
            },
        };

        await fs.writeFile(
            allDataPath,
            JSON.stringify(emptyData, null, 2),
            'utf-8'
        );

        await fs.writeFile(
            path.join(categoryDir, 'recent.json'),
            JSON.stringify(emptyData, null, 2),
            'utf-8'
        );

        await fs.writeFile(
            path.join(categoryDir, 'metadata.json'),
            JSON.stringify({
                category,
                total_records: 0,
                last_updated: new Date().toISOString(),
                sources: [],
            }, null, 2),
            'utf-8'
        );

        await fs.writeFile(
            path.join(categoryDir, 'partitions', 'index.json'),
            JSON.stringify({
                partitions: [],
                total_records: 0,
                total_partitions: 0,
            }, null, 2),
            'utf-8'
        );
    }
}

/**
 * Process West Bank specific data (schools, villages, barrier)
 */
async function processWestBankData() {
    logger.info('Processing West Bank specific data...');

    const westbankDir = path.join(DATA_DIR, 'westbank');
    const pipeline = new UnifiedPipeline({ logger });

    let schoolsResults = null;
    let villagesResults = null;
    let barrierResults = null;

    try {
        // Process Schools
        const schoolsPath = path.join(westbankDir, 'education/schools/raw-data.json');
        try {
            const schoolsData = JSON.parse(await fs.readFile(schoolsPath, 'utf-8'));
            const schoolsTransformer = new WestBankSchoolsTransformer();

            schoolsResults = await pipeline.process(
                schoolsData,
                { source: 'HDX', category: 'education', dataset: 'west-bank-schools' },
                schoolsTransformer,
                { partition: false, outputDir: path.join(UNIFIED_DIR, 'education') }
            );

            if (schoolsResults.success) {
                // Load existing education data
                const eduDir = path.join(UNIFIED_DIR, 'education');
                const eduPath = path.join(eduDir, 'all-data.json');
                let existingData = [];
                try {
                    const existing = JSON.parse(await fs.readFile(eduPath, 'utf-8'));
                    existingData = existing.data || [];
                } catch (e) {
                    // No existing data, that's fine
                }

                // Merge with new schools data
                const mergedData = [...existingData, ...(schoolsResults.enriched || [])];

                // Save merged data
                await fs.writeFile(
                    eduPath,
                    JSON.stringify({
                        data: mergedData,
                        metadata: {
                            total_records: mergedData.length,
                            generated_at: new Date().toISOString(),
                            source: 'HDX',
                            category: 'education',
                        },
                    }, null, 2),
                    'utf-8'
                );

                logger.success(`Processed and saved ${schoolsResults.stats.recordCount} West Bank schools`);
            }
        } catch (error) {
            logger.warn(`Could not process West Bank schools: ${error.message}`);
        }

        // Process Villages
        const villagesPath = path.join(westbankDir, 'infrastructure/villages/raw-data.json');
        try {
            const villagesData = JSON.parse(await fs.readFile(villagesPath, 'utf-8'));
            const villagesTransformer = new WestBankVillagesTransformer();

            villagesResults = await pipeline.process(
                villagesData,
                { source: 'HDX', category: 'infrastructure', dataset: 'west-bank-villages' },
                villagesTransformer,
                { partition: false, outputDir: path.join(UNIFIED_DIR, 'infrastructure') }
            );

            if (villagesResults.success) {
                // Load existing infrastructure data
                const infraDir = path.join(UNIFIED_DIR, 'infrastructure');
                const infraPath = path.join(infraDir, 'all-data.json');
                let existingData = [];
                try {
                    const existing = JSON.parse(await fs.readFile(infraPath, 'utf-8'));
                    existingData = existing.data || [];
                } catch (e) {
                    // No existing data
                }

                // Merge with new villages data
                const mergedData = [...existingData, ...(villagesResults.enriched || [])];

                // Save merged data
                await fs.writeFile(
                    infraPath,
                    JSON.stringify({
                        data: mergedData,
                        metadata: {
                            total_records: mergedData.length,
                            generated_at: new Date().toISOString(),
                            source: 'HDX',
                            category: 'infrastructure',
                        },
                    }, null, 2),
                    'utf-8'
                );

                logger.success(`Processed and saved ${villagesResults.stats.recordCount} West Bank villages`);
            }
        } catch (error) {
            logger.warn(`Could not process West Bank villages: ${error.message}`);
        }

        // Process Barrier
        const barrierPath = path.join(westbankDir, 'infrastructure/barrier/raw-data.json');
        try {
            const barrierData = JSON.parse(await fs.readFile(barrierPath, 'utf-8'));
            const barrierTransformer = new WestBankBarrierTransformer();

            barrierResults = await pipeline.process(
                barrierData,
                { source: 'HDX', category: 'infrastructure', dataset: 'west-bank-barrier' },
                barrierTransformer,
                { partition: false, outputDir: path.join(UNIFIED_DIR, 'infrastructure') }
            );

            if (barrierResults.success) {
                // Load existing infrastructure data
                const infraDir = path.join(UNIFIED_DIR, 'infrastructure');
                const infraPath = path.join(infraDir, 'all-data.json');
                let existingData = [];
                try {
                    const existing = JSON.parse(await fs.readFile(infraPath, 'utf-8'));
                    existingData = existing.data || [];
                } catch (e) {
                    // No existing data
                }

                // Merge with new barrier data
                const mergedData = [...existingData, ...(barrierResults.enriched || [])];

                // Save merged data
                await fs.writeFile(
                    infraPath,
                    JSON.stringify({
                        data: mergedData,
                        metadata: {
                            total_records: mergedData.length,
                            generated_at: new Date().toISOString(),
                            source: 'HDX',
                            category: 'infrastructure',
                        },
                    }, null, 2),
                    'utf-8'
                );

                logger.success(`Processed and saved ${barrierResults.stats.recordCount} West Bank barrier segments`);
            }
        } catch (error) {
            logger.warn(`Could not process West Bank barrier: ${error.message}`);
        }

        // --- Save the Unified West Bank Category JSON ---
        const wbMerged = [
            ...(schoolsResults?.enriched || []),
            ...(villagesResults?.enriched || []),
            ...(barrierResults?.enriched || [])
        ];
        if (wbMerged.length > 0) {
            const outPath = path.join(UNIFIED_DIR, 'westbank', 'all-data.json');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(
                outPath,
                JSON.stringify({
                    data: wbMerged,
                    metadata: {
                        total_records: wbMerged.length,
                        generated_at: new Date().toISOString(),
                        source: 'HDX/Westbank',
                        category: 'westbank'
                    }
                }, null, 2),
                'utf-8'
            );
            logger.success(`[OK] Saved unified West Bank data collection: ${wbMerged.length} records`);
        }

    } catch (error) {
        logger.error('Error processing West Bank data:', error.message);
    }
}

/**
 * Process Historical Manual Data
 */
async function processHistoricalData() {
    logger.info('Processing historical data...');
    try {
        const histDir = path.join(DATA_DIR, 'historical');
        const sourceHistDir = path.join(__dirname, '../data/historical');
        const manualPath = path.join(histDir, 'manual_population_1948_1990.json');
        // Prefer tracked source file; fall back to legacy public/data location
        let eventsPath = path.join(sourceHistDir, 'historical-events.json');
        try { await fs.access(eventsPath); } catch { eventsPath = path.join(histDir, 'historical-events.json'); }

        let rawData = [];

        // 1. Process Manual Population Data
        try {
            await fs.access(manualPath);
            const popData = JSON.parse(await fs.readFile(manualPath, 'utf-8'));
            if (Array.isArray(popData)) {
                rawData.push(...popData);
                logger.info(`Loaded ${popData.length} population records`);
            }
        } catch {
            logger.warn('Manual historical population data not found');
        }

        // 2. Process Historical Events Data
        try {
            await fs.access(eventsPath);
            const eventsData = JSON.parse(await fs.readFile(eventsPath, 'utf-8'));
            if (Array.isArray(eventsData)) {
                rawData.push(...eventsData);
                logger.info(`Loaded ${eventsData.length} historical event records`);
            }
        } catch {
            logger.warn('Historical events data not found');
        }

        if (rawData.length === 0) {
            logger.warn('No historical data available');
            return;
        }

        logger.info(`Found ${rawData.length} total historical records`);

        const transformer = new HistoricalTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const histUnifiedDir = path.join(UNIFIED_DIR, 'historical');

        const results = await pipeline.process(
            rawData,
            {
                source: 'Multiple (UN, PCBS, Historical Records)',
                organization: 'Various',
                category: 'historical',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false, // Small dataset
                outputDir: histUnifiedDir,
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} historical records`);

            // Save all-data.json
            await fs.writeFile(
                path.join(histUnifiedDir, 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'Multiple',
                        category: 'historical',
                    },
                }, null, 2),
                'utf-8'
            );

            // Save metadata.json
            await fs.writeFile(
                path.join(histUnifiedDir, 'metadata.json'),
                JSON.stringify({
                    category: 'historical',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
                    sources: ['UN', 'PCBS', 'Historical Records'],
                }, null, 2),
                'utf-8'
            );
        }

    } catch (error) {
        logger.error('Error processing historical data:', error.message);
    }
}

/**
 * Process Nakba Data
 */
async function processNakbaData() {
    logger.info('Processing Nakba data...');
    try {
        const nakbaDir = path.join(DATA_DIR, 'historical/nakba');
        const nakbaPath = path.join(nakbaDir, 'nakba-villages.json');

        try {
            await fs.access(nakbaPath);
        } catch {
            throw new Error('Nakba data not found, skipping');
        }

        const rawData = JSON.parse(await fs.readFile(nakbaPath, 'utf-8'));

        if (!Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No Nakba data available');
            return;
        }

        logger.info(`Found ${rawData.length} Nakba village records`);

        const transformer = new HistoricalTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const histUnifiedDir = path.join(UNIFIED_DIR, 'historical');

        const results = await pipeline.process(
            rawData,
            {
                source: 'Historical Records',
                organization: 'Various',
                category: 'historical',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: histUnifiedDir,
                filenamePrefix: 'nakba-'
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} Nakba records`);

            // Merge with existing historical data
            const mainFile = path.join(histUnifiedDir, 'all-data.json');
            let mainData = [];
            try {
                const content = JSON.parse(await fs.readFile(mainFile, 'utf-8'));
                mainData = content.data || [];
            } catch { }

            const newData = results.enriched || [];
            const combined = [...mainData, ...newData];

            await fs.writeFile(mainFile, JSON.stringify({
                data: combined,
                metadata: {
                    total_records: combined.length,
                    last_updated: new Date().toISOString(),
                    category: 'historical'
                }
            }, null, 2));
        }

    } catch (error) {
        logger.error('Error processing Nakba data:', error.message);
    }
}

/**
 * Process B'Tselem Data
 */
async function processBtselemData() {
    logger.info('Processing B\'Tselem data...');
    try {
        const btselemDir = path.join(DATA_DIR, 'btselem');
        const dataPath = path.join(btselemDir, 'btselem-aggregates.json');

        try {
            await fs.access(dataPath);
        } catch {
            throw new Error('B\'Tselem data not found, skipping');
        }

        const rawData = JSON.parse(await fs.readFile(dataPath, 'utf-8'));

        if (!Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No B\'Tselem data available');
            return;
        }

        logger.info(`Found ${rawData.length} B'Tselem aggregate records`);

        // Use ConflictTransformer as these are event summaries
        const transformer = new ConflictTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const conflictDir = path.join(UNIFIED_DIR, 'conflict');

        const results = await pipeline.process(
            rawData,
            {
                source: 'B\'Tselem',
                organization: 'B\'Tselem',
                category: 'conflict',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: false,
                outputDir: conflictDir,
                filenamePrefix: 'btselem-'
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} B'Tselem records`);

            // Merge with existing conflict data
            const mainFile = path.join(conflictDir, 'all-data.json');
            let mainData = [];
            try {
                const content = JSON.parse(await fs.readFile(mainFile, 'utf-8'));
                mainData = content.data || [];
            } catch { }

            const newData = results.enriched || [];
            const combined = [...mainData, ...newData];

            await fs.writeFile(mainFile, JSON.stringify({
                data: combined,
                metadata: {
                    total_records: combined.length,
                    last_updated: new Date().toISOString(),
                    category: 'conflict'
                }
            }, null, 2));

            logger.success(`Merged B'Tselem data into conflict/all-data.json`);
        }

    } catch (error) {
        logger.error('Error processing B\'Tselem data:', error.message);
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('[INFO]  Starting unified data population...\n');

    // Ensure directories exist
    await fs.mkdir(UNIFIED_DIR, { recursive: true });
    const categories = [
        'economic', 'conflict', 'infrastructure', 'education', 'health',
        'water', 'refugees', 'martyrs_snapshot_2023', 'news', 'culture',
        'land', 'westbank', 'pcbs'
    ];
    for (const cat of categories) {
        await fs.mkdir(path.join(UNIFIED_DIR, cat), { recursive: true });
    }

    // Pipeline task registry -- each entry is { name, fn }
    const tasks = [
        { name: 'economic',            fn: processEconomicData },
        { name: 'conflict',            fn: processConflictData },
        { name: 'infrastructure_t4p',  fn: processTech4PalestineInfrastructure },
        { name: 'press',               fn: processPressData },
        { name: 'martyrs',             fn: processMartyrsData },
        { name: 'hdx',                 fn: processHDXData },
        { name: 'who',                 fn: processWHOData },
        { name: 'pcbs',                fn: processPCBSData },
        { name: 'goodshepherd_health', fn: processGoodShepherdHealthcare },
        { name: 'goodshepherd',        fn: processGoodShepherdData },
        { name: 'static_refugees',     fn: processStaticRefugeesData },
        { name: 'funding',             fn: processFundingData },
        { name: 'news',                fn: processNewsData },
        { name: 'culture',             fn: processCultureData },
        { name: 'land',                fn: processLandData },
        { name: 'westbank',            fn: processWestBankData },
        { name: 'btselem',             fn: processBtselemData },
        { name: 'water',               fn: processWaterData },
        { name: 'infrastructure',      fn: processInfrastructureData },
    ];

    // Per-category failure isolation with timing
    const report = { generated_at: new Date().toISOString(), categories: {} };

    // Helper: read record count from the unified output file for a category
    async function getOutputCount(categoryName) {
        // Map task names to unified category directories
        const nameMap = {
            'infrastructure_t4p': 'infrastructure',
            'press': 'conflict',
            'goodshepherd_health': 'health',
            'goodshepherd': null, // contributes to multiple categories
            'static_refugees': 'refugees',
            'funding': 'funding',
            'btselem': 'conflict',
            'martyrs': 'martyrs_snapshot_2023',
        };
        const dirName = nameMap[categoryName] !== undefined ? nameMap[categoryName] : categoryName;
        if (!dirName) return null;
        try {
            const filePath = path.join(UNIFIED_DIR, dirName, 'all-data.json');
            const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            return (content.data || []).length;
        } catch { return null; }
    }

    for (const task of tasks) {
        const t0 = Date.now();
        try {
            await task.fn();
            const count = await getOutputCount(task.name);
            report.categories[task.name] = {
                status: 'ok',
                records: count,
                duration_ms: Date.now() - t0,
            };
            logger.success(`[${task.name}] done`);
        } catch (err) {
            report.categories[task.name] = {
                status: 'failed',
                error: err.message,
                stack: err.stack?.split('\n').slice(0, 3).join(' | '),
                duration_ms: Date.now() - t0,
            };
            logger.error(`[${task.name}] FAILED: ${err.message}`);
        }
    }

    // Create empty structures for any categories with no data yet
    await createEmptyStructures();

    // Generate unified manifest
    logger.info('Generating unified manifest...');
    try {
        const { spawn } = await import('child_process');
        const manifestScript = path.join(__dirname, 'generate-unified-manifest.js');
        await new Promise((resolve, reject) => {
            const child = spawn('node', [manifestScript], { stdio: 'inherit' });
            child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`manifest exit ${code}`)));
        });
        report.manifest = 'ok';
    } catch (err) {
        report.manifest = `failed: ${err.message}`;
        logger.error(`Manifest generation failed: ${err.message}`);
    }

    // Attach stable IDs + emit per-category lookup indexes. Runs last so it
    // catches records written by paths that bypass UnifiedPipeline.
    logger.info('Attaching stable IDs...');
    try {
        const { spawn } = await import('child_process');
        const sidScript = path.join(__dirname, 'attach-stable-ids.js');
        await new Promise((resolve, reject) => {
            const child = spawn('node', [sidScript], { stdio: 'inherit' });
            child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`stable-id exit ${code}`)));
        });
        report.stable_ids = 'ok';
    } catch (err) {
        report.stable_ids = `failed: ${err.message}`;
        logger.error(`Stable ID sweep failed: ${err.message}`);
    }

    // Write dated snapshot of unified data for ?as_of= pinning. Runs after
    // stable IDs so snapshots include the citable ID indexes.
    logger.info('Writing unified snapshot...');
    try {
        const { spawn } = await import('child_process');
        const snapScript = path.join(__dirname, 'write-snapshot.js');
        await new Promise((resolve, reject) => {
            const child = spawn('node', [snapScript], { stdio: 'inherit' });
            child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`snapshot exit ${code}`)));
        });
        report.snapshot = 'ok';
    } catch (err) {
        report.snapshot = `failed: ${err.message}`;
        logger.error(`Snapshot write failed: ${err.message}`);
    }

    // Write pipeline report
    await fs.writeFile(
        path.join(DATA_DIR, 'pipeline-report.json'),
        JSON.stringify(report, null, 2),
        'utf-8'
    );

    // Print summary
    const ok = Object.values(report.categories).filter(c => c.status === 'ok').length;
    const failed = Object.values(report.categories).filter(c => c.status === 'failed').length;
    console.log(`\n[OK]    Pipeline complete: ${ok} succeeded, ${failed} failed`);
    console.log(`[INFO]  Report: ${path.join(DATA_DIR, 'pipeline-report.json')}`);

    if (failed > 0) {
        console.log('\n[WARN]  Failed tasks:');
        for (const [name, result] of Object.entries(report.categories)) {
            if (result.status === 'failed') {
                console.log(`  - ${name}: ${result.error}`);
            }
        }
        // Exit 0 even with partial failures -- partial data is better than nothing
    }
}

main();

/**
 * Process Refugees Data — merges UNRWA camp populations (Wikipedia) with the
 * UNHCR Operational Data Portal time-series. UNHCR carries the official
 * year-by-year refugee counts by host country (CC-BY-4.0). UNRWA snapshot
 * carries camp-level point-in-time populations. Both feed the unified
 * `refugees` category.
 */
async function processStaticRefugeesData() {
    logger.info('Processing refugees data (UNRWA camps + UNHCR ODP)...');
    try {
        const { RefugeeTransformer } = await import('./utils/hdx-transformers.js');
        const transformer = new RefugeeTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const mappedRecords = [];
        let unrwaCount = 0;
        let unhcrCount = 0;

        // --- UNRWA Wikipedia camp snapshot ---
        try {
            const unrwaPath = path.join(DATA_DIR, 'static', 'unrwa-refugees.json');
            const unrwaRaw = JSON.parse(await fs.readFile(unrwaPath, 'utf-8'));
            const unrwaRows = Array.isArray(unrwaRaw) ? unrwaRaw : (unrwaRaw.data || []);
            for (const r of unrwaRows) {
                mappedRecords.push({
                    date: r.date,
                    location: r.camp_name || r.camp,
                    governorate: r.governorate || r.location,
                    refugees: r.total_population || r.refugees,
                    type: 'camp_population',
                    _provenance: { source: 'UNRWA', via: 'Wikipedia camp registry' },
                });
                unrwaCount += 1;
            }
        } catch (e) {
            logger.warn('UNRWA camp snapshot unavailable:', e.message);
        }

        // --- UNHCR Operational Data Portal time-series ---
        try {
            const unhcrPath = path.join(DATA_DIR, 'static', 'unhcr-refugees.json');
            const unhcrRaw = JSON.parse(await fs.readFile(unhcrPath, 'utf-8'));
            const unhcrRows = Array.isArray(unhcrRaw) ? unhcrRaw : (unhcrRaw.data || []);
            for (const r of unhcrRows) {
                mappedRecords.push({
                    date: r.date,
                    year: r.year,
                    location: r.country_of_asylum_name,
                    country_of_asylum_name: r.country_of_asylum_name,
                    country_of_asylum_code: r.country_of_asylum_code,
                    country_of_origin_name: r.country_of_origin_name,
                    country_of_origin_code: r.country_of_origin_code,
                    refugees: r.refugees,
                    asylum_seekers: r.asylum_seekers,
                    idps: r.idps,
                    type: 'cross-border_refugees',
                    _provenance: { source: 'UNHCR ODP', license: 'CC-BY-4.0' },
                });
                unhcrCount += 1;
            }
        } catch (e) {
            logger.warn('UNHCR ODP snapshot unavailable (run scripts/sources/unhcr.js):', e.message);
        }

        if (mappedRecords.length === 0) {
            logger.warn('No refugee source data on disk; skipping');
            return;
        }

        const results = await pipeline.process(
            mappedRecords,
            { source: 'UNHCR + UNRWA', category: 'refugees', source_url: 'https://api.unhcr.org/population/v1/population/' },
            transformer,
            { enrich: true, validate: true, partition: true, outputDir: path.join(UNIFIED_DIR, 'refugees') }
        );

        if (results.success) {
            const outPath = path.join(UNIFIED_DIR, 'refugees', 'all-data.json');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(
                outPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        sources: [
                            { name: 'UNHCR Operational Data Portal', records: unhcrCount, license: 'CC-BY-4.0' },
                            { name: 'UNRWA (via Wikipedia camp registry)', records: unrwaCount, license: 'CC-BY-SA-3.0' },
                        ],
                        source: 'UNHCR + UNRWA',
                        category: 'refugees'
                    }
                }, null, 2),
                'utf-8'
            );
            logger.success(`Processed ${results.stats.recordCount} refugee records (UNHCR ${unhcrCount} + UNRWA ${unrwaCount})`);
        }
    } catch (e) {
        logger.warn('Error processing refugees data:', e.message);
    }
}

/**
 * Process UN OCHA Financial Tracking Service funding flows.
 * Each FTS flow is one donor → recipient humanitarian funding event for
 * Palestine (commitment / pledge / paid). Backed by CC-BY-IGO-3.0 — green
 * for commercial reuse with attribution. Fed by scripts/sources/unfts.js.
 */
async function processFundingData() {
    logger.info('Processing UN FTS funding data...');
    try {
        const filePath = path.join(DATA_DIR, 'static', 'unfts-funding.json');
        let envelope;
        try {
            envelope = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (e) {
            logger.warn('UN FTS snapshot unavailable (run scripts/sources/unfts.js):', e.message);
            return;
        }

        const flows = Array.isArray(envelope) ? envelope : (envelope.data || []);
        if (flows.length === 0) {
            logger.warn('No FTS flows on disk; skipping');
            return;
        }

        const transformer = new FundingTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const results = await pipeline.process(
            flows,
            {
                source: envelope.source || 'UN OCHA FTS',
                category: 'funding',
                source_url: envelope.source_url || 'https://fts.unocha.org',
                license: envelope.license || 'CC-BY-IGO-3.0',
            },
            transformer,
            { enrich: true, validate: true, partition: true, outputDir: path.join(UNIFIED_DIR, 'funding') }
        );

        if (results.success) {
            const outPath = path.join(UNIFIED_DIR, 'funding', 'all-data.json');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(
                outPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        sources: [
                            { name: 'UN OCHA Financial Tracking Service', records: results.stats.recordCount, license: 'CC-BY-IGO-3.0' },
                        ],
                        source: 'UN OCHA Financial Tracking Service',
                        source_url: envelope.source_url || 'https://fts.unocha.org',
                        category: 'funding',
                    },
                }, null, 2),
                'utf-8',
            );
            logger.success(`Processed ${results.stats.recordCount} FTS funding flows`);
        }
    } catch (e) {
        logger.warn('Error processing UN FTS funding data:', e.message);
    }
}

/**
 * Process Static Prisoners Data (Fallback for GoodShepherd API)
 */
async function processStaticPrisonersData() {
    logger.info('Processing static Prisoners data...');
    try {
        const filePath = path.join(DATA_DIR, 'static', 'prisoners-addameer.json');
        let content;
        try {
            content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        } catch (e) {
            // Fallback to old path if addameer not yet fetched
            const oldPath = path.join(DATA_DIR, 'static', 'prisoners-statistics.json');
            content = JSON.parse(await fs.readFile(oldPath, 'utf-8'));
        }
        const records = Array.isArray(content) ? content : (content.data || []);
        
        if (records.length === 0) return;

        const { GoodShepherdTransformer } = await import('./utils/goodshepherd-transformer.js');
        const transformer = new GoodShepherdTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        
        const mappedRecords = records.map(r => ({
            ...r,
            _gs_category: 'prisoners',
            source_file: 'prisoners-statistics.json'
        }));

        const results = await pipeline.process(
            mappedRecords,
            { source: 'Addameer', category: 'prisoners' },
            transformer,
            { enrich: true, validate: true, partition: true, outputDir: path.join(UNIFIED_DIR, 'prisoners') }
        );

        if (results.success) {
            const outPath = path.join(UNIFIED_DIR, 'prisoners', 'all-data.json');
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(
                outPath,
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'Addameer',
                        category: 'prisoners'
                    }
                }, null, 2),
                'utf-8'
            );
            logger.success(`Processed and saved ${results.stats.recordCount} static prisoner records`);
        }
    } catch (e) {
        logger.warn('Error processing static prisoners data:', e.message);
    }
}

/**
 * Process Good Shepherd Data
 */
async function processGoodShepherdData() {
    logger.info('Processing Good Shepherd data...');
    try {
        const gsDir = path.join(DATA_DIR, 'goodshepherd');

        try {
            await fs.access(gsDir);
        } catch {
            throw new Error('Good Shepherd data directory not found, skipping');
        }

        const categories = ['prisoners', 'healthcare', 'ngo'];
        let allRecords = [];

        for (const cat of categories) {
            const catDir = path.join(gsDir, cat);
            try {
                await fs.access(catDir);
                // Recursively find JSON files
                async function getFiles(dir) {
                    const dirents = await fs.readdir(dir, { withFileTypes: true });
                    const files = await Promise.all(dirents.map((dirent) => {
                        const res = path.join(dir, dirent.name);
                        return dirent.isDirectory() ? getFiles(res) : res;
                    }));
                    return files.flat();
                }

                const files = await getFiles(catDir);
                const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('metadata.json'));

                for (const file of jsonFiles) {
                    try {
                        const content = JSON.parse(await fs.readFile(file, 'utf-8'));
                        const records = Array.isArray(content) ? content : (content.data || [content]);

                        // Add context to records
                        const enrichedRecords = records.map(r => ({
                            ...r,
                            _gs_category: cat, // internal flag for transformer
                            source_file: path.basename(file)
                        }));

                        allRecords.push(...enrichedRecords);
                    } catch (e) {
                        logger.warn(`Failed to read/parse ${path.basename(file)}`, e.message);
                    }
                }

            } catch (e) {
                // Category might not exist
            }
        }

        if (allRecords.length === 0) {
            logger.warn('No Good Shepherd records found');
            return;
        }

        logger.info(`Found ${allRecords.length} Good Shepherd records`);

        const transformer = new GoodShepherdTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        const batches = {
            conflict: allRecords.filter(r => r._gs_category === 'prisoners'),
            health: allRecords.filter(r => r._gs_category === 'healthcare'),
        };

        for (const [targetCategory, records] of Object.entries(batches)) {
            if (records.length === 0) continue;

            logger.info(`Processing ${records.length} Good Shepherd records for ${targetCategory}`);

            const results = await pipeline.process(
                records,
                {
                    source: 'Good Shepherd',
                    organization: 'Good Shepherd',
                    category: targetCategory,
                },
                transformer,
                {
                    enrich: true,
                    validate: true,
                    partition: true,
                    outputDir: path.join(UNIFIED_DIR, targetCategory),
                    filenamePrefix: 'goodshepherd-'
                }
            );

            if (results.success) {
                logger.success(`Processed Good Shepherd ${targetCategory} data`);

                try {
                    const mainFile = path.join(UNIFIED_DIR, targetCategory, 'all-data.json');
                    let mainData = [];
                    try {
                        const content = JSON.parse(await fs.readFile(mainFile, 'utf-8'));
                        mainData = content.data || [];
                    } catch { }

                    const newData = results.enriched || [];
                    const combined = [...mainData, ...newData];

                    await fs.writeFile(mainFile, JSON.stringify({
                        data: combined,
                        metadata: {
                            total_records: combined.length,
                            last_updated: new Date().toISOString(),
                            category: targetCategory
                        }
                    }, null, 2));

                    logger.success(`Merged Good Shepherd data into ${targetCategory}/all-data.json`);

                } catch (e) {
                    logger.error(`Failed to merge Good Shepherd data for ${targetCategory}`, e.message);
                }
            }
        }

    } catch (error) {
        logger.error('Error processing Good Shepherd data:', error.message);
    }
}
