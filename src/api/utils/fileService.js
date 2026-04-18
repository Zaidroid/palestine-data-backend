import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Base directory for data
// Assuming this file is in src/api/utils/
// We need to go up to root then public/data
const DATA_DIR = path.resolve(__dirname, '../../../public/data');
const UNIFIED_DIR = path.join(DATA_DIR, 'unified');
const SNAPSHOT_DIR = path.join(UNIFIED_DIR, 'snapshots');

/**
 * Read a JSON file safely
 * @param {string} filePath - Path relative to data directory
 * @returns {Promise<any>} Parsed JSON content or null
 */
export async function readJsonFile(filePath) {
    try {
        const fullPath = path.join(DATA_DIR, filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Error reading file ${filePath}:`, error.message);
        }
        return null;
    }
}

/**
 * Resolve the best available snapshot directory for a requested `as_of` date.
 * Finds the most recent snapshot on or before the requested date — graceful
 * degradation: if you ask for 2026-04-10 and only 2026-04-08 exists, you get
 * 2026-04-08 with the actual snapshot date surfaced in metadata.
 *
 * Returns null for invalid/unknown dates or when no snapshot exists.
 */
export async function resolveSnapshot(asOf) {
    if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
    try {
        const entries = await fs.readdir(SNAPSHOT_DIR, { withFileTypes: true });
        const dates = entries
            .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
            .map((e) => e.name)
            .sort();
        let best = null;
        for (const d of dates) {
            if (d <= asOf) best = d;
            else break;
        }
        if (!best) return null;
        return { resolved: best, requested: asOf, dir: path.join(SNAPSHOT_DIR, best) };
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
}

export async function listSnapshots() {
    try {
        const entries = await fs.readdir(SNAPSHOT_DIR, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
            .map((e) => e.name)
            .sort();
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

/**
 * Get unified data for a category.
 * When `opts.snapshotDir` is provided, reads from that pinned snapshot instead.
 * @param {string} category
 * @param {{ snapshotDir?: string }} opts
 */
export async function getUnifiedData(category, opts = {}) {
    if (opts.snapshotDir) {
        const p = path.join(opts.snapshotDir, category, 'all-data.json');
        try {
            return JSON.parse(await fs.readFile(p, 'utf-8'));
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }
    const filePath = path.join('unified', category, 'all-data.json');
    return readJsonFile(filePath);
}

/**
 * Get metadata for a category
 * @param {string} category
 * @param {{ snapshotDir?: string }} opts
 */
export async function getUnifiedMetadata(category, opts = {}) {
    if (opts.snapshotDir) {
        const p = path.join(opts.snapshotDir, category, 'metadata.json');
        try {
            return JSON.parse(await fs.readFile(p, 'utf-8'));
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }
    const filePath = path.join('unified', category, 'metadata.json');
    return readJsonFile(filePath);
}

/**
 * Get search index
 * @returns {Promise<any>} Search index
 */
export async function getSearchIndex() {
    return readJsonFile('search-index.json');
}

/**
 * Check if a category exists.
 * If snapshotDir is provided, checks within the snapshot.
 */
export async function categoryExists(category, opts = {}) {
    try {
        const base = opts.snapshotDir ? opts.snapshotDir : UNIFIED_DIR;
        const dirPath = path.join(base, category);
        await fs.access(dirPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * List all available categories (directories with all-data.json)
 * @returns {Promise<string[]>}
 */
export async function listCategories() {
    try {
        const entries = await fs.readdir(UNIFIED_DIR, { withFileTypes: true });
        const categories = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'snapshots') continue;
                try {
                    await fs.access(path.join(UNIFIED_DIR, entry.name, 'all-data.json'));
                    categories.push(entry.name);
                } catch {
                    // skip dirs without all-data.json
                }
            }
        }
        return categories.sort();
    } catch {
        return [];
    }
}
