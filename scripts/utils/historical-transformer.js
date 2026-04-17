/**
 * Historical Data Transformer
 *
 * Transforms manual historical data into the unified format.
 */

import { BaseTransformer } from './base-transformer.js';

const TIMELINE_PERIODS = [
    { id: 'pre_nakba', startsISO: '1900-01-01', endsISO: '1947-11-28' },
    { id: 'nakba', startsISO: '1947-11-29', endsISO: '1949-07-20' },
    { id: 'mandate_residue', startsISO: '1949-07-21', endsISO: '1967-06-04' },
    { id: '1967_war', startsISO: '1967-06-05', endsISO: '1967-06-10' },
    { id: 'naksa_aftermath', startsISO: '1967-06-11', endsISO: '1987-12-08' },
    { id: 'first_intifada', startsISO: '1987-12-09', endsISO: '1993-09-12' },
    { id: 'oslo', startsISO: '1993-09-13', endsISO: '2000-09-27' },
    { id: 'second_intifada', startsISO: '2000-09-28', endsISO: '2005-02-08' },
    { id: 'gaza_wars', startsISO: '2005-02-09', endsISO: '2023-10-06' },
    { id: 'post_2023', startsISO: '2023-10-07', endsISO: '2099-12-31' },
];

export function timelinePeriodFor(dateISO) {
    if (!dateISO) return null;
    const d = String(dateISO).slice(0, 10);
    for (const p of TIMELINE_PERIODS) {
        if (d >= p.startsISO && d <= p.endsISO) return p.id;
    }
    return null;
}

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
                timeline_period: timelinePeriodFor(date),
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
        if (['war', 'uprising', 'political', 'massacre', 'displacement'].includes(record.event_type)) {
            const date = record.date || `${record.year || 1948}-01-01`;
            const locationName = record.location || 'Palestine';
            return this.toCanonical({
                id: this.generateId('historical', { name: record.name, year: record.year, date }),
                date,
                timeline_period: timelinePeriodFor(date),
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
                    injured: parseInt(record.injured || 0),
                    displaced: parseInt(record.displaced || 0),
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
            timeline_period: timelinePeriodFor(date),
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
