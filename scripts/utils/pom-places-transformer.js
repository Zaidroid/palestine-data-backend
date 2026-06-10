/**
 * Palestine Open Maps localities transformer.
 *
 * Input (from scripts/sources/palopenmaps-places.js): one row per
 * historical locality with Mandate census populations and depopulation
 * status (see fetcher header).
 *
 * Output: canonical record with event_type "historical_locality".
 * Date = depopulation date when the locality was depopulated (Nakba era),
 * else 1945-04-01 (Village Statistics 1945 reference date) so census
 * records sort into the Mandate period.
 */

import { BaseTransformer } from './base-transformer.js';

const CENSUS_REFERENCE_DATE = '1945-04-01';

export class PomPlacesTransformer extends BaseTransformer {
    constructor() {
        super('historical');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.slug && (r.name_en || r.name_ar))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        const depopulated = /depopulated|abandoned/i.test(r.status || '');
        const date = (r.depopulated_date || '').slice(0, 10) || CENSUS_REFERENCE_DATE;
        return this.toCanonical({
            id: r.id,
            date,
            category: 'historical',
            event_type: depopulated ? 'locality_depopulated' : 'historical_locality',
            location: {
                name: r.name_en || r.name_ar,
                name_ar: r.name_ar,
                region: 'Historic Palestine',
                governorate: r.district_1945 || null,
                lat: r.latitude,
                lon: r.longitude,
                precision: 'locality',
            },
            metrics: {
                population_1922: r.pop_1922,
                population_1931: r.pop_1931,
                population_1945: r.pop_1945,
                population_2016: r.pop_2016,
                unit: 'persons',
            },
            locality_status: r.status,
            locality_group: r.group,
            district_1945: r.district_1945,
            subdistrict_1945: r.subdistrict_1945,
            cross_references: {
                zochrot_id: r.id_zochrot,
                palestineremembered_id: r.id_palestineremembered,
                palestineremembered_url: r.url_palestineremembered,
            },
            description: depopulated
                ? `${r.name_en || r.name_ar} (${r.district_1945 || 'Palestine'}): ${r.status}` +
                  (r.depopulated_date ? ` ${String(r.depopulated_date).slice(0, 10)}` : '') +
                  (r.pop_1945 ? `; population 1945: ${r.pop_1945}` : '')
                : `${r.name_en || r.name_ar} (${r.district_1945 || 'Palestine'}): ${r.status || 'locality'}` +
                  (r.pop_1945 ? `; population 1945: ${r.pop_1945}` : ''),
            sources: [{
                name: 'Palestine Open Maps',
                organization: 'Palestine Open Maps (Visualizing Palestine)',
                url: 'https://github.com/PalOpenMaps/pom-data',
                license: 'verify-required',
            }],
        });
    }
}
