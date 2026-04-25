/**
 * OCHA Humanitarian Programme Cycle (HPC) — Palestine.
 *
 * Pulls two related datasets in one pass:
 *
 *   - hrp-projects-pse:    Response Plan projects (CSV per year)
 *                          → public/data/response/hrp-projects-<year>.json
 *   - opt-humanitarian-needs: Annual needs assessments (XLSX per year)
 *                          → public/data/response/humanitarian-needs-<year>.json
 *
 * The OCHA Financial Tracking Service (FTS) funding dataset is NOT
 * included here because scripts/sources/unfts.js already pulls richer
 * per-flow data via the FTS API.
 *
 * Output (plus manifest.json):
 *   public/data/response/<file>.json
 *   public/data/response/manifest.json
 *
 * Sources:
 *   https://data.humdata.org/dataset/hrp-projects-pse
 *   https://data.humdata.org/dataset/opt-humanitarian-needs
 *
 * License: CC-BY-IGO / CC-BY (varies per dataset).
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Papa from 'papaparse';
import XLSX from 'xlsx';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUT_DIR = path.join(REPO_ROOT, 'public/data/response');
const HDX_BASE = 'https://data.humdata.org/api/3/action';

async function fetchPackage(slug) {
    const r = await fetchJSONWithRetry(`${HDX_BASE}/package_show?id=${slug}`,
        { timeout: 30000 });
    return r.result;
}

async function downloadBuf(url) {
    const r = await fetch(url, {
        headers: { 'User-Agent': 'palestine-data-backend/1.0' },
        redirect: 'follow',
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return Buffer.from(await r.arrayBuffer());
}

function parseCsvText(text) {
    return Papa.parse(text, { header: true, skipEmptyLines: true }).data;
}

function parseXlsxBuf(buf) {
    const wb = XLSX.read(buf, { type: 'buffer' });
    // Many HPC needs XLSX files have multiple sheets; flatten each into
    // {sheet, rows}. Caller decides how to surface.
    return wb.SheetNames.map(name => ({
        sheet: name,
        rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null }),
    }));
}

function inferYear(name) {
    const s = String(name);
    // Full 4-digit year first (oPt_hpc_needs_2023.xlsx → 2023)
    const m4 = s.match(/(20\d\d)/);
    if (m4) return parseInt(m4[1], 10);
    // HRP project file codes: hpse23/hpse22/fpse21/etc → 2023/2022/2021
    const m2 = s.match(/[hf]pse(\d{2})\b/i);
    if (m2) return 2000 + parseInt(m2[1], 10);
    return null;
}

async function processHrp() {
    console.log('[ocha-hpc] HRP projects...');
    const pkg = await fetchPackage('hrp-projects-pse');
    const out = [];
    for (const res of pkg.resources || []) {
        if (!/csv/i.test(res.format)) continue;
        const year = inferYear(res.name);
        if (!year) continue;
        // Plan code distinguishes Humanitarian Response Plan (hpse) from
        // Flash Response (fpse). Both can publish for the same year, so
        // the filename has to carry the code.
        const codeMatch = String(res.name).match(/([hf]pse\d{2})/i);
        const code = codeMatch ? codeMatch[1].toLowerCase() : `unk${year}`;
        const text = (await downloadBuf(res.url)).toString('utf8');
        const rows = parseCsvText(text);
        const target = `hrp-projects-${code}.json`;
        await fs.writeFile(path.join(OUT_DIR, target), JSON.stringify({
            year,
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'OCHA Humanitarian Programme Cycle Tools (HPC Tools) via HDX (CC-BY-IGO).',
            row_count: rows.length,
            rows,
        }, null, 1));
        console.log(`  HRP ${year}: ${rows.length} projects → ${target}`);
        out.push({ kind: 'hrp_projects', year, file: target, rows: rows.length });
    }
    return out;
}

async function processNeeds() {
    console.log('[ocha-hpc] humanitarian needs...');
    const pkg = await fetchPackage('opt-humanitarian-needs');
    const out = [];
    for (const res of pkg.resources || []) {
        if (!/xlsx/i.test(res.format)) continue;
        const year = inferYear(res.name);
        if (!year) continue;
        const buf = await downloadBuf(res.url);
        const sheets = parseXlsxBuf(buf);
        const totalRows = sheets.reduce((acc, s) => acc + s.rows.length, 0);
        const target = `humanitarian-needs-${year}.json`;
        await fs.writeFile(path.join(OUT_DIR, target), JSON.stringify({
            year,
            source_dataset: res.name,
            source_url: res.url,
            attribution: 'OCHA Humanitarian Programme Cycle Tools (HPC Tools) via HDX (CC-BY).',
            sheet_count: sheets.length,
            row_count: totalRows,
            sheets,
        }, null, 1));
        console.log(`  needs ${year}: ${sheets.length} sheets, ${totalRows} rows → ${target}`);
        out.push({ kind: 'humanitarian_needs', year, file: target,
                   sheets: sheets.length, rows: totalRows });
    }
    return out;
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const hrp = await processHrp();
    const needs = await processNeeds();

    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({
        attribution: 'OCHA Humanitarian Programme Cycle Tools (HPC Tools) via HDX.',
        fetched_at: new Date().toISOString(),
        hrp_projects: hrp,
        humanitarian_needs: needs,
    }, null, 2));
    console.log(`[ocha-hpc] wrote ${hrp.length + needs.length} file(s) total`);
}

main().catch(err => {
    console.error('[ocha-hpc] fatal:', err);
    process.exit(1);
});
