/**
 * WFP Food Prices transformer.
 *
 * Input (from scripts/sources/wfp-food-prices-pse.js): one row per
 * (month, market, commodity, pricetype):
 *   { date, admin1, admin2, market, latitude, longitude, category,
 *     commodity, unit, pricetype, currency, price, usdprice }
 *
 * Output: canonical record with event_type "food_price".
 */

import { BaseTransformer } from './base-transformer.js';

export class FoodPricesTransformer extends BaseTransformer {
    constructor() {
        super('food');
    }

    transform(data, context = {}) {
        if (!Array.isArray(data)) data = [data];
        return data
            .filter((r) => r && r.date && r.commodity && Number.isFinite(r.price))
            .map((r) => this.transformRecord(r, context));
    }

    transformRecord(r) {
        const region = r.admin1 === 'Gaza Strip' ? 'Gaza Strip'
            : r.admin1 === 'West Bank' ? 'West Bank' : 'Palestine';
        return this.toCanonical({
            id: `wfp-price-${r.date}-${this.simpleHash(`${r.market}|${r.commodity}|${r.pricetype}`)}`,
            date: r.date,
            category: 'food',
            event_type: 'food_price',
            location: {
                name: r.market || r.admin2 || r.admin1 || 'Palestine',
                region,
                governorate: r.admin2 || null,
                lat: r.latitude,
                lon: r.longitude,
                precision: r.market ? 'market' : 'region',
            },
            metrics: {
                price: r.price,
                price_usd: r.usdprice,
                unit: `${r.currency}/${r.unit || 'unit'}`,
            },
            commodity: r.commodity,
            commodity_category: r.category,
            price_type: r.pricetype,
            description: `${r.commodity} (${r.pricetype}) at ${r.market || r.admin1}: ${r.price} ${r.currency}/${r.unit}`,
            sources: [{
                name: 'WFP Food Prices',
                organization: 'World Food Programme',
                url: 'https://data.humdata.org/dataset/wfp-food-prices-for-state-of-palestine',
                license: 'CC-BY-IGO',
            }],
        });
    }
}
