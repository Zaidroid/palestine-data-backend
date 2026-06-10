/**
 * HaMoked detention transformer.
 *
 * Input (from scripts/sources/hamoked-detention.js): one row per month:
 *   { date, year, month, sentenced, remand, administrative,
 *     unlawful_combatants, total_held }
 *
 * Output: canonical records, category "prisoners", event_type
 * "prisoners_count" — one record per (month, metric) to match the existing
 * Addameer prisoners shape (prisoner_metric_type ∈ total/administrative/…).
 */

import { BaseTransformer } from './base-transformer.js';

const METRICS = [
    ['total', 'total_held'],
    ['administrative', 'administrative'],
    ['sentenced', 'sentenced'],
    ['remand', 'remand'],
];

export class HamokedTransformer extends BaseTransformer {
    constructor() {
        super('prisoners');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        const out = [];
        for (const row of data) {
            if (!row || !row.date) continue;
            for (const [metric, field] of METRICS) {
                const count = row[field];
                if (!Number.isFinite(count)) continue;
                out.push(this.transformRecord(row, metric, count));
            }
        }
        return out;
    }

    transformRecord(row, metric, count) {
        return this.toCanonical({
            id: `hamoked_${metric}_${row.date}`,
            date: row.date,
            category: 'prisoners',
            event_type: 'prisoners_count',
            location: { name: 'Palestine', region: 'Palestine', governorate: null, lat: null, lon: null, precision: 'region' },
            metrics: { detained: metric === 'total' ? count : 0, count, unit: 'persons' },
            prisoner_metric_type: metric,
            description: `HaMoked monthly ${metric} detainees held by Israel: ${count.toLocaleString()} (${row.date.slice(0, 7)}).`,
            sources: [{
                name: 'HaMoked',
                organization: 'HaMoked — Center for the Defence of the Individual',
                url: 'https://hamoked.org/prisoners-charts.php',
                license: 'verify-required',
            }],
        });
    }
}
