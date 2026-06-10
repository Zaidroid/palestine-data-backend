/**
 * WHO SSA — Surveillance System for Attacks on Health Care (oPt slice).
 *
 * Per-attack records against health care in the occupied Palestinian
 * territories: date, attack type, certainty, deaths/injuries, what was hit
 * (facilities / transport / personnel / supplies / patients) and
 * abduction/arrest/detention of health workers and patients.
 *
 * Complements Insecurity Insight (which aggregates news-based incidents) —
 * SSA is WHO's own verified surveillance, WHA 65.20 mandated.
 *
 * Source: HDX "surveillance-system-for-attacks-on-health-care-ssa-historic"
 * (CC-BY-IGO; archived dump ~2017 → 2021/22; the live extension is the
 * Power BI dashboard at extranet.who.int/ssa — Phase 2 scrape target).
 * Output: public/data/static/who-ssa-attacks.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(REPO_ROOT, 'public/data/static/who-ssa-attacks.json');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'surveillance-system-for-attacks-on-health-care-ssa-historic';

function excelDateToISO(serial) {
    if (!Number.isFinite(serial)) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
}

const yes = (v) => String(v || '').trim().toUpperCase() === 'YES';

async function main() {
    console.log('[who-ssa] discovering resources via CKAN...');
    const pkg = (await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`,
        { timeout: 30000 })).result;
    const xlsxRes = (pkg.resources || []).find((r) => /xlsx/i.test(r.format));
    if (!xlsxRes) throw new Error('No XLSX resource on SSA historic dataset');

    console.log(`[who-ssa] downloading ${xlsxRes.url}`);
    const res = await fetch(xlsxRes.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for SSA XLSX`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));

    const sheetName = wb.SheetNames.find((n) => /report/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });

    const records = rows
        .filter((r) => /palestin/i.test(r['Country / Territory'] || ''))
        .map((r) => ({
            id: `who-ssa-${r['Attack ID']}`,
            attack_id: r['Attack ID'],
            date: excelDateToISO(r['Attack Date']),
            attack_type: (r['Attack Type'] || '').trim() || null,
            certainty: r['Certainty Level'] || null,
            killed: Number.isFinite(r['Total Death']) ? r['Total Death'] : 0,
            injured: Number.isFinite(r['Total Injured']) ? r['Total Injured'] : 0,
            hit_facilities: yes(r['HC Facilities']),
            hit_transport: yes(r['HC Transport']),
            hit_personnel: yes(r['HC Personnel']),
            hit_supplies: yes(r['HC Supplies Assets']),
            hit_patients: yes(r['HC Patients']),
            facility_type: (r['Type of Facility'] || '').trim() || null,
            health_worker_abduction: yes(r['HW Abduction']),
            health_worker_arrest: yes(r['HW Arrest']),
            health_worker_detention: yes(r['HW Detention']),
        }))
        .filter((r) => r.date);

    records.sort((a, b) => a.date.localeCompare(b.date));
    const out = {
        generated_at: new Date().toISOString(),
        source: 'WHO Surveillance System for Attacks on Health Care (SSA), historic dump via HDX',
        source_url: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        live_dashboard: 'https://extranet.who.int/ssa',
        license: 'CC-BY-IGO',
        attribution_text: 'Attacks on health care: WHO SSA via HDX (CC-BY-IGO).',
        count: records.length,
        date_range: { earliest: records[0]?.date || null, latest: records[records.length - 1]?.date || null },
        total_killed: records.reduce((s, r) => s + r.killed, 0),
        total_injured: records.reduce((s, r) => s + r.injured, 0),
        data: records,
    };
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));

    // Also publish as an alternate source for /api/v1/incidents/healthcare
    // (?source=who_ssa) — same envelope + row schema as the AWSD shard.
    const shardRows = records.map((r) => ({
        incident_id: r.id,
        date: r.date,
        category: 'healthcare',
        country_iso: 'PSE',
        admin1: null,
        latitude: null,
        longitude: null,
        geo_precision: 'country',
        location_type: r.facility_type,
        perpetrator_type: null,
        perpetrator_name: null,
        weapon: null,
        event_description: r.attack_type,
        organisation_affected: null,
        victims: { killed: r.killed, injured: r.injured, kidnapped: 0,
            arrested: r.health_worker_arrest ? 1 : 0, threatened: 0, assaulted: 0 },
        certainty: r.certainty,
        source_dataset: 'WHO SSA historic dump',
        source_url: out.source_url,
    }));
    const shardPath = path.join(REPO_ROOT, 'public/data/insecurity-insight/incidents-healthcare-who-ssa.json');
    await fs.mkdir(path.dirname(shardPath), { recursive: true });
    await fs.writeFile(shardPath, JSON.stringify({
        source_dataset: PACKAGE_SLUG,
        source_url: out.source_url,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        attribution: out.attribution_text,
        organisation: 'World Health Organization',
        license_id: 'cc-by-igo',
        fetched_at: out.generated_at,
        row_count: shardRows.length,
        rows: shardRows,
    }, null, 2));

    console.log(
        `[who-ssa] DONE — ${records.length} oPt attacks on health care, ` +
        `${out.date_range.earliest} → ${out.date_range.latest}, ` +
        `${out.total_killed} killed / ${out.total_injured} injured → ${OUTPUT} (+ incidents shard)`
    );
}

main().catch((err) => {
    console.error('[who-ssa] FATAL:', err.message);
    process.exit(1);
});
