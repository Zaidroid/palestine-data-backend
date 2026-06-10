/**
 * IODA (Internet Outage Detection & Analysis, Georgia Tech) — Palestine.
 *
 * Pulls detected internet-outage events for Palestine at three levels:
 *   - country/PS
 *   - region 1226 (Gaza Strip), 4581 (West Bank)
 *   - asn 12975 (PALTEL), 29310 (JAWWAL)
 * Each event: start (epoch s), duration (s), datasource (bgp | ping-slash24 |
 * gtr | merit-nt), severity score. IODA's event DB reaches back to ~2022-03.
 *
 * Source: https://ioda.inetintel.cc.gatech.edu — free with attribution.
 * Updated: continuous (near-real-time detection).
 * Output: public/data/connectivity/ioda-outages.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'public/data/connectivity');
const OUTPUT = path.join(OUTPUT_DIR, 'ioda-outages.json');
const API_BASE = 'https://api.ioda.inetintel.cc.gatech.edu/v2';

// Window start: 2016-01-01 (IODA returns whatever it has; events begin ~2022).
const FROM_EPOCH = 1451606400;

const ENTITIES = [
    { entityType: 'country', entityCode: 'PS', label: 'Palestine', region: 'Palestine' },
    { entityType: 'region', entityCode: '1226', label: 'Gaza Strip', region: 'Gaza Strip' },
    { entityType: 'region', entityCode: '4581', label: 'West Bank', region: 'West Bank' },
    { entityType: 'asn', entityCode: '12975', label: 'AS12975 PALTEL', region: 'Palestine' },
    { entityType: 'asn', entityCode: '29310', label: 'AS29310 JAWWAL', region: 'Palestine' },
];

async function fetchEvents(entity) {
    const until = Math.floor(Date.now() / 1000);
    const url = `${API_BASE}/outages/events?entityType=${entity.entityType}` +
        `&entityCode=${entity.entityCode}&from=${FROM_EPOCH}&until=${until}`;
    const body = await fetchJSONWithRetry(url, { timeout: 60000 });
    return (body.data || []).map((e) => ({
        id: `ioda-${entity.entityType}-${entity.entityCode}-${e.start}-${e.datasource}`,
        entity_type: entity.entityType,
        entity_code: entity.entityCode,
        entity_label: entity.label,
        region: entity.region,
        date: new Date(e.start * 1000).toISOString().slice(0, 10),
        start: new Date(e.start * 1000).toISOString(),
        duration_seconds: e.duration,
        datasource: e.datasource,
        score: e.score,
        method: e.method,
    }));
}

async function main() {
    const all = [];
    for (const entity of ENTITIES) {
        try {
            const events = await fetchEvents(entity);
            console.log(`[ioda] ${entity.label}: ${events.length} outage events`);
            all.push(...events);
        } catch (err) {
            console.warn(`[ioda] ${entity.label} failed: ${err.message}`);
        }
    }
    if (all.length === 0) throw new Error('No IODA events fetched for any entity');

    all.sort((a, b) => a.start.localeCompare(b.start));
    const out = {
        generated_at: new Date().toISOString(),
        source: 'IODA — Internet Outage Detection & Analysis (Georgia Tech)',
        source_url: 'https://ioda.inetintel.cc.gatech.edu/country/PS',
        license: 'free-with-attribution',
        attribution_text: 'Internet outage events: IODA, Internet Intelligence Lab, Georgia Tech (ioda.inetintel.cc.gatech.edu).',
        count: all.length,
        date_range: { earliest: all[0]?.date || null, latest: all[all.length - 1]?.date || null },
        entities: ENTITIES.map((e) => e.label),
        data: all,
    };
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[ioda] DONE — ${all.length} outage events, ` +
        `${out.date_range.earliest} → ${out.date_range.latest} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[ioda] FATAL:', err.message);
    process.exit(1);
});
