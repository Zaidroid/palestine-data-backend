/**
 * IMF DataMapper fetcher for Palestine (West Bank and Gaza).
 *
 * Pulls every indicator from the IMF DataMapper API and extracts the
 * Palestine ("WBG") values series. Source: World Economic Outlook —
 * twice-yearly publication (April + October), so this catches macro
 * vintages months ahead of World Bank.
 *
 * Output: public/data/imf/all-indicators.json — shape mirrors World
 * Bank: { data: [{indicator, indicator_name, year, value, country, source}, ...] }
 * so processEconomicData in populate-unified-data.js can ingest both.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_DIR = path.resolve(__dirname, '../../public/data/imf');
const OUTPUT = path.join(OUTPUT_DIR, 'all-indicators.json');

const BASE = 'https://www.imf.org/external/datamapper/api/v1';
const COUNTRY = 'WBG';                  // West Bank and Gaza
const REQUEST_DELAY_MS = 150;           // polite pacing
const TIMEOUT_MS = 15_000;

async function fetchJson(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: ctl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

async function main() {
    console.log(`[IMF] Listing all DataMapper indicators...`);
    const indicatorList = await fetchJson(`${BASE}/indicators`);
    const indicators = indicatorList.indicators || {};
    const codes = Object.keys(indicators);
    console.log(`[IMF] Probing ${codes.length} indicators for ${COUNTRY} coverage...`);

    const records = [];
    let withData = 0;
    let latestVintageDate = null;

    for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        const meta = indicators[code] || {};
        try {
            const payload = await fetchJson(`${BASE}/${code}/${COUNTRY}`);
            const series = payload?.values?.[code]?.[COUNTRY];
            if (!series || typeof series !== 'object') continue;

            withData += 1;
            const vintage = meta['last-modified'];
            if (vintage && (!latestVintageDate || vintage > latestVintageDate)) {
                latestVintageDate = vintage;
            }

            for (const [yr, value] of Object.entries(series)) {
                if (value === null || value === undefined) continue;
                records.push({
                    indicator: code,
                    indicator_name: meta.label || code,
                    year: parseInt(yr, 10),
                    value: Number(value),
                    country: 'Palestine',
                    unit: meta.unit || null,
                    dataset: meta.dataset || null,
                    source: 'IMF',
                    source_dataset: meta.source || 'IMF DataMapper',
                });
            }
        } catch (err) {
            // Some indicators 404 or are slow; skip silently.
        }
        if (i < codes.length - 1) {
            await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
        }
        if ((i + 1) % 25 === 0) {
            console.log(`[IMF] Progress: ${i + 1}/${codes.length} probed (${withData} with WBG data, ${records.length} rows so far)`);
        }
    }

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const out = {
        generated_at: new Date().toISOString(),
        source: 'IMF DataMapper',
        source_url: 'https://www.imf.org/external/datamapper/profile/WBG',
        license: 'CC-BY-4.0',          // IMF DataMapper terms
        country: 'Palestine (West Bank and Gaza)',
        country_code: COUNTRY,
        latest_vintage: latestVintageDate,
        indicators_with_data: withData,
        count: records.length,
        data: records,
    };
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));

    const yrs = records.map((r) => r.year);
    const yMin = Math.min(...yrs);
    const yMax = Math.max(...yrs);
    console.log(
        `[IMF] DONE — ${records.length} rows from ${withData} indicators, ` +
        `years ${yMin}–${yMax}, latest vintage ${latestVintageDate} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[IMF] FATAL:', err.message);
    process.exit(1);
});
