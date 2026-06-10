/**
 * Peace Now settlements transformer.
 *
 * Input (from scripts/sources/peacenow-settlements.js): one row per year:
 *   { year, settler_population, region }
 *
 * Output: canonical record, category "settlements", event_type
 * "settler_population".
 */

import { BaseTransformer } from './base-transformer.js';

export class SettlementsTransformer extends BaseTransformer {
    constructor() {
        super('settlements');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && Number.isFinite(r.settler_population))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'settlements',
            event_type: 'settler_population',
            location: { name: 'West Bank', region: 'West Bank', governorate: null, lat: null, lon: null, precision: 'region' },
            metrics: { count: r.settler_population, value: r.settler_population, unit: 'settlers' },
            year: r.year,
            description: `West Bank settler population in ${r.year}: ${r.settler_population.toLocaleString()} (Peace Now).`,
            sources: [{
                name: 'Peace Now — Settlement Watch',
                organization: 'Peace Now',
                url: 'https://peacenow.org.il/en/settlements-watch/settlements-data/population',
                license: 'verify-required',
            }],
        });
    }
}
