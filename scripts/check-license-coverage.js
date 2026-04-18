#!/usr/bin/env node
/**
 * License coverage check (CI gate).
 *
 * Scans every record in public/data/unified/<category>/all-data.json and verifies
 * that each entry in sources[] resolves to a known license in
 * src/api/data/licenses.json (matched by name → aliases). Exits 1 on miss.
 *
 * Usage:
 *   node scripts/check-license-coverage.js
 *
 * Env:
 *   STRICT=1   (default 1) — exit non-zero on any unresolved name
 *   STRICT=0   — log warnings but exit 0 (useful while expanding aliases)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const LICENSES_PATH = path.join(ROOT, 'src/api/data/licenses.json');
const UNIFIED_DIR = path.join(ROOT, 'public/data/unified');

const STRICT = process.env.STRICT !== '0';

function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/['`’]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

async function loadLicenseLookup() {
    const raw = await fs.readFile(LICENSES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const lookup = new Map();
    for (const [key, src] of Object.entries(parsed.sources || {})) {
        const candidates = [key, src.name, src.organization, ...(src.aliases || [])];
        for (const c of candidates) {
            const n = normalize(c);
            if (n) lookup.set(n, key);
        }
    }
    return lookup;
}

function extractSourceNames(record) {
    const out = [];
    if (Array.isArray(record.sources)) {
        for (const s of record.sources) {
            if (typeof s === 'string') out.push(s);
            else if (s && typeof s === 'object') {
                if (s.name) out.push(s.name);
                else if (s.organization) out.push(s.organization);
            }
        }
    } else if (typeof record.source === 'string') {
        out.push(record.source);
    }
    return out;
}

// Many historical records cite composite sources like "B'Tselem; UN SC Res. 1073".
// Try the full string first; if it doesn't resolve, split on `;` and re-check each
// component. This avoids needing an alias entry for every long citation chain.
function resolveName(rawName, lookup) {
    const tryDirect = (s) => lookup.get(normalize(s)) || null;
    const direct = tryDirect(rawName);
    if (direct) return [{ name: rawName, key: direct }];

    // Split by `;` first (preserves comma-bearing aliases like "Morris, '1948 and After'").
    const semiParts = rawName.includes(';')
        ? rawName.split(';').map((p) => p.trim()).filter(Boolean)
        : [rawName];

    const out = [];
    for (const part of semiParts) {
        const partKey = tryDirect(part);
        if (partKey) {
            out.push({ name: part, key: partKey });
            continue;
        }
        if (!part.includes(',')) {
            out.push({ name: part, key: null });
            continue;
        }
        for (const sub of part.split(',').map((s) => s.trim()).filter(Boolean)) {
            out.push({ name: sub, key: tryDirect(sub) });
        }
    }
    return out;
}

async function main() {
    const lookup = await loadLicenseLookup();
    const categories = (await fs.readdir(UNIFIED_DIR, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const unresolved = new Map(); // normalized -> { sample, count }
    let recordsScanned = 0;

    for (const cat of categories) {
        const file = path.join(UNIFIED_DIR, cat, 'all-data.json');
        let payload;
        try {
            payload = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch {
            continue;
        }
        const data = payload.data || [];
        for (const rec of data) {
            recordsScanned += 1;
            for (const rawName of extractSourceNames(rec)) {
                if (!rawName) continue;
                const parts = resolveName(rawName, lookup);
                for (const part of parts) {
                    if (part.key) continue;
                    const n = normalize(part.name);
                    if (!n) continue;
                    const entry = unresolved.get(n) || { sample: part.name, count: 0, categories: new Set() };
                    entry.count += 1;
                    entry.categories.add(cat);
                    unresolved.set(n, entry);
                }
            }
        }
    }

    console.log(`license-coverage: scanned ${recordsScanned} records across ${categories.length} categories`);

    if (unresolved.size === 0) {
        console.log('license-coverage: OK — every source resolves to a known license entry');
        process.exit(0);
    }

    console.error(`license-coverage: ${unresolved.size} unresolved source name(s):`);
    for (const [norm, info] of unresolved) {
        console.error(
            `  - "${info.sample}" (normalized: "${norm}", occurrences: ${info.count}, categories: ${[...info.categories].join(',')})`
        );
    }
    console.error(
        `\nFix by adding the source name to the appropriate \`aliases\` array in ${path.relative(ROOT, LICENSES_PATH)}, or by adding a new entry there if the source is genuinely new.`
    );
    process.exit(STRICT ? 1 : 0);
}

main().catch((e) => {
    console.error('license-coverage: FATAL', e);
    process.exit(2);
});
