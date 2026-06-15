"""Static road-restriction layer (Phase 2).

Loads ``data/restrictions.geojson`` — physically-closed / segregated road
segments, seeded from OCHA *Closures_2022* LinearClosures (CC-BY) and extended
with hand-curated B'Tselem settler-road segments — and turns the ones near a
route into small avoid-polygons, reusing the same box mechanism as the live
closed-checkpoint reroute (``on_route.exclude_polygons``). Routes then don't run
through roads that are physically closed.

Fail-open by contract: ``build_route_plan`` retries WITHOUT these polygons if the
restricted route is impossible, so a stale closure never orphans a destination.
Coordinates are [lon, lat] to match GeoJSON / the routing engine.
"""
from __future__ import annotations

import json
import logging
import math
import os

log = logging.getLogger("restrictions")

_M_PER_DEG_LAT = 111_320.0
_CANDIDATES = [
    os.environ.get("RESTRICTIONS_PATH"),
    "/data/restrictions.geojson",  # canonical runtime path (bind mount, like known_checkpoints.json)
    os.path.join(os.path.dirname(__file__), "..", "..", "data", "restrictions.geojson"),
    "/app/data/restrictions.geojson",
]


def _feature_segments(features) -> list:
    """[[[lon,lat], ...], ...] for every prohibited feature. Lines keep their vertices;
    a Point obstacle (closed road gate / roadblock / earthmound) becomes a single-vertex
    segment so avoid_polygons boxes it like a closed road node."""
    segs = []
    for f in features:
        if (f.get("properties") or {}).get("class") != "prohibited":
            continue
        g = f.get("geometry") or {}
        t = g.get("type")
        c = g.get("coordinates")
        if not c:
            continue
        if t == "LineString":
            segs.append(c)
        elif t == "MultiLineString":
            segs.extend(c)
        elif t == "Point":
            segs.append([c])
        elif t == "MultiPoint":
            segs.extend([pt] for pt in c)
    return [s for s in segs if s]


def _load_segments() -> list:
    """Return [[[lon,lat], ...], ...] for every prohibited Line/Point feature."""
    for path in _CANDIDATES:
        if not path:
            continue
        try:
            fc = json.load(open(path, encoding="utf-8"))
        except FileNotFoundError:
            continue
        except Exception as e:  # noqa: BLE001
            log.warning("restrictions load error at %s (%s)", path, e)
            continue
        segs = _feature_segments(fc.get("features", []))
        log.info("restrictions: loaded %d closed segments from %s", len(segs), path)
        return segs
    log.warning("restrictions.geojson not found; static restriction layer disabled")
    return []


_SEGMENTS = _load_segments()


def _bbox(a, b, pad: float = 0.04):
    (la1, lo1), (la2, lo2) = a, b
    return (min(la1, la2) - pad, min(lo1, lo2) - pad, max(la1, la2) + pad, max(lo1, lo2) + pad)


def _box(lon: float, lat: float, box_m: float) -> list:
    dlat = (box_m / _M_PER_DEG_LAT) / 2.0
    dlon = (box_m / max(1.0, _M_PER_DEG_LAT * math.cos(math.radians(lat)))) / 2.0
    return [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat],
            [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]]


def avoid_polygons(from_latlon, to_latlon, *, box_m: float = 60.0,
                   max_polys: int = 150, segments=None) -> list:
    # 150 covers the densest realistic city-pair (Hebron->Bethlehem ~118 current OCHA
    # obstacles); cross-WB routes can exceed it (fail-safe truncation). 150*5=750 verts,
    # far under Valhalla's 10000 limit. Phase 3 (exclude_locations) is the perf-clean fix.
    """Avoid-polygons ([lon,lat] rings) for closed road segments inside the route
    bbox. Boxes a few sampled vertices per in-bbox segment so the engine can't
    traverse it. Returns [] when nothing relevant is near — routing proceeds
    normally and pays no cost on routes far from any closure."""
    segs = _SEGMENTS if segments is None else segments
    if not segs:
        return []
    lo_la, lo_lo, hi_la, hi_lo = _bbox(from_latlon, to_latlon)
    polys: list = []
    for seg in segs:
        pts = [(lon, lat) for lon, lat in seg if lo_la <= lat <= hi_la and lo_lo <= lon <= hi_lo]
        if not pts:
            continue
        for i in sorted({0, len(pts) // 2, len(pts) - 1}):
            polys.append(_box(pts[i][0], pts[i][1], box_m))
            if len(polys) >= max_polys:
                return polys
    return polys
