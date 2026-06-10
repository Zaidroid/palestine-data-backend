/**
 * HaMoked — Palestinians held by Israel, monthly (May 2008 → present).
 *
 * hamoked.org/prisoners-charts.php renders a bar-chart timeline where every
 * month is a `.pillar` <div> carrying the full IPS figures in data
 * attributes: data-judgment (sentenced), data-arrest (remand/pre-trial),
 * data-administrative-arrest (administrative detention), and
 * data-unnlawful-combatants. The page 403s to non-browser clients, so we
 * render it headless and parse the pillars out of the DOM.
 *
 * Fills the prisoners category with a 17-year monthly series (Addameer only
 * gives the last ~12 months) and adds the administrative-detention signal.
 *
 * Source: https://hamoked.org/prisoners-charts.php (IPS-sourced).
 * License: © HaMoked — attribution; verify before commercial redistribution.
 * Output: public/data/static/hamoked-detention.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderedHtml } from '../utils/browser-fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/hamoked-detention.json');
const PAGE_URL = 'https://hamoked.org/prisoners-charts.php';

const attr = (pillar, name) => {
    const m = pillar.match(new RegExp(`data-${name}="([^"]*)"`));
    return m ? m[1] : null;
};
const intOf = (v) => {
    const n = parseInt(String(v).replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
};

async function main() {
    console.log(`[hamoked] rendering ${PAGE_URL} headless...`);
    const html = await renderedHtml(PAGE_URL, { waitMs: 9000 });

    const pillars = html.match(/<div class="pillar"[^>]*>/g) || [];
    console.log(`[hamoked] ${pillars.length} monthly pillars found`);

    const records = [];
    for (const p of pillars) {
        const year = intOf(attr(p, 'year'));
        const month = intOf(attr(p, 'month'));
        if (!year || !month) continue;
        const sentenced = intOf(attr(p, 'judgment'));
        const remand = intOf(attr(p, 'arrest'));
        const administrative = intOf(attr(p, 'administrative-arrest'));
        const unlawful = intOf(attr(p, 'unnlawful-combatants'));
        const total = [sentenced, remand, administrative, unlawful]
            .reduce((s, v) => s + (v || 0), 0);
        records.push({
            id: `hamoked-${year}-${String(month).padStart(2, '0')}`,
            date: `${year}-${String(month).padStart(2, '0')}-01`,
            year,
            month,
            sentenced,
            remand,                 // pre-trial / awaiting trial
            administrative,         // administrative detention (no charge)
            unlawful_combatants: unlawful,
            total_held: total,
        });
    }
    records.sort((a, b) => a.date.localeCompare(b.date));
    if (records.length === 0) throw new Error('No HaMoked pillars parsed — page layout may have changed');

    const out = {
        generated_at: new Date().toISOString(),
        source: 'HaMoked — Center for the Defence of the Individual',
        source_url: PAGE_URL,
        license: 'verify-required',
        attribution_text: 'Detention figures: HaMoked (hamoked.org), sourced from Israel Prison Service.',
        count: records.length,
        date_range: { earliest: records[0].date, latest: records[records.length - 1].date },
        latest: records[records.length - 1],
        note: 'Monthly count of Palestinians held by Israel by detention category (IPS data via HaMoked).',
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[hamoked] DONE — ${records.length} months (${out.date_range.earliest} → ${out.date_range.latest}), ` +
        `latest total held: ${out.latest.total_held?.toLocaleString()} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[hamoked] FATAL:', err.message);
    process.exit(1);
});
