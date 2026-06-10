/**
 * IODA connectivity transformer.
 *
 * Input (from scripts/sources/ioda-connectivity-pse.js): one row per
 * detected outage event:
 *   { id, entity_type, entity_code, entity_label, region, date, start,
 *     duration_seconds, datasource, score }
 *
 * Output: canonical record with event_type "internet_outage".
 */

import { BaseTransformer } from './base-transformer.js';

export class ConnectivityTransformer extends BaseTransformer {
    constructor() {
        super('connectivity');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.date && r.start)
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        const hours = r.duration_seconds ? Math.round(r.duration_seconds / 36) / 100 : null;
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'connectivity',
            event_type: 'internet_outage',
            location: {
                name: r.entity_label,
                region: r.region,
                governorate: null,
                lat: null,
                lon: null,
                precision: r.entity_type === 'region' ? 'region' : 'country',
            },
            metrics: {
                duration_seconds: r.duration_seconds,
                severity_score: r.score,
                unit: 'seconds',
            },
            outage_start: r.start,
            outage_datasource: r.datasource,
            network_entity: { type: r.entity_type, code: r.entity_code },
            description: `Internet outage (${r.datasource}) for ${r.entity_label}` +
                (hours ? `, ~${hours}h` : '') + `, severity ${Math.round(r.score || 0)}.`,
            sources: [{
                name: 'IODA',
                organization: 'Internet Intelligence Lab, Georgia Tech',
                url: 'https://ioda.inetintel.cc.gatech.edu/country/PS',
                license: 'free-with-attribution',
            }],
        });
    }
}
