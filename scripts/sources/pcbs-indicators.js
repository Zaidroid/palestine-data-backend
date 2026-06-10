/**
 * PCBS — direct official indicators (population, CPI, poverty, internet).
 *
 * pcbs.gov.ps renders an indicator dashboard whose data tables are reachable
 * only after the page's JS runs (no static HTML), so we render it headless
 * and parse the tables by their header signature into a long format:
 *   { indicator, region, year, value, unit }
 *
 * These are PCBS's OWN published figures (Palestine / West Bank / Gaza /
 * Jerusalem). The existing `pcbs` category is World Bank proxy data — this is
 * the authentic source with East Jerusalem + region granularity.
 *
 * Source: https://www.pcbs.gov.ps (free with attribution).
 * Output: public/data/static/pcbs-indicators.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/pcbs-indicators.json');
const PAGE_URL = 'https://www.pcbs.gov.ps/statisticsIndicatorsTables.aspx?lang=en&table_id=585';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const num = (s) => {
    const n = parseFloat(String(s).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};
const isYear = (s) => /^\b(19|20)\d{2}\b$/.test(String(s).trim());

async function main() {
    console.log('[pcbs] rendering indicator dashboard headless...');
    const browser = await chromium.launch({ headless: true });
    let tables;
    try {
        const page = await (await browser.newContext({ userAgent: UA })).newPage();
        await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForTimeout(8000);
        tables = await page.evaluate(() =>
            [...document.querySelectorAll('table')].map((t) =>
                [...t.querySelectorAll('tr')].map((r) =>
                    [...r.querySelectorAll('td,th')].map((c) => c.innerText.trim()))));
    } finally {
        await browser.close();
    }

    const records = [];

    // ── Population by region: header row [Year/Region], then [WB, Gaza, Palestine],
    //    then year rows [year, wbVal, gazaVal, palVal].
    const popTable = tables.find((t) =>
        t[0]?.some((c) => /year/i.test(c)) &&
        t.some((r) => r.some((c) => /gaza/i.test(c))) &&
        t.some((r) => isYear(r[0]) && r.length >= 4 && num(r[1]) > 100000));
    if (popTable) {
        for (const row of popTable) {
            if (!isYear(row[0])) continue;
            const [year, wb, gaza, pal] = row;
            const add = (region, v) => { const n = num(v); if (n != null) records.push({ indicator: 'population', region, year: parseInt(year, 10), value: n, unit: 'persons' }); };
            add('West Bank', wb); add('Gaza Strip', gaza); add('Palestine', pal);
        }
    }

    // ── CPI by region: header contains "Index number Palestine"; year rows carry
    //    index + pct-change pairs per region.
    const cpiTable = tables.find((t) => t.some((r) => r.some((c) => /Index number Palestine/i.test(c))));
    if (cpiTable) {
        const header = cpiTable.find((r) => r.some((c) => /Index number/i.test(c))) || [];
        // Map column index → {region}. Index columns only (skip pct-change).
        const cols = header.map((h) => {
            const m = h.match(/Index number\s+(Palestine|West Bank|Gaza Strip|Jerusalem)/i);
            return m ? m[1].replace(/\s*\*+\s*$/, '').trim() : null;
        });
        for (const row of cpiTable) {
            if (!isYear(row[0])) continue;
            const year = parseInt(row[0], 10);
            cols.forEach((region, ci) => {
                if (!region) return;
                const v = num(row[ci]);
                if (v != null) records.push({ indicator: 'cpi', region: region === 'Jerusalem' ? 'East Jerusalem' : region, year, value: v, unit: 'index' });
            });
        }
    }

    // ── Poverty by region: header [Region, Poverty %, Deep Poverty %], a year
    //    sub-header row, then region rows [region, ...yearVals...].
    const povTable = tables.find((t) => t[0]?.some((c) => /poverty/i.test(c)));
    if (povTable) {
        const yearRow = povTable.find((r) => r.filter(isYear).length >= 2);
        const years = yearRow ? yearRow.filter(isYear).map((y) => parseInt(y, 10)) : [];
        for (const row of povTable) {
            const region = row[0];
            if (!/west bank|gaza|palestine/i.test(region || '')) continue;
            const canonRegion = /gaza/i.test(region) ? 'Gaza Strip' : /west bank/i.test(region) ? 'West Bank' : 'Palestine';
            // values follow the region label, aligned to `years` (poverty % first half)
            const vals = row.slice(1).map(num).filter((v) => v != null);
            years.slice(0, vals.length).forEach((year, i) => {
                records.push({ indicator: 'poverty_rate', region: canonRegion, year, value: vals[i], unit: 'percent' });
            });
        }
    }

    if (records.length === 0) throw new Error('No PCBS indicator tables parsed — page layout may have changed');

    const byIndicator = {};
    for (const r of records) byIndicator[r.indicator] = (byIndicator[r.indicator] || 0) + 1;
    const years = records.map((r) => r.year).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'Palestinian Central Bureau of Statistics (PCBS)',
        source_url: PAGE_URL,
        license: 'verify-required',
        attribution_text: 'Official statistics: Palestinian Central Bureau of Statistics (pcbs.gov.ps).',
        count: records.length,
        indicators: byIndicator,
        year_range: { earliest: years[0] || null, latest: years[years.length - 1] || null },
        data: records.map((r) => ({ id: `pcbs-${r.indicator}-${r.region.replace(/\s+/g, '-').toLowerCase()}-${r.year}`, date: `${r.year}-12-31`, ...r })),
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(`[pcbs] DONE — ${records.length} records (${JSON.stringify(byIndicator)}) → ${OUTPUT}`);
}

main().catch((err) => {
    console.error('[pcbs] FATAL:', err.message);
    process.exit(1);
});
