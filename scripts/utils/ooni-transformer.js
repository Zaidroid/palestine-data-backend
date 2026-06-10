/**
 * OONI censorship transformer.
 *
 * Input (from scripts/sources/ooni-censorship.js): one row per day:
 *   { id, date, measurements, ok, anomaly, confirmed, failure, anomaly_rate }
 *
 * Output: canonical record, category "connectivity", event_type
 * "censorship_measurement" (sits alongside IODA "internet_outage").
 */

import { BaseTransformer } from './base-transformer.js';

export class OoniTransformer extends BaseTransformer {
    constructor() {
        super('connectivity');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.date && Number.isFinite(r.measurements))
            .map((r) => this.transformRecord(r));
    }

    transformRecord(r) {
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'connectivity',
            event_type: 'censorship_measurement',
            location: { name: 'Palestine', region: 'Palestine', governorate: null, lat: null, lon: null, precision: 'country' },
            metrics: {
                count: r.measurements,
                anomaly_count: r.anomaly,
                confirmed_blocked: r.confirmed,
                value: r.anomaly_rate,
                unit: 'measurements',
            },
            anomaly_rate: r.anomaly_rate,
            description: `OONI ${r.measurements} web measurements; ${r.anomaly} anomalies` +
                (r.confirmed ? `, ${r.confirmed} confirmed blocked` : '') + ` (${r.date}).`,
            sources: [{
                name: 'OONI',
                organization: 'Open Observatory of Network Interference',
                url: 'https://explorer.ooni.org/country/PS',
                license: 'free-with-attribution',
            }],
        });
    }
}
