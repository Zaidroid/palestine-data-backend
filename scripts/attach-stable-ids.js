/**
 * Post-pipeline sweep: ensure every unified record has a deterministic
 * stable_id, collapse content-identical duplicates, and emit a lookup
 * index per category.
 *
 * Runs after populate-unified-data.js. Several code paths (B'Tselem merge,
 * westbank, infrastructure merge, goodshepherd) bypass UnifiedPipeline and
 * write directly, so this sweep is the guarantee that every record on disk
 * carries a stable_id by the time the API reads it.
 *
 * Deduplication: upstream sources overlap (the same WASH indicator row can
 * appear in three different HDX dataset packages), which used to inflate
 * categories ~3x (water: 71,969 rows for 24,778 facts). Records whose
 * fingerprints match are collapsed into the first occurrence; their distinct
 * `sources` attributions are merged so multi-dataset corroboration is kept.
 *
 * Handles both category layouts: all-data.json and partition-only categories
 * (large ones whose all-data.json the optimizer removed). Partition files are
 * processed in sorted filename order — the same order fileService.js uses to
 * reassemble them — so stable-id-index positions stay correct.
 *
 * Emits `public/data/unified/<category>/stable-id-index.json`:
 *   { generated_at, category, total, deduped, collisions, index: { <stable_id>: <pos> } }
 *
 * Idempotent.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachStableIds, buildStableIdIndex } from './utils/stable-id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../public/data/unified');

function sourceKey(s) {
    if (!s || typeof s !== 'object') return JSON.stringify(s);
    const { fetched_at, ...rest } = s;
    return JSON.stringify(rest, Object.keys(rest).sort());
}

/**
 * Collapse records with identical stable_ids. The first occurrence wins;
 * distinct `sources` entries from dropped duplicates are merged into it.
 */
function dedupeByStableId(records) {
    const byId = new Map();
    const out = [];
    for (const rec of records) {
        const prev = byId.get(rec.stable_id);
        if (!prev) {
            byId.set(rec.stable_id, rec);
            out.push(rec);
            continue;
        }
        if (Array.isArray(rec.sources) && rec.sources.length) {
            const seen = new Set((prev.sources || []).map(sourceKey));
            for (const s of rec.sources) {
                if (!seen.has(sourceKey(s))) {
                    if (!Array.isArray(prev.sources)) prev.sources = [];
                    prev.sources.push(s);
                    seen.add(sourceKey(s));
                }
            }
        }
    }
    return { records: out, deduped: records.length - out.length };
}

async function listCategoryDirs() {
    const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
    return entries
        .filter((e) => e.isDirectory() && e.name !== 'snapshots')
        .map((e) => e.name)
        .sort();
}

async function readJson(p) {
    return JSON.parse(await fs.readFile(p, 'utf-8'));
}

async function processCategory(category) {
    const catDir = path.join(UNIFIED_DIR, category);
    const allDataPath = path.join(catDir, 'all-data.json');

    let layout = 'all-data';
    let partFiles = [];
    try {
        await fs.access(allDataPath);
    } catch {
        layout = 'partitions';
        try {
            partFiles = (await fs.readdir(path.join(catDir, 'partitions')))
                .filter((f) => f.endsWith('.json') && f !== 'index.json')
                .sort();
        } catch {
            return null;
        }
        if (partFiles.length === 0) return null;
    }

    let result;
    if (layout === 'all-data') {
        const doc = await readJson(allDataPath);
        const records = Array.isArray(doc.data) ? doc.data : [];
        attachStableIds(records);
        const { records: clean, deduped } = dedupeByStableId(records);
        if (doc.metadata && typeof doc.metadata.total_records === 'number') {
            doc.metadata.total_records = clean.length;
        }
        await fs.writeFile(allDataPath, JSON.stringify({ ...doc, data: clean }, null, 2), 'utf-8');
        result = { records: clean, deduped };
    } else {
        // Concatenate in the same sorted order fileService.js reads them,
        // dedupe globally, then write each file back with its survivors.
        const docs = [];
        const all = [];
        for (const f of partFiles) {
            const p = path.join(catDir, 'partitions', f);
            const doc = await readJson(p);
            const records = Array.isArray(doc.data) ? doc.data : [];
            docs.push({ path: p, doc, records });
            all.push(...records);
        }
        attachStableIds(all);
        const seen = new Set();
        let deduped = 0;
        const keep = new Map(); // stable_id -> kept record (for source merging)
        for (const rec of all) {
            if (seen.has(rec.stable_id)) {
                deduped++;
                const prev = keep.get(rec.stable_id);
                if (prev && Array.isArray(rec.sources)) {
                    const have = new Set((prev.sources || []).map(sourceKey));
                    for (const s of rec.sources) {
                        if (!have.has(sourceKey(s))) {
                            if (!Array.isArray(prev.sources)) prev.sources = [];
                            prev.sources.push(s);
                            have.add(sourceKey(s));
                        }
                    }
                }
                continue;
            }
            seen.add(rec.stable_id);
            keep.set(rec.stable_id, rec);
        }
        const survivors = [];
        const globalSeen = new Set();
        for (const { path: p, doc, records } of docs) {
            const cleanRecords = records.filter((r) => {
                if (globalSeen.has(r.stable_id)) return false;
                globalSeen.add(r.stable_id);
                return true;
            });
            await fs.writeFile(p, JSON.stringify({ ...doc, data: cleanRecords }, null, 2), 'utf-8');
            survivors.push(...cleanRecords);
        }
        result = { records: survivors, deduped };
    }

    const { index, collisions, total } = buildStableIdIndex(result.records);
    await fs.writeFile(
        path.join(catDir, 'stable-id-index.json'),
        JSON.stringify({
            generated_at: new Date().toISOString(),
            category,
            total,
            deduped: result.deduped,
            collisions,
            index,
        }, null, 2),
        'utf-8'
    );

    return { total, deduped: result.deduped, collisions };
}

async function main() {
    const categories = await listCategoryDirs();
    console.log(`[INFO]  Attaching stable IDs across ${categories.length} categories`);

    let grandTotal = 0;
    let grandDeduped = 0;
    for (const cat of categories) {
        try {
            const res = await processCategory(cat);
            if (!res) continue;
            grandTotal += res.total;
            grandDeduped += res.deduped;
            const flag = res.deduped > 0 ? ` [-${res.deduped} duplicates merged]` : '';
            console.log(`[OK]    ${cat.padEnd(26)} ${String(res.total).padStart(7)} records${flag}`);
        } catch (err) {
            console.error(`[ERROR] ${cat}: ${err.message}`);
        }
    }

    console.log(`\n[OK]    Stable-ID sweep complete: ${grandTotal} unique records, ${grandDeduped} duplicates collapsed`);
}

main().catch((err) => {
    console.error('[FATAL] attach-stable-ids failed:', err);
    process.exit(1);
});
