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
import { UnifiedPipeline } from './utils/unified-pipeline.js';
import { validateDataset } from './utils/data-validator.js';

// Simple logger
const logger = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg, data) => console.log(`✅ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`⚠️  ${msg}`, data || ''),
    error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
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
            logger.warn('World Bank data not found, skipping economic data');
            return;
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
            logger.warn('Tech4Palestine data not found, skipping conflict data');
            return;
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
            logger.warn('Tech4Palestine infrastructure data not found, skipping');
            return;
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
        } catch { return; }

        const content = JSON.parse(await fs.readFile(pressPath, 'utf-8'));
        const rawData = content.data || content;

        if (!rawData || rawData.length === 0) return;

        logger.info(`Found ${rawData.length} press casualty records`);

        // Map to conflict records
        const conflictRecords = rawData.map(record => {
            // Attempt to extract date from notes or default to Unknown
            // Note: This is a best-effort extraction
            return {
                date: '2023-10-07', // Default start date if unknown, or mark as Unknown
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
        } catch { return; }

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
        const martyrsDir = path.join(UNIFIED_DIR, 'martyrs');

        const results = await pipeline.process(
            dataArray,
            {
                source: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                category: 'martyrs',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true, // Essential for 60k+ records
                outputDir: martyrsDir,
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} martyr records`);

            // Save all-data.json (might be huge, but consistent with other cats)
            // For 60k records, ~20MB json. Acceptable for now, but partitions are key.
            await fs.writeFile(
                path.join(martyrsDir, 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'Tech4Palestine',
                        category: 'martyrs',
                    },
                }, null, 2),
                'utf-8'
            );

            await fs.writeFile(
                path.join(martyrsDir, 'metadata.json'),
                JSON.stringify({
                    category: 'martyrs',
                    total_records: results.stats.recordCount,
                    last_updated: new Date().toISOString(),
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
        { name: 'humanitarian', transformer: new HumanitarianTransformer() },
        { name: 'refugees', transformer: new RefugeeTransformer() },
    ];

    for (const category of categories) {
        try {
            const hdxCategoryDir = path.join(DATA_DIR, 'hdx', category.name);

            // Check if category directory exists
            try {
                await fs.access(hdxCategoryDir);
            } catch {
                logger.warn(`HDX ${category.name} directory not found, skipping`);
                continue;
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

                // Look for transformed.json, data.json, or all-data.json
                const dataFile = dataFiles.find(f => f === 'transformed.json' || f === 'data.json' || f === 'all-data.json');

                if (dataFile) {
                    const dataPath = path.join(datasetPath, dataFile);
                    const fileContent = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
                    const data = fileContent.data || fileContent;

                    if (Array.isArray(data) && data.length > 0) {
                        allData = allData.concat(data);
                        logger.info(`  Loaded ${data.length} records from ${datasetDir.name}`);
                    }
                }
            }

            if (allData.length === 0) {
                logger.warn(`No HDX ${category.name} data available`);
                continue;
            }

            logger.info(`Processing ${allData.length} ${category.name} records from ${datasetDirs.length} datasets`);

            const rawData = allData;

            const pipeline = new UnifiedPipeline({ logger });

            const results = await pipeline.process(
                rawData,
                {
                    source: 'HDX',
                    organization: 'UN OCHA',
                    category: category.name,
                },
                category.transformer,
                {
                    enrich: true,
                    validate: true,
                    partition: rawData.length > 10000,
                    outputDir: path.join(UNIFIED_DIR, category.name),
                }
            );

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
            logger.warn('PCBS data not found, skipping');
            return;
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

        // Save category files
        for (const [cat, records] of Object.entries(byCategory)) {
            const catDir = path.join(UNIFIED_DIR, 'pcbs'); // Just put in pcbs dir for now
            await fs.mkdir(catDir, { recursive: true });

            await fs.writeFile(
                path.join(catDir, `${cat.toLowerCase().replace(/\s+/g, '-')}.json`),
                JSON.stringify({
                    category: cat,
                    data: records,
                    metadata: {
                        source: 'PCBS',
                        count: records.length
                    }
                }, null, 2),
                'utf-8'
            );
        }

        logger.success(`Processed ${enriched.length} PCBS records`);

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
            logger.warn('News data not found, skipping');
            return;
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
 * Process WHO health data
 */
async function processWHOData() {
    logger.info('Processing WHO health data...');

    try {
        const whoDir = path.join(DATA_DIR, 'who');
        const allDataPath = path.join(whoDir, 'all-data.json');

        // Check if file exists
        try {
            await fs.access(allDataPath);
        } catch {
            logger.warn('WHO data not found, skipping');
            return;
        }

        logger.info('Reading WHO data...');
        const fileContent = JSON.parse(await fs.readFile(allDataPath, 'utf-8'));

        // WHO data structure: { resources: [{ data: [...] }, ...] }
        let rawData = [];
        if (fileContent.resources && Array.isArray(fileContent.resources)) {
            // Combine data from all resources
            for (const resource of fileContent.resources) {
                if (resource.data && Array.isArray(resource.data)) {
                    rawData = rawData.concat(resource.data);
                }
            }
        }

        if (rawData.length === 0) {
            logger.warn('No WHO data available');
            return;
        }

        logger.info(`Found ${rawData.length} WHO health records`);

        const transformer = new WHOTransformer();
        const pipeline = new UnifiedPipeline({ logger });

        // Read existing health data to merge with WHO data
        const healthDir = path.join(UNIFIED_DIR, 'health');
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
            rawData,
            {
                source: 'WHO',
                organization: 'World Health Organization',
                category: 'health',
            },
            transformer,
            {
                enrich: true,
                validate: true,
                partition: true,
                outputDir: healthDir,
            }
        );

        if (results.success) {
            logger.success(`Processed ${results.stats.recordCount} WHO health records`);

            // Merge with existing HDX health data
            const mergedData = [...existingHealthData, ...(results.enriched || [])];
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
                        sources: ['WHO', 'HDX'],
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
                    sources: ['WHO', 'HDX'],
                    quality: results.validated ? {
                        average_score: results.validated.qualityScore,
                        completeness: results.validated.completeness,
                        consistency: results.validated.consistency,
                        accuracy: results.validated.accuracy,
                    } : null,
                }, null, 2),
                'utf-8'
            );

            logger.success(`Merged health data saved: ${mergedData.length} total records`);
        } else {
            logger.error('WHO data processing failed', results.errors);
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
            logger.warn('GoodShepherd healthcare data not found, skipping');
            return;
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
            logger.warn('Cultural heritage data not found, skipping');
            return;
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
            logger.warn('Land data not found, skipping');
            return;
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
            logger.warn('Water data not found, skipping');
            return;
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
            logger.warn('Infrastructure data not found, skipping');
            return;
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

            // Save all-data.json
            await fs.writeFile(
                path.join(UNIFIED_DIR, 'infrastructure', 'all-data.json'),
                JSON.stringify({
                    data: results.enriched || [],
                    metadata: {
                        total_records: results.stats.recordCount,
                        generated_at: new Date().toISOString(),
                        source: 'TechForPalestine',
                        category: 'infrastructure'
                    }
                }, null, 2),
                'utf-8'
            );
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
        'humanitarian',
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

    try {
        // Process Schools
        const schoolsPath = path.join(westbankDir, 'education/schools/raw-data.json');
        try {
            const schoolsData = JSON.parse(await fs.readFile(schoolsPath, 'utf-8'));
            const schoolsTransformer = new WestBankSchoolsTransformer();

            const schoolsResults = await pipeline.process(
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

            const villagesResults = await pipeline.process(
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

            const barrierResults = await pipeline.process(
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
        const manualPath = path.join(histDir, 'manual_population_1948_1990.json');

        try {
            await fs.access(manualPath);
        } catch {
            logger.warn('Manual historical data not found, skipping');
            return;
        }

        const rawData = JSON.parse(await fs.readFile(manualPath, 'utf-8'));

        if (!Array.isArray(rawData) || rawData.length === 0) {
            logger.warn('No historical data available');
            return;
        }

        logger.info(`Found ${rawData.length} historical records`);

        const transformer = new HistoricalTransformer();
        const pipeline = new UnifiedPipeline({ logger });
        const histUnifiedDir = path.join(UNIFIED_DIR, 'historical');

        const results = await pipeline.process(
            rawData,
            {
                source: 'Multiple (UN, PCBS, etc.)',
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
                    sources: ['UN', 'PCBS', 'Other'],
                }, null, 2),
                'utf-8'
            );
        }

    } catch (error) {
        logger.error('Error processing historical data:', error.message);
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('🚀 Starting unified data population...\n');

    try {
        // Ensure unified directory exists
        await fs.mkdir(UNIFIED_DIR, { recursive: true });

        // Create category directories
        const categories = ['economic', 'conflict', 'infrastructure', 'education', 'health', 'water', 'humanitarian', 'refugees', 'martyrs', 'news', 'culture', 'land', 'westbank', 'historical'];
        for (const category of categories) {
            await fs.mkdir(path.join(UNIFIED_DIR, category), { recursive: true });
        }

        // Process each data source
        await processEconomicData();
        await processConflictData();
        await processTech4PalestineInfrastructure();
        await processPressData();
        await processMartyrsData();
        await processHDXData();
        await processWHOData(); // Process WHO health data and merge with HDX health data
        await processPCBSData();
        await processGoodShepherdHealthcare();
        await processNewsData();
        await processCultureData(); // Process cultural heritage data
        await processLandData(); // Process land and settlements data
        await processWestBankData(); // Process West Bank specific data (schools, villages, barrier)
        await processHistoricalData(); // Process historical data

        // Create empty structures for missing data
        await createEmptyStructures();
        await processWaterData();
        await processInfrastructureData();

        // Generate unified manifest
        logger.info('📋 Generating unified manifest...');
        const { spawn } = await import('child_process');
        const manifestScript = path.join(__dirname, 'generate-unified-manifest.js');

        await new Promise((resolve, reject) => {
            const child = spawn('node', [manifestScript], { stdio: 'inherit' });
            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Manifest generation failed with code ${code}`));
            });
        });

        console.log('\n✅ Unified data population complete!');
        console.log(`\nData location: ${UNIFIED_DIR}`);
        console.log('\nNext steps:');
        console.log('1. Check data: ls public/data/unified/*/all-data.json');
        console.log('2. Validate: npm run validate-data');
        console.log('3. Use in app: import { useConflictData } from "@/hooks/useUnifiedData"');

    } catch (error) {
        logger.error('Fatal error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

main();
