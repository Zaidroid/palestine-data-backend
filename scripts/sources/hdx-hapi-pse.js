/**
 * HDX HAPI — Humanitarian API for State of Palestine.
 *
 * Pulls all 9 thematic CSVs in one pass. HAPI normalizes data from
 * many upstream sources into a single schema with admin1/admin2 codes,
 * making it the cleanest one-stop source for cross-cutting humanitarian
 * indicators.
 *
 * Output:
 *   public/data/hapi/<dataset>.json
 *   public/data/hapi/manifest.json
 *
 * Datasets:
 *   refugees / returnees / funding / conflict-events / national-risk /
 *   food-security / food-prices / poverty-rate / baseline-population
 *
 * Source: https://data.humdata.org/dataset/hdx-hapi-pse
 * License: HDX-other (free reuse with attribution).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/hapi');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'hdx-hapi-pse';

// Map resource title fragment → canonical short key. First match wins.
const TITLE_TO_KEY = [
    [/refugees & persons of concern/i,   'refugees'],
    [/returnees/i,                       'returnees'],
    [/coordination.+funding/i,           'funding'],
    [/conflict events/i,                 'conflict-events'],
    [/national risk/i,                   'national-risk'],
    // The "Food Security, Nutrition & Poverty:" prefix appears on three
    // different sub-titles. Match the specific sub-title first; the bare
    // "food security" catch-all goes LAST so the more specific ones win.
    [/poverty rate/i,                    'poverty-rate'],
    [/food prices & market monitor/i,    'food-prices'],
    [/food security/i,                   'food-security'],
    [/baseline population/i,             'baseline-population'],
    // Metadata: tracks data-availability of HAPI itself; surface separately.
    [/metadata.+data availability/i,     'metadata'],
];

// Catch-all for "Food Security:" plain title (HAPI sometimes uses
// "Food Security, Nutrition & Poverty: Food Security for State of
// Palestine" — already matches above, but the regex needs to be tight).
function classify(name) {
    for (const [re, key] of TITLE_TO_KEY) if (re.test(name)) return key;
    return null;
}

async function downloadText(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'palestine-data-backend/1.0' },
        redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log(`[hapi-pse] discovering ${PACKAGE_SLUG}...`);
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;

    const files = [];
    for (const res of pkg.resources || []) {
        if (!/csv/i.test(res.format)) continue;
        const key = classify(res.name);
        if (!key) {
            console.log(`  skip (unrouted): ${res.name}`);
            continue;
        }
        const text = await downloadText(res.url);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        const target = `${key}.json`;
        await fs.writeFile(path.join(OUT_DIR, target), JSON.stringify({
            dataset: key,
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'HDX HAPI (Humanitarian API) via HDX.',
            row_count: rows.length,
            rows,
        }, null, 1));
        files.push({ dataset: key, output: target, rows: rows.length, bytes_in: text.length });
        console.log(`  [${key}] ${rows.length} rows → ${target}`);
    }

    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title || 'HDX HAPI',
        license_id: pkg.license_id || 'hdx-other',
        attribution: 'HDX HAPI via HDX.',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        files,
    }, null, 2));
    console.log(`[hapi-pse] wrote ${files.length} dataset(s)`);
}

main().catch(err => {
    console.error('[hapi-pse] fatal:', err);
    process.exit(1);
});
