/**
 * Palestine Open Maps locality registry — the trusted historical backbone.
 *
 * POM (palopenmaps.org, a Visualizing Palestine project — Palestinian-led)
 * compiles every Mandate-era locality from primary sources: the British
 * Survey of Palestine maps and the 1922/1931 censuses + Village Statistics
 * 1945, with per-locality crosswalks to the canonical Nakba scholarship:
 * Zochrot, Palestine Remembered, and Salman Abu Sitta's Atlas of Palestine.
 *
 * ~2,540 localities; ~590 marked depopulated (468 "Depopulated",
 * 107 "Depopulated & built over", 14 "Depopulated & appropriated"),
 * 474 of them with day-precision depopulation dates.
 *
 * Source: github.com/PalOpenMaps/pom-data (raw-data/localities.csv).
 * Underlying census/map data is public domain (British Mandate government
 * works); the POM compilation is used with attribution — flagged
 * verify_required in the license registry pending explicit terms.
 *
 * Output: public/data/static/pom-localities.json
 *
 * Consumed by:
 *   - scripts/populate-unified-data.js processVillages1948 (depopulation
 *     events with scholarly citations, PRIMARY over the Wikidata bootstrap)
 *   - scripts/utils/location-resolver.js (historical gazetteer layer)
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT = path.resolve(__dirname, '../../public/data/static/pom-localities.json');
const CSV_URL = 'https://raw.githubusercontent.com/PalOpenMaps/pom-data/main/raw-data/localities.csv';

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines).
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
        } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

async function main() {
    console.log('[pom-localities] downloading', CSV_URL);
    const res = await fetch(CSV_URL, {
        headers: { 'User-Agent': 'PalestineDataBackend/1.0 (https://github.com/Zaidroid/palestine-data-backend)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    const header = rows.shift();
    const idx = Object.fromEntries(header.map((h, i) => [h, i]));
    const get = (row, col) => (row[idx[col]] || '').trim() || null;

    const data = rows.map((r) => ({
        pom_id: get(r, 'id'),
        name_en: get(r, 'name_en'),
        name_ar: get(r, 'name_ar'),
        slug: get(r, 'slug'),
        district_1945: get(r, 'district_1945'),
        subdistrict_1945: get(r, 'subdistrict_1945'),
        type_1945: get(r, 'type_1945'),
        grp_1945: get(r, 'grp_1945'),
        pop_1922: get(r, 'pop_1922') ? parseInt(get(r, 'pop_1922'), 10) : null,
        pop_1931: get(r, 'pop_1931') ? parseInt(get(r, 'pop_1931'), 10) : null,
        pop_1945: get(r, 'pop_1945') ? parseInt(get(r, 'pop_1945'), 10) : null,
        change_2016: get(r, 'change_2016'),
        depopulated_on: get(r, 'end'),
        lat: get(r, 'lat') ? parseFloat(get(r, 'lat')) : null,
        lon: get(r, 'lng') ? parseFloat(get(r, 'lng')) : null,
        id_zochrot: get(r, 'id_zo'),
        id_palremembered: get(r, 'id_pr'),
        id_abusitta: get(r, 'id_as'),
        id_palquest: get(r, 'id_pq'),
        url_palremembered: get(r, 'url_pr'),
    })).filter((l) => l.name_en || l.name_ar);

    const depopulated = data.filter((l) => /depopulated/i.test(l.change_2016 || ''));

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify({
        generated_at: new Date().toISOString(),
        source: 'Palestine Open Maps (Visualizing Palestine)',
        source_url: 'https://palopenmaps.org/',
        data_url: CSV_URL,
        license: 'POM compilation, attribution; underlying Survey of Palestine + Village Statistics 1945 are public domain',
        verify_required: true,
        count: data.length,
        depopulated_count: depopulated.length,
        data,
    }, null, 2), 'utf-8');

    const withDate = depopulated.filter((l) => l.depopulated_on).length;
    console.log(`[pom-localities] wrote ${data.length} localities ` +
        `(${depopulated.length} depopulated, ${withDate} with dates) → ${OUTPUT}`);
}

main().catch((err) => {
    console.error('[pom-localities] FATAL:', err.message);
    process.exit(1);
});
