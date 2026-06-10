/**
 * OCHA demolitions transformer.
 *
 * Input (from scripts/sources/ocha-demolitions.js):
 *   locality: { locality, governorate, latitude, longitude,
 *               structures_demolished, people_displaced }
 *   annual_total: { year, structures_demolished, people_displaced, people_affected }
 *
 * Output: canonical record, category "demolitions", event_type
 * "demolition_aggregate". Locality rows are geocoded; annual rows are a
 * West Bank + East Jerusalem time series.
 */

import { BaseTransformer } from './base-transformer.js';

export class DemolitionsTransformer extends BaseTransformer {
    constructor() {
        super('demolitions');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && (r.dimension === 'locality' || Number.isFinite(r.year)))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        const isLocality = r.dimension === 'locality';
        // OCHA demolitions data is West Bank + East Jerusalem; treat Jerusalem
        // governorate as East Jerusalem, the rest as West Bank.
        const region = isLocality && /jerusalem/i.test(r.governorate || '')
            ? 'East Jerusalem' : 'West Bank';
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'demolitions',
            event_type: 'demolition_aggregate',
            location: {
                name: isLocality ? r.locality : 'West Bank & East Jerusalem',
                region: isLocality ? region : 'West Bank',
                governorate: r.governorate || null,
                lat: isLocality ? r.latitude : null,
                lon: isLocality ? r.longitude : null,
                precision: isLocality ? 'locality' : 'region',
            },
            metrics: {
                demolished: r.structures_demolished || 0,
                displaced: r.people_displaced || 0,
                affected: r.people_affected || 0,
                unit: 'structures',
            },
            demolition_dimension: r.dimension,
            description: isLocality
                ? `${r.structures_demolished || 0} structures demolished in ${r.locality} (${r.governorate || '—'}); ${r.people_displaced || 0} displaced.`
                : `${r.structures_demolished || 0} structures demolished in ${r.year}; ${r.people_displaced || 0} displaced (West Bank + East Jerusalem).`,
            sources: [{
                name: 'UN OCHA oPt — Data on Demolitions',
                organization: 'UN OCHA oPt',
                url: 'https://www.ochaopt.org/data/demolition',
                license: 'verify-required',
            }],
        });
    }
}
