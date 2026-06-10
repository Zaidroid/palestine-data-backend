/**
 * Post-pipeline sweep: resolve every unified record's location against the
 * shared gazetteer + OCHA admin boundaries (scripts/utils/location-resolver.js).
 *
 * Adds (never overwrites) location.gazetteer_key / admin1 / admin2 /
 * admin2_pcode, and fills lat/lon from the gazetteer (precision:'gazetteer')
 * when the transformer had none. This is the keystone for cross-category
 * joins: records about the same place finally share a key.
 *
 * Handles both category layouts: all-data.json and partition-only categories
 * (large ones whose all-data.json the optimizer removed).
 *
 * Idempotent. Runs after populate-unified-data.js in refresh-data.sh.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveLocation } from './utils/location-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../public/data/unified');

function enrichRecords(records, stats) {
    for (const rec of records) {
        const loc = rec.location;
        if (!loc) continue;
        stats.total++;
        const add = resolveLocation(loc);
        if (!add) continue;
        for (const [k, v] of Object.entries(add)) {
            if (loc[k] == null) loc[k] = v;
        }
        if (add.gazetteer_key) stats.gazetteer++;
        if (add.admin2) stats.admin++;
        if (add.precision === 'gazetteer') stats.coordsAdded++;
    }
}

async function processFile(filePath, stats) {
    const doc = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    const records = Array.isArray(doc.data) ? doc.data : (Array.isArray(doc) ? doc : []);
    if (records.length === 0) return;
    enrichRecords(records, stats);
    await fs.writeFile(filePath, JSON.stringify(doc, null, 2), 'utf-8');
}

async function processCategory(category) {
    const catDir = path.join(UNIFIED_DIR, category);
    const stats = { total: 0, gazetteer: 0, admin: 0, coordsAdded: 0 };

    const allDataPath = path.join(catDir, 'all-data.json');
    let hasAllData = true;
    try {
        await fs.access(allDataPath);
    } catch {
        hasAllData = false;
    }

    if (hasAllData) {
        await processFile(allDataPath, stats);
    } else {
        const partsDir = path.join(catDir, 'partitions');
        let parts = [];
        try {
            parts = (await fs.readdir(partsDir)).filter((f) => f.endsWith('.json') && f !== 'index.json');
        } catch {
            return null; // no data in this category
        }
        for (const f of parts) {
            await processFile(path.join(partsDir, f), stats);
        }
    }
    return stats;
}

async function main() {
    const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
    const categories = entries
        .filter((e) => e.isDirectory() && e.name !== 'snapshots')
        .map((e) => e.name)
        .sort();

    console.log(`[INFO]  Resolving locations across ${categories.length} categories`);
    const grand = { total: 0, gazetteer: 0, admin: 0, coordsAdded: 0 };
    for (const cat of categories) {
        try {
            const stats = await processCategory(cat);
            if (!stats || stats.total === 0) continue;
            for (const k of Object.keys(grand)) grand[k] += stats[k];
            const pct = (n) => `${((100 * n) / stats.total).toFixed(0)}%`;
            console.log(
                `[OK]    ${cat.padEnd(26)} ${String(stats.total).padStart(7)} records  ` +
                `gazetteer ${pct(stats.gazetteer)}  admin ${pct(stats.admin)}  +coords ${stats.coordsAdded}`
            );
        } catch (err) {
            console.error(`[ERROR] ${cat}: ${err.message}`);
        }
    }
    console.log(
        `\n[OK]    Location sweep complete: ${grand.total} records — ` +
        `${grand.gazetteer} gazetteer-linked, ${grand.admin} admin-stamped, ` +
        `${grand.coordsAdded} coords added`
    );
}

main().catch((err) => {
    console.error('[FATAL] attach-locations failed:', err);
    process.exit(1);
});
