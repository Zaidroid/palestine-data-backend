#!/usr/bin/env node
/**
 * B3 — Expand the Palestinian gazetteer from GeoNames PS dump.
 *
 * Pulls the free GeoNames Palestine country extract (~6k entries),
 * filters to admin (A) + populated places (P) + locality (L), maps each
 * row to LocationKnowledgeBase shape, merges with the existing
 * curated known_locations.json (curated entries win on key collision),
 * and writes back to disk.
 *
 * Run-once, also wired into refresh-data.sh so we re-pull monthly.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_PATH = path.resolve(__dirname, '../services/westbank-alerts/data/known_locations.json');
const GEONAMES_URL = 'https://download.geonames.org/export/dump/PS.zip';
const KEEP_FEATURE_CLASSES = new Set(['A', 'P', 'L']);

// Map GeoNames admin1 codes (WB or GZ) to a coarser zone.
function zoneOf(lat, lng) {
    if (lat >= 31.20 && lat <= 31.62 && lng >= 34.18 && lng <= 34.60) return 'gaza_strip';
    if (lat >= 32.0) return 'north';
    if (lat >= 31.6) return 'middle';
    return 'south';
}

function snakeKey(s) {
    return String(s)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')      // strip Latin diacritics
        .replace(/[^a-z0-9_ -]/g, '')          // keep alnum + ws/-
        .trim()
        .replace(/[\s-]+/g, '_');
}

// Pick best Arabic variant from `alternatenames` if any, else null.
function arabicNameFrom(asciiName, alternatenames) {
    if (!alternatenames) return null;
    for (const alt of alternatenames.split(',')) {
        if (/[؀-ۿ]/.test(alt)) return alt.trim();
    }
    return null;
}

async function fetchGeonamesZip() {
    console.log(`[gazetteer] downloading ${GEONAMES_URL}`);
    const res = await fetch(GEONAMES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buf);
    const entry = zip.getEntry('PS.txt');
    if (!entry) throw new Error('PS.txt not in zip');
    return entry.getData().toString('utf-8');
}

function parseGeonames(tsvText) {
    const out = [];
    for (const line of tsvText.split('\n')) {
        if (!line) continue;
        const f = line.split('\t');
        if (f.length < 18) continue;
        const featureClass = f[6];
        if (!KEEP_FEATURE_CLASSES.has(featureClass)) continue;
        const name = f[1];
        const asciiName = f[2];
        const altNames = f[3];
        const lat = parseFloat(f[4]);
        const lng = parseFloat(f[5]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const admin1 = f[10];                     // WB or GZ
        const nameAr = arabicNameFrom(asciiName, altNames);
        const aliases = new Set();
        if (name) aliases.add(name);
        if (asciiName) aliases.add(asciiName);
        if (altNames) altNames.split(',').forEach((a) => a && aliases.add(a.trim()));
        out.push({
            canonical_key: snakeKey(asciiName || name),
            name_ar: nameAr || '',
            name_en: asciiName || name,
            governorate: admin1 ? admin1.toLowerCase() : null,
            zone: zoneOf(lat, lng),
            latitude: lat,
            longitude: lng,
            aliases: [...aliases].filter(Boolean),
            source: 'geonames',
        });
    }
    return out;
}

async function main() {
    const tsv = await fetchGeonamesZip();
    const fromGeo = parseGeonames(tsv);
    console.log(`[gazetteer] parsed ${fromGeo.length} candidate places from GeoNames`);

    const curated = JSON.parse(await fs.readFile(KB_PATH, 'utf-8'));
    const curatedKeys = new Set(curated.map((c) => c.canonical_key));
    console.log(`[gazetteer] ${curated.length} curated entries already on disk`);

    // Merge — curated wins on key collision; GeoNames fills the long tail.
    const merged = [...curated];
    let added = 0;
    const seen = new Set(curatedKeys);
    for (const g of fromGeo) {
        if (!g.canonical_key || seen.has(g.canonical_key)) continue;
        seen.add(g.canonical_key);
        merged.push(g);
        added += 1;
    }
    console.log(`[gazetteer] merged: +${added} from GeoNames; total ${merged.length}`);

    await fs.writeFile(KB_PATH, JSON.stringify(merged, null, 2));
    console.log(`[gazetteer] DONE — ${merged.length} entries → ${KB_PATH}`);
}

main().catch((err) => {
    console.error('[gazetteer] FATAL:', err.message);
    process.exit(1);
});
