/**
 * OCHA/B'Tselem casualties transformer.
 *
 * Input (from scripts/sources/ocha-casualties.js): mixed dimension rows —
 *   annual_total: { year, fatalities }
 *   region/governorate/demographic/weapon: { label, fatalities }
 *
 * Output: canonical record, category "casualties", event_type
 * "fatalities_aggregate". Annual rows carry a date; breakdown rows are
 * current-snapshot cross-tabs (date null).
 */

import { BaseTransformer } from './base-transformer.js';

const REGION_MAP = {
    'gaza strip': 'Gaza Strip',
    'west bank': 'West Bank',
    'israel': 'Israel',
};

export class CasualtiesTransformer extends BaseTransformer {
    constructor() {
        super('casualties');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && Number.isFinite(r.fatalities))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        const isRegion = r.dimension === 'region';
        const region = isRegion ? (REGION_MAP[String(r.label).toLowerCase()] || 'Palestine') : 'Palestine';
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'casualties',
            event_type: 'fatalities_aggregate',
            location: {
                name: isRegion ? r.label : 'Palestine',
                region,
                governorate: r.dimension === 'governorate' ? r.label : null,
                lat: null,
                lon: null,
                precision: isRegion || r.dimension === 'governorate' ? 'region' : 'country',
            },
            metrics: { killed: r.fatalities, count: r.fatalities, unit: 'fatalities' },
            casualty_dimension: r.dimension,
            casualty_breakdown_label: r.dimension === 'annual_total' ? null : r.label,
            description: r.dimension === 'annual_total'
                ? `${r.fatalities} Palestinian fatalities in ${r.year} (OCHA/B'Tselem verified).`
                : `${r.fatalities} Palestinian fatalities — ${r.dimension}: ${r.label} (OCHA/B'Tselem verified).`,
            sources: [{
                name: 'UN OCHA oPt — Data on Casualties',
                organization: 'UN OCHA (B\'Tselem data)',
                url: 'https://www.ochaopt.org/data/casualties',
                license: 'verify-required',
            }],
        });
    }
}
