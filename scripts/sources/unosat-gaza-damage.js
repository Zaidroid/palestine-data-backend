/**
 * UNOSAT Gaza Strip Comprehensive Damage Assessments (CDA).
 *
 * Satellite-derived structure-damage assessments for Gaza since Oct 2023.
 * The building-level data ships as ESRI Geodatabases (needs GDAL — not
 * ingested here); each HDX dataset's notes carry UNOSAT's own parsed
 * totals (destroyed / severe / moderate / possible / total affected +
 * housing units). We extract those into an assessment-level time series
 * and link the GDB zip for GIS consumers.
 *
 * Source: HDX, UNOSAT org, CC-BY-SA.
 * Updated: per-assessment (every ~2-3 months during active conflict).
 * Output: public/data/static/unosat-gaza-damage.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/unosat-gaza-damage.json');
const HDX_BASE = 'https://data.humdata.org/api/3/action';

const MONTHS = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const num = (s) => parseInt(String(s).replace(/,/g, ''), 10);

// Assessment date = first imagery-collection date: "images collected on
// 3 and 6 September 2024 when compared to…" / "image collected on 15 October
// 2023" / "as of 22-23 September 2025". Take the first day number.
function parseAssessmentDate(text) {
    const m = text.match(
        /(?:images? collected on(?: the)?|as of)\s+(\d{1,2})(?:\s*(?:and|-|–|‑)\s*\d{1,2})?\s+([A-Za-z]+),?\s+(\d{4})/i
    );
    if (!m) return null;
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${month}-${String(m[1]).padStart(2, '0')}`;
}

function parseDamageTotals(text) {
    const destroyed = text.match(/([\d,]+)\s+destroyed structures/i);
    const severe = text.match(/([\d,]+)\s+severely damaged structures/i);
    const moderate = text.match(/([\d,]+)\s+moderately damaged structures/i);
    const possible = text.match(/([\d,]+)\s+possibly damaged structures/i);
    const total = text.match(/total of\s+([\d,]+)/i);
    const housing = text.match(/([\d,]+)\s+housing units have been damaged/i);
    const pct = text.match(/approximately\s+(\d+)%\s+of all structures/i);
    if (!destroyed && !total) return null;
    return {
        destroyed: destroyed ? num(destroyed[1]) : null,
        severely_damaged: severe ? num(severe[1]) : null,
        moderately_damaged: moderate ? num(moderate[1]) : null,
        possibly_damaged: possible ? num(possible[1]) : null,
        total_affected: total ? num(total[1]) : null,
        housing_units_damaged: housing ? num(housing[1]) : null,
        percent_structures_damaged: pct ? parseInt(pct[1], 10) : null,
    };
}

async function main() {
    console.log('[unosat] searching HDX for Gaza damage assessments...');
    const search = await fetchJSONWithRetry(
        `${HDX_BASE}/package_search?q=unosat+gaza+damage+assessment&rows=100`,
        { timeout: 60000 });

    const packages = (search.result.results || []).filter((p) =>
        /^unosat-gaza/.test(p.name) && /damage/i.test(p.name));
    console.log(`[unosat] ${packages.length} UNOSAT Gaza datasets found`);

    const records = [];
    for (const pkg of packages) {
        const notes = pkg.notes || '';
        const totals = parseDamageTotals(notes);
        if (!totals) continue; // road/agriculture or governorate-partial datasets without CDA totals
        const date = parseAssessmentDate(notes);
        if (!date) continue;
        const gdb = (pkg.resources || []).find((r) => /geodatabase/i.test(r.format));
        const scope = /governorate/i.test(pkg.name) ? 'governorate' : 'strip';
        records.push({
            id: `unosat-cda-${scope}-${date}`,
            date,
            scope,
            dataset: pkg.name,
            title: pkg.title,
            ...totals,
            geodatabase_url: gdb?.url || null,
            source_url: `https://data.humdata.org/dataset/${pkg.name}`,
        });
    }

    // One record per (scope, assessment date) — duplicate datasets exist for
    // some assessments; keep the one with the largest total.
    const byKey = {};
    for (const r of records) {
        const k = `${r.scope}|${r.date}`;
        if (!byKey[k] || (r.total_affected || 0) > (byKey[k].total_affected || 0)) {
            byKey[k] = r;
        }
    }
    const deduped = Object.values(byKey).sort((a, b) => a.date.localeCompare(b.date));

    if (deduped.length === 0) throw new Error('No parseable UNOSAT CDA assessments found');

    const out = {
        generated_at: new Date().toISOString(),
        source: 'UNOSAT Gaza Strip Comprehensive Damage Assessments (via HDX)',
        source_url: 'https://data.humdata.org/organization/un-operational-satellite-appplications-programme-unosat',
        license: 'CC-BY-SA',
        attribution_text: 'Satellite damage assessments: UNOSAT (UNITAR) via HDX (CC-BY-SA).',
        count: deduped.length,
        date_range: { earliest: deduped[0].date, latest: deduped[deduped.length - 1].date },
        notice: 'Assessment-level totals parsed from UNOSAT dataset descriptions; ' +
            'building-level geodata available per record via geodatabase_url (ESRI GDB).',
        data: deduped,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[unosat] DONE — ${deduped.length} assessments, ${out.date_range.earliest} → ` +
        `${out.date_range.latest}, latest: ${deduped[deduped.length - 1].total_affected?.toLocaleString()} affected structures → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[unosat] FATAL:', err.message);
    process.exit(1);
});
