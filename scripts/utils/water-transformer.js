/**
 * Water & Sanitation (WASH) Data Transformer
 * 
 * Transforms WASH data from HDX and other sources into the unified WaterData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class WaterTransformer extends BaseTransformer {
    constructor() {
        super('water');
    }

    /**
     * Transform raw water data to unified format
     */
    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData :
            (rawData.data ? rawData.data : []);

        return records
            .filter(record => this.isValidRecord(record))
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
     * Validate record has essential fields
     */
    isValidRecord(record) {
        // HDX HAPI records usually have value and indicator info
        return record && (record.value !== undefined || record.metric_value !== undefined);
    }

    /**
     * Transform a single water data record
     */
    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(record.date || record.last_updated || record.reference_period_end);
        const locationName = record.location_name || record.admin1_name || 'Palestine';
        const region = this.classifyRegion(locationName);
        const value = parseFloat(record.value || record.metric_value || 0);

        return this.toCanonical({
            id: this.generateId('water', { ...record, date }),
            date,
            category: 'water',
            event_type: 'wash_indicator',

            location: {
                name: locationName,
                governorate: record.admin2_name || null,
                region,
                lat: record.lat ? parseFloat(record.lat) : null,
                lon: record.lon ? parseFloat(record.lon) : null,
                precision: record.lat ? 'exact' : 'region',
            },

            metrics: {
                value,
                unit: record.unit || 'count',
                count: 1,
            },

            description: record.indicator_name || 'WASH indicator',

            // Water-specific supplemental fields
            indicator_code: record.indicator_code || 'UNKNOWN',
            indicator_name: record.indicator_name || 'Unknown Indicator',
            wash_status: this.assessStatus(record),
            access_level: this.assessAccessLevel(record),

            sources: [{
                name: metadata.source || 'HDX',
                organization: record.provider_name || metadata.organization || 'UN Agencies',
                url: metadata.url || record.dataset_hdx_url || null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    /**
     * Assess status based on indicator values
     * This is a heuristic and should be refined with domain knowledge
     */
    assessStatus(record) {
        const name = (record.indicator_name || '').toLowerCase();
        const value = parseFloat(record.value || 0);

        if (name.includes('shortage') || name.includes('deficit')) {
            if (value > 50) return 'Critical';
            if (value > 20) return 'Warning';
            return 'Stable';
        }

        if (name.includes('access') || name.includes('coverage')) {
            if (value < 30) return 'Critical';
            if (value < 70) return 'Warning';
            return 'Good';
        }

        return 'Unknown';
    }

    /**
     * Assess access level
     */
    assessAccessLevel(record) {
        const status = this.assessStatus(record);
        if (status === 'Critical') return 'Low';
        if (status === 'Warning') return 'Moderate';
        if (status === 'Good') return 'High';
        return 'Unknown';
    }
}

export default WaterTransformer;
