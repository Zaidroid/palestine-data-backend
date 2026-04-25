import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LICENSES_PATH = path.resolve(__dirname, '../data/licenses.json');

// Tiers that pay for commercial redistribution. Anonymous + free see everything
// (subject to attribution); paid tiers get records stripped of any source whose
// license is `commercial_use: false`.
const PAID_TIERS = new Set(['journalist', 'ngo', 'enterprise']);

// One-shot load on first call. Restart the process to pick up edits.
let _index = null;
function load() {
    if (_index) return _index;
    const doc = JSON.parse(fs.readFileSync(LICENSES_PATH, 'utf8'));
    const sources = doc.sources || {};
    const aliasToId = new Map();
    for (const [id, entry] of Object.entries(sources)) {
        const aliases = entry.aliases || [];
        for (const a of aliases) aliasToId.set(String(a).toLowerCase(), id);
        aliasToId.set(id.toLowerCase(), id);
    }
    _index = { sources, aliasToId };
    return _index;
}

function lookup(name) {
    if (!name) return null;
    const { sources, aliasToId } = load();
    const id = aliasToId.get(String(name).toLowerCase());
    return id ? { id, ...sources[id] } : null;
}

function recordSourceNames(record) {
    const raw = record?.sources;
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
}

// True if any source on the record is explicitly non-commercial. "varies" /
// "unknown" / missing entries are NOT treated as blocking — the registry only
// gates on confirmed restrictions.
function isCommerciallyBlocked(record) {
    const names = recordSourceNames(record);
    if (names.length === 0) return false;
    for (const n of names) {
        const entry = lookup(n);
        if (entry && entry.commercial_use === false) return true;
    }
    return false;
}

/**
 * Strip records with non-commercial sources for paid tiers. Anonymous + free
 * see everything.
 *
 * @param {Array} records
 * @param {string} tier
 * @returns {{ records: Array, hidden: number }}
 */
export function filterRecordsByLicense(records, tier) {
    if (!Array.isArray(records)) return { records: records || [], hidden: 0 };
    if (!PAID_TIERS.has(tier)) return { records, hidden: 0 };
    const out = [];
    let hidden = 0;
    for (const r of records) {
        if (isCommerciallyBlocked(r)) hidden += 1;
        else out.push(r);
    }
    return { records: out, hidden };
}

/**
 * Distinct attribution strings for the sources actually present in `records`.
 * Customers redistributing must reproduce these (per ToS).
 *
 * @param {Array} records
 * @returns {string[]}
 */
export function collectRequiredAttributions(records) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const seen = new Set();
    for (const r of records) {
        for (const n of recordSourceNames(r)) {
            const entry = lookup(n);
            const text = entry?.attribution_text;
            if (text) seen.add(text);
        }
    }
    return Array.from(seen).sort();
}
