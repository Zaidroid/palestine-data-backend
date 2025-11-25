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

        return {
            // Identity
            id: this.generateId('martyr', { ...record, index }), // Include index for uniqueness
            type: 'martyr',
            category: 'martyrs',

            // Personal Info
            name: name,
            name_ar: record.ar_name || record.name || null,
            name_en: record.en_name || null,
            age: age,
            sex: sex,
            dob: record.dob || null,

            // Temporal
            date_of_death: date || 'Unknown',
            date: date || 'Unknown', // Required for partitioning

            // Spatial
            location: {
                name: 'Gaza',
                region: 'Gaza Strip',
                coordinates: null
            },

            // Provenance
            sources: [{
                name: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                fetched_at: new Date().toISOString(),
                url: 'https://data.techforpalestine.org'
            }],

            // Metadata
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
        };
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
