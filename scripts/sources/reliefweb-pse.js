/**
 * ReliefWeb — humanitarian reports/documents for Palestine.
 *
 * Metadata for every report filed under primary_country=PSE: OCHA flash
 * updates and sitreps, WHO/UNRWA/UNICEF situation reports, assessments,
 * NGO updates — title, date, source org, format, themes, and a link to the
 * document. The single richest "documents" feed for Palestine, reaching
 * back decades.
 *
 * REQUIRES a registered appname (free): https://apidoc.reliefweb.int/parameters#appname
 * Set RELIEFWEB_APPNAME in the environment; the fetcher skips gracefully
 * when unset so the pipeline doesn't fail.
 *
 * Source: api.reliefweb.int v2. License varies per document; metadata is
 * freely redistributable with attribution to ReliefWeb.
 * Updated: continuous.
 * Output: public/data/documents/reliefweb-reports.json
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from '../utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'public/data/documents');
const OUTPUT = path.join(OUTPUT_DIR, 'reliefweb-reports.json');

const APPNAME = process.env.RELIEFWEB_APPNAME;
const API = 'https://api.reliefweb.int/v2/reports';
const PAGE_SIZE = 1000;       // API max
const MAX_REPORTS = 20000;    // safety cap per run

async function fetchPage(offset) {
    const body = {
        appname: APPNAME,
        filter: { field: 'primary_country.iso3', value: 'pse' },
        fields: { include: ['title', 'date.created', 'date.original', 'source.name', 'source.shortname', 'format.name', 'theme.name', 'language.code', 'url', 'origin'] },
        sort: ['date.original:desc'],
        limit: PAGE_SIZE,
        offset,
    };
    return fetchJSONWithRetry(`${API}?appname=${encodeURIComponent(APPNAME)}`, {
        timeout: 60000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function main() {
    if (!APPNAME) {
        console.log('[reliefweb] RELIEFWEB_APPNAME not set — skipping (register at https://apidoc.reliefweb.int/parameters#appname)');
        return;
    }

    const records = [];
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, MAX_REPORTS); offset += PAGE_SIZE) {
        const page = await fetchPage(offset);
        total = page.totalCount ?? 0;
        const items = page.data || [];
        if (items.length === 0) break;
        for (const item of items) {
            const f = item.fields || {};
            records.push({
                id: `reliefweb-${item.id}`,
                date: (f.date?.original || f.date?.created || '').slice(0, 10) || null,
                title: f.title,
                source: (f.source || []).map((s) => s.shortname || s.name).join(', ') || null,
                format: f.format?.[0]?.name || null,
                themes: (f.theme || []).map((t) => t.name),
                language: f.language?.[0]?.code || null,
                url: f.url,
                origin: f.origin || null,
            });
        }
        console.log(`[reliefweb] ${records.length}/${Math.min(total, MAX_REPORTS)}`);
    }

    const dates = records.map((r) => r.date).filter(Boolean).sort();
    const out = {
        generated_at: new Date().toISOString(),
        source: 'ReliefWeb (OCHA)',
        source_url: 'https://reliefweb.int/updates?advanced-search=%28C181%29',
        license: 'metadata-free-with-attribution; per-document licenses vary',
        attribution_text: 'Report metadata: ReliefWeb (reliefweb.int), OCHA.',
        count: records.length,
        total_upstream: total,
        date_range: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
        data: records,
    };
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify(out, null, 2));
    console.log(
        `[reliefweb] DONE — ${records.length} report records (of ${total} upstream), ` +
        `${out.date_range.earliest} → ${out.date_range.latest} → ${OUTPUT}`
    );
}

main().catch((err) => {
    console.error('[reliefweb] FATAL:', err.message);
    process.exit(1);
});
