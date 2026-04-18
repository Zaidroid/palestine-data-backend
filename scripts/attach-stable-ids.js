/**
 * Post-pipeline sweep: ensure every unified record has a deterministic
 * stable_id and emit a lookup index per category.
 *
 * Runs after populate-unified-data.js. Several code paths (B'Tselem merge,
 * westbank, infrastructure merge, goodshepherd) bypass UnifiedPipeline and
 * write directly, so this sweep is the guarantee that every record on disk
 * carries a stable_id by the time the API reads it.
 *
 * Emits `public/data/unified/<category>/stable-id-index.json`:
 *   { generated_at, category, total, collisions, index: { <stable_id>: <array_position> } }
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

async function listCategoryDirs() {
    const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === 'snapshots') continue;
        try {
            await fs.access(path.join(UNIFIED_DIR, e.name, 'all-data.json'));
            out.push(e.name);
        } catch {}
    }
    return out.sort();
}

async function processCategory(category) {
    const filePath = path.join(UNIFIED_DIR, category, 'all-data.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const doc = JSON.parse(raw);
    const records = Array.isArray(doc.data) ? doc.data : [];

    attachStableIds(records);

    const updated = {
        ...doc,
        data: records,
    };
    await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');

    const { index, collisions, total } = buildStableIdIndex(records);
    const indexPath = path.join(UNIFIED_DIR, category, 'stable-id-index.json');
    await fs.writeFile(
        indexPath,
        JSON.stringify({
            generated_at: new Date().toISOString(),
            category,
            total,
            collisions,
            index,
        }, null, 2),
        'utf-8'
    );

    return { total, collisions };
}

async function main() {
    const categories = await listCategoryDirs();
    console.log(`[INFO]  Attaching stable IDs across ${categories.length} categories`);

    let grandTotal = 0;
    let grandCollisions = 0;
    for (const cat of categories) {
        try {
            const { total, collisions } = await processCategory(cat);
            grandTotal += total;
            grandCollisions += collisions;
            const flag = collisions > 0 ? ` [${collisions} collisions]` : '';
            console.log(`[OK]    ${cat.padEnd(26)} ${String(total).padStart(7)} records${flag}`);
        } catch (err) {
            console.error(`[ERROR] ${cat}: ${err.message}`);
        }
    }

    console.log(`\n[OK]    Stable-ID sweep complete: ${grandTotal} records, ${grandCollisions} collisions`);
    if (grandCollisions > 0) {
        console.log('[WARN]  Collisions indicate two records with identical fingerprints —');
        console.log('        investigate if > 1% of any single category.');
    }
}

main().catch((err) => {
    console.error('[FATAL] attach-stable-ids failed:', err);
    process.exit(1);
});
