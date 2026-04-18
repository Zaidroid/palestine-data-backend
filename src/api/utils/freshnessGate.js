import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const QUALITY_PATH = path.resolve(__dirname, '../../../public/data/unified/quality.json');

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { loadedAt: 0, byCategory: {} };

async function loadQuality() {
    if (Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.byCategory;
    try {
        const snap = JSON.parse(await fs.readFile(QUALITY_PATH, 'utf8'));
        cache = { loadedAt: Date.now(), byCategory: snap.categories || {} };
    } catch {
        // Snapshot may be missing on first deploy — degrade gracefully.
        cache = { loadedAt: Date.now(), byCategory: {} };
    }
    return cache.byCategory;
}

/**
 * Returns { stale, frozen_at, latest_record_at, freshness_days_since_latest, active }
 * for a given unified category, or null if the snapshot has no entry yet.
 */
export async function getFreshness(category) {
    const all = await loadQuality();
    return all[category] || null;
}

/**
 * Stamps response with a Warning: 299 header and merges freshness fields into
 * the response envelope's `metadata` object. Caller is responsible for json().
 */
export async function applyFreshnessGate(res, category, envelope) {
    const f = await getFreshness(category);
    if (!f) return envelope;

    if (f.stale && f.latest_record_at) {
        const latest = f.latest_record_at.slice(0, 10);
        res.setHeader(
            'Warning',
            `299 - "Stale data: latest record ${latest} (${f.freshness_days_since_latest} days old)"`
        );
    }
    if (f.frozen_at) {
        res.setHeader('Warning', `299 - "Frozen snapshot — upstream stopped publishing on ${f.frozen_at}"`);
    }

    envelope.metadata = {
        ...(envelope.metadata || {}),
        stale: f.stale,
        active: f.active,
        frozen_at: f.frozen_at,
        latest_record_at: f.latest_record_at,
        freshness_days_since_latest: f.freshness_days_since_latest,
    };
    return envelope;
}
