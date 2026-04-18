/**
 * UN OCHA FTS Funding Transformer
 *
 * Maps a flow record from the FTS API into the unified canonical schema as a
 * `funding` category event. Each record represents a single donor → recipient
 * commitment / disbursement / pledge for Palestine.
 */

import { BaseTransformer } from './base-transformer.js';

export class FundingTransformer extends BaseTransformer {
  constructor() {
    super('funding');
  }

  transform(rawData, metadata) {
    const records = Array.isArray(rawData) ? rawData : (rawData?.data || []);
    return records
      .filter((r) => r && (Number(r.amount_usd) > 0))
      .map((r, i) => this.transformRecord(r, metadata, i));
  }

  transformRecord(record, metadata, index) {
    const date = this.normalizeDate(record.date || record.first_reported_date || record.decision_date);
    const amount = Number(record.amount_usd || 0);
    const donor = record.donor_name || 'Unknown donor';
    const recipient = record.recipient_name || 'Unknown recipient';
    const status = (record.status || 'commitment').toLowerCase();

    const summary = `${this.formatUsd(amount)} ${status} from ${donor} to ${recipient}` +
      (record.cluster ? ` (${record.cluster})` : '') +
      (record.plan ? ` — ${record.plan}` : '');

    return this.toCanonical({
      id: this.generateId('funding', { ...record, date }),
      date: date || new Date().toISOString().split('T')[0],
      category: 'funding',
      event_type: 'humanitarian_funding',

      location: {
        name: record.destination_location || 'Occupied Palestinian Territory',
        governorate: null,
        region: this.classifyRegion(record.destination_location || 'Palestine') || 'Palestine',
        lat: null,
        lon: null,
        precision: 'country',
      },

      metrics: {
        value: amount,
        unit: 'USD',
        count: 1,
      },

      description: summary,
      actors: [donor, recipient].filter(Boolean),

      // Funding-specific fields preserved at top level for direct querying
      funding: {
        amount_usd: amount,
        original_amount: Number(record.original_amount || 0),
        original_currency: record.original_currency || 'USD',
        status,
        flow_type: record.flow_type || null,
        contribution_type: record.contribution_type || null,
        method: record.method || null,
        donor: { name: donor, type: record.donor_type || null },
        recipient: { name: recipient, type: record.recipient_type || null },
        usage_years: Array.isArray(record.usage_years) ? record.usage_years : [],
        cluster: record.cluster || null,
        plan: record.plan || null,
        emergency: record.emergency || null,
        keywords: Array.isArray(record.keywords) ? record.keywords : [],
        new_money: Boolean(record.new_money),
        ref_code: record.ref_code || null,
        flow_id: record.flow_id || null,
      },

      sources: [{
        name: metadata.source || 'UN OCHA Financial Tracking Service',
        organization: 'UN OCHA',
        url: metadata.source_url || `https://fts.unocha.org/flows/${record.flow_id || ''}`,
        license: metadata.license || 'CC-BY-IGO-3.0',
        fetched_at: new Date().toISOString(),
      }],
    });
  }

  formatUsd(n) {
    if (!n) return '$0';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
    return `$${n.toFixed(0)}`;
  }
}

export default FundingTransformer;
