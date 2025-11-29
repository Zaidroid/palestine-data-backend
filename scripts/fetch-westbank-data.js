#!/usr/bin/env node

/**
 * West Bank Specific Data Fetcher
 * 
 * Fetches West Bank-specific datasets from HDX to enrich coverage beyond conflict data
 * Sources: HDX OCHA oPt, Tech4Palestine (already integrated), GoodShepherd
 * 
 * Datasets:
 * - West Bank Schools (Education)
 * - Village Boundaries (Geographic/Infrastructure)
 * - Separation Barrier (Infrastructure)
 * - Humanitarian Access (Humanitarian)
 * 
 * Usage: node scripts/fetch-westbank-data.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRateLimitedFetcher } from './utils/fetch-with-retry.js';
import AdmZip from 'adm-zip';
import shapefile from 'shapefile';
import { schemaUtils } from './utils/standardized-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data/westbank');
const TEMP_DIR = path.join(__dirname, '../temp/westbank');
const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests

const rateLimitedFetch = createRateLimitedFetcher(RATE_LIMIT_DELAY);

const logger = {
    info: (msg, data) => console.log(`ℹ️  ${msg}`, data || ''),
    success: (msg, data) => console.log(`✅ ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`⚠️  ${msg}`, data || ''),
    error: (msg, data) => console.error(`❌ ${msg}`, data || ''),
};

/**
 * HDX Dataset Configuration
 */
const HDX_API_BASE = 'https://data.humdata.org/api/3/action';
const HDX_DATASETS = {
    schools: {
        package: 'state-of-palestine-west-bank-schools',
        category: 'education',
        description: 'Schools in the West Bank',
    },
    villages: {
        package: 'state-of-palestine-village-boundary-in-the-west-bank',
        category: 'infrastructure',
        description: 'Village boundaries and populated places',
    },
    barrier: {
        package: 'west-bank-barrier',
        category: 'infrastructure',
        description: 'Separation barrier data',
    },
    humanitarian_access: {
        package: 'state-of-palestine-humanitarian-access',
        category: 'humanitarian',
        description: 'Humanitarian access and restrictions',
    },
    admin_boundaries: {
        package: 'cod-ab-pse',
        category: 'infrastructure',
        description: 'Subnational administrative boundaries',
    },
};

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
}

/**
 * Write JSON file
 */
async function writeJSON(filePath, data) {
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        logger.success(`Written: ${path.basename(filePath)}`);
    } catch (error) {
        logger.error(`Failed to write ${filePath}:`, error.message);
        throw error;
    }
}

/**
 * Extract ZIP file
 */
/**
 * Extract ZIP file (recursively if needed)
 */
async function extractZip(zipPath, extractPath) {
    logger.info(`Extracting: ${path.basename(zipPath)}`);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);

    const entries = zip.getEntries();
    logger.success(`Extracted ${entries.length} files`);

    // Check for nested ZIPs
    const nestedZips = entries.filter(entry => entry.entryName.toLowerCase().endsWith('.zip'));

    if (nestedZips.length > 0) {
        logger.info(`Found ${nestedZips.length} nested ZIPs, extracting...`);

        for (const entry of nestedZips) {
            const nestedZipPath = path.join(extractPath, entry.entryName);
            const nestedExtractPath = path.join(extractPath, path.basename(entry.entryName, '.zip'));

            await extractZip(nestedZipPath, nestedExtractPath);

            // Delete the nested zip file after extraction to save space
            await fs.rm(nestedZipPath).catch(() => { });
        }
    }

    return extractPath;
}

/**
 * Parse shapefile to GeoJSON features
 */
async function parseShapefile(shpPath) {
    logger.info(`Parsing shapefile: ${path.basename(shpPath)}`);

    const features = [];

    try {
        const source = await shapefile.open(shpPath);
        let result = await source.read();

        while (!result.done) {
            if (result.value) {
                features.push(result.value);
            }
            result = await source.read();
        }

        logger.success(`Parsed ${features.length} features from shapefile`);
        return features;
    } catch (error) {
        logger.error(`Failed to parse shapefile: ${error.message}`);
        throw error;
    }
}

/**
 * Find shapefile in directory
 */
/**
 * Find shapefile in directory (recursively)
 */
async function findShapefile(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Check files in current directory
    const shpFile = entries.find(e => e.isFile() && e.name.endsWith('.shp'));
    if (shpFile) {
        return path.join(dirPath, shpFile.name);
    }

    // Check subdirectories
    for (const entry of entries) {
        if (entry.isDirectory()) {
            try {
                const found = await findShapefile(path.join(dirPath, entry.name));
                if (found) return found;
            } catch (e) {
                // Continue searching
            }
        }
    }

    throw new Error('No .shp file found in extracted directory');
}

/**
 * Find GeoJSON files in directory (recursively)
 */
async function findGeoJsonFiles(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let results = [];

    // Check files in current directory
    const geoJsonFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.geojson'));
    for (const file of geoJsonFiles) {
        results.push(path.join(dirPath, file.name));
    }

    // Check subdirectories
    for (const entry of entries) {
        if (entry.isDirectory()) {
            try {
                const found = await findGeoJsonFiles(path.join(dirPath, entry.name));
                results = [...results, ...found];
            } catch (e) {
                // Continue searching
            }
        }
    }

    return results;
}

/**
 * Fetch dataset metadata from HDX
 */
async function fetchDatasetMetadata(packageName) {
    logger.info(`Fetching metadata for: ${packageName}`);

    const url = `${HDX_API_BASE}/package_show?id=${packageName}`;
    const response = await rateLimitedFetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch metadata: ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !data.result) {
        throw new Error('Invalid response from HDX API');
    }

    return data.result;
}

/**
 * Download and process resource from HDX
 */
async function downloadResource(resource) {
    logger.info(`Downloading: ${resource.name} (${resource.format})`);

    const response = await rateLimitedFetch(resource.url);

    if (!response.ok) {
        throw new Error(`Failed to download: ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    const format = resource.format?.toLowerCase() || '';

    const isZip = resource.url.toLowerCase().endsWith('.zip') ||
        contentType?.includes('zip') ||
        format.includes('zip');

    // Handle GeoJSON (if not zipped)
    if ((format.includes('geojson') || contentType?.includes('geojson')) && !isZip) {
        const data = await response.json();
        return { type: 'geojson', features: data.features || [], data };
    }

    // Handle CSV (if not zipped)
    if ((format.includes('csv') || contentType?.includes('csv')) && !isZip) {
        const text = await response.text();
        return { type: 'csv', data: text };
    }

    // Handle Zipped files (Shapefiles, Zipped GeoJSON, etc)
    if (isZip || format.includes('shp') || format.includes('geodatabase')) {
        await ensureDir(TEMP_DIR);

        // Download to temp file
        const buffer = Buffer.from(await response.arrayBuffer());
        const tempZipPath = path.join(TEMP_DIR, `${Date.now()}.zip`);
        await fs.writeFile(tempZipPath, buffer);

        // Extract
        const extractPath = path.join(TEMP_DIR, `extracted_${Date.now()}`);
        await extractZip(tempZipPath, extractPath);

        // Find and parse shapefile or geojson
        try {
            // Check for GeoJSON first
            try {
                const geoJsonFiles = await findGeoJsonFiles(extractPath);

                if (geoJsonFiles.length > 0) {
                    // Sort to find best file (adm3 > adm2 > adm1 > adm0)
                    // Also prefer 'polbnda' (polygon boundary) over 'lnbnda' (line boundary)
                    const bestFile = geoJsonFiles.sort((a, b) => {
                        const score = (name) => {
                            let s = 0;
                            if (name.includes('adm3')) s += 40;
                            else if (name.includes('adm2')) s += 30;
                            else if (name.includes('adm1')) s += 20;
                            else if (name.includes('adm0')) s += 10;

                            if (name.includes('polbnda') || name.includes('polygon')) s += 5;
                            return s;
                        };
                        return score(b.toLowerCase()) - score(a.toLowerCase());
                    })[0];

                    logger.info(`Selected GeoJSON file: ${path.basename(bestFile)}`);

                    const content = JSON.parse(await fs.readFile(bestFile, 'utf-8'));

                    // Cleanup
                    await fs.rm(tempZipPath, { force: true });
                    await fs.rm(extractPath, { recursive: true, force: true });

                    return { type: 'geojson', features: content.features || [], data: content };
                }
            } catch (e) {
                // No GeoJSON found, continue to Shapefile check
            }

            // Fallback to Shapefile
            const shpPath = await findShapefile(extractPath);
            const features = await parseShapefile(shpPath);

            // Cleanup temp files
            await fs.rm(tempZipPath, { force: true });
            await fs.rm(extractPath, { recursive: true, force: true });

            return { type: 'shapefile', features };
        } catch (error) {
            logger.warn(`Could not parse extracted files: ${error.message}`);
            // Cleanup on error
            await fs.rm(tempZipPath, { force: true }).catch(() => { });
            await fs.rm(extractPath, { recursive: true, force: true }).catch(() => { });
            return { type: 'unknown', error: error.message };
        }
    }

    // Fallback: try JSON
    try {
        const data = await response.json();
        return { type: 'json', data };
    } catch {
        const text = await response.text();
        return { type: 'text', data: text };
    }
}

/**
 * Process a single HDX dataset
 */
async function processDataset(datasetKey, config) {
    try {
        logger.info(`\n========================================`);
        logger.info(`Processing: ${config.description}`);
        logger.info(`Package: ${config.package}`);
        logger.info(`========================================\n`);

        // Fetch metadata
        const metadata = await fetchDatasetMetadata(config.package);

        logger.info(`Found ${metadata.resources?.length || 0} resources`);

        if (!metadata.resources || metadata.resources.length === 0) {
            logger.warn('No resources found for this dataset');
            return null;
        }

        // Find best resource (prefer GeoJSON, then Shapefile, then CSV)
        const resource = metadata.resources.find(r =>
            r.format?.toLowerCase().includes('geojson')
        ) || metadata.resources.find(r =>
            r.format?.toLowerCase().includes('shp') || r.format?.toLowerCase().includes('zip')
        ) || metadata.resources.find(r =>
            r.format?.toLowerCase().includes('csv')
        ) || metadata.resources[0];

        logger.info(`Selected resource: ${resource.name} (${resource.format})`);

        // Download and parse resource
        const result = await downloadResource(resource);

        if (result.type === 'unknown' || result.error) {
            logger.warn(`Could not process resource: ${result.error || 'Unknown format'}`);
            return null;
        }

        // Create output directory
        const outputDir = path.join(DATA_DIR, config.category, datasetKey);
        await ensureDir(outputDir);

        // Determine record count
        let recordCount = 0;
        let dataToSave = result;

        if (result.features) {
            recordCount = result.features.length;
            dataToSave = {
                type: result.type,
                features: result.features,
            };
        } else if (Array.isArray(result.data)) {
            recordCount = result.data.length;
        } else if (result.data) {
            recordCount = 'unknown';
        }

        // Transform to Unified Schema
        let unifiedEvents = [];
        if (result.features) {
            unifiedEvents = result.features.map(feature => {
                const props = feature.properties || {};
                const coords = feature.geometry?.coordinates || [];
                const lat = coords[1] || null;
                const lon = coords[0] || null;

                // Determine category and type based on dataset key
                let category = config.category;
                let type = 'infrastructure_status';
                let details = '';

                if (datasetKey === 'schools') {
                    category = 'education';
                    type = 'facility_status';
                    details = `School: ${props.NAME_EN || props.Name || 'Unknown'}`;
                } else if (datasetKey === 'barrier') {
                    category = 'infrastructure';
                    type = 'barrier_segment';
                } else if (datasetKey === 'humanitarian_access') {
                    category = 'humanitarian';
                    type = 'access_restriction';
                    details = `Restriction: ${props.Type || 'Unknown'}`;
                }

                return schemaUtils.createEvent({
                    id: `${datasetKey}-${props.ID || props.OBJECTID || Math.random().toString(36).substr(2, 9)}`,
                    date: new Date().toISOString(), // Static data often lacks date, use current or metadata date
                    category: category,
                    event_type: type,
                    location: {
                        governorate: props.Governorate || props.GOVERNORAT || 'West Bank',
                        lat: lat,
                        lon: lon,
                        precision: 'exact'
                    },
                    metrics: {
                        count: 1
                    },
                    details: details || config.description,
                    source_link: `HDX: ${config.package}`,
                    confidence: 'high'
                });
            });
        }

        // Save processed data
        const outputFile = path.join(outputDir, `raw-data.json`);
        await writeJSON(outputFile, {
            metadata: {
                source: 'HDX',
                package: config.package,
                description: config.description,
                category: config.category,
                resource_name: resource.name,
                resource_format: resource.format,
                data_type: result.type,
                record_count: recordCount,
                fetched_at: new Date().toISOString(),
            },
            data: dataToSave,
        });

        // Save Unified Data
        if (unifiedEvents.length > 0) {
            await writeJSON(path.join(outputDir, `unified-data.json`), {
                source: 'HDX-WestBank',
                category: config.category,
                transformed_at: new Date().toISOString(),
                record_count: unifiedEvents.length,
                data: unifiedEvents
            });
            logger.success(`✅ Saved ${unifiedEvents.length} unified events`);
        }

        logger.success(`✅ Processed ${datasetKey}: ${recordCount} records`);

        return {
            dataset: datasetKey,
            category: config.category,
            records: recordCount,
            type: result.type,
            file: outputFile,
        };

    } catch (error) {
        logger.error(`Failed to process ${datasetKey}:`, error.message);
        return null;
    }
}

/**
 * Main fetch function
 */
async function fetchWestBankData() {
    try {
        logger.info('========================================');
        logger.info('West Bank Data Fetcher');
        logger.info('========================================\n');

        await ensureDir(DATA_DIR);

        const results = [];

        // Process each dataset
        for (const [key, config] of Object.entries(HDX_DATASETS)) {
            const result = await processDataset(key, config);
            if (result) {
                results.push(result);
            }
        }

        // Generate summary
        const summary = {
            total_datasets: results.length,
            datasets: results,
            categories: [...new Set(results.map(r => r.category))],
            last_updated: new Date().toISOString(),
        };

        await writeJSON(path.join(DATA_DIR, 'summary.json'), summary);

        logger.info('\n========================================');
        logger.success('✅ West Bank data fetch completed!');
        logger.info(`Processed ${results.length} datasets`);
        logger.info('Categories:', summary.categories.join(', '));
        logger.info('========================================');

        return { success: true, summary };

    } catch (error) {
        logger.error('Fatal error during West Bank data fetch:', error.message);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        await fetchWestBankData();
        process.exit(0);
    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}

export { fetchWestBankData };
