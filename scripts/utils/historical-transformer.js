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
            // Handle Nakba Data
            if (record.event_type === 'depopulation') {
                return {
                    date: record.depopulation_date || `${record.year}-05-15`,
                    year: record.year,
                    location: {
                        name: record.name,
                        district: record.district,
                        coordinates: record.coord
                    },
                    region: this.normalizeRegion(record.district),
                    category: 'historical',
                    event_type: 'depopulation',

                    // Metrics
                    population_affected: record.population_1948,

                    // Metadata
                    source: 'Historical Records',
                    original_id: `nakba_${record.name.replace(/\s+/g, '_')}`,

                    description: `Depopulation of ${record.name} (${record.district}) during the Nakba. Population: ${record.population_1948}`,
                    tags: ['nakba', 'depopulation', 'displacement']
                };
            }

            // Handle Historical Events (Wars, Uprisings)
            if (['war', 'uprising', 'political'].includes(record.event_type)) {
                return {
                    date: record.date || `${record.year}-01-01`,
                    year: record.year,
                    location: {
                        name: record.location || 'Palestine'
                    },
                    region: this.normalizeRegion(record.location),
                    category: 'historical',
                    event_type: record.event_type,

                    // Metrics
                    fatalities: record.fatalities || 0,

                    // Metadata
                    source: record.source || 'Historical Records',
                    original_id: `hist_event_${record.year}_${record.name.replace(/\s+/g, '_')}`,

                    description: record.description || `${record.name} (${record.year})`,
                    tags: ['historical', record.event_type, 'conflict']
                };
            }

            // Handle Manual Population Data (Default)
            const locationName = record.location || 'Unknown';
            const transformed = {
                date: `${record.year}-01-01`, // Default to Jan 1st for annual data
                year: record.year,
                location: {
                    name: locationName
                },
                region: this.normalizeRegion(locationName),
                category: 'demographics',
                event_type: 'population_estimate',

                // Metrics
                population: record.value,

                // Metadata
                source: record.source,
                source_detail: record.source_detail,
                original_id: `hist_pop_${record.year}_${locationName.replace(/\s+/g, '_')}`,

                // Standard fields
                description: `Population estimate for ${locationName} in ${record.year}: ${(record.value || 0).toLocaleString()}`,
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
