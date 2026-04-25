/**
 * OCHA Common Operational Datasets — Subnational Administrative Boundaries
 * for State of Palestine (cod-ab-pse). Downloads the GeoJSON ZIP from HDX,
 * unpacks each admin level into its own file under public/data/admin/,
 * and writes a manifest with provenance.
 *
 * Output:
 *   public/data/admin/admin0.geojson    — Palestine outline (1 feature)
 *   public/data/admin/admin1.geojson    — West Bank + Gaza (2 features)
 *   public/data/admin/admin2.geojson    — Governorates (16 features)
 *   public/data/admin/adminlines.geojson
 *   public/data/admin/adminpoints.geojson
 *   public/data/admin/manifest.json
 *
 * Source: https://data.humdata.org/dataset/cod-ab-pse
 * License: CC-BY-IGO (per HDX page).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/admin');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'cod-ab-pse';

async function fetchPackage() {
    const json = await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 });
    return json.result;
}

async function downloadBuf(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[cod-ab] discovering resources via CKAN...');
    const pkg = await fetchPackage();
    const geoZip = (pkg.resources || []).find(r => /geojson/i.test(r.format));
    if (!geoZip) throw new Error('No GeoJSON resource on cod-ab-pse');
    console.log(`[cod-ab] downloading ${geoZip.url}`);
    const buf = await downloadBuf(geoZip.url);
    const zip = new AdmZip(buf);

    const layers = [];
    for (const e of zip.getEntries()) {
        if (!/\.geojson$/i.test(e.entryName)) continue;
        const layerName = path.basename(e.entryName, '.geojson').replace(/^pse_/, '');
        const target = path.join(OUT_DIR, `${layerName}.geojson`);
        const content = e.getData().toString('utf8');
        // Validate it parses (don't ship malformed GeoJSON)
        const parsed = JSON.parse(content);
        await fs.writeFile(target, content);
        layers.push({
            layer: layerName,
            features: parsed.features?.length ?? 0,
            file: path.relative(REPO_ROOT, target),
            bytes: content.length,
        });
        console.log(`  wrote ${layerName}: ${parsed.features?.length} features`);
    }

    const manifest = {
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title || 'OCHA Field Information Services Section',
        license_id: pkg.license_id || 'cc-by-igo',
        attribution: 'OCHA Field Information Services Section (FISS) via HDX (CC-BY-IGO)',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        source_resource_url: geoZip.url,
        layers,
    };
    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[cod-ab] wrote ${layers.length} layer(s) to ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

main().catch(err => {
    console.error('[cod-ab] fatal:', err);
    process.exit(1);
});
