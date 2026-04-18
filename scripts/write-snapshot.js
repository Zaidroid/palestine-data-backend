/**
 * Write a dated snapshot of the unified dataset to
 * `public/data/unified/snapshots/YYYY-MM-DD/`.
 *
 * Snapshots are how `?as_of=YYYY-MM-DD` pinning works on the unified API:
 * academic + journalist consumers can cite an exact version of the dataset
 * even after it's been updated.
 *
 * Retention: keeps SNAPSHOT_RETENTION_DAYS most recent date-dirs (default 30).
 * If you need longer horizons, bump the env var — disk budget is caller's
 * problem.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNIFIED_DIR = path.resolve(__dirname, '../public/data/unified');
const SNAPSHOT_DIR = path.join(UNIFIED_DIR, 'snapshots');

const RETENTION = Number(process.env.SNAPSHOT_RETENTION_DAYS || 30);

// Files we snapshot per category. Everything else (partition chunks, metadata)
// can be re-derived; these are the two needed for `?as_of=` reads.
const CATEGORY_FILES = ['all-data.json', 'stable-id-index.json', 'metadata.json'];

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

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

async function writeSnapshot(date) {
    const targetRoot = path.join(SNAPSHOT_DIR, date);
    await fs.mkdir(targetRoot, { recursive: true });

    const categories = await listCategoryDirs();
    let written = 0;
    for (const cat of categories) {
        const destDir = path.join(targetRoot, cat);
        await fs.mkdir(destDir, { recursive: true });
        for (const fname of CATEGORY_FILES) {
            const src = path.join(UNIFIED_DIR, cat, fname);
            const dst = path.join(destDir, fname);
            try {
                await fs.copyFile(src, dst);
                written += 1;
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
        }
    }

    const manifest = {
        generated_at: new Date().toISOString(),
        as_of: date,
        categories,
        files_copied: written,
    };
    await fs.writeFile(
        path.join(targetRoot, 'snapshot-manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
    );

    return { date, categories: categories.length, filesCopied: written };
}

async function pruneOldSnapshots(keep) {
    try {
        const entries = await fs.readdir(SNAPSHOT_DIR, { withFileTypes: true });
        const dates = entries
            .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
            .map((e) => e.name)
            .sort();
        if (dates.length <= keep) return 0;
        const toDelete = dates.slice(0, dates.length - keep);
        for (const d of toDelete) {
            await fs.rm(path.join(SNAPSHOT_DIR, d), { recursive: true, force: true });
        }
        return toDelete.length;
    } catch (err) {
        if (err.code === 'ENOENT') return 0;
        throw err;
    }
}

async function main() {
    const date = todayISO();
    await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

    const result = await writeSnapshot(date);
    console.log(
        `[OK]    Snapshot ${result.date}: ${result.categories} categories, ${result.filesCopied} files`
    );

    const pruned = await pruneOldSnapshots(RETENTION);
    if (pruned > 0) {
        console.log(`[OK]    Pruned ${pruned} snapshots older than ${RETENTION}-day retention`);
    }
}

main().catch((err) => {
    console.error('[FATAL] write-snapshot failed:', err);
    process.exit(1);
});
