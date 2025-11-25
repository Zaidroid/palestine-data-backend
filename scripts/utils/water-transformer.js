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
        // Normalize date
        let date = record.date || record.last_updated || record.reference_period_end;
        try {
            const d = new Date(date);
            if (!isNaN(d.getTime())) {
                date = d.toISOString();
            } else {
                date = new Date().toISOString();
            }
        } catch (e) {
            date = new Date().toISOString();
        }

        // Extract location info
        const locationName = record.location_name || record.admin1_name || 'Palestine';
        const region = this.classifyRegion(locationName);

        return {
            id: this.generateId('water', { ...record, date }),
            type: 'water',
            category: 'water',
            date: date,
            timestamp: date,
            period: {
                type: 'point',
                value: date,
            },

            // Spatial
            location: {
                name: locationName,
                admin_levels: {
                    level1: region,
                    level2: record.admin2_name || locationName,
                },
                region: region,
                coordinates: record.lat && record.lon ? {
                    lat: parseFloat(record.lat),
                    lon: parseFloat(record.lon)
                } : null,
            },

            // Water-specific data
            indicator: {
                code: record.indicator_code || 'UNKNOWN',
                name: record.indicator_name || 'Unknown Indicator',
                description: record.indicator_description || '',
            },
            value: parseFloat(record.value || record.metric_value || 0),
            unit: record.unit || 'count',

            // Status & Analysis
            status: this.assessStatus(record),
            access_level: this.assessAccessLevel(record),

            // Metadata
            source_dataset: record.dataset_name || metadata.source,
            provider: record.provider_name || metadata.organization,

            // Quality
            quality: this.enrichQuality({
                id: this.generateId('water', record),
                date,
                location: { name: locationName },
                value: record.value,
            }).quality,

            // Provenance
            sources: [
                {
                    name: metadata.source || 'HDX',
                    organization: record.provider_name || metadata.organization || 'UN Agencies',
                    url: metadata.url || record.dataset_hdx_url,
                    fetched_at: new Date().toISOString(),
                },
            ],

            // Metadata
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
        };
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
