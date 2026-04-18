/**
 * Deterministic content-addressed record IDs.
 *
 * Every canonical record gets a `stable_id` derived from a canonical
 * serialization of its content, so re-running the pipeline over the same
 * upstream data yields the same IDs. This is what makes
 * /api/v1/record/:category/:stable_id a citable permalink and what lets
 * ?as_of= snapshot pinning work.
 *
 * The fingerprint is the SHA-256 of the record's JSON with:
 *   - keys sorted recursively (canonicalization)
 *   - volatile / derived fields stripped (fetched_at timestamps, per-run
 *     random legacy `id`, days_since_baseline etc.)
 *   - the `stable_id` field itself stripped so the hash is idempotent
 *     when re-run on records that already carry one.
 *
 * Anything else is in scope — name, age, description, value, indicator_code,
 * whatever the transformer chose to emit. That way tabular indicator rows
 * that only differ by `metrics.value` still get distinct IDs, and person
 * records only differing by `name/dob` still get distinct IDs.
 */
import crypto from 'crypto';

// Fields to remove before hashing. These either change every run (timestamps,
// per-run random IDs) or are derived from other fields (baseline offsets).
const VOLATILE_TOP_LEVEL = new Set(['stable_id', 'id']);
const VOLATILE_TEMPORAL = new Set(['days_since_baseline', 'baseline_period']);
const VOLATILE_SOURCE = new Set(['fetched_at']);

function canonicalize(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value).sort()) {
        out[key] = canonicalize(value[key]);
    }
    return out;
}

function stripVolatile(record) {
    const clone = {};
    for (const [k, v] of Object.entries(record)) {
        if (VOLATILE_TOP_LEVEL.has(k)) continue;
        if (k === 'temporal_context' && v && typeof v === 'object') {
            const tc = {};
            for (const [tk, tv] of Object.entries(v)) {
                if (VOLATILE_TEMPORAL.has(tk)) continue;
                tc[tk] = tv;
            }
            clone[k] = tc;
            continue;
        }
        if (k === 'sources' && Array.isArray(v)) {
            clone[k] = v.map((s) => {
                if (!s || typeof s !== 'object') return s;
                const out = {};
                for (const [sk, sv] of Object.entries(s)) {
                    if (VOLATILE_SOURCE.has(sk)) continue;
                    out[sk] = sv;
                }
                return out;
            });
            continue;
        }
        clone[k] = v;
    }
    return clone;
}

export function computeStableId(record) {
    const scrubbed = stripVolatile(record);
    const canonical = canonicalize(scrubbed);
    const json = JSON.stringify(canonical);
    const h = crypto.createHash('sha256').update(json).digest('hex');
    // 16 bytes (32 hex chars) — birthday collision risk ~1 in 1e19 for
    // record sets under a billion, far beyond our scale.
    return h.slice(0, 32);
}

/**
 * Attach stable_id to every record in a dataset. Safe to call multiple
 * times — stable_id is deterministic from content, not from position.
 */
export function attachStableIds(records) {
    for (const r of records) {
        r.stable_id = computeStableId(r);
    }
    return records;
}

/**
 * Build an index mapping stable_id → array position, for O(1) /record lookups.
 * Collisions (same content → same id) are resolved by keeping the first
 * occurrence; the collision count is surfaced so callers can flag categories
 * with true-duplicate upstream data.
 */
export function buildStableIdIndex(records) {
    const index = {};
    let collisions = 0;
    for (let i = 0; i < records.length; i++) {
        const id = records[i].stable_id;
        if (!id) continue;
        if (index[id] !== undefined) {
            collisions += 1;
            continue;
        }
        index[id] = i;
    }
    return { index, collisions, total: records.length };
}
