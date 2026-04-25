/**
 * IDMC — Internal Displacements (new + total) for State of Palestine.
 * Two CSVs: conflict-driven new displacements, and disaster-driven new
 * displacements. Distinct from the existing event-level idmc.js fetcher
 * (which pulls geo-tagged event data).
 *
 * Output:
 *   public/data/displacement/idmc-pse-stocks.json
 *   public/data/displacement/idmc-pse-disasters.json
 *   public/data/displacement/idmc-pse-stocks-manifest.json
 *
 * Source: https://data.humdata.org/dataset/idmc-idp-data-pse
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
const PACKAGE_SLUG = 'idmc-idp-data-pse';

const FILE_ROUTES = [
    [/disaster/i,     'idmc-pse-disasters.json'],
    [/displacement/i, 'idmc-pse-stocks.json'],
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
    console.log('[idmc-stocks-pse] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;

    const fileSummaries = [];
    for (const res of pkg.resources || []) {
        if (!/csv/i.test(res.format)) continue;
        const out = classify(res.name);
        if (!out) continue;
        const text = await downloadText(res.url);
        const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
        for (const r of rows) {
            r.year = num(r.year);
            r.new_displacement = num(r.new_displacement);
            r.new_displacement_rounded = num(r.new_displacement_rounded);
            r.total_displacement = num(r.total_displacement);
            r.total_displacement_rounded = num(r.total_displacement_rounded);
        }
        rows.sort((a, b) => (a.year || 0) - (b.year || 0));
        const target = path.join(OUT_DIR, out);
        await fs.writeFile(target, JSON.stringify({
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'IDMC — Internal Displacement Monitoring Centre via HDX (CC-BY-IGO).',
            row_count: rows.length,
            rows,
        }, null, 1));
        fileSummaries.push({ resource: res.name, output: out, rows: rows.length });
        console.log(`  wrote ${out}: ${rows.length} rows`);
    }

    await fs.writeFile(path.join(OUT_DIR, 'idmc-pse-stocks-manifest.json'),
        JSON.stringify({
            source_package: PACKAGE_SLUG,
            source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
            organisation: pkg.organization?.title || 'IDMC',
            license_id: pkg.license_id || 'cc-by-igo',
            attribution: 'IDMC via HDX (CC-BY-IGO).',
            fetched_at: new Date().toISOString(),
            package_last_modified: pkg.metadata_modified || null,
            files: fileSummaries,
        }, null, 2));
    console.log(`[idmc-stocks-pse] wrote ${fileSummaries.length} file(s)`);
}

main().catch(err => {
    console.error('[idmc-stocks-pse] fatal:', err);
    process.exit(1);
});
