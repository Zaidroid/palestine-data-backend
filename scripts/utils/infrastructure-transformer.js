/**
 * Infrastructure Data Transformer
 * 
 * Transforms infrastructure damage data from TechForPalestine/GMO into unified InfrastructureData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class InfrastructureTransformer extends BaseTransformer {
    constructor() {
        super('infrastructure');
    }

    /**
     * Transform raw infrastructure data to unified format
     */
    transform(rawData, metadata) {
        // TechForPalestine returns a list of daily reports
        const records = Array.isArray(rawData) ? rawData : [];

        // We typically want the latest report for the current status,
        // but we might process all for a time series.
        // For the unified "current state" view, we'll process the latest record
        // and potentially some key historical points if needed.

        // For this implementation, we'll transform all records to allow for time-series analysis
        return records
            .filter(record => record && record.report_date)
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
     * Transform a single daily report into multiple infrastructure records
     * (One for each category: Housing, Roads, Public Buildings, etc.)
     */
    transformRecord(record, metadata, index) {
        const date = record.report_date;
        const baseId = `infra-${date}`;

        // We'll create a composite record for the daily summary
        // In a more granular system, we might split this into separate features

        const housing_destroyed = record.housing_units_destroyed || 0;
        const housing_damaged   = record.housing_units_damaged   || 0;

        return this.toCanonical({
            id: this.generateId('infrastructure', { date, type: 'daily_summary' }),
            date,
            category: 'infrastructure',
            event_type: 'infrastructure_damage',

            location: {
                name: 'Gaza Strip',
                region: 'Gaza Strip',
                lat: 31.5,
                lon: 34.466667,
                precision: 'region',
            },

            metrics: {
                demolished: housing_destroyed,
                affected:   housing_destroyed + housing_damaged,
                count:      housing_destroyed + housing_damaged,
                unit: 'housing_units',
            },

            description: `Daily infrastructure report: ${housing_destroyed} housing units destroyed, ${housing_damaged} damaged`,

            // Supplemental detail fields
            infrastructure_detail: {
                housing_destroyed,
                housing_damaged,
                government_buildings_destroyed: record.government_buildings_destroyed || 0,
                schools_destroyed: record.schools_destroyed || 0,
                schools_damaged:   record.schools_damaged   || 0,
                mosques_destroyed: record.mosques_destroyed || 0,
                hospitals_out_of_service: record.hospitals_out_of_service || 0,
            },

            sources: [{
                name: 'TechForPalestine',
                organization: 'Government Media Office (Gaza)',
                url: 'https://data.techforpalestine.org/',
                license: 'public-domain',
                fetched_at: new Date().toISOString(),
            }],
        });
    }
}

export default InfrastructureTransformer;
