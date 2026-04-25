#!/usr/bin/env node

/**
 * A4 — HDX auto-discovery.
 *
 * Once a day, query HDX CKAN for Palestine-tagged datasets and diff
 * against the URLs / dataset slugs we already mention in sources.json
 * + scripts/. New finds land in public/data/discovered-sources-pending.json
 * for human review (no auto-ingest).
 *
 * Reviewer workflow:
 *   1. Open the pending file
 *   2. For each entry, decide: add fetcher | mark wontfix | leave
 *   3. To dismiss permanently, append the dataset id to data/hdx-discovery-ignored.json
 *
 * The script is idempotent: re-running with no HDX changes produces the
 * same file (entries sorted by dataset id).
 *
 * Source: https://data.humdata.org/api/3/action/package_search
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchJSONWithRetry } from './utils/fetch-with-retry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const HDX_BASE = 'https://data.humdata.org/api/3/action';
const SOURCES_JSON = path.join(REPO_ROOT, 'src/api/data/sources.json');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');
const IGNORE_PATH = path.join(REPO_ROOT, 'data/hdx-discovery-ignored.json');
const OUT_PATH = path.join(REPO_ROOT, 'public/data/discovered-sources-pending.json');

// Page through HDX up to MAX_RESULTS. Palestine-tagged datasets are
// well under 1k as of 2026; 500 is plenty of headroom.
const PAGE_SIZE = 100;
const MAX_RESULTS = 500;

// Skip datasets that are too small (likely stubs) or last touched too
// long ago to be worth wiring up as a recurring fetcher.
const MIN_RESOURCES = 1;
const MAX_AGE_DAYS_SINCE_UPDATE = 730;  // 2 years


/**
 * Walk the registered sources + every script for HDX dataset slugs.
 * Returns a Set of slugs (normalized lowercased).
 *
 * Three signals:
 *  1. URL form: `data.humdata.org/dataset/<slug>` anywhere in source files
 *  2. Object-literal form: `id: '<slug>'` inside JS (used by
 *     scripts/fetch-hdx-ckan-data.js's PRIORITY_HDX_DATASETS registry)
 *  3. Operator-maintained ignored list (data/hdx-discovery-ignored.json)
 */
async function loadKnownSlugs() {
    const known = new Set();
    const urlRe = /data\.humdata\.org\/dataset\/([a-z0-9-]+)/gi;
    // Slug-shape literal inside JS: id: 'slug-with-hyphens'
    const litRe = /\bid:\s*['"]([a-z][a-z0-9-]{6,80})['"]/g;

    async function harvest(filePath) {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            for (const m of raw.matchAll(urlRe)) known.add(m[1].toLowerCase());
            for (const m of raw.matchAll(litRe)) known.add(m[1].toLowerCase());
        } catch {
            // ignore unreadable
        }
    }

    await harvest(SOURCES_JSON);

    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') continue;
                await walk(full);
                continue;
            }
            if (!entry.name.endsWith('.js')) continue;
            await harvest(full);
        }
    }
    await walk(SCRIPTS_DIR);

    return known;
}


/**
 * Operator-maintained dismissal list — slugs we've decided are not
 * worth wiring up. Format: { ignored: ["slug-a", "slug-b"], updated_at: "..." }
 */
async function loadIgnored() {
    try {
        const raw = await fs.readFile(IGNORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return new Set((parsed.ignored || []).map(s => s.toLowerCase()));
    } catch {
        return new Set();
    }
}


/**
 * Ask CKAN for Palestine-tagged datasets. The fq filter mirrors what
 * fetch-hdx-ckan-data.js uses elsewhere so coverage stays consistent.
 */
async function fetchPalestineDatasets() {
    const fq = '(locations:pse OR locations:palestine OR groups:pse)';
    const all = [];
    for (let start = 0; start < MAX_RESULTS; start += PAGE_SIZE) {
        const url = `${HDX_BASE}/package_search?fq=${encodeURIComponent(fq)}` +
            `&rows=${PAGE_SIZE}&start=${start}`;
        let response;
        try {
            response = await fetchJSONWithRetry(url, { timeout: 20000 });
        } catch (e) {
            console.error(`[discover-hdx] page ${start} failed: ${e.message}`);
            break;
        }
        const results = response?.result?.results;
        if (!Array.isArray(results) || results.length === 0) break;
        all.push(...results);
        if (results.length < PAGE_SIZE) break;
    }
    return all;
}


function summarize(dataset) {
    const resources = dataset.resources || [];
    const formats = [...new Set(
        resources.map(r => (r.format || '').toUpperCase()).filter(Boolean)
    )].sort();
    const updatedAt = dataset.metadata_modified || dataset.last_modified || null;
    const tags = (dataset.tags || []).map(t => t.display_name || t.name).filter(Boolean);
    return {
        slug: dataset.name,
        title: dataset.title || dataset.name,
        organization: dataset.organization?.title || dataset.organization?.name || null,
        landing_page: `https://data.humdata.org/dataset/${dataset.name}`,
        license_id: dataset.license_id || null,
        last_updated: updatedAt,
        resource_count: resources.length,
        formats,
        tags: tags.slice(0, 8),
        notes: (dataset.notes || '').slice(0, 400),
    };
}


function isWorthSurfacing(summary) {
    if (summary.resource_count < MIN_RESOURCES) return false;
    if (summary.last_updated) {
        const ageMs = Date.now() - new Date(summary.last_updated).getTime();
        if (ageMs > MAX_AGE_DAYS_SINCE_UPDATE * 86400000) return false;
    }
    return true;
}


async function main() {
    console.log('[discover-hdx] loading known slugs...');
    const known = await loadKnownSlugs();
    const ignored = await loadIgnored();
    console.log(`[discover-hdx] known: ${known.size} slug(s); ignored: ${ignored.size}`);

    console.log('[discover-hdx] querying HDX CKAN for Palestine datasets...');
    const datasets = await fetchPalestineDatasets();
    console.log(`[discover-hdx] HDX returned ${datasets.length} dataset(s)`);

    const candidates = [];
    for (const ds of datasets) {
        const slug = (ds.name || '').toLowerCase();
        if (!slug) continue;
        if (known.has(slug) || ignored.has(slug)) continue;
        const summary = summarize(ds);
        if (!isWorthSurfacing(summary)) continue;
        candidates.push(summary);
    }
    candidates.sort((a, b) => a.slug.localeCompare(b.slug));

    const output = {
        generated_at: new Date().toISOString(),
        hdx_datasets_seen: datasets.length,
        known_slugs: known.size,
        ignored_slugs: ignored.size,
        new_candidates: candidates.length,
        candidates,
    };

    await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
    await fs.writeFile(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
    console.log(
        `[discover-hdx] wrote ${candidates.length} candidate(s) to ${
            path.relative(REPO_ROOT, OUT_PATH)
        }`
    );
    if (candidates.length) {
        console.log('  first few:', candidates.slice(0, 5).map(c => c.slug).join(', '));
    }
}

main().catch(err => {
    console.error('[discover-hdx] fatal:', err);
    process.exit(1);
});
