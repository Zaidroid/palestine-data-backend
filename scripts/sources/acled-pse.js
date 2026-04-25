/**
 * ACLED — Palestine conflict events.
 *
 * Three thematic XLSX files aggregated by Admin2 × Month-Year:
 *   - political_violence_events_and_fatalities
 *   - civilian_targeting_events_and_fatalities
 *   - demonstration_events
 *
 * ACLED is the gold-standard academic conflict event database.
 * Distinct from UCDP-GED (already in our pipeline) — different
 * methodology and richer geographic granularity.
 *
 * Output:
 *   public/data/conflict/acled-pse-political-violence.json
 *   public/data/conflict/acled-pse-civilian-targeting.json
 *   public/data/conflict/acled-pse-demonstrations.json
 *   public/data/conflict/acled-pse-manifest.json
 *
 * Source: https://data.humdata.org/dataset/palestine-acled-conflict-data
 * License: HDX-other (ACLED Terms of Use — free reuse with attribution).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/conflict');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'palestine-acled-conflict-data';

const TYPE_TO_KEY = [
    [/political_violence/i, 'political-violence'],
    [/civilian_targeting/i, 'civilian-targeting'],
    [/demonstration/i,      'demonstrations'],
];

function classify(name) {
    for (const [re, key] of TYPE_TO_KEY) if (re.test(name)) return key;
    return null;
}

const MONTH_TO_NUM = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

function num(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

async function downloadBuf(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'palestine-data-backend/1.0' },
        redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log(`[acled-pse] discovering ${PACKAGE_SLUG}...`);
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;

    const files = [];
    for (const res of pkg.resources || []) {
        if (!/xlsx/i.test(res.format)) continue;
        const key = classify(res.name);
        if (!key) continue;
        const buf = await downloadBuf(res.url);
        const wb = XLSX.read(buf, { type: 'buffer' });
        // ACLED packages put data on the "Data" sheet; first sheet is TOU.
        const sheet = wb.Sheets['Data'] || wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]];
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: null });
        // Normalize: numeric Month + Events/Fatalities, ISO date for sorting
        const rows = raw.map(r => {
            const monthNum = MONTH_TO_NUM[r.Month] || null;
            const year = parseInt(r.Year, 10);
            return {
                country: r.Country,
                admin1: r.Admin1,
                admin2: r.Admin2,
                admin1_pcode: r['Admin1 Pcode'],
                admin2_pcode: r['Admin2 Pcode'],
                year: Number.isFinite(year) ? year : null,
                month: monthNum,
                date_period: (Number.isFinite(year) && monthNum)
                    ? `${year}-${String(monthNum).padStart(2,'0')}`
                    : null,
                events: num(r.Events),
                fatalities: num(r.Fatalities),
            };
        }).filter(r => r.year && r.month);
        // Newest period first
        rows.sort((a, b) => (b.date_period || '').localeCompare(a.date_period || ''));

        const out = `acled-pse-${key}.json`;
        await fs.writeFile(path.join(OUT_DIR, out), JSON.stringify({
            event_type: key,
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'ACLED — Armed Conflict Location & Event Data Project, via HDX. ' +
                'Use of this data must comply with the ACLED Terms of Use.',
            row_count: rows.length,
            rows,
        }, null, 1));
        files.push({ event_type: key, output: out, rows: rows.length });
        console.log(`  [${key}] ${rows.length} aggregate rows → ${out}`);
    }

    await fs.writeFile(path.join(OUT_DIR, 'acled-pse-manifest.json'), JSON.stringify({
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title || 'ACLED',
        license_id: pkg.license_id || 'hdx-other',
        attribution: 'ACLED — Armed Conflict Location & Event Data Project, via HDX.',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        files,
    }, null, 2));
    console.log(`[acled-pse] wrote ${files.length} file(s)`);
}

main().catch(err => {
    console.error('[acled-pse] fatal:', err);
    process.exit(1);
});
