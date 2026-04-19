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
     * Transform a single martyr record. T4P does not publish per-record dates
     * of death — leave date null and let the category-level last_updated drive
     * freshness. Forcing a placeholder date (2023-10-07) misled both the
     * freshness gate and any timeseries consumer.
     */
    transformRecord(record, metadata, index) {
        const date = this.normalizeDate(
            record.date_of_death || record.date || null
        );

        const name = record.name || record.en_name || record.ar_name || 'Unknown';
        const age = this.parseAge(record.age);
        const sex = this.normalizeSex(record.sex);

        return this.toCanonical({
            id: this.generateId('martyr', { ...record, index }),
            date,
            category: 'martyrs',
            event_type: 'identified_killed',

            location: { name: 'Gaza', region: 'Gaza Strip', precision: 'region' },

            metrics: { killed: 1, unit: 'persons' },

            description: [name, sex, age ? `age ${age}` : null].filter(Boolean).join(', '),

            // Martyr-specific supplemental fields (preserved beyond canonical)
            name,
            name_ar: record.ar_name || record.name || null,
            name_en: record.en_name || null,
            age,
            sex,
            dob: record.dob || null,
            t4p_id: record.id || null,
            t4p_source_marker: record.source || null,  // u=Universal, c=Civil registry, etc.

            sources: [{
                name: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                url: 'https://data.techforpalestine.org',
                license: 'CC-BY-4.0',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    /**
     * Build a single "summary" event from T4P's summary.json. Carries the
     * cumulative casualty totals (Gaza + WB) — this is the live count
     * (currently ~72k Gaza killed) that the named-martyrs database lags.
     */
    buildSummaryRecord(summary) {
        if (!summary || !summary.gaza) return null;
        const lastUpdate = summary.gaza.last_update || summary.west_bank?.last_update || null;
        const gaza = summary.gaza || {};
        const wb = summary.west_bank || {};
        const gazaKilled = gaza.killed?.total || 0;
        const gazaInjured = gaza.injured?.total || 0;
        const wbKilled = wb.killed?.total || 0;
        const wbInjured = wb.injured?.total || 0;
        const totalKilled = gazaKilled + wbKilled;
        const totalInjured = gazaInjured + wbInjured;

        return this.toCanonical({
            id: this.generateId('martyr-summary', { d: lastUpdate, k: totalKilled, w: totalInjured }),
            date: lastUpdate,
            category: 'martyrs',
            event_type: 'cumulative_summary',

            location: { name: 'Palestine', region: 'Palestine', precision: 'region' },

            metrics: {
                killed: totalKilled,
                injured: totalInjured,
                count: totalKilled,
                unit: 'persons',
            },

            description: `Cumulative casualties as of ${lastUpdate || 'unknown'}: ` +
                `${totalKilled.toLocaleString()} killed (${gazaKilled.toLocaleString()} Gaza + ` +
                `${wbKilled.toLocaleString()} West Bank), ${totalInjured.toLocaleString()} injured. ` +
                `Includes ${(gaza.killed?.children || 0).toLocaleString()} children, ` +
                `${(gaza.killed?.women || 0).toLocaleString()} women, ` +
                `${(gaza.killed?.medical || 0).toLocaleString()} medical, ` +
                `${(gaza.killed?.press || 0).toLocaleString()} press killed in Gaza.`,

            // Detailed cumulative breakdown for direct consumers
            cumulative: {
                gaza: {
                    killed: gazaKilled,
                    children: gaza.killed?.children || 0,
                    women: gaza.killed?.women || 0,
                    press: gaza.killed?.press || 0,
                    medical: gaza.killed?.medical || 0,
                    civil_defence: gaza.killed?.civil_defence || 0,
                    injured: gazaInjured,
                    massacres: gaza.massacres || 0,
                    famine_total: gaza.famine?.total || 0,
                    famine_children: gaza.famine?.children || 0,
                    aid_seekers_killed: gaza.aid_seeker?.killed || 0,
                    aid_seekers_injured: gaza.aid_seeker?.injured || 0,
                },
                west_bank: {
                    killed: wbKilled,
                    children: wb.killed?.children || 0,
                    injured: wbInjured,
                    injured_children: wb.injured?.children || 0,
                    settler_attacks: wb.settler_attacks || 0,
                },
                identified_in_gaza_database: summary.known_killed_in_gaza?.records || 0,
                press_identified: summary.known_press_killed_in_gaza?.records || 0,
            },

            sources: [{
                name: 'Tech4Palestine',
                organization: 'Tech for Palestine',
                url: 'https://data.techforpalestine.org/api/v3/summary.json',
                license: 'CC-BY-4.0',
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
