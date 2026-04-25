/**
 * IPC — Acute Food Insecurity for State of Palestine.
 *
 * Pulls the IPC GeoJSON polygons + the area-long time-series CSV. Each
 * polygon carries an IPC phase (1=Minimal … 5=Famine), population in
 * phase, and a render color — ready to drop on a map as a humanitarian
 * severity layer.
 *
 * Source: https://data.humdata.org/dataset/state-of-palestine-acute-food-insecurity-country-data
 * License: public domain (other-pd-nr).
 *
 * Output:
 *   public/data/humanitarian/ipc-food-insecurity.geojson  — polygons
 *   public/data/humanitarian/ipc-area-long.csv            — full time series
 *   public/data/humanitarian/ipc-manifest.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/humanitarian');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'state-of-palestine-acute-food-insecurity-country-data';

async function fetchPackage() {
    const r = await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 });
    return r.result;
}

async function downloadText(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[ipc-food] discovering resources via CKAN...');
    const pkg = await fetchPackage();

    const geoRes  = (pkg.resources || []).find(r => /geojson/i.test(r.format));
    const longRes = (pkg.resources || [])
        .find(r => r.name === 'ipc_pse_area_long.csv');
    if (!geoRes)  throw new Error('No GeoJSON resource on IPC PSE');

    const geoText = await downloadText(geoRes.url);
    JSON.parse(geoText);  // validate
    await fs.writeFile(path.join(OUT_DIR, 'ipc-food-insecurity.geojson'), geoText);

    let csvBytes = 0;
    if (longRes) {
        const csvText = await downloadText(longRes.url);
        await fs.writeFile(path.join(OUT_DIR, 'ipc-area-long.csv'), csvText);
        csvBytes = csvText.length;
    }

    const manifest = {
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title
            || 'Integrated Food Security Phase Classification (IPC)',
        license_id: pkg.license_id || 'other-pd-nr',
        attribution: 'Integrated Food Security Phase Classification (IPC) via HDX (public domain).',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        geojson_url: geoRes.url,
        geojson_bytes: geoText.length,
        area_long_csv_url: longRes?.url || null,
        area_long_csv_bytes: csvBytes,
    };
    await fs.writeFile(path.join(OUT_DIR, 'ipc-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[ipc-food] wrote GeoJSON (${geoText.length}B) and CSV (${csvBytes}B) to ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

main().catch(err => {
    console.error('[ipc-food] fatal:', err);
    process.exit(1);
});
