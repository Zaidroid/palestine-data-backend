/**
 * UN OCHA Financial Tracking Service (FTS) fetcher.
 *
 * Pulls every recorded humanitarian funding flow into Palestine
 * (countryISO3=PSE) by year. Each flow is a transfer from a donor
 * (governments, foundations, private) to a recipient (UN agencies, NGOs)
 * with amount, date, status (commitment/paid/pledge), and earmarking.
 *
 * Endpoint:
 *   https://api.hpc.tools/v1/public/fts/flow?countryISO3=PSE&year=YYYY&limit=200
 *   Pagination via `meta.nextLink` (page query param).
 *
 * License: CC-BY-IGO-3.0 — green-light for commercial reuse with attribution.
 *
 * Output: public/data/static/unfts-funding.json
 *   { generated_at, source, license, count, data: [...] }
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT = path.resolve(__dirname, '../../public/data/static/unfts-funding.json');

const BASE = 'https://api.hpc.tools/v1/public/fts/flow';
const LIMIT = 200;
const YEAR_FROM = 2015;
const YEAR_TO = new Date().getFullYear();

function pickByType(arr, type) {
    if (!Array.isArray(arr)) return null;
    return arr.find((o) => o.type === type) || null;
}

function pickAllByType(arr, type) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((o) => o.type === type);
}

function toRecord(flow) {
    const src = pickByType(flow.sourceObjects, 'Organization');
    const dst = pickByType(flow.destinationObjects, 'Organization');
    const dstLoc = pickByType(flow.destinationObjects, 'Location');
    const usageYears = pickAllByType(flow.destinationObjects, 'UsageYear').map((o) => o.name);
    const cluster = pickByType(flow.destinationObjects, 'GlobalCluster') || pickByType(flow.destinationObjects, 'Cluster');
    const plan = pickByType(flow.destinationObjects, 'Plan');
    const emergency = pickByType(flow.destinationObjects, 'Emergency');
    const amountUSD = Number(flow.amountUSD || 0);
    const parkedUSD = Number(flow.fullParkedAmountUSD || 0);
    return {
        flow_id: String(flow.id),
        date: (flow.date || flow.createdAt || '').slice(0, 10),
        decision_date: flow.decisionDate ? flow.decisionDate.slice(0, 10) : null,
        first_reported_date: flow.firstReportedDate ? flow.firstReportedDate.slice(0, 10) : null,
        amount_usd: amountUSD || parkedUSD,
        original_amount: Number(flow.originalAmount || 0),
        original_currency: flow.originalCurrency || 'USD',
        status: flow.status || null,
        flow_type: flow.flowType || null,
        contribution_type: flow.contributionType || null,
        method: flow.method || null,
        donor_name: src?.name || null,
        donor_type: src?.organizationTypes?.[0] || null,
        recipient_name: dst?.name || null,
        recipient_type: dst?.organizationTypes?.[0] || null,
        destination_location: dstLoc?.name || 'Occupied Palestinian Territory',
        usage_years: usageYears,
        cluster: cluster?.name || null,
        plan: plan?.name || null,
        emergency: emergency?.name || null,
        keywords: Array.isArray(flow.keywords) ? flow.keywords : [],
        description: (flow.description || '').slice(0, 500),
        new_money: Boolean(flow.newMoney),
        ref_code: flow.refCode || null,
    };
}

async function fetchYear(year) {
    let url = `${BASE}?countryISO3=PSE&year=${year}&limit=${LIMIT}`;
    const acc = [];
    let page = 1;
    while (url) {
        const res = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
        if (!res.ok) throw new Error(`FTS ${res.status} ${res.statusText} for ${url}`);
        const body = await res.json();
        const flows = body?.data?.flows || [];
        for (const f of flows) acc.push(toRecord(f));
        const next = body?.meta?.nextLink || null;
        console.log(`[unfts] ${year} page ${page}: +${flows.length} (year total ${acc.length}${body?.meta?.count ? '/' + body.meta.count : ''})`);
        url = next;
        page += 1;
        if (page > 200) break; // hard safety stop
    }
    return acc;
}

async function main() {
    console.log(`[unfts] fetching humanitarian funding flows for Palestine ${YEAR_FROM}-${YEAR_TO}`);
    const all = [];
    for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
        try {
            const rows = await fetchYear(year);
            all.push(...rows);
        } catch (e) {
            console.warn(`[unfts] year ${year} skipped: ${e.message}`);
        }
    }

    // Deduplicate on flow_id (parent/child overlaps occur)
    const seen = new Set();
    const deduped = [];
    for (const r of all) {
        if (seen.has(r.flow_id)) continue;
        seen.add(r.flow_id);
        deduped.push(r);
    }

    const envelope = {
        generated_at: new Date().toISOString(),
        source: 'UN OCHA Financial Tracking Service',
        source_url: `${BASE}?countryISO3=PSE`,
        license: 'CC-BY-IGO-3.0',
        attribution: 'UN OCHA Financial Tracking Service (FTS), https://fts.unocha.org',
        count: deduped.length,
        data: deduped,
    };

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(envelope, null, 2), 'utf-8');
    console.log(`[unfts] wrote ${deduped.length} unique flows (${all.length - deduped.length} duplicates dropped) to ${OUTPUT}`);
}

main().catch((err) => {
    console.error('[unfts] FATAL', err);
    process.exit(1);
});
