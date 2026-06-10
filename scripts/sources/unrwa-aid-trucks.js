/**
 * UNRWA Gaza Aid Truck / Commodities Received data.
 *
 * Per-consignment records of aid entering Gaza via land crossings:
 * trucks, cargo description + category, quantity/units, donor, crossing,
 * recipient. Covers 2023-10-21 → 2025-01-16 (uploads halted at the
 * ceasefire pending a methodology change) — the verified historical
 * baseline for aid-access analysis.
 *
 * Caveats (from UNRWA's own disclaimer sheet): data after the May 2024
 * Rafah operation is PARTIAL (UN could not maintain constant presence at
 * Kerem Shalom; private-sector cargo unverified). 2023-10 → 2024-05-05 is
 * fully monitored/verified.
 *
 * Source: HDX dataset "state-of-palestine-gaza-aid-truck-data" (CC-BY) —
 * UNRWA's official public channel for this data.
 * Updated: discontinued (historical).
 * Output: public/data/static/unrwa-aid-trucks.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/unrwa-aid-trucks.json');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'state-of-palestine-gaza-aid-truck-data';

// Excel date serial → ISO date (Excel epoch 1899-12-30, UTC).
function excelDateToISO(serial) {
    if (!Number.isFinite(serial)) return null;
    const ms = Date.UTC(1899, 11, 30) + serial * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
    console.log('[unrwa-trucks] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;
    const xlsxRes = (pkg.resources || []).find((r) => /xlsx/i.test(r.format));
    if (!xlsxRes) throw new Error('No XLSX resource on aid-truck dataset');

    console.log(`[unrwa-trucks] downloading ${xlsxRes.url}`);
    const res = await fetch(xlsxRes.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for trucks XLSX`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));

    const sheetName = wb.SheetNames.find((n) => /supp?ly/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
    console.log(`[unrwa-trucks] ${rows.length} rows on sheet "${sheetName}"`);

    const records = rows
        .filter((r) => r['ID'] != null && r['Received Date'] != null)
        .map((r) => ({
            id: `unrwa-truck-${r['ID']}`,
            date: excelDateToISO(r['Received Date']),
            trucks: Number.isFinite(r['No. of Trucks']) ? r['No. of Trucks'] : null,
            data_source: r['Data Source'] || null,
            cargo_description: r['Description of Cargo'] || null,
            cargo_category: r['Cargo Category'] || null,
            status: r['Status'] || null,
            quantity: Number.isFinite(r['Quantity']) ? r['Quantity'] : null,
            units: r['Units'] || null,
            donor: r['Donating Country/ Organization'] || null,
            donation_type: r['Donation Type'] || null,
            crossing: r['Crossing'] || null,
            recipient: r['Destination Recipient/ Partner'] || null,
            verified_period: r['Data Period'] || null,
        }))
        .filter((r) => r.date);

    const dates = records.map((r) => r.date).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'UNRWA Gaza Supply and Logistics dashboard (via HDX)',
        source_url: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        license: 'CC-BY',
        attribution_text: 'Gaza aid truck data: UNRWA via HDX (CC-BY).',
        package_last_modified: pkg.metadata_modified || null,
        count: records.length,
        date_range: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
        total_trucks: records.reduce((s, r) => s + (r.trucks || 0), 0),
        notice: 'Discontinued upstream at 2025-01-16 (ceasefire + methodology change). ' +
            'Records after 2024-05-05 (Rafah operation) are partial — UN monitoring at ' +
            'Kerem Shalom was disrupted and private-sector cargo could not be independently verified.',
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[unrwa-trucks] DONE — ${records.length} consignments, ${out.total_trucks} trucks, ` +
        `${out.date_range.earliest} → ${out.date_range.latest} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[unrwa-trucks] FATAL:', err.message);
    process.exit(1);
});
