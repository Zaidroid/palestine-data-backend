/**
 * PCBS direct indicators transformer.
 *
 * Input (from scripts/sources/pcbs-indicators.js): long-format rows:
 *   { id, date, indicator, region, year, value, unit }
 *   indicator ∈ population | cpi | poverty_rate
 *
 * Output: canonical record, category "economic" (merged on top of the World
 * Bank economic series — these are PCBS's authentic figures with East
 * Jerusalem + region granularity).
 */

import { BaseTransformer } from './base-transformer.js';

const REGION_MAP = {
    'west bank': 'West Bank',
    'gaza strip': 'Gaza Strip',
    'east jerusalem': 'East Jerusalem',
    'palestine': 'Palestine',
};

const LABEL = {
    population: 'Population',
    cpi: 'Consumer Price Index',
    poverty_rate: 'Poverty rate',
};

export class PcbsIndicatorsTransformer extends BaseTransformer {
    constructor() {
        super('economic');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.indicator && Number.isFinite(r.value))
            .map((r) => this.transformRecord(r));
    }

    transformRecord(r) {
        const region = REGION_MAP[String(r.region).toLowerCase()] || 'Palestine';
        return this.toCanonical({
            id: r.id,
            date: r.date,
            category: 'economic',
            event_type: 'indicator_measurement',
            location: { name: r.region, region, governorate: null, lat: null, lon: null, precision: 'region' },
            metrics: { value: r.value, count: r.indicator === 'population' ? r.value : 0, unit: r.unit },
            indicator_code: `pcbs_${r.indicator}`,
            indicator_name: LABEL[r.indicator] || r.indicator,
            description: `${LABEL[r.indicator] || r.indicator} (${r.region}, ${r.year}): ${r.value.toLocaleString()} ${r.unit}.`,
            sources: [{
                name: 'Palestinian Central Bureau of Statistics (PCBS)',
                organization: 'PCBS',
                url: 'https://www.pcbs.gov.ps',
                license: 'verify-required',
            }],
        });
    }
}
