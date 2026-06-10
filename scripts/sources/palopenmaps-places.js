/**
 * Palestine Open Maps — historical localities + Mandate-era censuses.
 *
 * Pulls the PalOpenMaps places dataset (digitized from Village Statistics
 * 1945, Survey of Palestine maps, Salman Abu Sitta's atlas, Zochrot and
 * PalestineRemembered): ~2,490 localities across historic Palestine with
 * British Mandate census populations (1922 / 1931 / 1945), Arab/Jewish
 * land-group splits, 2016 status, and depopulation status + date for the
 * ~620 localities depopulated in the Nakba (1947–49) and after.
 *
 * Source: github.com/PalOpenMaps/pom-data (no formal license — attribution
 * to Palestine Open Maps / Abu Sitta / Zochrot / PalestineRemembered;
 * verify before commercial redistribution).
 * Updated: static (repo changes rarely); refetch monthly is plenty.
 * Output: public/data/historical/palopenmaps-places.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'public/data/historical');
const OUTPUT = path.join(OUTPUT_DIR, 'palopenmaps-places.json');

const PLACES_INDEX_URL = 'https://raw.githubusercontent.com/PalOpenMaps/pom-data/main/data/places.json';
const RAW_BASE = 'https://raw.githubusercontent.com/PalOpenMaps/pom-data/main/data/places';
const CONCURRENCY = 16;

async function fetchPlace(slug) {
    try {
        const feature = await fetchJSONWithRetry(`${RAW_BASE}/${encodeURIComponent(slug)}.json`,
            { timeout: 30000, retries: 2 });
        return feature.properties || null;
    } catch (err) {
        console.warn(`  [pom] ${slug} failed: ${err.message}`);
        return null;
    }
}

async function main() {
    console.log('[pom] downloading places index...');
    const index = await fetchJSONWithRetry(PLACES_INDEX_URL, { timeout: 60000 });
    const slugs = (index.features || [])
        .map((f) => f.properties?.slug)
        .filter(Boolean);
    console.log(`[pom] ${slugs.length} places listed; fetching per-place census records...`);

    const detailed = [];
    for (let i = 0; i < slugs.length; i += CONCURRENCY) {
        const batch = slugs.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(fetchPlace));
        detailed.push(...results.filter(Boolean));
        if ((i / CONCURRENCY) % 20 === 0) {
            console.log(`  [pom] ${Math.min(i + CONCURRENCY, slugs.length)}/${slugs.length}`);
        }
    }

    const records = detailed.map((p) => ({
        id: `pom-${p.slug}`,
        slug: p.slug,
        name_en: p.name_en,
        name_ar: p.name_ar,
        name_he: p.name_he || null,
        type: p.type,                        // Settlement | …
        group: p.group,                      // Palestinian | Jewish | Mixed
        status: p.status,                    // Remaining | Depopulated | New locality | …
        district_1945: p.district_1945,
        subdistrict_1945: p.subdistrict_1945,
        pop_1922: p.pop_1922 ?? null,
        pop_1931: p.pop_1931 ?? null,
        pop_1945: p.pop_1945 ?? null,
        pal_1945: p.pal_1945 ?? null,        // Palestinian population share 1945
        jsh_1945: p.jsh_1945 ?? null,        // Jewish population share 1945
        type_1945: p.type_1945 || null,
        pop_2016: p.pop_2016 ?? null,
        status_2016: p.change_2016 || null,
        depopulated_date: p.end || null,     // ISO date for Nakba-era depopulations
        latitude: p.lat ?? null,
        longitude: p.lng ?? null,
        id_zochrot: p.id_zo ?? null,
        id_palestineremembered: p.id_pr ?? null,
        url_palestineremembered: p.url_pr ? `https://www.palestineremembered.com/${p.url_pr}` : null,
    }));

    const depopulated = records.filter((r) => /depopulated|abandoned/i.test(r.status || ''));
    const out = {
        generated_at: new Date().toISOString(),
        source: 'Palestine Open Maps (pom-data)',
        source_url: 'https://github.com/PalOpenMaps/pom-data',
        license: 'verify-required',
        attribution_text: 'Historical localities and census data: Palestine Open Maps (palopenmaps.org), ' +
            'digitized from Village Statistics 1945 and Survey of Palestine; cross-referenced with ' +
            'Salman Abu Sitta, Zochrot, and PalestineRemembered.',
        count: records.length,
        depopulated_count: depopulated.length,
        census_years: [1922, 1931, 1945],
        data: records,
    };
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[pom] DONE — ${records.length} localities (${depopulated.length} depopulated/abandoned), ` +
        `censuses 1922/1931/1945 → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[pom] FATAL:', err.message);
    process.exit(1);
});
