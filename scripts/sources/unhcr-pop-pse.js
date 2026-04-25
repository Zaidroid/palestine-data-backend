/**
 * UNHCR — End-year stock population figures + demographics for forcibly
 * displaced people originating from / hosted in State of Palestine.
 *
 * Output:
 *   public/data/displacement/unhcr-pse-stocks.json
 *   public/data/displacement/unhcr-pse-demographics.json
 *   public/data/displacement/unhcr-pse-asylum-applications.json
 *   public/data/displacement/unhcr-pse-manifest.json
 *
 * Source: https://data.humdata.org/dataset/unhcr-population-data-for-pse
 * License: CC-BY-IGO.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/displacement');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'unhcr-population-data-for-pse';

// Map resource title → output filename. Order matters; first match wins.
// Two demographics resources exist: one for PSE-origin (most rows), one
// for displaced+stateless received in PSE.
const FILE_ROUTES = [
    [/end-year stock population/i,             'unhcr-pse-stocks.json'],
    [/demographics and locations.+residing/i,  'unhcr-pse-demographics-residing-in-pse.json'],
    [/demographics and locations/i,            'unhcr-pse-demographics-originating.json'],
    [/asylum applications/i,                   'unhcr-pse-asylum-applications.json'],
    [/asylum decisions/i,                      'unhcr-pse-asylum-decisions.json'],
    [/solutions for refugees/i,                'unhcr-pse-solutions.json'],
];

function classify(name) {
    for (const [re, out] of FILE_ROUTES) if (re.test(name)) return out;
    return null;
}

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

async function downloadText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[unhcr-pse] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;

    const fileSummaries = [];
    for (const res of pkg.resources || []) {
        if (!/csv/i.test(res.format)) continue;
        const out = classify(res.name);
        if (!out) {
            console.log(`  skip (unrouted): ${res.name}`);
            continue;
        }
        const text = await downloadText(res.url);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        // Coerce numeric stock columns
        const NUM_KEYS = new Set([
            'Refugees', 'Asylum seekers', 'Internally displaced persons',
            'Stateless Persons', 'Others of concern to UNHCR', 'Host community',
            'Other people in need of international protection',
            'applied during year', 'Year',
        ]);
        for (const r of rows) {
            for (const k of Object.keys(r)) {
                if (NUM_KEYS.has(k)) r[k] = num(r[k]);
            }
        }
        const target = path.join(OUT_DIR, out);
        await fs.writeFile(target, JSON.stringify({
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'UNHCR — The UN Refugee Agency via HDX (CC-BY-IGO).',
            row_count: rows.length,
            rows,
        }, null, 1));
        fileSummaries.push({ resource: res.name, output: out, rows: rows.length,
                             bytes_in: text.length });
        console.log(`  wrote ${out}: ${rows.length} rows from "${res.name.slice(0, 60)}…"`);
    }

    await fs.writeFile(path.join(OUT_DIR, 'unhcr-pse-manifest.json'), JSON.stringify({
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title || 'UNHCR — The UN Refugee Agency',
        license_id: pkg.license_id || 'cc-by-igo',
        attribution: 'UNHCR — The UN Refugee Agency via HDX (CC-BY-IGO).',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        files: fileSummaries,
    }, null, 2));
    console.log(`[unhcr-pse] wrote ${fileSummaries.length} file(s) to ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

main().catch(err => {
    console.error('[unhcr-pse] fatal:', err);
    process.exit(1);
});
