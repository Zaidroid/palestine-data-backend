/**
 * World Bank — Combined Indicators for West Bank and Gaza.
 *
 * Single 5.7MB long-format CSV with ~51,594 rows / 2,500 distinct
 * indicators × ~20 years. We pivot to per-indicator time series so the
 * API can serve any single indicator quickly without scanning the whole
 * file.
 *
 * Output:
 *   public/data/indicators/world-bank-wbg-by-indicator.json
 *      { <code>: { name, latest_year, values: [{year, value}, ...] } }
 *   public/data/indicators/world-bank-wbg-list.json
 *      [ {code, name, year_count, latest_year} ]
 *   public/data/indicators/world-bank-wbg-manifest.json
 *
 * Source: https://data.humdata.org/dataset/world-bank-combined-indicators-for-west-bank-and-gaza
 * License: CC-BY 4.0.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/indicators');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'world-bank-combined-indicators-for-west-bank-and-gaza';

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

async function downloadText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[wb-wbg] discovering resource via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;
    const csvRes = (pkg.resources || []).find(r => /csv/i.test(r.format));
    if (!csvRes) throw new Error('No CSV on world-bank-wbg');

    console.log(`[wb-wbg] downloading ${(csvRes.size / 1048576).toFixed(1)}MB CSV...`);
    const text = await downloadText(csvRes.url);
    const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
    console.log(`[wb-wbg] ${rows.length} rows parsed`);

    // Pivot long → indexed-by-indicator-code
    const byIndicator = {};
    for (const r of rows) {
        const code = r['Indicator Code'];
        if (!code) continue;
        const year = parseInt(r['Year'], 10);
        const value = num(r['Value']);
        if (!Number.isFinite(year)) continue;
        if (!byIndicator[code]) {
            byIndicator[code] = { code, name: r['Indicator Name'] || code, values: [] };
        }
        byIndicator[code].values.push({ year, value });
    }
    // Source CSV has duplicate (year, value) pairs for many indicators —
    // West Bank and Gaza is republished across multiple WB databases
    // (WDI, Pop Estimates etc) with the same value. Dedup by year,
    // keeping last (input-order) which is generally the freshest source.
    for (const k of Object.keys(byIndicator)) {
        const dedup = new Map();
        for (const v of byIndicator[k].values) dedup.set(v.year, v);
        byIndicator[k].values = [...dedup.values()].sort((a, b) => a.year - b.year);
        byIndicator[k].latest_year = byIndicator[k].values.length
            ? byIndicator[k].values[byIndicator[k].values.length - 1].year
            : null;
    }

    const list = Object.values(byIndicator).map(x => ({
        code: x.code,
        name: x.name,
        year_count: x.values.length,
        latest_year: x.latest_year,
    })).sort((a, b) => a.name.localeCompare(b.name));

    await fs.writeFile(
        path.join(OUT_DIR, 'world-bank-wbg-by-indicator.json'),
        JSON.stringify(byIndicator)
    );
    await fs.writeFile(
        path.join(OUT_DIR, 'world-bank-wbg-list.json'),
        JSON.stringify({
            attribution: 'World Bank via HDX (CC-BY-4.0).',
            source_url: csvRes.url,
            indicator_count: list.length,
            indicators: list,
        }, null, 1)
    );
    await fs.writeFile(path.join(OUT_DIR, 'world-bank-wbg-manifest.json'),
        JSON.stringify({
            source_package: PACKAGE_SLUG,
            source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
            organisation: pkg.organization?.title || 'World Bank Group',
            license_id: pkg.license_id || 'cc-by',
            attribution: 'World Bank via HDX (CC-BY-4.0).',
            fetched_at: new Date().toISOString(),
            package_last_modified: pkg.metadata_modified || null,
            row_count: rows.length,
            indicator_count: list.length,
        }, null, 2));
    console.log(`[wb-wbg] wrote ${list.length} indicators (${rows.length} data points)`);
}

main().catch(err => {
    console.error('[wb-wbg] fatal:', err);
    process.exit(1);
});
