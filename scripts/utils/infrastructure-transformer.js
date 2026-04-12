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
            .filter(record => record && (record.report_date || record.date))
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
     * Transform a single daily report into multiple infrastructure records
     * (One for each category: Housing, Roads, Public Buildings, etc.)
     */
    transformRecord(record, metadata, index) {
        const date = record.date || record.report_date;

        const value = parseInt(record.value || record.housing_units_destroyed || 0);

        return this.toCanonical({
            id: this.generateId('infrastructure', { date, type: record.type || 'daily_summary' }),
            date,
            category: 'infrastructure',
            event_type: 'infrastructure_damage',

            location: {
                name: record.location || 'Gaza Strip',
                region: 'Gaza Strip',
                lat: 31.5,
                lon: 34.466667,
                precision: 'region',
            },

            metrics: {
                demolished: record.damage_level === 'destroyed' ? value : 0,
                affected: value,
                count: value,
                unit: record.unit || 'units',
            },

            description: `Infrastructure damage: ${value} ${record.unit || 'units'} of ${record.type || 'infrastructure'} ${record.damage_level || 'damaged'}`,

            // Supplemental detail fields
            infrastructure_detail: {
                type: record.type || 'unknown',
                damage_level: record.damage_level || 'unknown'
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
