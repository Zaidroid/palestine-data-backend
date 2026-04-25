/**
 * FAO DIEM — Data in Emergencies Monitoring System (household surveys).
 * Multi-country dataset; we filter to PSE-only rows (~20 per theme).
 *
 * Output:
 *   public/data/indicators/fao-diem-pse-{theme}.json    — per theme
 *   public/data/indicators/fao-diem-pse-manifest.json
 *
 * Source: https://data.humdata.org/dataset/fao-diem-monitoring-system-household-surveys-aggregated-data
 * License: HDX-other (essentially free reuse with attribution).
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
const PACKAGE_SLUG = 'fao-diem-monitoring-system-household-surveys-aggregated-data';

const THEME_PATTERNS = [
    [/food[_ ]security/i,       'food-security'],
    [/income[_ ]shocks/i,       'income-shocks'],
    [/livestock[_ ]production/i,'livestock'],
    [/crop[_ ]production/i,     'crop'],
];

function classify(name) {
    for (const [re, theme] of THEME_PATTERNS) if (re.test(name)) return theme;
    return null;
}

function isPalestine(row) {
    const iso = (row.adm0_iso3 || row.iso3 || '').toUpperCase();
    if (iso === 'PSE') return true;
    const name = (row.adm0_name || row.country || '').toLowerCase();
    return /palestin/.test(name);
}

async function downloadText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[fao-diem-pse] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;

    const fileSummaries = [];
    for (const res of pkg.resources || []) {
        if (!/csv/i.test(res.format)) continue;
        const theme = classify(res.name);
        if (!theme) continue;
        const text = await downloadText(res.url);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        const psRows = rows.filter(isPalestine);
        const out = `fao-diem-pse-${theme}.json`;
        await fs.writeFile(path.join(OUT_DIR, out), JSON.stringify({
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'Food and Agriculture Organization (FAO) of the United Nations via HDX.',
            theme,
            row_count: psRows.length,
            rows: psRows,
        }, null, 1));
        fileSummaries.push({ theme, output: out, total_rows: rows.length, pse_rows: psRows.length });
        console.log(`  [${theme}] ${psRows.length}/${rows.length} PSE rows kept → ${out}`);
    }

    await fs.writeFile(path.join(OUT_DIR, 'fao-diem-pse-manifest.json'), JSON.stringify({
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title
            || 'Food and Agriculture Organization (FAO) of the United Nations',
        license_id: pkg.license_id || 'hdx-other',
        attribution: 'FAO via HDX.',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        themes: fileSummaries,
    }, null, 2));
    console.log(`[fao-diem-pse] wrote ${fileSummaries.length} theme(s)`);
}

main().catch(err => {
    console.error('[fao-diem-pse] fatal:', err);
    process.exit(1);
});
