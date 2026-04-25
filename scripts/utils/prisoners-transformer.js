/**
 * Prisoners (Addameer) transformer.
 *
 * Input shape (one row per (month, metric_type)):
 *   { id, date, governorate, metric_type, count, source, source_url }
 *
 * Output: canonical record with:
 *   - event_type: "prisoners_count"
 *   - metrics.detained: count
 *   - prisoner_metric_type: "total" | "administrative" | "child" | "female"
 */

import { BaseTransformer } from './base-transformer.js';

export class PrisonersTransformer extends BaseTransformer {
    constructor() {
        super('prisoners');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && typeof r === 'object' && Number.isFinite(r.count))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(record, context = {}) {
        const date = record.date || new Date().toISOString().slice(0, 10);
        const region = this._regionFromGovernorate(record.governorate);
        const metric = record.metric_type || 'total';

        return this.toCanonical({
            id: record.id,
            date,
            category: 'prisoners',
            event_type: 'prisoners_count',
            location: {
                name: record.governorate || 'Palestine',
                region,
                governorate: null,
                lat: null,
                lon: null,
                precision: 'region',
            },
            metrics: {
                detained: metric === 'total' ? record.count : 0,
                count: record.count,
                unit: 'persons',
            },
            prisoner_metric_type: metric,
            description: `Addameer monthly ${metric} prisoners count: ${record.count} (as of ${date.slice(0, 7)}).`,
            sources: [{
                name: record.source || 'Addameer',
                organization: 'Addameer Prisoner Support and Human Rights Association',
                url: record.source_url || 'https://www.addameer.ps/statistics',
                license: 'verify-required',
                fetched_at: new Date().toISOString(),
            }],
        });
    }

    _regionFromGovernorate(g) {
        if (!g) return 'Palestine';
        const s = String(g).toLowerCase();
        if (s.includes('gaza') && !s.includes('west bank')) return 'Gaza Strip';
        if (s.includes('west bank') && !s.includes('gaza')) return 'West Bank';
        if (s.includes('jerusalem')) return 'East Jerusalem';
        return 'Palestine';
    }
}
