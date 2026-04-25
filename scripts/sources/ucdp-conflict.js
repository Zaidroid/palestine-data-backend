/**
 * UCDP Georeferenced Event Dataset (Israel/Palestine) fetcher.
 *
 * Pulls the Uppsala Conflict Data Program's geocoded conflict events
 * dataset for Israel — which includes Palestinian conflict events back
 * to 1989 (35-year history). 7,600+ Palestine-related events with
 * lat/lng, casualty counts, source attribution.
 *
 * Mission: extends /unified/conflict's history pre-2000 (currently
 * Tech4Palestine starts 2000-09-28). UCDP is the academic gold-standard
 * conflict dataset.
 *
 * Source: HDX dataset "ucdp-data-for-israel", CC-BY-IGO licensed.
 * Output: public/data/ucdp/conflict-events-isr.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../../public/data/ucdp');
const OUTPUT = path.join(OUTPUT_DIR, 'conflict-events-isr.json');

const CSV_URL =
    'https://data.humdata.org/dataset/2d813ab3-11fd-42c8-acb7-3a4ecb6072a6/' +
    'resource/9ebf5ffb-1590-48dc-b7d6-99b939cf620f/download/conflict_data_isr.csv';

// type_of_violence (UCDP codebook):
//   1 = state-based (govt vs organized armed group)
//   2 = non-state (between two non-state groups)
//   3 = one-sided (govt or non-state group attacking civilians)
const TYPE_OF_VIOLENCE = {
    '1': 'state_based',
    '2': 'non_state',
    '3': 'one_sided',
};

function isPalestinian(row) {
    const blob = `${row.side_a || ''} ${row.side_b || ''} ${row.where_coordinates || ''} ${row.adm_1 || ''} ${row.conflict_name || ''}`.toLowerCase();
    return blob.includes('palest') || blob.includes('gaza') || blob.includes('west bank');
}

function regionFromAdm(row) {
    const blob = `${row.where_coordinates || ''} ${row.adm_1 || ''}`.toLowerCase();
    if (blob.includes('gaza')) return 'Gaza Strip';
    if (blob.includes('west bank')) return 'West Bank';
    if (blob.includes('jerusalem')) return 'East Jerusalem';
    if (blob.includes('israel')) return 'Israel';
    return 'Palestine';
}

async function main() {
    console.log(`[UCDP] Downloading ${CSV_URL}`);
    const res = await fetch(CSV_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const csvText = await res.text();
    console.log(`[UCDP] Downloaded ${(csvText.length / 1024 / 1024).toFixed(1)}MB`);

    const parsed = Papa.parse(csvText, { header: true, dynamicTyping: false, skipEmptyLines: true });
    if (parsed.errors?.length) {
        console.warn(`[UCDP] CSV parse warnings: ${parsed.errors.length} (continuing)`);
    }

    // Filter to Palestine-related rows + map to a clean per-event shape.
    const palestinian = parsed.data.filter(isPalestinian);
    const records = palestinian.map((r) => {
        const date = (r.date_start || '').slice(0, 10);
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        const best = parseInt(r.best, 10);
        return {
            id: `ucdp-${r.id}`,
            ucdp_id: r.id,
            ucdp_relid: r.relid,
            date,
            year: parseInt(r.year, 10),
            type_of_violence: TYPE_OF_VIOLENCE[r.type_of_violence] || 'unknown',
            conflict_name: r.conflict_name,
            dyad_name: r.dyad_name,
            side_a: r.side_a,
            side_b: r.side_b,
            where: r.where_coordinates || r.where_description,
            adm_1: r.adm_1,
            adm_2: r.adm_2,
            country: r.country,
            region: regionFromAdm(r),
            latitude: Number.isFinite(lat) ? lat : null,
            longitude: Number.isFinite(lng) ? lng : null,
            deaths_a: parseInt(r.deaths_a, 10) || 0,
            deaths_b: parseInt(r.deaths_b, 10) || 0,
            deaths_civilians: parseInt(r.deaths_civilians, 10) || 0,
            deaths_unknown: parseInt(r.deaths_unknown, 10) || 0,
            best_estimate: Number.isFinite(best) ? best : 0,
            source_headline: r.source_headline,
            source_office: r.source_office,
            source_date: r.source_date,
            number_of_sources: parseInt(r.number_of_sources, 10) || 0,
            event_clarity: r.event_clarity,
            date_precision: r.date_prec,
        };
    });

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const yrs = records.map((r) => r.year).filter(Number.isFinite);
    const out = {
        generated_at: new Date().toISOString(),
        source: 'Uppsala Conflict Data Program (UCDP) Georeferenced Event Dataset',
        source_url: 'https://ucdp.uu.se/',
        hdx_url: 'https://data.humdata.org/dataset/ucdp-data-for-israel',
        license: 'CC-BY-IGO',
        attribution_text: 'Conflict events: Uppsala Conflict Data Program (ucdp.uu.se), CC-BY-IGO.',
        country_dataset: 'Israel',
        scope: 'Palestine-related events only (filtered from full dataset)',
        count: records.length,
        year_range: { earliest: Math.min(...yrs), latest: Math.max(...yrs) },
        data: records,
    };
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[UCDP] DONE — ${records.length} Palestine-related events ` +
        `(${out.year_range.earliest}–${out.year_range.latest}) → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[UCDP] FATAL:', err.message);
    process.exit(1);
});
