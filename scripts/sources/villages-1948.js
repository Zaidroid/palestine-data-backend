/**
 * 1948 depopulated Palestinian villages — the Nakba layer of the gazetteer.
 *
 * Pulls every instance of wd:Q12232785 ("depopulated Palestinian village")
 * from Wikidata: English + Arabic labels, coordinates, administrative
 * district, depopulation date and peak population where recorded.
 *
 * License: CC0 (Wikidata). ~452 villages as of 2026.
 *
 * Output: public/data/static/villages-1948.json
 *   { generated_at, source, license, count, data: [
 *       { qid, name_en, name_ar, lat, lon, district, depopulated_on, population } ] }
 *
 * Consumed by:
 *   - scripts/build-gazetteer.js (merges villages into known_locations.json
 *     so 1948 places are first-class, linkable to modern records)
 *   - scripts/populate-unified-data.js processNakbaData (depopulation event
 *     records in /unified/conflict with per-village citations)
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT = path.resolve(__dirname, '../../public/data/static/villages-1948.json');

const SPARQL = `
SELECT ?v ?name_en ?name_ar ?coord ?districtLabel ?depopulated ?population WHERE {
  ?v wdt:P31 wd:Q12232785 .
  OPTIONAL { ?v rdfs:label ?name_en FILTER(LANG(?name_en) = "en") }
  OPTIONAL { ?v rdfs:label ?name_ar FILTER(LANG(?name_ar) = "ar") }
  OPTIONAL { ?v wdt:P625 ?coord }
  OPTIONAL { ?v wdt:P131 ?district . ?district rdfs:label ?districtLabel FILTER(LANG(?districtLabel) = "en") }
  OPTIONAL { ?v wdt:P576 ?depopulated }
  OPTIONAL { ?v wdt:P1082 ?population }
}`;

function parsePoint(wkt) {
    // "Point(35.123 32.456)" — WKT is lon lat
    const m = /Point\(([-0-9.]+) ([-0-9.]+)\)/.exec(wkt || '');
    if (!m) return [null, null];
    return [parseFloat(m[2]), parseFloat(m[1])];
}

async function main() {
    console.log('[villages-1948] querying Wikidata…');
    const res = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(SPARQL), {
        headers: {
            Accept: 'application/sparql-results+json',
            'User-Agent': 'PalestineDataBackend/1.0 (https://github.com/Zaidroid/palestine-data-backend)',
        },
    });
    if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
    const body = await res.json();

    // One row per (village × optional combo) — collapse by QID keeping the
    // most complete values.
    const byQid = new Map();
    for (const b of body.results.bindings) {
        const qid = b.v.value.split('/').pop();
        const [lat, lon] = parsePoint(b.coord?.value);
        const cur = byQid.get(qid) || {
            qid,
            name_en: null,
            name_ar: null,
            lat: null,
            lon: null,
            district: null,
            depopulated_on: null,
            population: null,
        };
        cur.name_en = cur.name_en || b.name_en?.value || null;
        cur.name_ar = cur.name_ar || b.name_ar?.value || null;
        if (cur.lat == null && lat != null) { cur.lat = lat; cur.lon = lon; }
        cur.district = cur.district || b.districtLabel?.value || null;
        cur.depopulated_on = cur.depopulated_on || b.depopulated?.value?.slice(0, 10) || null;
        cur.population = cur.population || (b.population ? parseInt(b.population.value, 10) : null);
        byQid.set(qid, cur);
    }

    const data = [...byQid.values()]
        .filter((v) => v.name_en || v.name_ar)
        .sort((a, b) => (a.name_en || '').localeCompare(b.name_en || ''));

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify({
        generated_at: new Date().toISOString(),
        source: 'Wikidata (Q12232785: depopulated Palestinian village)',
        source_url: 'https://www.wikidata.org/wiki/Q12232785',
        license: 'CC0-1.0',
        count: data.length,
        data,
    }, null, 2), 'utf-8');

    const withCoords = data.filter((v) => v.lat != null).length;
    const withDate = data.filter((v) => v.depopulated_on).length;
    console.log(`[villages-1948] wrote ${data.length} villages (${withCoords} with coords, ${withDate} with depopulation dates) → ${OUTPUT}`);
}

main().catch((err) => {
    console.error('[villages-1948] FATAL:', err.message);
    process.exit(1);
});
