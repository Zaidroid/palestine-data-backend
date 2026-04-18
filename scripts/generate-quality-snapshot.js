#!/usr/bin/env node
/**
 * Pre-compute the data-quality snapshot for /api/v1/quality.
 *
 * Reading every all-data.json at request time blows past the 512MB container
 * limit because each JSON parse holds ~3x the file size in V8 objects, and
 * 16 categories × ~10MB each ≈ 480MB on top of the already-loaded search
 * index. Generate the snapshot offline (one category at a time), write it to
 * public/data/unified/quality.json, and serve it from there.
 *
 * Run:
 *   node scripts/generate-quality-snapshot.js
 *
 * Wire into the data pipeline by appending this to scripts/update-all-data.sh
 * after populate-unified-data.js completes.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const UNIFIED_DIR = path.join(ROOT, 'public/data/unified');
const MANIFEST_PATH = path.join(UNIFIED_DIR, 'unified-manifest.json');
const OUT_PATH = path.join(UNIFIED_DIR, 'quality.json');

function regionOf(rec) {
    return rec?.location?.region || rec?.location?.governorate || 'Unknown';
}

const STALE_THRESHOLD_DAYS = 90;

function dateOf(rec) {
    const d = rec?.date || rec?.event_date || rec?.timestamp || rec?.pubDate || null;
    if (!d) return null;
    const t = Date.parse(d);
    return Number.isFinite(t) ? t : null;
}

async function main() {
    let manifest = { categories: {}, generated_at: null };
    try {
        manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    } catch {
        // proceed without manifest
    }

    const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
    const categories = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => name !== 'snapshots');

    const perCategory = {};
    for (const cat of categories) {
        const file = path.join(UNIFIED_DIR, cat, 'all-data.json');
        const metaFile = path.join(UNIFIED_DIR, cat, 'metadata.json');
        let payload;
        try {
            payload = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch {
            continue;
        }
        // metadata.json is small and is rewritten on every pipeline run; prefer it
        // for governance fields that may not yet be in the (much larger) all-data.json.
        let sidecar = {};
        try {
            sidecar = JSON.parse(await fs.readFile(metaFile, 'utf8'));
        } catch {
            // sidecar is optional
        }
        const data = payload.data || [];
        const total = data.length;
        const byRegion = {};
        let unknown = 0;
        let latestRecordTs = null;
        for (const rec of data) {
            const r = regionOf(rec);
            byRegion[r] = (byRegion[r] || 0) + 1;
            if (r === 'Unknown') unknown += 1;
            const t = dateOf(rec);
            if (t !== null && (latestRecordTs === null || t > latestRecordTs)) {
                latestRecordTs = t;
            }
        }
        const lastUpdated =
            payload?.metadata?.last_updated ||
            manifest.categories?.[cat]?.last_updated ||
            null;
        const frozenAt = payload?.metadata?.frozen_at || sidecar?.frozen_at || null;
        const active = (payload?.metadata?.active ?? sidecar?.active) !== false;
        const latestRecordAt = latestRecordTs !== null ? new Date(latestRecordTs).toISOString() : null;
        const freshnessDays = latestRecordTs !== null
            ? Math.floor((Date.now() - latestRecordTs) / 86_400_000)
            : null;
        // Frozen snapshots aren't stale — they're explicitly historical.
        const stale = frozenAt
            ? false
            : (freshnessDays !== null && freshnessDays > STALE_THRESHOLD_DAYS);
        perCategory[cat] = {
            total,
            unknown_region_pct: total ? Number(((unknown / total) * 100).toFixed(2)) : 0,
            coverage_by_region: byRegion,
            last_fetch_success_at: lastUpdated,
            latest_record_at: latestRecordAt,
            freshness_days_since_latest: freshnessDays,
            stale,
            active,
            frozen_at: frozenAt,
        };
        // Help V8 reclaim before parsing the next file.
        payload = null;
        console.log(`[quality] ${cat}: ${total} records, unknown=${perCategory[cat].unknown_region_pct}%`);
    }

    const out = {
        generated_at: new Date().toISOString(),
        manifest_generated_at: manifest.generated_at || null,
        categories: perCategory,
    };
    await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(`[quality] wrote ${OUT_PATH}`);
}

main().catch((e) => {
    console.error('[quality] FATAL', e);
    process.exit(1);
});
