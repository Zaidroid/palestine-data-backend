/**
 * WFP Food Prices for State of Palestine.
 *
 * Monthly market-level retail/wholesale prices per commodity (bread, rice,
 * vegetables, fuel, …) with market coordinates — Gaza Strip + West Bank,
 * 2007-01 → ongoing. The longest-running economic micro time series we have.
 *
 * Source: HDX dataset "wfp-food-prices-for-state-of-palestine", CC-BY-IGO.
 * Updated: monthly on HDX side.
 * Output: public/data/static/wfp-food-prices.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/wfp-food-prices.json');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'wfp-food-prices-for-state-of-palestine';

async function main() {
    console.log('[wfp-prices] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;
    const priceRes = (pkg.resources || []).find((r) => /food prices/i.test(r.name));
    if (!priceRes) throw new Error('No Food Prices resource on WFP PSE dataset');

    console.log(`[wfp-prices] downloading ${priceRes.url}`);
    const res = await fetch(priceRes.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for prices CSV`);
    const csvText = await res.text();

    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const records = parsed.data
        // First data row is an HXL tag row on some vintages (#date, #adm1+name, …)
        .filter((r) => r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.commodity)
        .map((r) => {
            const lat = parseFloat(r.latitude);
            const lon = parseFloat(r.longitude);
            const price = parseFloat(r.price);
            const usdprice = parseFloat(r.usdprice);
            return {
                date: r.date,
                admin1: r.admin1 || null,            // Gaza Strip | West Bank
                admin2: r.admin2 || null,            // governorate
                market: r.market || null,
                latitude: Number.isFinite(lat) ? lat : null,
                longitude: Number.isFinite(lon) ? lon : null,
                category: r.category || null,        // cereals and tubers, …
                commodity: r.commodity,
                unit: r.unit || null,
                priceflag: r.priceflag || null,      // actual | aggregate
                pricetype: r.pricetype || null,      // Retail | Wholesale
                currency: r.currency || 'ILS',
                price: Number.isFinite(price) ? price : null,
                usdprice: Number.isFinite(usdprice) ? usdprice : null,
            };
        })
        .filter((r) => r.price !== null);

    const dates = records.map((r) => r.date).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'WFP Food Prices (via HDX)',
        source_url: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        license: 'CC-BY-IGO',
        attribution_text: 'Food prices: World Food Programme (WFP) via HDX, CC-BY-IGO.',
        package_last_modified: pkg.metadata_modified || null,
        count: records.length,
        date_range: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
        markets: [...new Set(records.map((r) => r.market).filter(Boolean))].length,
        commodities: [...new Set(records.map((r) => r.commodity))].length,
        data: records,
    };

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[wfp-prices] DONE — ${records.length} price points, ` +
        `${out.commodities} commodities × ${out.markets} markets, ` +
        `${out.date_range.earliest} → ${out.date_range.latest} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[wfp-prices] FATAL:', err.message);
    process.exit(1);
});
