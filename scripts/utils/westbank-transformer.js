import { BaseTransformer } from './base-transformer.js';

// ---------------------------------------------------------------------------
// Shared GeoJSON coordinate helper
// ---------------------------------------------------------------------------
function geomCentroid(feature) {
    if (!feature?.geometry?.coordinates) return null;
    const coords = feature.geometry.coordinates;
    const type = feature.geometry.type;

    if (type === 'Point') return { lat: coords[1], lon: coords[0] };

    if (type === 'LineString' && coords.length > 0) {
        const mid = coords[Math.floor(coords.length / 2)];
        return { lat: mid[1], lon: mid[0] };
    }

    if ((type === 'Polygon' || type === 'MultiPolygon') && coords[0]?.length > 0) {
        const ring = type === 'Polygon' ? coords[0] : coords[0][0];
        const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        return { lat, lon };
    }

    return null;
}

function calcCompleteness(props, fields) {
    return (fields.filter(f => props[f]).length / fields.length) * 100;
}

// ---------------------------------------------------------------------------
// West Bank Schools
// ---------------------------------------------------------------------------
export class WestBankSchoolsTransformer extends BaseTransformer {
    constructor() { super('education'); }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];
        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};
        // HDX shapefile fields: English_Sc, Arabic_sch, locname (Arabic
        // locality), districtna (Arabic district), x_dd/y_dd (decimal
        // degrees). The earlier Name/Governorat/lat fallbacks never fired
        // — every school was "Unknown School" with null coords.
        const name = props.English_Sc || props.Name || props.name || props.SCHOOL_NAM ||
            props.Arabic_sch || 'Unknown School';
        const governorate = props.districtna || props.Governorat || props.GOVERNORAT ||
            props.governorate || null;
        const locality = props.locname || null;
        const geomCoords = geomCentroid(feature);
        // Shapefile features cache lat/lon directly in properties (x_dd/y_dd)
        // when the geometry type is missing from the GeoJSON envelope.
        const lat = geomCoords?.lat ?? (Number.isFinite(props.y_dd) ? props.y_dd : null);
        const lon = geomCoords?.lon ?? (Number.isFinite(props.x_dd) ? props.x_dd : null);

        return this.toCanonical({
            id: this.generateId('wb-school', { schid: props.schid, index, name }),
            date: new Date().toISOString().split('T')[0],
            category: 'education',
            event_type: 'school_record',
            location: {
                name,
                governorate,
                locality,
                region: 'West Bank',
                lat,
                lon,
                precision: lat != null && lon != null ? 'exact' : 'region',
            },
            metrics: {
                value: parseInt(props.Students || props.STUDENTS || props.enrollment || 0) || 0,
                unit: 'students',
                count: 1,
            },
            description: locality ? `${name} (${locality})` : name,
            school_name: name,
            school_name_ar: props.Arabic_sch || null,
            school_id: props.schid || null,
            school_type: props.Type || props.TYPE || props.school_type || 'Unknown',
            education_level: props.Level || props.LEVEL || props.education_level || null,
            school_status: props.Status || props.STATUS || 'Active',
            sources: [{
                name: metadata?.source || 'HDX',
                organization: metadata?.organization || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// West Bank Villages / Localities
// ---------------------------------------------------------------------------
export class WestBankVillagesTransformer extends BaseTransformer {
    constructor() { super('infrastructure'); }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];
        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};
        const name = props.Name || props.name || props.LOCALITY || 'Unknown Locality';
        const governorate = props.Governorat || props.GOVERNORAT || props.governorate || null;
        const coords = geomCentroid(feature);

        return this.toCanonical({
            id: this.generateId('wb-village', { index, name }),
            date: new Date().toISOString().split('T')[0],
            category: 'infrastructure',
            event_type: 'locality_record',
            location: {
                name,
                governorate,
                region: 'West Bank',
                lat: coords?.lat ?? null,
                lon: coords?.lon ?? null,
                precision: coords ? 'exact' : 'region',
            },
            metrics: {
                value: parseInt(props.Population || props.POP || props.population || 0) || 0,
                unit: 'persons',
                count: 1,
            },
            description: name,
            locality_name: name,
            locality_type: props.Type || props.TYPE || props.locality_type || 'Village',
            population: parseInt(props.Population || props.POP || props.population || 0) || null,
            area_km2: parseFloat(props.Area || props.AREA || props.area_km2 || 0) || null,
            sources: [{
                name: metadata?.source || 'HDX',
                organization: metadata?.organization || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// West Bank Barrier
// ---------------------------------------------------------------------------
export class WestBankBarrierTransformer extends BaseTransformer {
    constructor() { super('infrastructure'); }

    transform(rawData, metadata) {
        const features = rawData?.data?.features || rawData?.features || [];
        return features.map((feature, index) => this.transformRecord(feature, metadata, index));
    }

    transformRecord(feature, metadata, index) {
        const props = feature.properties || {};
        const name = props.Name || props.name || 'Separation Barrier Segment';
        const governorate = props.Governorat || props.GOVERNORAT || props.governorate || null;
        const coords = geomCentroid(feature);

        return this.toCanonical({
            id: this.generateId('wb-barrier', { index }),
            date: new Date().toISOString().split('T')[0],
            category: 'infrastructure',
            event_type: 'barrier_segment',
            location: {
                name,
                governorate,
                region: 'West Bank',
                lat: coords?.lat ?? null,
                lon: coords?.lon ?? null,
                precision: coords ? 'exact' : 'region',
            },
            metrics: {
                value: parseFloat(props.Length || props.LENGTH || props.length_km || 0) || 0,
                unit: 'km',
                count: 1,
            },
            description: `${props.Type || 'Barrier'} segment${name !== 'Separation Barrier Segment' ? ': ' + name : ''}`,
            barrier_type: props.Type || props.TYPE || props.barrier_type || 'Wall',
            barrier_status: props.Status || props.STATUS || 'Constructed',
            length_km: parseFloat(props.Length || props.LENGTH || props.length_km || 0) || null,
            construction_year: parseInt(props.Year || props.YEAR || props.construction_year || 0) || null,
            sources: [{
                name: metadata?.source || 'HDX',
                organization: metadata?.organization || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}
