/**
 * Land & Settlements Data Transformer
 * 
 * Transforms land status, settlement, checkpoint, and demolition data
 * from Peace Now, B'Tselem, and OCHA into unified LandData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class LandTransformer extends BaseTransformer {
    constructor() {
        super('land');
    }

    /**
     * Transform raw land data to unified format
     */
    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData :
            (rawData.records ? rawData.records : []);

        return records
            .filter(record => record && (record.name || record.location))
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
     * Transform a single land record
     */
    transformRecord(record, metadata, index) {
        const date = record.date || record.last_updated || new Date().toISOString().split('T')[0];
        const recordType = this.determineLandType(record, metadata);

        const locationName = record.location || record.name || 'Palestine';
        const region = this.classifyRegion(locationName);
        const demolished = parseInt(record.structures_demolished || record.homes_demolished || 0);
        const displaced  = parseInt(record.people_displaced || record.persons_displaced || 0);

        return this.toCanonical({
            id: this.generateId('land', { ...record, date }),
            date,
            category: 'land',
            event_type: recordType,

            location: {
                name: locationName,
                governorate: record.governorate || record.district || null,
                region,
                lat: parseFloat(record.latitude || record.lat) || null,
                lon: parseFloat(record.longitude || record.lon) || null,
                precision: record.latitude ? 'exact' : 'region',
            },

            metrics: {
                demolished,
                displaced,
                count: demolished || 1,
                unit: recordType === 'demolition' ? 'structures' : 'sites',
            },

            description: record.notes || record.details || record.name || '',

            // Type-specific supplemental data
            land_type: recordType,
            land_name: record.name || record.location,
            land_status: this.normalizeStatus(record.status, recordType),
            ...(recordType === 'settlement' && this.enrichSettlementData(record)),
            ...(recordType === 'checkpoint' && this.enrichCheckpointData(record)),
            ...(recordType === 'demolition' && this.enrichDemolitionData(record)),

            sources: [
                record._source_attribution
                    ? { ...record._source_attribution, fetched_at: new Date().toISOString() }
                    : {
                        name: metadata.source || 'Land Status Database',
                        organization: metadata.organization || "OCHA/B'Tselem/Peace Now",
                        url: metadata.url || record.source_url || null,
                        license: 'varies',
                        fetched_at: new Date().toISOString(),
                    },
            ],
        });
    }

    /**
     * Determine land record type
     */
    determineLandType(record, metadata) {
        const source = metadata.type || metadata.category || '';
        const recordType = record.type || '';

        if (source.includes('settlement') || recordType.includes('settlement')) {
            return 'settlement';
        }
        if (source.includes('checkpoint') || recordType.includes('checkpoint') || recordType.includes('barrier')) {
            return 'checkpoint';
        }
        if (source.includes('demolition') || recordType.includes('demolition') || recordType.includes('destruction')) {
            return 'demolition';
        }
        if (source.includes('wall') || recordType.includes('wall') || recordType.includes('barrier') || recordType.includes('fence')) {
            return 'wall';
        }
        if (source.includes('confiscation') || recordType.includes('confiscation') || recordType.includes('seizure')) {
            return 'confiscation';
        }

        return 'other';
    }

    /**
     * Normalize status based on type
     */
    normalizeStatus(status, type) {
        if (!status) return 'Unknown';

        const statusStr = status.toLowerCase();

        // Settlement status
        if (type === 'settlement') {
            if (statusStr.includes('authorized') || statusStr.includes('legal')) return 'Authorized';
            if (statusStr.includes('unauthorized') || statusStr.includes('illegal')) return 'Unauthorized';
            if (statusStr.includes('outpost')) return 'Outpost';
            if (statusStr.includes('expanding')) return 'Expanding';
        }

        // Checkpoint status
        if (type === 'checkpoint') {
            if (statusStr.includes('active') || statusStr.includes('operational')) return 'Active';
            if (statusStr.includes('partial')) return 'Partial';
            if (statusStr.includes('closed') || statusStr.includes('inactive')) return 'Closed';
        }

        // Demolition status
        if (type === 'demolition') {
            if (statusStr.includes('complete')) return 'Completed';
            if (statusStr.includes('partial')) return 'Partial';
            if (statusStr.includes('pending') || statusStr.includes('planned')) return 'Pending';
        }

        return status;
    }

    /**
     * Enrich settlement data
     */
    enrichSettlementData(record) {
        return {
            settlement: {
                population: record.population || record.settlers,
                established_year: record.established_year || record.year_established,
                settlement_type: record.settlement_type || (record.is_outpost ? 'Outpost' : 'Settlement'),
                area_dunums: record.area_dunums || record.area,
                growth_rate: record.growth_rate,
                housing_units: record.housing_units || record.units,
                expansion_plans: record.expansion_plans || record.planned_expansion,
                legal_status: this.normalizeStatus(record.status || record.legal_status, 'settlement'),
            },
        };
    }

    /**
     * Enrich checkpoint data
     */
    enrichCheckpointData(record) {
        return {
            checkpoint: {
                checkpoint_type: record.checkpoint_type || this.classifyCheckpointType(record),
                operational_status: this.normalizeStatus(record.status, 'checkpoint'),
                restrictions: record.restrictions || [],
                hours_of_operation: record.hours || record.operating_hours,
                weekly_closures: record.weekly_closures,
                permits_required: record.permits_required !== false,
                average_wait_time: record.average_wait_time,
                controls_access_to: record.controls_access_to || [],
            },
        };
    }

    /**
     * Classify checkpoint type
     */
    classifyCheckpointType(record) {
        const name = (record.name || '').toLowerCase();
        const type = (record.type || '').toLowerCase();

        if (name.includes('terminal') || type.includes('terminal')) return 'Terminal';
        if (name.includes('partial') || type.includes('partial')) return 'Partial Checkpoint';
        if (name.includes('roadblock') || type.includes('roadblock')) return 'Roadblock';
        if (name.includes('gate') || type.includes('gate')) return 'Gate';

        return 'Checkpoint';
    }

    /**
     * Enrich demolition data
     */
    enrichDemolitionData(record) {
        return {
            demolition: {
                demolition_date: record.demolition_date || record.date,
                structure_type: record.structure_type || record.building_type,
                structures_demolished: record.structures_demolished || record.count || 1,
                people_displaced: record.people_displaced || record.displaced,
                reason: record.reason || record.demolition_reason,
                notification_given: record.notification_given !== false,
                legal_order: record.legal_order || record.order_number,
                owner_type: record.owner_type || 'Private',
            },
        };
    }

    /**
     * Enrich wall/barrier data
     */
    enrichWallData(record) {
        return {
            wall: {
                segment_length: record.segment_length || record.length,
                wall_type: record.wall_type || this.classifyWallType(record),
                construction_status: record.construction_status || this.normalizeStatus(record.status, 'wall'),
                route: record.route || record.path,
                communities_affected: record.communities_affected || [],
                land_isolated: record.land_isolated,
            },
        };
    }

    /**
     * Classify wall type
     */
    classifyWallType(record) {
        const description = (record.description || '').toLowerCase();
        const type = (record.type || '').toLowerCase();

        if (description.includes('concrete') || type.includes('concrete')) return 'Concrete Wall';
        if (description.includes('fence') || type.includes('fence')) return 'Fence';
        if (description.includes('trench') || type.includes('trench')) return 'Trench';

        return 'Barrier';
    }

    /**
     * Enrich confiscation data
     */
    enrichConfiscationData(record) {
        return {
            confiscation: {
                confiscation_date: record.confiscation_date || record.date,
                area_confiscated: record.area_confiscated || record.area,
                land_type: record.land_type || record.use,
                previous_use: record.previous_use,
                new_use: record.new_use || record.purpose,
                legal_basis: record.legal_basis || record.military_order,
                compensation_offered: record.compensation_offered === true,
                affected_families: record.affected_families,
            },
        };
    }

    /**
     * Get category-specific required fields
     */
    getCategoryRequiredFields() {
        return ['name', 'location', 'land_type'];
    }

    /**
     * Enrich land data with additional context
     */
    enrich(data) {
        return data.map(record => ({
            ...record,
            ...this.enrichTemporal(record),
            ...this.enrichSpatial(record),
            context: this.enrichLandContext(record),
        }));
    }

    /**
     * Add land-specific context enrichment
     */
    enrichLandContext(record) {
        return {
            conflict_relevance: this.assessConflictRelevance(record),
            human_rights_concern: this.assessHumanRightsConcern(record),
            international_law: this.assessInternationalLawContext(record),
        };
    }

    /**
     * Assess conflict relevance
     */
    assessConflictRelevance(record) {
        if (record.land_type === 'settlement' || record.land_type === 'confiscation') {
            return 'High - Territorial Dispute';
        }
        if (record.land_type === 'checkpoint' || record.land_type === 'wall') {
            return 'High - Movement Restriction';
        }
        if (record.land_type === 'demolition') {
            return 'High - Displacement';
        }
        return 'Medium';
    }

    /**
     * Assess human rights concern level
     */
    assessHumanRightsConcern(record) {
        const concerns = [];

        if (record.land_type === 'demolition' && record.demolition?.people_displaced > 0) {
            concerns.push('Forced Displacement');
        }
        if (record.land_type === 'checkpoint') {
            concerns.push('Freedom of Movement');
        }
        if (record.land_type === 'confiscation') {
            concerns.push('Property Rights');
        }
        if (record.land_type === 'settlement') {
            concerns.push('Land Rights');
        }

        return concerns.length > 0 ? concerns : ['None'];
    }

    /**
     * Assess international law context
     */
    assessInternationalLawContext(record) {
        if (record.land_type === 'settlement') {
            return 'Fourth Geneva Convention - Settlements in occupied territory';
        }
        if (record.land_type === 'demolition') {
            return 'Fourth Geneva Convention - Destruction of property';
        }
        if (record.land_type === 'wall') {
            return 'ICJ Advisory Opinion 2004 - Barrier construction';
        }
        if (record.land_type === 'confiscation') {
            return 'Hague Regulations - Land confiscation in occupied territory';
        }

        return 'International Humanitarian Law';
    }
}

export default LandTransformer;
