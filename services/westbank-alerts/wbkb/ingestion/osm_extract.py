"""OpenStreetMap (Overpass) -> snap node coordinates to real barrier/checkpoint
nodes and pull true road geometry. Run weekly.

No-arg: prints the Overpass query to POST to https://overpass-api.de/api/interpreter
With data/overpass_result.json present: snaps KB node coords (source=osm, never
overrides a human_local coord) to the nearest matching OSM barrier within ~250 m.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from engine.kb_io import load_kb, save_kb, DATA_DIR

# West Bank bounding box (S, W, N, E)
BBOX = (31.30, 34.85, 32.60, 35.60)

QUERY = f"""[out:json][timeout:60];
(
  node["barrier"="checkpoint"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["military"="checkpoint"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  node["barrier"="border_control"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out body;"""


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def snap(result_path: str, max_km: float = 0.25) -> dict:
    elements = json.loads(open(result_path, encoding="utf-8").read()).get("elements", [])
    osm_pts = [(e["lat"], e["lon"]) for e in elements if e.get("type") == "node" and "lat" in e]
    nodes, edges, meta = load_kb()
    snapped = 0
    for n in nodes.values():
        if n.get("type") != "checkpoint" or n.get("coord_source") == "human_local":
            continue
        c = n.get("coord")
        if not c:
            continue
        here = (c["lat"], c["lng"])
        near = min(osm_pts, key=lambda p: _km(here, p), default=None)
        if near and _km(here, near) <= max_km:
            n["coord"] = {"lat": near[0], "lng": near[1]}
            n["coord_source"] = "osm"
            snapped += 1
    save_kb(nodes, edges, meta)
    return {"osm_nodes": len(osm_pts), "snapped": snapped}


if __name__ == "__main__":
    default = DATA_DIR / "overpass_result.json"
    path = sys.argv[1] if len(sys.argv) > 1 else (str(default) if Path(default).exists() else None)
    if not path:
        print("# No overpass_result.json found. POST this query, save the JSON to data/overpass_result.json,")
        print("# then re-run:  python -m ingestion.osm_extract\n")
        print(QUERY)
    else:
        print(json.dumps(snap(path), ensure_ascii=False, indent=2))
