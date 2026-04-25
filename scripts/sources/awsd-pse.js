/**
 * Aid Worker Security Database (AWSD) — Palestine.
 *
 * Cross-source for /api/v1/incidents/aid-worker (default = Insecurity
 * Insight). AWSD uses a distinct verification methodology and is the
 * canonical reference for aid-worker security incidents (1997-present).
 *
 * Output:
 *   public/data/insecurity-insight/incidents-aid-worker-awsd.json
 *
 * Source: https://data.humdata.org/dataset/aid-worker-security-database-pse
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
const OUT_DIR = path.join(REPO_ROOT, 'public/data/insecurity-insight');
const OUT_FILE = 'incidents-aid-worker-awsd.json';
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'aid-worker-security-database-pse';

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

async function downloadText(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'palestine-data-backend/1.0' },
        redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.text();
}

function normalize(row) {
    const y = parseInt(row.Year, 10);
    const m = parseInt(row.Month, 10);
    const d = parseInt(row.Day, 10);
    const dateISO = (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d))
        ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        : null;
    return {
        incident_id: `awsd-${row['Incident ID']}`,
        date: dateISO,
        category: 'aid_worker',
        country_iso: row['Country Code'] || 'PSE',
        admin1: row['Region'] || null,
        admin2: row['District'] || null,
        latitude: num(row.Latitude),
        longitude: num(row.Longitude),
        organisations: {
            UN: row.UN, INGO: row.INGO, ICRC: row.ICRC,
            Red_Cross: row['NRCS and IFRC'], NNGO: row.NNGO, Other: row.Other,
        },
        victims: {
            killed: num(row['Total killed']) ?? (num(row['Nationals killed']) || 0)
                                              + (num(row['Internationals killed']) || 0),
            wounded: num(row['Total wounded']) ?? (num(row['Nationals wounded']) || 0)
                                                + (num(row['Internationals wounded']) || 0),
            kidnapped: num(row['Total kidnapped']),
            detained: num(row['Total detained']),
            nationals: num(row['Total nationals']),
            internationals: num(row['Total internationals']),
        },
        means_of_attack: row['Means of attack'] || null,
        attack_context: row['Attack context'] || null,
        location_type: row.Location || null,
        verified: row['Verified'] || null,
        details: row,
    };
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log(`[awsd-pse] discovering ${PACKAGE_SLUG}...`);
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;
    const csv = (pkg.resources || []).find(r => /csv/i.test(r.format));
    if (!csv) throw new Error('No CSV on AWSD');

    const text = await downloadText(csv.url);
    const rows = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
    const normalized = rows.map(normalize).filter(i => i.date);
    normalized.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    await fs.writeFile(path.join(OUT_DIR, OUT_FILE), JSON.stringify({
        source_dataset: csv.name,
        source_url: csv.url,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        attribution: 'Aid Worker Security Database (AWSD) via HDX (CC-BY-4.0).',
        organisation: pkg.organization?.title || 'Humanitarian Outcomes',
        license_id: pkg.license_id || 'cc-by',
        package_last_modified: pkg.metadata_modified || null,
        fetched_at: new Date().toISOString(),
        row_count: normalized.length,
        rows: normalized,
    }, null, 1));
    console.log(`[awsd-pse] wrote ${normalized.length} incidents → ${OUT_FILE}`);
}

main().catch(err => {
    console.error('[awsd-pse] fatal:', err);
    process.exit(1);
});
