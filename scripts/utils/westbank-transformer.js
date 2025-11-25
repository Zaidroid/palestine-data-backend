import { BaseTransformer } from './base-transformer.js';

/**
 * West Bank Schools Transformer
 * Transforms HDX West Bank schools data into unified education format
 */
export class WestBankSchoolsTransformer extends BaseTransformer {
    constructor() {
        super('education');
    }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];

        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};

        return {
            id: this.generateId('wb-school', { index, name: props.Name || props.name }),
            type: 'school',
            category: 'education',
            date: new Date().toISOString().split('T')[0], // Current date as snapshot

            location: {
                name: props.Name || props.name || props.SCHOOL_NAM || 'Unknown School',
                region: 'West Bank',
                governorate: props.Governorat || props.GOVERNORAT || props.governorate || null,
                locality: props.Locality || props.locality || null,
                coordinates: this.extractCoordinates(feature),
                admin_levels: {
                    level1: 'West Bank',
                    level2: props.Governorat || props.GOVERNORAT || null,
                    level3: props.Locality || props.locality || null,
                },
            },

            // School-specific fields
            school_name: props.Name || props.name || props.SCHOOL_NAM || 'Unknown',
            school_type: props.Type || props.TYPE || props.school_type || 'Unknown',
            education_level: props.Level || props.LEVEL || props.education_level || null,
            students: parseInt(props.Students || props.STUDENTS || props.enrollment || 0) || null,
            status: props.Status || props.STATUS || 'Active',

            // Metadata
            source: metadata?.source || 'HDX',
            quality: this.enrichQuality({
                completeness: this.calculateCompleteness(props),
                has_coordinates: !!this.extractCoordinates(feature),
            }),
        };
    }

    extractCoordinates(feature) {
        if (!feature.geometry) return null;

        const coords = feature.geometry.coordinates;
        if (!coords) return null;

        // Handle Point geometry
        if (feature.geometry.type === 'Point') {
            return {
                latitude: coords[1],
                longitude: coords[0],
            };
        }

        // Handle Polygon - use centroid
        if (feature.geometry.type === 'Polygon' && coords[0]?.length > 0) {
            const ring = coords[0];
            const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
            const lon = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
            return { latitude: lat, longitude: lon };
        }

        return null;
    }

    calculateCompleteness(props) {
        const fields = ['Name', 'name', 'Governorat', 'GOVERNORAT', 'Type', 'TYPE'];
        const present = fields.filter(f => props[f]).length;
        return (present / fields.length) * 100;
    }
}

/**
 * West Bank Villages/Localities Transformer
 * Transforms village boundary data into infrastructure records
 */
export class WestBankVillagesTransformer extends BaseTransformer {
    constructor() {
        super('infrastructure');
    }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];

        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};

        return {
            id: this.generateId('wb-village', { index, name: props.Name || props.name }),
            type: 'locality',
            category: 'infrastructure',
            date: new Date().toISOString().split('T')[0],

            location: {
                name: props.Name || props.name || props.LOCALITY || 'Unknown Locality',
                region: 'West Bank',
                governorate: props.Governorat || props.GOVERNORAT || props.governorate || null,
                coordinates: this.extractCoordinates(feature),
                admin_levels: {
                    level1: 'West Bank',
                    level2: props.Governorat || props.GOVERNORAT || null,
                    level3: props.Name || props.name || null,
                },
            },

            // Locality-specific fields
            locality_name: props.Name || props.name || props.LOCALITY || 'Unknown',
            locality_type: props.Type || props.TYPE || props.locality_type || 'Village',
            population: parseInt(props.Population || props.POP || props.population || 0) || null,
            area_km2: parseFloat(props.Area || props.AREA || props.area_km2 || 0) || null,

            // Metadata
            source: metadata?.source || 'HDX',
            quality: this.enrichQuality({
                completeness: this.calculateCompleteness(props),
                has_coordinates: !!this.extractCoordinates(feature),
            }),
        };
    }

    extractCoordinates(feature) {
        if (!feature.geometry) return null;

        const coords = feature.geometry.coordinates;
        if (!coords) return null;

        // For polygons, calculate centroid
        if (feature.geometry.type === 'Polygon' && coords[0]?.length > 0) {
            const ring = coords[0];
            const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
            const lon = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
            return { latitude: lat, longitude: lon };
        }

        // For points
        if (feature.geometry.type === 'Point') {
            return {
                latitude: coords[1],
                longitude: coords[0],
            };
        }

        return null;
    }

    calculateCompleteness(props) {
        const fields = ['Name', 'name', 'Governorat', 'GOVERNORAT', 'Type', 'TYPE'];
        const present = fields.filter(f => props[f]).length;
        return (present / fields.length) * 100;
    }
}

/**
 * West Bank Barrier Transformer
 * Transforms separation barrier data into infrastructure records
 */
export class WestBankBarrierTransformer extends BaseTransformer {
    constructor() {
        super('infrastructure');
    }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];

        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};

        return {
            id: this.generateId('wb-barrier', { index }),
            type: 'barrier',
            category: 'infrastructure',
            date: new Date().toISOString().split('T')[0],

            location: {
                name: props.Name || props.name || 'Separation Barrier Segment',
                region: 'West Bank',
                governorate: props.Governorat || props.GOVERNORAT || props.governorate || null,
                coordinates: this.extractCoordinates(feature),
                admin_levels: {
                    level1: 'West Bank',
                    level2: props.Governorat || props.GOVERNORAT || null,
                    level3: null,
                },
            },

            // Barrier-specific fields
            barrier_type: props.Type || props.TYPE || props.barrier_type || 'Wall',
            status: props.Status || props.STATUS || 'Constructed',
            length_km: parseFloat(props.Length || props.LENGTH || props.length_km || 0) || null,
            construction_year: parseInt(props.Year || props.YEAR || props.construction_year || 0) || null,

            // Metadata
            source: metadata?.source || 'HDX',
            quality: this.enrichQuality({
                completeness: this.calculateCompleteness(props),
                has_coordinates: !!this.extractCoordinates(feature),
            }),
        };
    }

    extractCoordinates(feature) {
        if (!feature.geometry) return null;

        const coords = feature.geometry.coordinates;
        if (!coords) return null;

        // For LineString, use midpoint
        if (feature.geometry.type === 'LineString' && coords.length > 0) {
            const midIndex = Math.floor(coords.length / 2);
            return {
                latitude: coords[midIndex][1],
                longitude: coords[midIndex][0],
            };
        }

        // For polygons, calculate centroid
        if (feature.geometry.type === 'Polygon' && coords[0]?.length > 0) {
            const ring = coords[0];
            const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
            const lon = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
            return { latitude: lat, longitude: lon };
        }

        return null;
    }

    calculateCompleteness(props) {
        const fields = ['Type', 'TYPE', 'Status', 'STATUS'];
        const present = fields.filter(f => props[f]).length;
        return (present / fields.length) * 100;
    }
}
