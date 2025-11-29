
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
        await processWHOData();
        await processPCBSData();
        await processGoodShepherdHealthcare();
        await processGoodShepherdData();
        await processNewsData();
        await processCultureData();
        await processLandData();
        await processWestBankData();
        await processHistoricalData();

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
            logger.warn('Good Shepherd data directory not found, skipping');
            return;
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
            humanitarian: allRecords.filter(r => r._gs_category === 'ngo')
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
