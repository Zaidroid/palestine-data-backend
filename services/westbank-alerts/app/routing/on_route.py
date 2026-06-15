"""Checkpoint-on-route detection (Phase D).

Engine-agnostic geometry: given a route polyline and the full checkpoint catalog,
return the checkpoints within a corridor of the route, ordered along it, flagging
the closed ones. Ports the frontend's perpendicular-distance math to the backend so
detection runs against the FULL catalog (every status, including permanently-closed
Huwara) instead of whatever the client happened to load — and so the closed ones can
be turned into avoid-polygons for a reroute.

All coordinates are [lon, lat] to match GeoJSON / routing-engine geometry.
"""
from __future__ import annotations

import math

_M_PER_DEG_LAT = 111_320.0


def _m_per_deg_lon(lat: float) -> float:
    return _M_PER_DEG_LAT * math.cos(math.radians(lat))


def _dist_to_segment_m(p, a, b) -> float:
    """Perpendicular distance (m) from point p to segment a→b, all [lon, lat]."""
    kx = _m_per_deg_lon(p[1])
    ky = _M_PER_DEG_LAT
    px = (p[0] - a[0]) * kx
    py = (p[1] - a[1]) * ky
    bx = (b[0] - a[0]) * kx
    by = (b[1] - a[1]) * ky
    len2 = bx * bx + by * by
    t = max(0.0, min(1.0, (px * bx + py * by) / len2)) if len2 else 0.0
    return math.hypot(px - t * bx, py - t * by)


def _seg_km(a, b) -> float:
    return math.hypot((b[0] - a[0]) * _m_per_deg_lon(a[1]),
                      (b[1] - a[1]) * _M_PER_DEG_LAT) / 1000.0


def checkpoints_on_route(route_coords: list, checkpoints: list, corridor_m: float = 300.0) -> list:
    """Return [{checkpoint, distance_m, along_km, closed}] within corridor_m of the
    route, ordered by along_km. `checkpoints` are envelope-style dicts carrying
    coordinates{lat,lon} and effective_status."""
    if not route_coords or len(route_coords) < 2:
        return []

    cum_km = [0.0]
    for i in range(1, len(route_coords)):
        cum_km.append(cum_km[i - 1] + _seg_km(route_coords[i - 1], route_coords[i]))

    out = []
    for cp in checkpoints:
        coords = cp.get("coordinates") or {}
        lat, lon = coords.get("lat"), coords.get("lon")
        if lat is None or lon is None:
            continue
        p = (lon, lat)
        best, best_idx = float("inf"), 0
        for i in range(1, len(route_coords)):
            d = _dist_to_segment_m(p, route_coords[i - 1], route_coords[i])
            if d < best:
                best, best_idx = d, i - 1
        if best <= corridor_m:
            out.append({
                "checkpoint": cp,
                "distance_m": round(best),
                "along_km": round(cum_km[best_idx], 2),
                "closed": cp.get("effective_status") == "closed",
            })
    out.sort(key=lambda o: o["along_km"])
    return out


def _point_dist_m(a, b) -> float:
    """Distance (m) between two {lat,lon}-ish points given as (lat, lon) tuples."""
    return math.hypot((b[1] - a[1]) * _m_per_deg_lon(a[0]), (b[0] - a[0]) * _M_PER_DEG_LAT)


def dedup_on_route(on_route: list, min_gap_m: float = 200.0) -> list:
    """Collapse checkpoints clustered within min_gap_m of each other (the catalog has
    many near-duplicate variants of one gate, e.g. Huwara / Huwara-gate / Huwara-bridge).
    Keeps the most important per cluster (closed > open, then nearest to the route)."""
    kept = []
    for o in sorted(on_route, key=lambda x: (0 if x.get("closed") else 1, x.get("distance_m", 1e9))):
        coords = o["checkpoint"].get("coordinates") or {}
        lat, lon = coords.get("lat"), coords.get("lon")
        is_dup = False
        if lat is not None and lon is not None:
            for k in kept:
                kc = k["checkpoint"].get("coordinates") or {}
                if kc.get("lat") is None or kc.get("lon") is None:
                    continue
                if _point_dist_m((lat, lon), (kc["lat"], kc["lon"])) <= min_gap_m:
                    is_dup = True
                    break
        if not is_dup:
            kept.append(o)
    return sorted(kept, key=lambda o: o["along_km"])


def closed_checkpoints(on_route: list) -> list:
    """The closed entries from a checkpoints_on_route result."""
    return [o for o in on_route if o.get("closed")]


def exclude_polygons(closed: list, box_m: float = 200.0) -> list:
    """Small square avoid-polygons (GeoJSON [lon,lat] rings) around each closed
    checkpoint, for a routing engine's exclude_polygons / avoid_polygons. The box is
    kept small so it removes the blocked node without isolating the destination."""
    polys = []
    for o in closed:
        coords = o["checkpoint"].get("coordinates") or {}
        lat, lon = coords.get("lat"), coords.get("lon")
        if lat is None or lon is None:
            continue
        dlat = (box_m / _M_PER_DEG_LAT) / 2.0
        dlon = (box_m / max(1.0, _m_per_deg_lon(lat))) / 2.0
        ring = [
            [lon - dlon, lat - dlat],
            [lon + dlon, lat - dlat],
            [lon + dlon, lat + dlat],
            [lon - dlon, lat + dlat],
            [lon - dlon, lat - dlat],  # close the ring
        ]
        polys.append(ring)
    return polys
