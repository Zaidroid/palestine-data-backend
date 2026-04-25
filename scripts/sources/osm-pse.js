/**
 * Humanitarian OpenStreetMap Team (HOT) — Palestine layer cluster.
 *
 * Pulls three small (<100KB compressed) GeoJSON layers in one pass:
 *   - hotosm_pse_health_facilities_points
 *   - hotosm_pse_education_facilities_points
 *   - hotosm_pse_populated_places_points
 *
 * Output: public/data/osm/{health-facilities,education-facilities,populated-places}.geojson
 *
 * Each layer is unpacked from its HDX-hosted ZIP and stored as raw
 * GeoJSON; consumers (API endpoints) keep them in-memory for fast
 * bbox / spatial queries.
 *
 * License: ODbL (HDX-ODC-ODbL — OSM contributors).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/osm');
const HDX_BASE = 'https://data.humdata.org/api/3/action';

const LAYERS = [
    { slug: 'hotosm_pse_health_facilities',    out: 'health-facilities.geojson' },
    { slug: 'hotosm_pse_education_facilities', out: 'education-facilities.geojson' },
    { slug: 'hotosm_pse_populated_places',     out: 'populated-places.geojson' },
];

async function fetchPackage(slug) {
    const r = await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${slug}`,
        { timeout: 30000 });
    return r.result;
}

async function downloadBuf(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

function findGeoJsonZipResource(pkg) {
    return (pkg.resources || []).find(r =>
        /geojson/i.test(r.format) && /points/i.test(r.name)
    );
}

async function fetchLayer({ slug, out }) {
    const pkg = await fetchPackage(slug);
    const res = findGeoJsonZipResource(pkg);
    if (!res) throw new Error(`No points GeoJSON resource on ${slug}`);
    const buf = await downloadBuf(res.url);
    const zip = new AdmZip(buf);
    const entry = zip.getEntries().find(e => /\.geojson$/i.test(e.entryName));
    if (!entry) throw new Error(`No .geojson inside ${slug} zip`);
    const content = entry.getData().toString('utf8');
    const parsed = JSON.parse(content);
    const target = path.join(OUT_DIR, out);
    await fs.writeFile(target, content);
    return {
        slug,
        out,
        features: parsed.features?.length ?? 0,
        bytes: content.length,
        source_resource_url: res.url,
        package_last_modified: pkg.metadata_modified || null,
        license_id: pkg.license_id || 'hdx-odc-odbl',
        organisation: pkg.organization?.title || 'Humanitarian OpenStreetMap Team (HOT)',
    };
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log(`[osm-pse] fetching ${LAYERS.length} HOT/OSM layers...`);
    const results = [];
    for (const L of LAYERS) {
        try {
            const info = await fetchLayer(L);
            console.log(`  ${L.slug}: ${info.features} features → ${L.out}`);
            results.push(info);
        } catch (e) {
            console.error(`  ERROR ${L.slug}: ${e.message}`);
            results.push({ ...L, error: e.message });
        }
    }

    const manifest = {
        attribution: 'OpenStreetMap contributors via Humanitarian OpenStreetMap Team (HOT) (ODbL).',
        license_id: 'hdx-odc-odbl',
        fetched_at: new Date().toISOString(),
        layers: results,
    };
    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[osm-pse] wrote ${results.length} layer(s) to ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

main().catch(err => {
    console.error('[osm-pse] fatal:', err);
    process.exit(1);
});
