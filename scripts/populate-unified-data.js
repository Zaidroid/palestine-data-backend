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
import {
    InfrastructureTransformer,
    EducationTransformer,
    HealthTransformer,
    WaterTransformer,
    HumanitarianTransformer,
    RefugeeTransformer,
} from './utils/hdx-transformers.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';

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
        const wbDir = path.join(DATA_DIR, 'worldbank');
        const allIndicatorsPath = path.join(wbDir, 'all-indicators.json');

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
async function processConflictData() {
    logger.info('Processing conflict data...');

    try {
        const t4pDir = path.join(DATA_DIR, 'tech4palestine');
        const summaryPath = path.join(t4pDir, 'summary.json');

        // Check if file exists
        try {
            await fs.access(summaryPath);
        } catch {
            logger.warn('Tech4Palestine data not found, skipping conflict data');
            return;
        }

        const fileContent = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
        const rawData = fileContent.data || fileContent;

        if (!rawData) {
            logger.warn('No Tech4Palestine data available');
            return;
        }

        // Convert summary to array format for transformer
        const dataArray = [];
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

        if (dataArray.length === 0) {
            logger.warn('No conflict data to process');
            return;
        }

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
                partition: false, // Small dataset
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
        const validation = transformer.validate(enriched);
        if (!validation.valid) {
            logger.warn(`PCBS validation found ${validation.errors.length} errors`);
        }

        // Group by category
        const byCategory = {};
        enriched.forEach(record => {
            const cat = record.category;
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(record);
        });

        // Save by category
        const pcbsUnifiedDir = path.join(UNIFIED_DIR, 'pcbs');
        await fs.mkdir(pcbsUnifiedDir, { recursive: true });

        for (const [category, records] of Object.entries(byCategory)) {
            const categoryPath = path.join(pcbsUnifiedDir, `${category}.json`);
            await fs.writeFile(
                categoryPath,
                JSON.stringify({
                    category,
                    metadata: {
                        source: 'pcbs',
                        record_count: records.length,
                        generated_at: new Date().toISOString(),
                    },
                    data: records,
                }, null, 2),
                'utf-8'
            );
            logger.success(`Saved ${category}: ${records.length} records`);
        }

        // Save all data
        const allDataPath = path.join(pcbsUnifiedDir, 'all-data-transformed.json');
        await fs.writeFile(
            allDataPath,
            JSON.stringify({
                metadata: {
                    source: 'pcbs',
                    source_name: 'Palestinian Central Bureau of Statistics',
                    transformed_at: new Date().toISOString(),
                    total_records: enriched.length,
                    categories: Object.keys(byCategory),
                },
                data: enriched,
            }, null, 2),
            'utf-8'
        );

        logger.success(`Processed ${enriched.length} PCBS records across ${Object.keys(byCategory).length} categories`);

    } catch (error) {
        logger.error('Error processing PCBS data:', error.message);
        console.error(error);
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
        'water',
        'refugees',
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
 * Main execution
 */
async function main() {
    console.log('🚀 Starting unified data population...\n');

    try {
        // Ensure unified directory exists
        await fs.mkdir(UNIFIED_DIR, { recursive: true });

        // Process each data source
        await processEconomicData();
        await processConflictData();
        await processHDXData();
        await processPCBSData();

        // Create empty structures for missing data
        await createEmptyStructures();

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
