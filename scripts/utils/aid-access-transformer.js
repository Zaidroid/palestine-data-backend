/**
 * UNRWA aid trucks / aid-access transformer.
 *
 * Input (from scripts/sources/unrwa-aid-trucks.js): one row per
 * consignment received into Gaza:
 *   { id, date, trucks, cargo_description, cargo_category, status,
 *     quantity, units, donor, donation_type, crossing, recipient }
 *
 * Output: canonical record with event_type "aid_consignment".
 */

import { BaseTransformer } from './base-transformer.js';

export class AidAccessTransformer extends BaseTransformer {
    constructor() {
        super('aid_access');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.id && r.date)
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        return this.toCanonical({
            id: r.id,
            // Upstream consignment ID, kept under a non-volatile key so the
            // stable-id hash distinguishes content-identical consignments
            // (same date/crossing/cargo/donor) — `id` is stripped before hashing.
            source_record_key: r.id,
            date: r.date,
            category: 'aid_access',
            event_type: 'aid_consignment',
            location: {
                name: r.crossing || 'Gaza Strip',
                region: 'Gaza Strip',
                governorate: null,
                lat: null,
                lon: null,
                precision: 'crossing',
            },
            metrics: {
                trucks: r.trucks,
                quantity: r.quantity,
                unit: r.units || 'trucks',
            },
            cargo_category: r.cargo_category,
            cargo_description: r.cargo_description,
            crossing: r.crossing,
            donor: r.donor,
            donation_type: r.donation_type,
            recipient: r.recipient,
            description: `${r.cargo_category || 'Aid'} via ${r.crossing || 'land crossing'}: ` +
                `${r.cargo_description || 'cargo'}${r.donor ? ` (${r.donor})` : ''}`,
            sources: [{
                name: 'UNRWA Gaza Supply and Logistics dashboard',
                organization: 'UNRWA',
                url: 'https://data.humdata.org/dataset/state-of-palestine-gaza-aid-truck-data',
                license: 'CC-BY',
            }],
        });
    }
}
