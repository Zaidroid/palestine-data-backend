/**
 * Good Shepherd Data Transformer
 *
 * Transforms data from Good Shepherd sources (prisoners, healthcare, etc.)
 * into the unified canonical format.
 */

import { BaseTransformer } from './base-transformer.js';

export class GoodShepherdTransformer extends BaseTransformer {
    constructor() {
        super('conflict');
    }

    /**
     * Transform an array of records
     */
    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter(record => record && typeof record === 'object')
            .map(record => this.transformRecord(record, context));
    }

    /**
     * Transform a single record
     */
    transformRecord(record, context = {}) {
        const category = context.category || 'conflict';
        const date = this._extractDate(record);
        const locationName = this._extractLocationName(record);
        const region = this.classifyRegion(locationName);
        const eventType = record.event_type || `${category}_report`;

        const base = {
            id: record.id || this.generateId('gs', { ...record, date }),
            date,
            category,
            event_type: eventType,
            location: {
                name: locationName,
                governorate: null,
                region,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {},
            description: record.description || record.notes || '',
            sources: [{
                name: 'Good Shepherd',
                organization: 'Good Shepherd',
                url: record.source_url || null,
                license: 'varies',
                fetched_at: new Date().toISOString(),
            }],
        };

        // Category-specific metric mapping
        if (category === 'conflict' || category === 'prisoners') {
            base.metrics = {
                detained: parseInt(record.total_prisoners || 0),
                count: parseInt(record.total_prisoners || record.arrests || 0),
                unit: 'persons',
            };
            base.administrative_detainees = parseInt(record.administrative_detainees || 0);
            base.child_prisoners = parseInt(record.child_prisoners || 0);
            base.female_prisoners = parseInt(record.female_prisoners || 0);
            base.arrests = parseInt(record.arrests || 0);
        } else if (category === 'health' || category === 'healthcare') {
            base.metrics = {
                count: parseInt(record.attacks_on_healthcare || 0),
                unit: 'incidents',
            };
            base.hospitals_functioning = parseInt(record.hospitals_functioning || 0);
            base.clinics_functioning = parseInt(record.clinics_functioning || 0);
            base.attacks_on_healthcare = parseInt(record.attacks_on_healthcare || 0);
        } else if (category === 'ngo' || category === 'humanitarian') {
            base.metrics = {
                value: parseFloat(record.funding_amount || 0),
                unit: 'usd',
                affected: parseInt(record.beneficiaries || 0),
            };
        }

        return this.toCanonical(base);
    }

    _extractDate(record) {
        if (record.date) return this.normalizeDate(record.date);
        if (record.report_date) return this.normalizeDate(record.report_date);
        if (record.timestamp) return new Date(record.timestamp).toISOString().split('T')[0];
        if (record.period) {
            const match = record.period.match(/(\d{4})-Q(\d)/);
            if (match) {
                const month = parseInt(match[2]) * 3;
                return `${match[1]}-${month.toString().padStart(2, '0')}-30`;
            }
        }
        return new Date().toISOString().split('T')[0];
    }

    _extractLocationName(record) {
        if (record.location && typeof record.location === 'string') return record.location;
        if (record.region) return record.region;
        return 'Palestine';
    }
}

export default GoodShepherdTransformer;
