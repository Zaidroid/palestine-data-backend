/**
 * Historical Data Transformer
 *
 * Transforms manual historical data into the unified format.
 */

import { BaseTransformer } from './base-transformer.js';

export class HistoricalTransformer extends BaseTransformer {
    constructor() {
        super('historical');
    }

    /**
     * Transform manual historical data
     */
    transform(data, metadata) {
        if (!Array.isArray(data)) {
            console.warn('HistoricalTransformer: Data is not an array');
            return [];
        }
        return data.map(record => this.transformRecord(record, metadata || {}));
    }

    transformRecord(record, metadata) {
        // Depopulation (Nakba) records
        if (record.event_type === 'depopulation') {
            const date = record.depopulation_date || `${record.year || 1948}-05-15`;
            const locationName = record.name || 'Unknown';
            return this.toCanonical({
                id: this.generateId('historical', { name: record.name, year: record.year }),
                date,
                category: 'historical',
                event_type: 'depopulation',
                location: {
                    name: locationName,
                    governorate: record.district || null,
                    region: this._regionFromDistrict(record.district),
                    lat: record.coord?.lat ?? null,
                    lon: record.coord?.lon ?? null,
                    precision: record.coord ? 'exact' : 'region',
                },
                metrics: {
                    displaced: parseInt(record.population_1948 || 0),
                    count: parseInt(record.population_1948 || 0),
                    unit: 'persons',
                },
                description: `Depopulation of ${locationName} (${record.district || 'unknown district'}) during the Nakba. Population: ${record.population_1948 || 'unknown'}`,
                sources: [{
                    name: 'Historical Records',
                    organization: metadata.organization || 'Historical Records',
                    url: null,
                    license: 'public-domain',
                    fetched_at: new Date().toISOString(),
                }],
            });
        }

        // War / Uprising / Political events
        if (['war', 'uprising', 'political'].includes(record.event_type)) {
            const date = record.date || `${record.year || 1948}-01-01`;
            const locationName = record.location || 'Palestine';
            return this.toCanonical({
                id: this.generateId('historical', { name: record.name, year: record.year }),
                date,
                category: 'historical',
                event_type: record.event_type,
                location: {
                    name: locationName,
                    governorate: null,
                    region: this.classifyRegion(locationName),
                    lat: null,
                    lon: null,
                    precision: 'region',
                },
                metrics: {
                    killed: parseInt(record.fatalities || 0),
                    count: parseInt(record.fatalities || 0),
                    unit: 'persons',
                },
                description: record.description || `${record.name || ''} (${record.year || ''})`,
                sources: [{
                    name: record.source || 'Historical Records',
                    organization: metadata.organization || 'Historical Records',
                    url: null,
                    license: 'public-domain',
                    fetched_at: new Date().toISOString(),
                }],
            });
        }

        // Default: population / demographic estimate
        const locationName = record.location || 'Palestine';
        const date = `${record.year || 2000}-01-01`;
        return this.toCanonical({
            id: this.generateId('historical', { location: locationName, year: record.year }),
            date,
            category: 'demographics',
            event_type: 'population_estimate',
            location: {
                name: locationName,
                governorate: null,
                region: this.classifyRegion(locationName),
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                value: parseFloat(record.value || 0),
                unit: 'persons',
                count: 1,
            },
            description: `Population estimate for ${locationName} in ${record.year}: ${(record.value || 0).toLocaleString()}`,
            sources: [{
                name: record.source || 'Historical Records',
                organization: metadata.organization || 'Historical Records',
                url: null,
                license: 'public-domain',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    _regionFromDistrict(district) {
        if (!district) return 'Palestine';
        const d = district.toLowerCase();
        if (d.includes('gaza')) return 'Gaza Strip';
        if (d.includes('jerusalem')) return 'East Jerusalem';
        return 'West Bank';
    }
}

export default HistoricalTransformer;
