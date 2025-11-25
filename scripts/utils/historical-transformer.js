/**
 * Historical Data Transformer
 * 
 * Transforms manual historical data into the unified format.
 */

import { BaseTransformer } from './base-transformer.js';

export class HistoricalTransformer extends BaseTransformer {
    constructor() {
        super();
    }

    /**
     * Transform manual historical data
     * @param {Array} data - Array of manual data records
     * @param {Object} metadata - Source metadata
     * @returns {Array} - Transformed records
     */
    transform(data, metadata) {
        if (!Array.isArray(data)) {
            console.warn('HistoricalTransformer: Data is not an array');
            return [];
        }

        return data.map(record => {
            // Base record structure
            const transformed = {
                date: `${record.year}-01-01`, // Default to Jan 1st for annual data
                year: record.year,
                location: record.location,
                region: this.normalizeRegion(record.location),
                category: 'demographics',
                event_type: 'population_estimate',

                // Metrics
                population: record.value,

                // Metadata
                source: record.source,
                source_detail: record.source_detail,
                original_id: `hist_pop_${record.year}_${record.location.replace(/\s+/g, '_')}`,

                // Standard fields
                description: `Population estimate for ${record.location} in ${record.year}: ${record.value.toLocaleString()}`,
                tags: ['population', 'historical', 'demographics']
            };

            return transformed;
        });
    }

    /**
     * Normalize region name
     * @param {string} location 
     * @returns {string}
     */
    normalizeRegion(location) {
        if (!location) return 'unknown';
        const lower = location.toLowerCase();
        if (lower.includes('gaza')) return 'gaza';
        if (lower.includes('west bank')) return 'west_bank';
        return 'palestine';
    }
}
