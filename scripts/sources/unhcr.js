/**
 * UNHCR Operational Data Portal fetcher.
 *
 * Pulls Palestinian refugee populations by country of asylum, year by year,
 * from the official UNHCR ODP API. CC-BY-4.0 — green-light for commercial
 * resale. Replaces the 75-row Wikipedia scrape with a few thousand structured
 * records covering 2010 → present.
 *
 * Endpoint:
 *   https://api.unhcr.org/population/v1/population/?yearFrom=...&yearTo=...&coo=GAZ&coa_all=true
 *
 * The "GAZ" code is UNHCR's legacy code for State of Palestine (iso PSE).
 *
 * Output: public/data/static/unhcr-refugees.json
 *   { generated_at, source, license, count, data: [...] }
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT = path.resolve(__dirname, '../../public/data/static/unhcr-refugees.json');

const BASE = 'https://api.unhcr.org/population/v1/population/';
const COO = 'GAZ';
const YEAR_FROM = 2010;
const YEAR_TO = new Date().getFullYear();
const LIMIT = 200;

async function fetchPage(page) {
    const url = `${BASE}?yearFrom=${YEAR_FROM}&yearTo=${YEAR_TO}&coo=${COO}&coa_all=true&limit=${LIMIT}&page=${page}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!res.ok) throw new Error(`UNHCR ${res.status} ${res.statusText} for page ${page}`);
    return res.json();
}

function toRecord(row) {
    const refugees = Number(row.refugees) || 0;
    const asylum = Number(row.asylum_seekers) || 0;
    const idps = Number(row.idps) || 0;
    const returned = Number(row.returned_refugees) || 0;
    const stateless = Number(row.stateless) || 0;
    const ooc = Number(row.ooc) || 0;
    return {
        date: `${row.year}-12-31`,
        year: row.year,
        country_of_origin_name: row.coo_name || 'Palestinian',
        country_of_origin_code: row.coo_iso || 'PSE',
        country_of_asylum_name: row.coa_name || null,
        country_of_asylum_code: row.coa_iso || null,
        location: row.coa_name || null,
        refugees,
        asylum_seekers: asylum,
        idps,
        returned_refugees: returned,
        stateless,
        others_of_concern: ooc,
        type: 'cross-border_refugees',
    };
}

async function main() {
    console.log(`[unhcr] fetching Palestinian refugees ${YEAR_FROM}-${YEAR_TO} from UNHCR ODP`);
    const all = [];
    let page = 1;
    let maxPages = 1;
    do {
        const body = await fetchPage(page);
        const items = Array.isArray(body.items) ? body.items : [];
        for (const row of items) {
            // Drop empty rows (no asylum country breakdown, all zeros)
            if (!row.coa_name || row.coa === '-') continue;
            const refugees = Number(row.refugees) || 0;
            const asylum = Number(row.asylum_seekers) || 0;
            const idps = Number(row.idps) || 0;
            if (refugees + asylum + idps === 0) continue;
            all.push(toRecord(row));
        }
        maxPages = Number(body.maxPages) || 1;
        console.log(`[unhcr] page ${page}/${maxPages}: kept ${items.length} rows (running total ${all.length})`);
        page += 1;
    } while (page <= maxPages);

    const envelope = {
        generated_at: new Date().toISOString(),
        source: 'UNHCR Operational Data Portal',
        source_url: `${BASE}?yearFrom=${YEAR_FROM}&yearTo=${YEAR_TO}&coo=${COO}&coa_all=true`,
        license: 'CC-BY-4.0',
        attribution: 'UNHCR (United Nations High Commissioner for Refugees)',
        count: all.length,
        data: all,
    };

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(envelope, null, 2), 'utf-8');
    console.log(`[unhcr] wrote ${all.length} records to ${OUTPUT}`);
}

main().catch((err) => {
    console.error('[unhcr] FATAL', err);
    process.exit(1);
});
