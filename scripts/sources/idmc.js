/**
 * IDMC (Internal Displacement Monitoring Centre) fetcher for Palestine.
 *
 * Pulls per-event displacement records (geocoded, with figure, type,
 * source attribution) from IDMC's Internal Displacement Updates dataset
 * hosted on HDX. Complements UNHCR (which covers cross-border refugee
 * stocks) with internal displacement events.
 *
 * Source: HDX dataset "idmc-event-data-for-pse", CC-BY-IGO.
 * Updated: daily on HDX side.
 * Output: public/data/idmc/displacements-pse.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../../public/data/idmc');
const OUTPUT = path.join(OUTPUT_DIR, 'displacements-pse.json');

const CSV_URL =
    'https://data.humdata.org/dataset/a641dda7-9b19-4103-b811-76a3963d29d2/' +
    'resource/759900bf-d08a-4523-8e4a-157aa97e3d29/download/event_data_pse.csv';

function regionFromCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Palestine';
    // Gaza Strip approx bounding box: lng 34.20–34.57, lat 31.22–31.60
    if (lat >= 31.20 && lat <= 31.62 && lng >= 34.18 && lng <= 34.60) return 'Gaza Strip';
    // West Bank rough bbox: lng 34.87–35.58, lat 31.34–32.55
    if (lat >= 31.30 && lat <= 32.60 && lng >= 34.85 && lng <= 35.65) return 'West Bank';
    return 'Palestine';
}

async function main() {
    console.log(`[IDMC] Downloading ${CSV_URL}`);
    const res = await fetch(CSV_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const csvText = await res.text();
    const parsed = Papa.parse(csvText, { header: true, dynamicTyping: false, skipEmptyLines: true });

    const records = parsed.data
        .filter((r) => r.id && r.displacement_date)
        .map((r) => {
            const lat = parseFloat(r.latitude);
            const lng = parseFloat(r.longitude);
            const figure = parseInt(r.figure, 10);
            return {
                id: `idmc-${r.id}`,
                idmc_id: r.id,
                date: (r.displacement_date || '').slice(0, 10),
                start_date: (r.displacement_start_date || '').slice(0, 10),
                end_date: (r.displacement_end_date || '').slice(0, 10),
                event_name: r.event_name,
                category: r.category,                  // Conflict | Disaster
                subcategory: r.subcategory,
                type: r.type,                          // Storm, Flood, Conflict-violence, etc.
                subtype: r.subtype,
                displacement_type: r.displacement_type,
                qualifier: r.qualifier,                // total | partial
                figure: Number.isFinite(figure) ? figure : 0,
                location_name: r.locations_name,
                location_accuracy: r.locations_accuracy,
                latitude: Number.isFinite(lat) ? lat : null,
                longitude: Number.isFinite(lng) ? lng : null,
                region: regionFromCoords(lat, lng),
                source: r.sources,
                source_url: r.source_url || r.link,
                description: r.description,
                created_at: r.created_at,
            };
        });

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const dates = records.map((r) => r.date).filter(Boolean).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'IDMC Internal Displacement Updates (via HDX)',
        source_url: 'https://data.humdata.org/dataset/idmc-event-data-for-pse',
        license: 'CC-BY-IGO',
        attribution_text: 'Displacement events: Internal Displacement Monitoring Centre (idmc.ch), CC-BY-IGO.',
        country: 'Palestine',
        country_code: 'PSE',
        count: records.length,
        date_range: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
        total_displaced: records.reduce((s, r) => s + (r.figure || 0), 0),
        data: records,
    };
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[IDMC] DONE — ${records.length} displacement events, ` +
        `${out.date_range.earliest} → ${out.date_range.latest}, ` +
        `${out.total_displaced.toLocaleString()} people displaced → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[IDMC] FATAL:', err.message);
    process.exit(1);
});
