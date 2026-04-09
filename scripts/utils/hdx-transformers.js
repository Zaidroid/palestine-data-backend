/**
 * HDX Category Transformers (JavaScript)
 *
 * Provides transformers for all HDX data categories
 */

import { BaseTransformer } from './base-transformer.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build canonical location from a raw HDX record + metadata context.
 * Returns {name, governorate, region, lat, lon, precision}.
 */
function extractCanonicalLocation(record, metadata, transformer) {
    const locationName = record.location || record.governorate || record.area || 'unknown';
    let region = transformer.classifyRegion(locationName);

    if (region === 'Unknown' && metadata) {
        const ctx = `${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
        if (ctx.includes('gaza')) region = 'Gaza Strip';
        else if (ctx.includes('west bank')) region = 'West Bank';
        else if (ctx.includes('palestine')) region = 'Palestine';
    }

    const coords = transformer.extractCoordinates(record);

    return {
        name: locationName,
        governorate: record.admin1 || record.governorate || null,
        region,
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        precision: coords ? 'exact' : 'region',
    };
}

// ---------------------------------------------------------------------------
// InfrastructureTransformer
// ---------------------------------------------------------------------------
export class InfrastructureTransformer extends BaseTransformer {
    constructor() { super('infrastructure'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                const isGhost = (v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown');
                return !isGhost;
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(
            record.damage_date || record.incident_date || record.date || record.assessment_date
        );
        const location = extractCanonicalLocation(record, metadata, this);

        return this.toCanonical({
            id: this.generateId('infrastructure', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'infrastructure',
            event_type: 'infrastructure_damage',
            location,
            metrics: {
                value: parseFloat(record.estimated_cost || record.damage_cost || 0),
                unit: 'usd',
                count: 1,
            },
            description: record.type || record.structure_type || 'infrastructure damage',
            structure_type: record.type || record.structure_type || record.building_type || 'building',
            damage_level: record.damage || record.damage_level || record.damage_assessment || 'unknown',
            people_affected: parseInt(record.people_affected || record.affected_population || 0),
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// EducationTransformer
// ---------------------------------------------------------------------------
export class EducationTransformer extends BaseTransformer {
    constructor() { super('education'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                const isGhost = (v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown');
                const locationName = (record.location?.name || '').toLowerCase();
                const isPalestineRelated = locationName.includes('palestine') ||
                    locationName.includes('pse') || locationName.includes('gaza') ||
                    locationName.includes('west bank') || locationName === 'unknown' || locationName === '';
                return !isGhost && isPalestineRelated;
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(record.assessment_date || record.last_updated || record.date);
        const countryCode = record.ref_area || record.country_id || '';
        const countryName = record.geographic_area || '';
        let locationName = countryName || countryCode || record.location || record.governorate || record.region || 'unknown';
        if (typeof locationName === 'object' && locationName !== null) locationName = locationName.name || 'unknown';
        let region = this.classifyRegion(locationName);
        if (region === 'Unknown' && countryCode) region = this.classifyRegion(countryCode);
        if (region === 'Unknown' && metadata) {
            const ctx = `${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
            if (ctx.includes('gaza')) region = 'Gaza Strip';
            else if (ctx.includes('west bank')) region = 'West Bank';
            else if (ctx.includes('palestine')) region = 'Palestine';
        }

        return this.toCanonical({
            id: this.generateId('education', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'education',
            event_type: 'education_indicator',
            location: {
                name: locationName,
                governorate: record.admin1 || null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value: parseInt(record.students || record.enrollment || record.capacity || 0),
                unit: 'students',
                count: 1,
            },
            description: record.name || record.facility_name || record.school_name || 'education facility',
            facility_name: record.name || record.facility_name || record.school_name || 'unknown',
            facility_type: record.type || record.facility_type || 'school',
            damage_level: record.damage || record.damage_level || null,
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// HealthTransformer
// ---------------------------------------------------------------------------
export class HealthTransformer extends BaseTransformer {
    constructor() { super('health'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                const isGhost = (v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown');
                const locationName = (record.location?.name || '').toLowerCase();
                const isForeign = ['italy', 'ukraine', 'sudan', 'yemen', 'eswatini', 'africa', 'turkey']
                    .some(c => locationName.includes(c));
                return !isGhost && !isForeign;
            });
    }

    transformRecord(record, metadata, index) {
        let dateStr = record.damage_date || record.incident_date || record.date || record.assessment_date;
        if (!dateStr && record['year_(display)']) dateStr = `${record['year_(display)']}-01-01`;
        const date = this.normalizeDate(dateStr);

        const isWhoData = record['gho_(code)'] || record['numeric'] !== undefined;
        const value = isWhoData
            ? parseFloat(record['numeric'] || 0)
            : parseInt(record.bed_capacity || record.beds || record.capacity || 0);
        const facilityName = isWhoData
            ? (record['gho_(display)'] || 'Health Indicator')
            : (record.name || record.facility_name || record.hospital_name || 'unknown');

        const rawLocation = record.location || record.governorate || record.area ||
            record['country_(display)'] || record['region_(display)'] || 'unknown';
        let region = this.classifyRegion(rawLocation);
        if (region === 'Unknown' && record.description) {
            if (record.description.toLowerCase().includes('west bank')) region = 'West Bank';
            else if (record.description.toLowerCase().includes('gaza')) region = 'Gaza Strip';
        }
        if (region === 'Unknown' && metadata) {
            const ctx = `${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
            if (ctx.includes('gaza')) region = 'Gaza Strip';
            else if (ctx.includes('west bank')) region = 'West Bank';
            else if (ctx.includes('palestine')) region = 'Palestine';
        }
        const finalName = (rawLocation === 'unknown' && region !== 'Unknown') ? region : rawLocation;

        return this.toCanonical({
            id: this.generateId('health', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'health',
            event_type: isWhoData ? 'health_indicator' : 'health_facility',
            location: {
                name: finalName,
                governorate: record.admin1 || record.governorate || null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value,
                unit: isWhoData ? 'count' : 'beds',
                count: 1,
            },
            description: facilityName,
            facility_name: facilityName,
            facility_type: record.type || record.facility_type || (isWhoData ? 'indicator' : 'health_facility'),
            sources: [{
                name: metadata.organization?.title || metadata.source || 'HDX',
                organization: metadata.organization?.title || metadata.organization || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// WaterTransformer (HDX version — distinct from scripts/utils/water-transformer.js)
// ---------------------------------------------------------------------------
export class WaterTransformer extends BaseTransformer {
    constructor() { super('water'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                return !((v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown'));
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(record.assessment_date || record.last_updated || record.date);
        const location = extractCanonicalLocation(record, metadata, this);

        return this.toCanonical({
            id: this.generateId('water', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'water',
            event_type: 'wash_facility',
            location,
            metrics: {
                value: parseFloat(record.capacity || record.daily_capacity || 0),
                unit: 'cubic_meters',
                count: 1,
            },
            description: record.name || record.facility_name || 'water facility',
            facility_name: record.name || record.facility_name || 'unknown',
            facility_type: record.type || record.facility_type || 'water',
            population_served: parseInt(record.population_served || record.beneficiaries || 0),
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// HumanitarianTransformer
// ---------------------------------------------------------------------------
export class HumanitarianTransformer extends BaseTransformer {
    constructor() { super('humanitarian'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                return !((v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown'));
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(
            record.date || record.reporting_date || record.assessment_date || record.startdate || record.year
        );

        let value = 0;
        let unit = 'people';
        if (record.people_in_need || record.pin || record.affected) {
            value = parseInt(record.people_in_need || record.pin || record.affected || 0);
        } else if (record.origrequirements || record.revisedrequirements) {
            value = parseFloat(record.revisedrequirements || record.origrequirements || 0);
            unit = 'usd';
        }

        let locationName = record.location || record.governorate || record.area || 'unknown';
        if (locationName === 'unknown' && record.locations) locationName = record.locations;
        let region = this.classifyRegion(locationName);
        if (region === 'Unknown' && metadata) {
            const ctx = `${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
            if (ctx.includes('gaza')) region = 'Gaza Strip';
            else if (ctx.includes('west bank')) region = 'West Bank';
            else if (ctx.includes('palestine')) region = 'Palestine';
        }

        return this.toCanonical({
            id: this.generateId('humanitarian', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'humanitarian',
            event_type: 'humanitarian_needs',
            location: {
                name: locationName,
                governorate: record.admin1 || null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value,
                unit,
                affected: parseInt(record.people_in_need || record.pin || record.affected || 0),
                count: 1,
            },
            description: record.sector || record.indicator || 'humanitarian indicator',
            sector: record.sector || record.cluster || record.categories || 'multi-sector',
            people_in_need: parseInt(record.people_in_need || record.pin || record.affected || 0),
            people_targeted: parseInt(record.people_targeted || record.target || 0),
            people_reached: parseInt(record.people_reached || record.reached || 0),
            funding_requirements: parseFloat(record.revisedrequirements || record.origrequirements || 0),
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// RefugeeTransformer
// ---------------------------------------------------------------------------
export class RefugeeTransformer extends BaseTransformer {
    constructor() { super('refugees'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                return !((v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown'));
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(
            record.date || record.reporting_date || record.timestamp || record.year
        );

        const refugees = parseInt(record.refugees || 0);
        const asylum = parseInt(record.asylum_seekers || 0);
        const idps = parseInt(record.idps || record.displaced || record.population ||
            record.internally_displaced_persons || 0);
        const total = refugees + asylum + idps;

        const locationName = record.country_of_asylum_name || record.country_of_asylum_code ||
            record.location || record.governorate || 'unknown';
        let region = this.classifyRegion(locationName);
        if (region === 'Unknown' && locationName !== 'unknown') region = 'Palestine'; // Palestinian refugees in host country
        if (region === 'Unknown' && metadata) {
            const ctx = `${metadata.title || ''} ${metadata.description || ''}`.toLowerCase();
            if (ctx.includes('gaza')) region = 'Gaza Strip';
            else if (ctx.includes('west bank')) region = 'West Bank';
            else if (ctx.includes('palestine')) region = 'Palestine';
        }

        return this.toCanonical({
            id: this.generateId('refugee', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'refugees',
            event_type: 'refugee_displacement',
            location: {
                name: locationName,
                governorate: null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value: total,
                unit: 'people',
                displaced: idps,
                count: total,
            },
            description: `Palestinian refugees: ${total.toLocaleString()} total`,
            displaced_population: idps,
            refugees,
            asylum_seekers: asylum,
            displacement_type: record.displacement_type || record.type || (idps > 0 ? 'internal' : 'cross-border'),
            origin: record.country_of_origin_name || record.country_of_origin_code || 'Palestine',
            asylum_country: record.country_of_asylum_name || record.country_of_asylum_code || null,
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// ---------------------------------------------------------------------------
// ShelterTransformer
// ---------------------------------------------------------------------------
export class ShelterTransformer extends BaseTransformer {
    constructor() { super('infrastructure'); }

    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData : (rawData.data || []);
        return records
            .filter(record => record && Object.keys(record).length > 0)
            .map((record, index) => this.transformRecord(record, metadata, index))
            .filter(record => {
                const v = record.metrics?.value;
                return !((v === 0 || v === null || isNaN(v)) &&
                    (!record.location?.name || record.location.name === 'unknown'));
            });
    }

    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(
            record.damage_date || record.incident_date || record.date || record.assessment_date
        );
        const locationName = record.location || record.governorate || record.area || 'unknown';
        let region = this.classifyRegion(locationName);
        if (region === 'Unknown') {
            const titleCheck = `${record.title || ''} ${record.dataset_title || ''}`.toLowerCase();
            if (titleCheck.includes('gaza')) region = 'Gaza Strip';
        }

        return this.toCanonical({
            id: this.generateId('shelter', { ...record, date }),
            date: date || new Date().toISOString().split('T')[0],
            category: 'infrastructure',
            event_type: 'shelter_damage',
            location: {
                name: locationName,
                governorate: record.admin1 || null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value: parseInt(record.capacity || record.housing_units || 0),
                unit: 'units',
                count: parseInt(record.capacity || record.housing_units || 0),
                displaced: parseInt(record.idps || record.displaced || 0),
            },
            description: record.name || record.shelter_name || 'shelter',
            shelter_name: record.name || record.shelter_name || record.building_name || 'unknown',
            shelter_type: record.type || record.shelter_type || record.housing_type || 'housing',
            occupancy: parseInt(record.occupancy || record.residents || record.population || 0),
            sources: [{
                name: metadata.organization?.title || 'HDX',
                organization: metadata.organization?.title || 'HDX',
                url: null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

// Export all transformers
export default {
    InfrastructureTransformer,
    EducationTransformer,
    HealthTransformer,
    WaterTransformer,
    HumanitarianTransformer,
    RefugeeTransformer,
    ShelterTransformer,
};
