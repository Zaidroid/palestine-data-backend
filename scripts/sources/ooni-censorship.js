/**
 * OONI — internet censorship / interference measurements for Palestine.
 *
 * Daily aggregation of OONI Probe web_connectivity tests run from Palestine:
 * per day, counts of OK vs anomaly (possible interference) vs confirmed
 * (verified blocking) vs failure measurements. Complements IODA (which
 * detects connectivity *outages*) with a *censorship* signal — both feed the
 * connectivity category.
 *
 * Source: https://api.ooni.org (OONI, free with attribution, CC-BY-SA-style).
 * Updated: continuous.
 * Output: public/data/connectivity/ooni-censorship.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'public/data/connectivity');
const OUTPUT = path.join(OUTPUT_DIR, 'ooni-censorship.json');

const SINCE = '2012-12-01'; // OONI launch; API returns whatever exists
const API = 'https://api.ooni.org/api/v1/aggregation';

async function main() {
    const until = new Date().toISOString().slice(0, 10);
    const url = `${API}?probe_cc=PS&since=${SINCE}&until=${until}` +
        `&axis_x=measurement_start_day&test_name=web_connectivity`;
    console.log(`[ooni] fetching daily web_connectivity aggregation for PS...`);
    const body = await fetchJSONWithRetry(url, { timeout: 90000 });
    const result = body.result || [];

    const records = result
        .filter((r) => r.measurement_start_day && r.measurement_count > 0)
        .map((r) => ({
            id: `ooni-ps-${r.measurement_start_day}`,
            date: r.measurement_start_day,
            measurements: r.measurement_count,
            ok: r.ok_count,
            anomaly: r.anomaly_count,        // possible interference
            confirmed: r.confirmed_count,    // verified blocking
            failure: r.failure_count,
            anomaly_rate: r.measurement_count ? +(r.anomaly_count / r.measurement_count).toFixed(4) : 0,
        }));

    const dates = records.map((r) => r.date).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'OONI — Open Observatory of Network Interference',
        source_url: 'https://explorer.ooni.org/country/PS',
        license: 'free-with-attribution',
        attribution_text: 'Censorship measurements: OONI (ooni.org), CC-BY-SA.',
        count: records.length,
        date_range: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
        total_measurements: records.reduce((s, r) => s + r.measurements, 0),
        total_anomalies: records.reduce((s, r) => s + r.anomaly, 0),
        total_confirmed_blocked: records.reduce((s, r) => s + r.confirmed, 0),
        data: records,
    };
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[ooni] DONE — ${records.length} days (${out.date_range.earliest} → ${out.date_range.latest}), ` +
        `${out.total_measurements.toLocaleString()} measurements, ` +
        `${out.total_anomalies.toLocaleString()} anomalies → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[ooni] FATAL:', err.message);
    process.exit(1);
});
