/**
 * Geospatial Data Processor
 * 
 * Converts shapefiles and large geospatial datasets from HDX into simplified,
 * frontend-ready GeoJSON format with unified schema.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import shapefile from 'shapefile';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../public/data');
const HDX_DIR = path.join(DATA_DIR, 'hdx');
const UNIFIED_DIR = path.join(DATA_DIR, 'unified');

// Simple logger
const logger = {
    info: (msg) => console.log(`ℹ️  ${msg}`),
    success: (msg) => console.log(`✅ ${msg}`),
    warn: (msg) => console.warn(`⚠️  ${msg}`),
    error: (msg, err) => console.error(`❌ ${msg}`, err || '')
};

/**
 * Process shapefile and convert to simplified GeoJSON
 */
async function processShapefile(shpPath, category) {
    logger.info(`Processing shapefile: ${path.basename(shpPath)}`);

    try {
        const source = await shapefile.open(shpPath);
        const features = [];
        let result;

        while (!(result = await source.read()).done) {
            const feature = result.value;

            // Simplify the feature
            const simplified = {
                type: 'Feature',
                geometry: simplifyGeometry(feature.geometry),
                properties: {
                    ...feature.properties,
                    _source: 'HDX',
                    _category: category,
                    _processed_at: new Date().toISOString()
                }
            };

            features.push(simplified);
        }

        return {
            type: 'FeatureCollection',
            features,
            metadata: {
                source: 'HDX (Shapefile)',
                category,
                feature_count: features.length,
                processed_at: new Date().toISOString()
            }
        };

    } catch (error) {
        logger.error(`Failed to process shapefile: ${error.message}`);
        return null;
    }
}

/**
 * Simplify geometry to reduce file size
 * For now, just pass through - can add Douglas-Peucker later if needed
 */
function simplifyGeometry(geometry) {
    // For points, return as-is
    if (geometry.type === 'Point') {
        return geometry;
    }

    // For complex geometries, could add simplification here
    // For now, just return the geometry
    return geometry;
}

/**
 * Extract centroid from geometry for point-based datasets
 */
function extractCentroid(geometry) {
    if (geometry.type === 'Point') {
        return geometry.coordinates;
    }

    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
        // Simple centroid calculation (bbox center)
        const coords = geometry.type === 'Polygon'
            ? geometry.coordinates[0]
            : geometry.coordinates[0][0];

        const lons = coords.map(c => c[0]);
        const lats = coords.map(c => c[1]);

        return [
            (Math.min(...lons) + Math.max(...lons)) / 2,
            (Math.min(...lats) + Math.max(...lats)) / 2
        ];
    }

    return null;
}

/**
 * Convert GeoJSON feature to unified data format
 */
function featureToUnifiedRecord(feature, category, index) {
    const centroid = extractCentroid(feature.geometry);
    const props = feature.properties || {};

    return {
        id: `geo-${category}-${index}`,
        category,
        date: props.date || props.timestamp || new Date().toISOString().split('T')[0],
        source: 'HDX',
        location: {
            name: props.name || props.NAME || props.location || 'Unknown',
            region: props.region || props.governorate || props.admin1 || 'Palestine',
            coordinates: centroid,
            geometry: feature.geometry  // Keep full geometry for mapping
        },
        data: {
            type: props.type || props.feature_type || category,
            ...props  // Include all original properties
        },
        metadata: {
            geometry_type: feature.geometry.type,
            source_file: props._source_file,
            confidence: 0.8  // Geospatial data is generally reliable
        }
    };
}

/**
 * Process infrastructure shapefiles
 */
async function processInfrastructure() {
    logger.info('Processing infrastructure shapefiles...');

    const infraDir = path.join(HDX_DIR, 'infrastructure');

    try {
        const subdirs = await fs.readdir(infraDir, { withFileTypes: true });
        const allRecords = [];

        for (const subdir of subdirs) {
            if (!subdir.isDirectory()) continue;

            const datasetPath = path.join(infraDir, subdir.name);
            const files = await fs.readdir(datasetPath);

            // Find shapefile
            const shpFile = files.find(f => f.endsWith('.shp'));

            if (shpFile) {
                const shpPath = path.join(datasetPath, shpFile);
                const geojson = await processShapefile(shpPath, 'infrastructure');

                if (geojson && geojson.features) {
                    // Convert to unified format
                    const records = geojson.features.map((feature, index) =>
                        featureToUnifiedRecord(feature, 'infrastructure', allRecords.length + index)
                    );

                    allRecords.push(...records);
                    logger.success(`Processed ${records.length} features from ${subdir.name}`);
                }
            }
        }

        if (allRecords.length > 0) {
            // Save to unified directory
            const outputDir = path.join(UNIFIED_DIR, 'infrastructure');
            await fs.mkdir(outputDir, { recursive: true });

            // Save full dataset
            await fs.writeFile(
                path.join(outputDir, 'geospatial-data.json'),
                JSON.stringify({
                    data: allRecords,
                    metadata: {
                        category: 'infrastructure',
                        total_records: allRecords.length,
                        source: 'HDX (Shapefiles)',
                        generated_at: new Date().toISOString()
                    }
                }, null, 2)
            );

            logger.success(`Saved ${allRecords.length} infrastructure records`);
        }

    } catch (error) {
        logger.error('Error processing infrastructure:', error);
    }
}

/**
 * Process water/WASH shapefiles
 */
async function processWater() {
    logger.info('Processing water/WASH shapefiles...');

    const waterDir = path.join(HDX_DIR, 'water');

    try {
        const subdirs = await fs.readdir(waterDir, { withFileTypes: true });
        const allRecords = [];

        for (const subdir of subdirs) {
            if (!subdir.isDirectory()) continue;

            const datasetPath = path.join(waterDir, subdir.name);
            const files = await fs.readdir(datasetPath);

            // Find shapefile
            const shpFile = files.find(f => f.endsWith('.shp'));

            if (shpFile) {
                const shpPath = path.join(datasetPath, shpFile);
                const geojson = await processShapefile(shpPath, 'water');

                if (geojson && geojson.features) {
                    const records = geojson.features.map((feature, index) =>
                        featureToUnifiedRecord(feature, 'water', allRecords.length + index)
                    );

                    allRecords.push(...records);
                    logger.success(`Processed ${records.length} features from ${subdir.name}`);
                }
            }
        }

        if (allRecords.length > 0) {
            const outputDir = path.join(UNIFIED_DIR, 'water');
            await fs.mkdir(outputDir, { recursive: true });

            await fs.writeFile(
                path.join(outputDir, 'geospatial-data.json'),
                JSON.stringify({
                    data: allRecords,
                    metadata: {
                        category: 'water',
                        total_records: allRecords.length,
                        source: 'HDX (Shapefiles)',
                        generated_at: new Date().toISOString()
                    }
                }, null, 2)
            );

            logger.success(`Saved ${allRecords.length} water/WASH records`);
        }

    } catch (error) {
        logger.error('Error processing water data:', error);
    }
}

/**
 * Main execution
 */
async function main() {
    console.log('\n🗺️  Geospatial Data Processor');
    console.log('='.repeat(60));

    try {
        await processInfrastructure();
        await processWater();

        console.log('\n✅ Geospatial processing complete!');

    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

main();
