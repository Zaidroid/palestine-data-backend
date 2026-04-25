/**
 * Global Healthsites Mapping Project — Palestinian Territories.
 *
 * Cross-validation source for /api/v1/facilities/health (which defaults
 * to OSM/HOT). This dataset is community-curated, ODbL, and includes
 * facility-level metadata that complements OSM.
 *
 * Output:
 *   public/data/osm/health-facilities-globalhealthsites.geojson
 *
 * Source: https://data.humdata.org/dataset/palestinian-territories-healthsites
 * License: ODbL.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/osm');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'palestinian-territories-healthsites';
const OUT_FILE = 'health-facilities-globalhealthsites.geojson';

async function fetchPackage(slug) {
    const r = await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${slug}`,
        { timeout: 30000 });
    return r.result;
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
    console.log(`[global-healthsites-pse] discovering ${PACKAGE_SLUG}...`);
    const pkg = await fetchPackage(PACKAGE_SLUG);

    // Prefer the non-HXL GeoJSON (cleaner shape — HXL adds a hashtag
    // header row that consumers don't need at runtime).
    const res = (pkg.resources || []).find(r =>
        /geojson/i.test(r.format) && !/hxl/i.test(r.name)
    ) || (pkg.resources || []).find(r => /geojson/i.test(r.format));
    if (!res) throw new Error('No GeoJSON resource on global-healthsites');

    const text = await downloadText(res.url);
    const parsed = JSON.parse(text);  // validate
    await fs.writeFile(path.join(OUT_DIR, OUT_FILE), text);

    console.log(`  ${parsed.features?.length} features → ${OUT_FILE}`);
}

main().catch(err => {
    console.error('[global-healthsites-pse] fatal:', err);
    process.exit(1);
});
