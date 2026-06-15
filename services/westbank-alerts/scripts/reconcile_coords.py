#!/usr/bin/env python3
"""Reconcile known_checkpoints.json coordinates against authoritative geodata.

The catalog's coordinates are a mix of crowd/gazetteer origins and drift up to ~2 km
from the actual road, which breaks tight on-route detection. This tool corrects them
WITHOUT guessing: it matches each catalog checkpoint to OpenStreetMap (and optionally
road-snaps via Valhalla) and adopts the authoritative coordinate.

Sources, in priority order:
  1. OSM Overpass — barrier=checkpoint / military=checkpoint nodes+ways in the West
     Bank, matched by normalized Arabic name (name:ar) within MAX_MATCH_KM. OSM points
     sit on the actual road. HIGH confidence.
  2. Valhalla /locate road-snap (optional, --valhalla URL) — for catalog points with
     no OSM match, snap to the nearest drivable road IF the move is small
     (<= SNAP_CAP_M), which fixes minor drift without jumping to a wrong parallel road.
     MEDIUM confidence.
  3. No confident source -> keep original, flag for manual review. LOW.

Default is DRY-RUN: prints a report (per-tier counts, every move with distance). Pass
--apply to write the corrected file. Never moves a point more than MAX_MATCH_KM.

Usage:
  python3 reconcile_coords.py                          # dry-run, OSM only
  python3 reconcile_coords.py --valhalla http://valhalla:8002   # + road-snap pass
  python3 reconcile_coords.py --apply [--valhalla ...]          # write corrected file
"""
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
CATALOG = HERE / "data" / "known_checkpoints.json"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "westbank-checkpoint-tracker/1.0 (zsalem33@gmail.com)"
WB_BBOX = (31.2, 34.8, 32.6, 35.6)   # S, W, N, E

MAX_MATCH_KM = 3.0    # never adopt an OSM coord farther than this from the catalog point
SNAP_CAP_M = 120.0    # Valhalla snap accepted only if it moves the point <= this

APPLY = "--apply" in sys.argv
VALHALLA = None
for i, a in enumerate(sys.argv):
    if a == "--valhalla" and i + 1 < len(sys.argv):
        VALHALLA = sys.argv[i + 1].rstrip("/")


def normalise(s: str) -> str:
    s = (s or "").replace("_", " ")
    s = re.sub(r"[ً-ْٰ]", "", s)   # strip diacritics
    s = re.sub(r"[أإآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(a))


def fetch_osm() -> list:
    s, w, n, e = WB_BBOX
    box = f"({s},{w},{n},{e})"
    q = ("[out:json][timeout:90];("
         f'node["barrier"="checkpoint"]{box};way["barrier"="checkpoint"]{box};'
         f'node["military"="checkpoint"]{box};way["military"="checkpoint"]{box};'
         f'node["barrier"="border_control"]{box};'
         ");out center;")
    req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": UA})
    data = json.load(urllib.request.urlopen(req, timeout=120))
    out = []
    for el in data.get("elements", []):
        tags = el.get("tags") or {}
        name_ar = tags.get("name:ar")
        name_en = tags.get("name:en") or tags.get("name")
        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            c = el.get("center") or {}
            lat, lon = c.get("lat"), c.get("lon")
        if lat is None or lon is None:
            continue
        out.append({
            "name_ar_norm": normalise(name_ar) if name_ar else "",
            "name_en_norm": (name_en or "").strip().lower(),
            "lat": lat, "lon": lon, "name_ar": name_ar, "name_en": name_en,
        })
    return out


def valhalla_snap(lat, lon):
    if not VALHALLA:
        return None
    body = {"locations": [{"lat": lat, "lon": lon}], "costing": "auto", "verbose": True}
    try:
        req = urllib.request.Request(f"{VALHALLA}/locate", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        d = json.load(urllib.request.urlopen(req, timeout=20))
        edges = d[0].get("edges") or []
        if not edges:
            return None
        clat = edges[0].get("correlated_lat")
        clon = edges[0].get("correlated_lon")
        if clat is None or clon is None:
            return None
        return clat, clon
    except Exception:
        return None


PROX_M = 250.0  # proximity match: an OSM checkpoint within this of a catalog point is the same one


def osm_candidates(cp, osm, aliases=None):
    """Return [(distance_m, osm, how)] matches, nearest first. Match by Arabic name,
    English name, or — failing names — pure proximity (same checkpoint, different/no name)."""
    ar_names = {normalise(cp.get("name_ar", "")), normalise(cp.get("canonical_key", ""))}
    ar_names |= {normalise(a) for a in (cp.get("aliases") or [])}
    ar_names.discard("")
    en = (cp.get("name_en") or "").strip().lower()
    cands = []
    for o in osm:
        d = haversine_m(cp["latitude"], cp["longitude"], o["lat"], o["lon"])
        how = None
        oa = o["name_ar_norm"]
        if oa and any(nm == oa or (len(nm) >= 4 and (nm in oa or oa in nm)) for nm in ar_names):
            how = "name:ar"
        elif en and len(en) >= 4 and o["name_en_norm"] and (en == o["name_en_norm"] or en in o["name_en_norm"] or o["name_en_norm"] in en):
            how = "name:en"
        elif d <= PROX_M:
            how = "proximity"
        if how and d <= MAX_MATCH_KM * 1000:
            cands.append((d, o, how))
    cands.sort(key=lambda x: x[0])
    return cands


def main():
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    print(f"catalog: {len(catalog)} checkpoints")
    print("fetching OSM checkpoints…")
    osm = fetch_osm()
    print(f"OSM checkpoints with name:ar: {len(osm)}")
    if VALHALLA:
        print(f"Valhalla snapping enabled: {VALHALLA} (cap {SNAP_CAP_M:.0f} m)")

    tiers = {"osm": [], "snap": [], "kept": []}
    for cp in catalog:
        if cp.get("latitude") is None or cp.get("longitude") is None:
            tiers["kept"].append((cp["canonical_key"], "no coords"))
            continue
        # Tier 1 — OSM match. name:ar + proximity are high-confidence (auto-adopt);
        # name:en is ambiguity-prone (transliteration collisions) so it's review-only.
        cands = osm_candidates(cp, osm)
        if cands:
            d, o, how = cands[0]
            if how == "name:en":
                tiers.setdefault("review", []).append((cp["canonical_key"], round(d), o["lat"], o["lon"], o.get("name_en")))
                continue
            tiers["osm"].append((cp["canonical_key"], round(d), o["lat"], o["lon"], how))
            if APPLY:
                cp["latitude"], cp["longitude"] = o["lat"], o["lon"]
                cp["geo_precision"] = "checkpoint"
            continue
        # Tier 2 — Valhalla conservative road-snap
        snap = valhalla_snap(cp["latitude"], cp["longitude"])
        if snap:
            d = haversine_m(cp["latitude"], cp["longitude"], snap[0], snap[1])
            if d <= SNAP_CAP_M:
                tiers["snap"].append((cp["canonical_key"], round(d), snap[0], snap[1]))
                if APPLY:
                    cp["latitude"], cp["longitude"] = round(snap[0], 6), round(snap[1], 6)
                continue
        tiers["kept"].append((cp["canonical_key"], "no confident match"))

    print(f"\n=== TIER 1: OSM-matched ({len(tiers['osm'])}) — adopted authoritative coord ===")
    for k, d, lat, lon, how in sorted(tiers["osm"], key=lambda x: -x[1]):
        print(f"  moved {d:5d} m [{how:9}] -> ({lat:.5f},{lon:.5f})  {k}")
    review = tiers.get("review", [])
    print(f"\n=== REVIEW: name:en matches ({len(review)}) — NOT auto-applied (ambiguity risk), confirm manually ===")
    for k, d, lat, lon, en in sorted(review, key=lambda x: -x[1]):
        print(f"  {k}  ->  OSM '{en}' at ({lat:.5f},{lon:.5f}), {d} m away")
    print(f"\n=== TIER 2: Valhalla road-snap ({len(tiers['snap'])}) ===")
    for k, d, lat, lon in sorted(tiers["snap"], key=lambda x: -x[1]):
        print(f"  snapped {d:4d} m  {k}")
    print(f"\n=== TIER 3: kept original ({len(tiers['kept'])}) — need manual review if on a route ===")

    if APPLY:
        CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nAPPLIED -> {CATALOG}")
    else:
        print("\nDRY-RUN — re-run with --apply to write. Review the moves above first.")


if __name__ == "__main__":
    main()
