#!/usr/bin/env python3
"""Build data/restrictions.geojson from the CURRENT OCHA closure points (Dec 2025).

Replaces the stale 2022 linear closures with the current physical road blockages from
OCHA ClosurePoints_811. We keep ONLY the unambiguous hard blockages (earthmound, road
block, closed road gate) as class=prohibited — staffed/partial checkpoints and OPEN gates
are routable and their status is handled by the live crowd catalog, so boxing them would
over-block.

Run after  scripts/fetch_ocha_closures.sh :
    python3 scripts/build_restrictions_from_ocha.py
"""
import json
import os
import re

SRC = os.path.join(os.path.dirname(__file__), "..", "data", "ocha", "2025", "closurepoints_811.geojson")
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "restrictions.geojson")
VINTAGE = "2025-12"

# OCHA closutretype coded-value domain -> only the hard PHYSICAL blockages are prohibited.
# (1 Checkpoint, 2/10/11 Partial Checkpoint, 3 Open Road Gate are routable/status-variable.)
HARD_TYPES = {4: "Earthmound", 5: "Road Block", 6: "Closed Road Gate"}
ALL_TYPES = {1: "Checkpoint", 2: "Partial Checkpoint", 3: "Open Road Gate", 4: "Earthmound",
             5: "Road Block", 6: "Closed Road Gate", 7: "Earth Wall", 8: "Road Barrier",
             9: "Trench", 10: "Partial Checkpoint w/ Closed Gate", 11: "Partial Checkpoint w/ Open Gate"}


def _slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", (s or "").lower())).strip("-")[:48]


def main() -> None:
    fc = json.load(open(SRC, encoding="utf-8"))
    feats_in = fc.get("features", [])
    out_feats, kept_by_type, skipped_by_type = [], {}, {}
    for f in feats_in:
        p = f.get("properties") or {}
        t = p.get("closutretype")
        if t not in HARD_TYPES:
            skipped_by_type[ALL_TYPES.get(t, t)] = skipped_by_type.get(ALL_TYPES.get(t, t), 0) + 1
            continue
        g = f.get("geometry") or {}
        if g.get("type") != "Point" or not g.get("coordinates"):
            continue
        oid = p.get("objectid")
        name = p.get("name") or f"{HARD_TYPES[t]} {oid}"
        out_feats.append({
            "type": "Feature",
            "properties": {
                "restriction_id": f"ocha-cp811-{oid}-{_slug(name)}",
                "class": "prohibited",
                "source": "ocha-closurepoints-811",
                "name": name,
                "closure_type": HARD_TYPES[t],
                "governorate": p.get("governoratet"),
                "blocks_access_main_road": p.get("blocks_access_main_road"),
                "since_ceasefire": p.get("installedsincegazaceasefire"),
                "last_verified": VINTAGE,
            },
            "geometry": {"type": "Point", "coordinates": g["coordinates"][:2]},
        })
        kept_by_type[HARD_TYPES[t]] = kept_by_type.get(HARD_TYPES[t], 0) + 1

    json.dump({"type": "FeatureCollection", "features": out_feats},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False)

    print(f"read {len(feats_in)} OCHA closure points -> wrote {len(out_feats)} prohibited obstacles")
    print("  kept (prohibited):", {k: kept_by_type[k] for k in sorted(kept_by_type)})
    print("  skipped (routable):", {k: skipped_by_type[k] for k in sorted(skipped_by_type, key=str)})
    print(f"  -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
