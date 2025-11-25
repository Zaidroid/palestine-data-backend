/**
 * GeoJSON Generator Utility
 * 
 * Converts data points with coordinates to GeoJSON format for map visualizations.
 * Supports Point, LineString, and Polygon geometries.
 */

import { createLogger } from './logger.js';

const logger = createLogger({
    context: 'GeoJSON-Generator',
    logLevel: 'INFO',
});

/**
 * Validate coordinates
 */
export function isValidCoordinate(lon, lat) {
    if (typeof lon !== 'number' || typeof lat !== 'number') return false;
    if (isNaN(lon) || isNaN(lat)) return false;

    // Valid longitude: -180 to 180
    // Valid latitude: -90 to 90
    if (lon < -180 || lon > 180) return false;
    if (lat < -90 || lat > 90) return false;

    return true;
}

/**
 * Extract coordinates from a data record
 */
export function extractCoordinates(record) {
    // Try different coordinate field names
    const lat = parseFloat(
        record.latitude ||
        record.lat ||
        record.y ||
        record.location?.latitude ||
        record.location?.lat ||
        record.location?.coordinates?.lat ||
        record.location?.coordinates?.[1] ||
        record.coordinates?.lat ||
        record.coordinates?.[1]
    );

    const lon = parseFloat(
        record.longitude ||
        record.lon ||
        record.long ||
        record.x ||
        record.location?.longitude ||
        record.location?.lon ||
        record.location?.coordinates?.lon ||
        record.location?.coordinates?.[0] ||
        record.coordinates?.lon ||
        record.coordinates?.[0]
    );

    if (isValidCoordinate(lon, lat)) {
        return [lon, lat];
    }

    return null;
}

/**
 * Create a GeoJSON Point feature from a data record
 */
export function createPointFeature(record, properties = {}) {
    const coordinates = extractCoordinates(record);

    if (!coordinates) {
        return null;
    }

    // Merge record data with additional properties
    const featureProperties = {
        ...record,
        ...properties,
    };

    // Remove coordinate fields from properties to avoid duplication
    delete featureProperties.latitude;
    delete featureProperties.lat;
    delete featureProperties.longitude;
    delete featureProperties.lon;
    delete featureProperties.long;
    delete featureProperties.x;
    delete featureProperties.y;
    delete featureProperties.coordinates;

    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: coordinates,
        },
        properties: featureProperties,
    };
}

/**
 * Create a GeoJSON FeatureCollection from an array of records
 */
export function createFeatureCollection(records, options = {}) {
    const {
        name = 'Unnamed Layer',
        description = '',
        additionalProperties = {},
    } = options;

    const features = [];
    let skipped = 0;

    for (const record of records) {
        const feature = createPointFeature(record, additionalProperties);
        if (feature) {
            features.push(feature);
        } else {
            skipped++;
        }
    }

    if (skipped > 0) {
        logger.debug(`Skipped ${skipped} records without valid coordinates`);
    }

    return {
        type: 'FeatureCollection',
        name: name,
        crs: {
            type: 'name',
            properties: {
                name: 'urn:ogc:def:crs:OGC:1.3:CRS84', // WGS84
            },
        },
        features: features,
        metadata: {
            description: description,
            featureCount: features.length,
            skippedCount: skipped,
            generatedAt: new Date().toISOString(),
        },
    };
}

/**
 * Create a GeoJSON LineString feature (for movement/displacement data)
 */
export function createLineStringFeature(coordinates, properties = {}) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return null;
    }

    // Validate all coordinates
    const validCoordinates = coordinates.filter(coord => {
        if (!Array.isArray(coord) || coord.length !== 2) return false;
        return isValidCoordinate(coord[0], coord[1]);
    });

    if (validCoordinates.length < 2) {
        return null;
    }

    return {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: validCoordinates,
        },
        properties: properties,
    };
}

/**
 * Create a GeoJSON Polygon feature (for areas/regions)
 */
export function createPolygonFeature(coordinates, properties = {}) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return null;
    }

    // Polygon coordinates should be an array of linear rings
    // First ring is exterior, others are holes
    const rings = Array.isArray(coordinates[0][0]) ? coordinates : [coordinates];

    // Validate coordinates
    const validRings = rings.map(ring => {
        return ring.filter(coord => {
            if (!Array.isArray(coord) || coord.length !== 2) return false;
            return isValidCoordinate(coord[0], coord[1]);
        });
    }).filter(ring => ring.length >= 4); // Polygons need at least 4 points (closed)

    if (validRings.length === 0) {
        return null;
    }

    return {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: validRings,
        },
        properties: properties,
    };
}

/**
 * Filter features by bounding box
 */
export function filterByBoundingBox(featureCollection, bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;

    const filteredFeatures = featureCollection.features.filter(feature => {
        if (feature.geometry.type === 'Point') {
            const [lon, lat] = feature.geometry.coordinates;
            return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
        }
        // For other geometry types, check if any coordinate is within bounds
        return true; // TODO: Implement for LineString and Polygon
    });

    return {
        ...featureCollection,
        features: filteredFeatures,
        metadata: {
            ...featureCollection.metadata,
            featureCount: filteredFeatures.length,
            filteredBy: 'bounding box',
            bbox: bbox,
        },
    };
}

/**
 * Palestine bounding boxes
 */
export const PALESTINE_BBOX = {
    // Entire Palestine (Gaza + West Bank)
    all: [34.2, 31.2, 35.6, 32.6],

    // Gaza Strip
    gaza: [34.2, 31.2, 34.6, 31.6],

    // West Bank
    westBank: [34.9, 31.3, 35.6, 32.6],
};

/**
 * Generate statistics for a feature collection
 */
export function generateStatistics(featureCollection) {
    const stats = {
        totalFeatures: featureCollection.features.length,
        geometryTypes: {},
        propertiesStats: {},
    };

    // Count geometry types
    featureCollection.features.forEach(feature => {
        const type = feature.geometry.type;
        stats.geometryTypes[type] = (stats.geometryTypes[type] || 0) + 1;
    });

    // Analyze properties (sample first 100 features)
    const sampleSize = Math.min(100, featureCollection.features.length);
    const propertyKeys = new Set();

    for (let i = 0; i < sampleSize; i++) {
        const props = featureCollection.features[i].properties;
        Object.keys(props).forEach(key => propertyKeys.add(key));
    }

    stats.propertyKeys = Array.from(propertyKeys);
    stats.propertySampleSize = sampleSize;

    return stats;
}

export default {
    isValidCoordinate,
    extractCoordinates,
    createPointFeature,
    createFeatureCollection,
    createLineStringFeature,
    createPolygonFeature,
    filterByBoundingBox,
    generateStatistics,
    PALESTINE_BBOX,
};
