/**
 * Location resolver — the shared geographic authority for the unified databank.
 *
 * Joins three assets the repo already maintains but never connected:
 *   1. The curated gazetteer (services/westbank-alerts/data/known_locations.json,
 *      ~1,400 places with Arabic/English names, aliases, coords, governorate).
 *   2. OCHA COD-AB admin boundaries (public/data/admin/admin{1,2}.geojson).
 *   3. Unified records' free-text location.name + optional lat/lon.
 *
 * resolveLocation(location) returns additive enrichment only — it never
 * overwrites a non-null field the transformer already set:
 *   { gazetteer_key, admin1, admin2, admin2_pcode, lat, lon, precision }
 *
 * Matching is deliberately conservative (exact normalized match on names and
 * aliases, plus administrative-suffix stripping). A wrong geo link is worse
 * than a missing one.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const GAZETTEER_PATH = path.join(REPO_ROOT, 'services/westbank-alerts/data/known_locations.json');
const ADMIN2_PATH = path.join(REPO_ROOT, 'public/data/admin/admin2.geojson');

// ── Normalization ─────────────────────────────────────────────────────────────

const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g; // harakat + tatweel

export function normalizeName(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // Latin combining marks: Khān → khan
        .toLowerCase()
        .replace(ARABIC_DIACRITICS, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/[''`´]/g, "'")
        .replace(/[-_/]/g, ' ')
        .replace(/[.,()؛،]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Administrative qualifiers that sources append to place names. Stripping
// them maps "Nablus Governorate" / "nablus directorate" onto the gazetteer's
// "nablus". Deliberately NOT stripped: "camp" (Jenin Camp ≠ Jenin city).
const ADMIN_SUFFIXES = /\s+(governorate|directorate|district|municipality|gov\.?)$/;
const ADMIN_PREFIXES = /^(governorate|district|municipality) of\s+/;

// Settlement-type qualifiers appended by UCDP/HDX exports: "Rafah town",
// "Bani Suheila village". True synonyms of the bare name — safe to strip.
const TYPE_SUFFIXES = /\s+(town|city|village)$/;

function nameCandidates(raw) {
    const base = normalizeName(raw);
    if (!base) return [];
    const out = [base];
    const push = (c) => { if (c && !out.includes(c)) out.push(c); };

    push(base.replace(ADMIN_SUFFIXES, '').replace(ADMIN_PREFIXES, '').trim());
    // An explicit settlement type makes an otherwise-ambiguous name specific:
    // bare "Gaza" usually means the strip, but "Gaza town/city" is the city —
    // mark such candidates so the resolver lets them through the region block.
    if (TYPE_SUFFIXES.test(base)) {
        const c = base.replace(TYPE_SUFFIXES, '').trim();
        push(c);
        out.typed = c;
    }

    // "X refugee camp": prefer the gazetteer's "x camp" convention, then the
    // bare locality (Gaza camps like Nuseirat are gazetted as the bare name).
    // Ordering matters — "jenin camp" must win before bare "jenin".
    if (/\s+refugee camp$/.test(base)) {
        push(base.replace(/\s+refugee camp$/, ' camp'));
        push(base.replace(/\s+refugee camp$/, '').trim());
    }

    // "al-bireh" vs "bireh" — try without a leading Arabic definite article
    for (const c of [...out]) {
        if (c.startsWith('al ')) push(c.slice(3));
        if (c.startsWith('el ')) push(c.slice(3));
    }
    // Common transliteration variance on the taa marbuta: Jabaliyah/Jabaliya
    for (const c of [...out]) {
        if (c.endsWith('ah')) push(c.slice(0, -1));
        else if (c.endsWith('a')) push(c + 'h');
    }
    return out;
}

// Region-level names must never resolve to a specific place.
const NON_SPECIFIC = new Set([
    'palestine', 'state of palestine', 'occupied palestinian territory', 'opt',
    'west bank', 'gaza', 'gaza strip', 'east jerusalem', 'westbank',
    'فلسطين', 'الضفه الغربيه', 'قطاع غزه', 'غزه',
].map(normalizeName));

// ── Gazetteer index ───────────────────────────────────────────────────────────

let GAZ_INDEX = null;

function loadGazetteer() {
    if (GAZ_INDEX) return GAZ_INDEX;
    const entries = JSON.parse(fs.readFileSync(GAZETTEER_PATH, 'utf-8'));
    const index = new Map();     // ambiguous region-level names excluded
    const indexAll = new Map();  // everything — used only for typed lookups ("Gaza town")
    const put = (key, entry) => {
        const k = normalizeName(key);
        if (!k) return;
        // First writer wins; curated file lists curated entries before
        // GeoNames merges, so curated names keep priority on collisions.
        if (!indexAll.has(k)) indexAll.set(k, entry);
        if (NON_SPECIFIC.has(k)) return;
        if (!index.has(k)) index.set(k, entry);
    };
    // Two phases: canonical keys and primary names first, aliases second —
    // an entry's own name must never be shadowed by another entry's alias
    // (gaza_strip carries a plain "Gaza" alias that would hide the city).
    for (const e of entries) {
        put(e.canonical_key?.replace(/_/g, ' '), e);
        put(e.name_en, e);
        put(e.name_ar, e);
    }
    for (const e of entries) {
        for (const a of e.aliases || []) put(a, e);
    }
    GAZ_INDEX = { index, indexAll };
    return GAZ_INDEX;
}

// ── Point-in-polygon (ray casting, no deps) ───────────────────────────────────

let ADMIN2 = null;

function loadAdmin2() {
    if (ADMIN2) return ADMIN2;
    const geo = JSON.parse(fs.readFileSync(ADMIN2_PATH, 'utf-8'));
    ADMIN2 = geo.features.map((f) => {
        const polys = f.geometry.type === 'Polygon'
            ? [f.geometry.coordinates]
            : f.geometry.coordinates; // MultiPolygon
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const poly of polys) {
            for (const [x, y] of poly[0]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        return {
            admin1: f.properties.adm1_name,
            admin2: f.properties.adm2_name,
            pcode: f.properties.adm2_pcode,
            bbox: [minX, minY, maxX, maxY],
            polys,
        };
    });
    return ADMIN2;
}

function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

export function pointToAdmin(lat, lon) {
    if (lat == null || lon == null) return null;
    for (const f of loadAdmin2()) {
        const [minX, minY, maxX, maxY] = f.bbox;
        if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
        for (const poly of f.polys) {
            if (!inRing(poly[0], lon, lat)) continue;
            // outer ring hit — reject if inside a hole
            let inHole = false;
            for (let h = 1; h < poly.length; h++) {
                if (inRing(poly[h], lon, lat)) { inHole = true; break; }
            }
            if (!inHole) return { admin1: f.admin1, admin2: f.admin2, pcode: f.pcode };
        }
    }
    return null;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * @param {object} location  canonical record location ({name, governorate, region, lat, lon, ...})
 * @returns {object|null} additive fields, or null when nothing could be resolved
 */
export function resolveLocation(location) {
    if (!location || typeof location !== 'object') return null;
    const out = {};
    const { index, indexAll } = loadGazetteer();

    let entry = null;
    const candidates = nameCandidates(location.name);
    for (const cand of candidates) {
        if (NON_SPECIFIC.has(cand)) {
            // Region-level name ("Gaza", "West Bank") — never geo-link it,
            // unless the source said e.g. "Gaza town", which IS the city.
            if (cand === candidates.typed) {
                entry = indexAll.get(cand);
                if (entry) break;
            }
            if (cand === candidates[0]) break;
            continue;
        }
        entry = index.get(cand);
        if (entry) break;
    }

    if (entry) {
        out.gazetteer_key = entry.canonical_key;
        if (location.governorate == null && entry.governorate) {
            out.governorate = entry.governorate;
        }
    }

    let lat = location.lat;
    let lon = location.lon;
    if ((lat == null || lon == null) && entry?.latitude != null) {
        lat = entry.latitude;
        lon = entry.longitude;
        out.lat = lat;
        out.lon = lon;
        out.precision = 'gazetteer';
    }

    if (lat != null && lon != null && (location.admin1 == null || location.admin2 == null)) {
        const admin = pointToAdmin(lat, lon);
        if (admin) {
            out.admin1 = admin.admin1;
            out.admin2 = admin.admin2;
            out.admin2_pcode = admin.pcode;
        }
    }

    return Object.keys(out).length ? out : null;
}
