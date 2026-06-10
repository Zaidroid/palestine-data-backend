/**
 * OCHA oPt "Data on Casualties" — Palestinian fatalities since 2008.
 *
 * The public page embeds a Power BI "publish to web" report backed by the
 * B'Tselem-derived view vw_BS_Pal_Fatalities. We load the embed headless and
 * capture the querydata responses it issues, then decode Power BI's
 * delta-compressed result envelope into clean aggregates:
 *   - annual fatalities (2008 → present)
 *   - by region (Gaza Strip / West Bank / …)
 *   - by governorate
 *   - by demographic group (men / women / boys / girls)
 *   - by weapon
 *
 * This is the highest-value West Bank gap-filler: an 18-year fatalities
 * series covering BOTH territories at annual granularity with breakdowns.
 *
 * Source: https://www.ochaopt.org/data/casualties (UN OCHA; B'Tselem data).
 * Output: public/data/static/ocha-casualties.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { captureResponses } from '../utils/browser-fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/ocha-casualties.json');

// First (largest) Power BI embed on the casualties page — the fatalities report.
const EMBED_URL = 'https://app.powerbi.com/view?r=eyJrIjoiNjBlY2ExZWYtNTg1Mi00ODA3LTliYzMtNGZkYjg5MTVjNzFjIiwidCI6IjBmOWUzNWRiLTU0NGYtNGY2MC1iZGNjLTVlYTQxNmU2ZGM3MCIsImMiOjh9';

// Pull the DM0 rows out of Power BI's result envelope.
function dm0(capture) {
    try {
        return capture.body.results[0].result.data.dsr.DS[0].PH[0].DM0;
    } catch {
        return null;
    }
}

// DM0 rows are delta-compressed: the first row declares its column schema in
// `S`; later rows reuse it and may omit leading columns (R bitmask) — for the
// simple [label, value] and [year, value] shapes here, `C` is the full tuple.
function pairs(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => Array.isArray(r.C) && r.C.length >= 2).map((r) => r.C);
}

function classifyDim(requestBody) {
    if (/Fatalities\.Year/.test(requestBody)) return 'by_year';
    if (/\.Region/.test(requestBody) && /Sum/.test(requestBody)) return 'by_region';
    if (/Govornorate/.test(requestBody)) return 'by_governorate';
    if (/SA \(groups\)/.test(requestBody)) return 'by_demographic';
    if (/Weapon/.test(requestBody)) return 'by_weapon';
    return null;
}

async function main() {
    console.log('[ocha-casualties] loading Power BI embed headless...');
    const captures = await captureResponses(EMBED_URL, /querydata/i, { settleMs: 22000 });
    console.log(`[ocha-casualties] captured ${captures.length} querydata calls`);

    const dims = {};
    for (const c of captures) {
        if (!c.request_body || typeof c.body !== 'object') continue;
        const dim = classifyDim(c.request_body);
        if (!dim || dims[dim]) continue;
        const rows = pairs(dm0(c));
        if (rows.length) dims[dim] = rows;
    }

    if (!dims.by_year && !dims.by_region) {
        throw new Error('No casualties aggregates captured — embed layout may have changed');
    }

    const records = [];
    // Annual fatalities → one conflict record per year.
    for (const [year, fatalities] of dims.by_year || []) {
        if (!Number.isFinite(year)) continue;
        records.push({
            id: `ocha-casualties-year-${year}`,
            date: `${year}-12-31`,
            year,
            dimension: 'annual_total',
            label: String(year),
            fatalities,
        });
    }
    // Current-snapshot breakdowns (region/governorate/demographic/weapon).
    const snapshotDims = {
        by_region: 'region', by_governorate: 'governorate',
        by_demographic: 'demographic', by_weapon: 'weapon',
    };
    for (const [dimKey, dimName] of Object.entries(snapshotDims)) {
        for (const [label, fatalities] of dims[dimKey] || []) {
            records.push({
                id: `ocha-casualties-${dimName}-${String(label).trim().replace(/\s+/g, '-').toLowerCase()}`,
                date: null,
                dimension: dimName,
                label: String(label).trim(),
                fatalities,
            });
        }
    }

    const years = (dims.by_year || []).map(([y]) => y).filter(Number.isFinite).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'UN OCHA oPt — Data on Casualties (B\'Tselem data)',
        source_url: 'https://www.ochaopt.org/data/casualties',
        license: 'verify-required',
        attribution_text: 'Palestinian fatalities: UN OCHA oPt "Data on Casualties", sourced from B\'Tselem.',
        coverage: { earliest_year: years[0] || null, latest_year: years[years.length - 1] || null },
        dimensions_captured: Object.keys(dims),
        count: records.length,
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[ocha-casualties] DONE — ${records.length} records ` +
        `(${(dims.by_year || []).length} years ${years[0]}–${years[years.length - 1]}, ` +
        `dims: ${Object.keys(dims).join(', ')}) → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[ocha-casualties] FATAL:', err.message);
    process.exit(1);
});
