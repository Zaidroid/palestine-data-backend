/**
 * Martyrs Data Transformer (JavaScript)
 * 
 * Transforms individual martyr records (killed in Gaza)
 * into the unified MartyrsData format.
 */

import { BaseTransformer } from './base-transformer.js';

export class MartyrsTransformer extends BaseTransformer {
    constructor() {
        super('martyrs');
    }

    /**
     * Transform raw martyr data to unified format
     */
    transform(rawData, metadata) {
        const records = Array.isArray(rawData) ? rawData :
            (rawData.data ? rawData.data : []);

        return records
            .filter(record => record && (record.name || record.en_name))
            .map((record, index) => this.transformRecord(record, metadata, index));
    }

    /**
     * Transform a single martyr record
     */
    transformRecord(record, metadata, index) {
        // Handle both object format and potentially array format if source changes,
        // but current T4P API returns objects with specific keys.

        const date = this.normalizeDate(
            record.date_of_death || record.date || record.dob
        );

        const name = record.name || record.en_name || record.ar_name || 'Unknown';
        const age = this.parseAge(record.age);
        const sex = this.normalizeSex(record.sex);

        return this.toCanonical({
            id: this.generateId('martyr', { ...record, index }),
            date: date || '2023-10-07',
            category: 'martyrs',
            event_type: 'killed',

            location: { name: 'Gaza', region: 'Gaza Strip', precision: 'region' },

            metrics: { killed: 1, unit: 'persons' },

            description: [name, sex, age ? `age ${age}` : null].filter(Boolean).join(', '),

            // Martyr-specific supplemental fields (not in canonical but preserved)
            name,
            name_ar: record.ar_name || record.name || null,
            name_en: record.en_name || null,
            age,
            sex,
            dob: record.dob || null,

            sources: [{
                name: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                url: 'https://data.techforpalestine.org',
                license: 'public-domain',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    parseAge(age) {
        if (age === undefined || age === null || age === '') return null;
        const parsed = parseInt(age);
        return isNaN(parsed) ? null : parsed;
    }

    normalizeSex(sex) {
        if (!sex) return 'unknown';
        const s = sex.toLowerCase();
        if (s === 'm' || s === 'male') return 'male';
        if (s === 'f' || s === 'female') return 'female';
        return 'unknown';
    }
}

export default MartyrsTransformer;
