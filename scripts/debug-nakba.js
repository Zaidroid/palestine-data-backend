
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { HistoricalTransformer } from './utils/historical-transformer.js';
import { UnifiedPipeline } from './utils/unified-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const UNIFIED_DIR = path.join(DATA_DIR, 'unified');

// Simple logger
const logger = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg, data) => console.log(`✅ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`⚠️  ${msg}`, data || ''),
    error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
};

async function processNakbaData() {
    logger.info('Processing Nakba data...');
    try {
        const nakbaDir = path.join(DATA_DIR, 'historical/nakba');
        const nakbaPath = path.join(nakbaDir, 'nakba-villages.json');

        console.log(`Checking path: ${nakbaPath}`);

        try {
            await fs.access(nakbaPath);
        } catch {
            logger.warn('Nakba data not found, skipping');
            return;
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

        // Ensure directory exists
        await fs.mkdir(histUnifiedDir, { recursive: true });

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

            console.log(`Wrote to ${mainFile}`);
        } else {
            logger.error('Pipeline failed', results);
        }

    } catch (error) {
        logger.error('Error processing Nakba data:', error.message);
        console.error(error);
    }
}

processNakbaData();
