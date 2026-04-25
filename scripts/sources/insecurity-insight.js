/**
 * Insecurity Insight — incident-level data on attacks against healthcare,
 * aid workers, education, food/water systems, plus protection-in-danger
 * and conflict-related sexual violence. Hosted on HDX as 16 XLSX files.
 *
 * Output:
 *   public/data/insecurity-insight/incidents.json   — flat array, all categories
 *   public/data/insecurity-insight/by-category.json — counts/index per category
 *   public/data/insecurity-insight/manifest.json    — fetch metadata
 *
 * Each row is normalized to a canonical schema; sub-dataset-specific
 * fields land in `details` so we never lose information.
 *
 * Source: https://data.humdata.org/dataset/opt-violent-and-threatening-incidents-against-healthcare
 * License: CC-BY 4.0 (per HDX page).
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/insecurity-insight');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const PACKAGE_SLUG = 'opt-violent-and-threatening-incidents-against-healthcare';

// Map sub-dataset filename patterns → canonical category. Order matters
// (first match wins) — Gaza-specific food file must come before generic.
const FILENAME_TO_CATEGORY = [
    [/aid[- ]?worker[- ]?kika/i,            'aid_worker'],
    [/attacks[- ]?on[- ]?health[- ]?care/i, 'healthcare'],
    [/shcc[- ]?health[- ]?care/i,           'healthcare'],   // SHCC reports = same domain
    [/conflict[- ]?related[- ]?sexual[- ]?violence|crsv/i, 'sexual_violence'],
    [/education[- ]?in[- ]?danger/i,        'education'],
    [/explosive[- ]?weapons/i,              'explosive_weapons'],
    [/protection[- ]?in[- ]?danger/i,       'protection'],
    [/food[- ]?systems/i,                   'food_systems'],
    [/water[- ]?systems/i,                  'water_systems'],
    [/overview/i,                           'overview'],
];

function categoryFor(filename) {
    for (const [re, cat] of FILENAME_TO_CATEGORY) {
        if (re.test(filename)) return cat;
    }
    return 'other';
}

// Excel stores dates as days since 1899-12-30 (Lotus 1-2-3 quirk).
// 1 → 1899-12-31; 60 → 1900-02-28; etc.
function excelSerialToISO(serial) {
    if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
    if (serial < 10000 || serial > 200000) return null;  // sanity bound
    const ms = (serial - 25569) * 86400000;  // 25569 = days from 1899-12-30 to epoch
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function isoOrPassthrough(v) {
    if (typeof v === 'number') return excelSerialToISO(v);
    if (typeof v === 'string') {
        // Skip HXL hashtag header row ("#date", "#country+code", …)
        if (v.startsWith('#')) return null;
        // Already an ISO-ish string
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[1]}-${m[2]}-${m[3]}`;
        // YYYY-MM (older SHCC files use month-precision dates) — pin to mid-month
        const mYM = v.match(/^(\d{4})-(\d{2})$/);
        if (mYM) return `${mYM[1]}-${mYM[2]}-15`;
        // dd/mm/yyyy or dd-mm-yyyy
        const m2 = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
        if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`;
    }
    return null;
}

function num(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

// Sum every column whose name matches a victim-count signature. The
// canonical schema keeps the headline counts; the full raw row goes in
// `details` so consumers can drill down.
const VICTIM_FIELDS = {
    killed:      /(workers?[\s_]killed|health[\s_]worker[\s_]killed|fatalities|deaths|killed( in captivity)?$)/i,
    injured:     /(workers?[\s_]injured|health[\s_]worker[\s_]injured|injuries|wounded)/i,
    kidnapped:   /(workers?[\s_]kidnapped|health[\s_]worker[\s_]kidnapped|abducted)/i,
    arrested:    /(workers?[\s_]arrested|health[\s_]worker[\s_]arrested|detained)/i,
    threatened:  /(workers?[\s_]threatened|threats)/i,
    assaulted:   /(workers?[\s_]assaulted|health[\s_]worker[\s_]assaulted|assault(ed)?$)/i,
};

function rollupVictims(row) {
    const out = {};
    for (const [bucket, re] of Object.entries(VICTIM_FIELDS)) {
        let total = 0;
        let any = false;
        for (const [k, v] of Object.entries(row)) {
            if (!re.test(k)) continue;
            const n = num(v);
            if (n == null) continue;
            total += n;
            any = true;
        }
        out[bucket] = any ? total : null;
    }
    return out;
}

// Stable id from category + date + lat/lng + perpetrator + first-meaningful
// fields. Hash to 16 hex chars (64 bits) — fits safely in JS Number/SQLite.
function deriveIncidentId(category, row, dateISO) {
    const key = [
        category,
        dateISO || '',
        row['Latitude'] || '',
        row['Longitude'] || '',
        row['Reported Perpetrator Name'] || '',
        row['Location of Incident'] || '',
        row['Event Description']?.slice(0, 80) || '',
        row['SiND Event ID'] || '',
    ].join('|');
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 16);
}

// Old SHCC files (2019-2021) use slightly different headers — normalize
// by reading whichever variant exists.
function pick(row, ...keys) {
    for (const k of keys) {
        if (row[k] != null && row[k] !== '') return row[k];
    }
    return null;
}

function normalize(row, category, sourceUrl, sourceDataset) {
    const rawDate = pick(row, 'Date', 'Incident date', 'incident date', 'Event Date');
    const dateISO = isoOrPassthrough(rawDate);
    const lat = num(pick(row, 'Latitude', 'latitude'));
    const lng = num(pick(row, 'Longitude', 'longitude'));
    const victims = rollupVictims(row);
    const incident = {
        incident_id: deriveIncidentId(category, row, dateISO),
        date: dateISO,
        category,
        country_iso: pick(row, 'Country ISO', 'Country') || 'PSE',
        admin1: pick(row, 'Admin 1', 'admin 1', 'Province'),
        latitude: lat,
        longitude: lng,
        geo_precision: pick(row, 'Geo Precision', 'geo precision'),
        location_type: pick(row, 'Location of Incident', 'Location'),
        perpetrator_type: pick(row, 'Reported Perpetrator', 'Perpetrator', 'Perpetrator '),
        perpetrator_name: pick(row, 'Reported Perpetrator Name', 'Name of perpetrator',
                               'Name of perpetrator '),
        weapon: pick(row, 'Weapon Carried/Used', 'Weapons use', 'Weapon'),
        event_description: pick(row, 'Event Description', 'Description', 'Incident description'),
        organisation_affected: pick(row, 'Organisation Affected', 'Organization Affected',
                                    'Org affected'),
        victims,
        source_dataset: sourceDataset,
        source_url: sourceUrl,
        // Preserve the full raw row so we never lose category-specific
        // fields (kidnapping outcomes, polio-related flags, etc.)
        details: row,
    };
    return incident;
}

async function fetchPackage() {
    const url = `${HDX_BASE}/package_show?id=${PACKAGE_SLUG}`;
    const json = await fetchJSONWithRetry(url, { timeout: 30000 });
    return json.result;
}

async function downloadXLSX(url) {
    const r = await fetch(url, { headers: { 'User-Agent': 'palestine-data-backend/1.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

function parseXLSX(buf) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    console.log('[insecurity-insight] discovering resources via CKAN...');
    const pkg = await fetchPackage();
    const xlsxResources = (pkg.resources || []).filter(r => /xlsx/i.test(r.format));
    console.log(`[insecurity-insight] ${xlsxResources.length} XLSX resources found`);

    const allIncidents = [];
    const perFile = [];
    let errors = 0;

    for (const res of xlsxResources) {
        const filename = res.name || res.url.split('/').pop();
        const category = categoryFor(filename);
        try {
            const buf = await downloadXLSX(res.url);
            const rows = parseXLSX(buf);
            const normalized = rows
                .map(r => normalize(r, category, res.url, filename))
                .filter(i => i.date);  // drop rows where date couldn't be parsed
            allIncidents.push(...normalized);
            perFile.push({
                filename, category,
                rows_in_file: rows.length,
                normalized_count: normalized.length,
                size_kb: Math.round((res.size || 0) / 1024),
                last_modified: res.last_modified || res.created || null,
                url: res.url,
            });
            console.log(`  [${category}] ${filename}: ${normalized.length}/${rows.length} rows kept`);
        } catch (e) {
            errors++;
            console.error(`  ERROR ${filename}: ${e.message}`);
            perFile.push({ filename, category, error: e.message, url: res.url });
        }
    }

    // Dedup on incident_id (some rows may legitimately appear in two
    // sub-datasets — e.g. an attack on a hospital that also injured an
    // aid worker). Keep the first occurrence (canonical category by
    // discovery order).
    const seen = new Set();
    const deduped = [];
    let dupCount = 0;
    for (const inc of allIncidents) {
        if (seen.has(inc.incident_id)) { dupCount++; continue; }
        seen.add(inc.incident_id);
        deduped.push(inc);
    }
    deduped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Per-category index
    const byCategory = {};
    for (const inc of deduped) {
        if (!byCategory[inc.category]) {
            byCategory[inc.category] = { total: 0, by_year: {}, total_victims: { killed: 0, injured: 0, kidnapped: 0, arrested: 0 } };
        }
        const c = byCategory[inc.category];
        c.total++;
        const year = inc.date.slice(0, 4);
        c.by_year[year] = (c.by_year[year] || 0) + 1;
        for (const k of ['killed', 'injured', 'kidnapped', 'arrested']) {
            c.total_victims[k] += inc.victims[k] || 0;
        }
    }

    const incidentsPath = path.join(OUT_DIR, 'incidents.json');
    const byCategoryPath = path.join(OUT_DIR, 'by-category.json');
    const manifestPath = path.join(OUT_DIR, 'manifest.json');

    await fs.writeFile(incidentsPath, JSON.stringify(deduped, null, 1));
    await fs.writeFile(byCategoryPath, JSON.stringify(byCategory, null, 2));

    // Per-category shards for fast API serving — avoids reading the
    // 38MB combined file on every request.
    for (const cat of Object.keys(byCategory)) {
        const slice = deduped.filter(i => i.category === cat);
        await fs.writeFile(
            path.join(OUT_DIR, `incidents-${cat.replace(/_/g, '-')}.json`),
            JSON.stringify(slice, null, 1)
        );
    }
    await fs.writeFile(manifestPath, JSON.stringify({
        source_package: PACKAGE_SLUG,
        source_landing: `https://data.humdata.org/dataset/${PACKAGE_SLUG}`,
        organisation: pkg.organization?.title || 'Insecurity Insight',
        license_id: pkg.license_id || 'CC-BY-4.0',
        attribution: 'Insecurity Insight via HDX (CC-BY-4.0)',
        fetched_at: new Date().toISOString(),
        package_last_modified: pkg.metadata_modified || null,
        files: perFile,
        rows_total_kept: deduped.length,
        rows_duplicate_dropped: dupCount,
        files_with_errors: errors,
    }, null, 2));

    console.log(`[insecurity-insight] wrote ${deduped.length} incidents (${dupCount} dups dropped) to ${path.relative(REPO_ROOT, incidentsPath)}`);
}

main().catch(err => {
    console.error('[insecurity-insight] fatal:', err);
    process.exit(1);
});
