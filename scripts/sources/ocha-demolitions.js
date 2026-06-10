/**
 * OCHA oPt Demolitions — West Bank + East Jerusalem demolitions since 2009.
 *
 * The public page embeds a Power BI report over the _vw_Incidents view. We
 * load the embed headless and capture two queries:
 *   - the map cross-tab → per-locality totals (lat, lon, locality,
 *     governorate, structures demolished, people displaced) — ~500 localities
 *   - the year×month cross-tab → annual demolition / displacement series
 *
 * Fills a category the bank lacked entirely (only Peace Now settlements +
 * B'Tselem stub existed). West Bank-focused — directly addresses the
 * geographic imbalance.
 *
 * Source: https://www.ochaopt.org/data/demolition (UN OCHA oPt).
 * Output: public/data/static/ocha-demolitions.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { captureResponses } from '../utils/browser-fetch.js';
import { decodeDM0 } from '../utils/pbi-decode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/ocha-demolitions.json');

const EMBED_URL = 'https://app.powerbi.com/view?r=eyJrIjoiYWFlNzc4MDUtMDg0Mi00M2EyLTlkMmUtYWEyMWQ0MzU1N2U2IiwidCI6IjBmOWUzNWRiLTU0NGYtNGY2MC1iZGNjLTVlYTQxNmU2ZGM3MCIsImMiOjh9';

async function main() {
    console.log('[ocha-demolitions] loading Power BI embed headless...');
    const captures = await captureResponses(EMBED_URL, /querydata/i, { settleMs: 22000 });
    console.log(`[ocha-demolitions] captured ${captures.length} querydata calls`);

    const mapCap = captures.find((c) =>
        (c.request_body || '').includes('_vw_Incidents.y') &&
        (c.request_body || '').includes('_vw_Incidents.x'));
    const yearCap = captures.find((c) =>
        /Date Hierarchy\.Year/.test(c.request_body || '') && /Month/.test(c.request_body || ''));

    if (!mapCap && !yearCap) {
        throw new Error('No demolitions aggregates captured — embed layout may have changed');
    }

    const records = [];

    // Per-locality map rows: [lat, lon, locality, governorate, demolished, displaced]
    if (mapCap) {
        for (const r of decodeDM0(mapCap)) {
            const [lat, lon, locality, governorate, demolished, displaced] = r;
            if (locality == null) continue;
            records.push({
                id: `ocha-demo-loc-${String(locality).trim().replace(/\s+/g, '-').toLowerCase()}`,
                dimension: 'locality',
                date: null,
                locality: String(locality).trim(),
                governorate: governorate ? String(governorate).trim() : null,
                latitude: parseFloat(lat) || null,
                longitude: parseFloat(lon) || null,
                structures_demolished: Number.isFinite(demolished) ? demolished : null,
                people_displaced: Number.isFinite(displaced) ? displaced : null,
            });
        }
    }

    // Year×month: [year, demolished, displaced, affected] (per first-row schema).
    if (yearCap) {
        for (const r of decodeDM0(yearCap)) {
            const [year, demolished, displaced, affected] = r;
            if (!Number.isFinite(year)) continue;
            records.push({
                id: `ocha-demo-year-${year}`,
                dimension: 'annual_total',
                date: `${year}-12-31`,
                year,
                structures_demolished: Number.isFinite(demolished) ? demolished : null,
                people_displaced: Number.isFinite(displaced) ? displaced : null,
                people_affected: Number.isFinite(affected) ? affected : null,
            });
        }
    }

    const locRecords = records.filter((r) => r.dimension === 'locality');
    const yearRecords = records.filter((r) => r.dimension === 'annual_total');
    const years = yearRecords.map((r) => r.year).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'UN OCHA oPt — Data on Demolitions',
        source_url: 'https://www.ochaopt.org/data/demolition',
        license: 'verify-required',
        attribution_text: 'Demolitions and displacement: UN OCHA oPt "Data on Demolition".',
        coverage: { earliest_year: years[0] || null, latest_year: years[years.length - 1] || null },
        locality_count: locRecords.length,
        total_structures_demolished: locRecords.reduce((s, r) => s + (r.structures_demolished || 0), 0),
        count: records.length,
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[ocha-demolitions] DONE — ${locRecords.length} localities + ${yearRecords.length} annual ` +
        `(${years[0]}–${years[years.length - 1]}), ` +
        `${out.total_structures_demolished.toLocaleString()} structures → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[ocha-demolitions] FATAL:', err.message);
    process.exit(1);
});
