/**
 * Peace Now — West Bank settler population time series (1967 → present).
 *
 * The settlements-data/population page renders a Highcharts chart whose
 * year axis (categories) and population series are embedded inline in the
 * page JS. We pull the page and parse the two arrays — no browser needed.
 *
 * Source: https://peacenow.org.il/en/settlements-watch/settlements-data/population
 * License: © Peace Now (Settlement Watch) — attribution; verify before
 * commercial redistribution.
 * Output: public/data/static/peacenow-settlers.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/peacenow-settlers.json');
const PAGE_URL = 'https://peacenow.org.il/en/settlements-watch/settlements-data/population';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function main() {
    console.log(`[peacenow] fetching ${PAGE_URL}`);
    const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // Year axis: the categories array beginning at "1967".
    const catsMatch = html.match(/categories:\s*(\["1967".*?\])/s);
    if (!catsMatch) throw new Error('Could not find year categories on page');
    const years = JSON.parse(catsMatch[1]).map((y) => parseInt(y, 10));

    // Population series = the numeric data array with the same length as years.
    let series = null;
    for (const m of html.matchAll(/data:\s*(\[[^\]]*\])/g)) {
        let arr;
        try { arr = JSON.parse(m[1]); } catch { continue; }
        if (arr.length === years.length && arr.every((x) => typeof x === 'number')) {
            series = arr;
            break;
        }
    }
    if (!series) throw new Error('Could not find population series matching year axis');

    const records = years.map((year, i) => ({
        id: `peacenow-settlers-${year}`,
        date: `${year}-12-31`,
        year,
        settler_population: series[i],
        region: 'West Bank',
    })).filter((r) => Number.isFinite(r.settler_population));

    const out = {
        generated_at: new Date().toISOString(),
        source: 'Peace Now — Settlement Watch',
        source_url: PAGE_URL,
        license: 'verify-required',
        attribution_text: 'Settler population: Peace Now (Settlement Watch), peacenow.org.il.',
        count: records.length,
        coverage: { earliest_year: years[0], latest_year: years[years.length - 1] },
        latest_population: records[records.length - 1]?.settler_population || null,
        note: 'West Bank settler population (excludes East Jerusalem); annual series digitized from Peace Now chart.',
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[peacenow] DONE — ${records.length} years (${years[0]}–${years[years.length - 1]}), ` +
        `latest ${out.latest_population?.toLocaleString()} settlers → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[peacenow] FATAL:', err.message);
    process.exit(1);
});
