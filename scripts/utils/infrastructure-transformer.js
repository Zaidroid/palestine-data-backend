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

        return {
            // Identity
            id: this.generateId('infrastructure', { date, type: 'daily_summary' }),
            type: 'infrastructure',
            category: 'infrastructure',

            // Temporal
            date: date,
            timestamp: new Date(date).toISOString(),
            period: {
                type: 'point',
                value: date,
            },

            // Spatial
            location: {
                name: 'Gaza Strip',
                admin_levels: {
                    level1: 'Gaza Strip',
                    level2: 'Gaza Strip',
                },
                region: 'Gaza Strip',
                coordinates: { lat: 31.5, lon: 34.466667 }, // Centroid of Gaza
            },

            // Standard Metrics (for validation)
            value: (record.housing_units_destroyed || 0) + (record.housing_units_damaged || 0),
            unit: 'housing_units_affected',

            // Infrastructure Metrics
            metrics: {
                housing: {
                    destroyed_units: record.housing_units_destroyed || 0,
                    damaged_units: record.housing_units_damaged || 0,
                    total_affected: (record.housing_units_destroyed || 0) + (record.housing_units_damaged || 0),
                },
                public_buildings: {
                    destroyed: record.government_buildings_destroyed || 0,
                    schools_destroyed: record.schools_destroyed || 0,
                    schools_damaged: record.schools_damaged || 0,
                    mosques_destroyed: record.mosques_destroyed || 0,
                    churches_damaged: record.churches_damaged || 0,
                    hospitals_out_of_service: record.hospitals_out_of_service || 0,
                },
                infrastructure: {
                    roads_destroyed_km: record.road_network_destroyed_km || 0, // If available
                    water_wells_destroyed: record.water_wells_destroyed || 0, // If available
                }
            },

            // Status
            status: 'Critical', // Gaza infrastructure is generally critical

            // Metadata
            source_dataset: 'TechForPalestine / GMO',

            // Quality
            quality: this.enrichQuality({
                id: baseId,
                date,
                location: { name: 'Gaza Strip' },
                value: record.housing_units_destroyed,
            }).quality,

            // Provenance
            sources: [
                {
                    name: 'TechForPalestine',
                    organization: 'Government Media Office (Gaza)',
                    url: 'https://data.techforpalestine.org/',
                    fetched_at: new Date().toISOString(),
                },
            ],

            // Metadata
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
        };
    }
}

export default InfrastructureTransformer;
