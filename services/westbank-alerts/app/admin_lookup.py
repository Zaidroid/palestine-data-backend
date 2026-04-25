"""
Reverse-geocode (lat, lng) → admin1/admin2 from OCHA cod-ab-pse polygons.

Loads admin1.geojson + admin2.geojson once at import; subsequent
point_to_admin() calls do ray-casting in-memory. Polygon counts are tiny
(2 admin1 + 16 admin2) so no spatial index is needed.

Polygon source files:
  /app/data/admin/admin1.geojson  (image-baked via Dockerfile)
  /app/data/admin/admin2.geojson  (image-baked via Dockerfile)

If the volume mount of /data shadows /app/data we also try /data/admin/
(same fallback pattern as location_knowledge_base.py).
"""

import json
import logging
from pathlib import Path
from typing import Optional, Tuple

log = logging.getLogger(__name__)

_admin1_features: list[dict] = []
_admin2_features: list[dict] = []


def _load_one(filename: str) -> list[dict]:
    candidates = [
        Path("/app/data/admin") / filename,
        Path("/data/admin") / filename,
        Path(__file__).resolve().parent.parent / "data" / "admin" / filename,
    ]
    for path in candidates:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            features = data.get("features", []) or []
            log.info(f"admin_lookup: loaded {len(features)} from {path}")
            return features
        except Exception as e:
            log.warning(f"admin_lookup: failed to load {path}: {e}")
    log.warning(f"admin_lookup: {filename} not found in any candidate path")
    return []


def init() -> None:
    """Load both admin levels. Idempotent — safe to call from app startup."""
    global _admin1_features, _admin2_features
    _admin1_features = _load_one("admin1.geojson")
    _admin2_features = _load_one("admin2.geojson")


def _point_in_ring(lng: float, lat: float, ring) -> bool:
    """Standard ray-casting on one ring of [lng, lat] coords."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        intersect = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def _point_in_feature(lng: float, lat: float, feature: dict) -> bool:
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        if not coords:
            return False
        if not _point_in_ring(lng, lat, coords[0]):
            return False
        for hole in coords[1:]:
            if _point_in_ring(lng, lat, hole):
                return False
        return True
    if gtype == "MultiPolygon":
        for poly in coords:
            if not poly or not _point_in_ring(lng, lat, poly[0]):
                continue
            in_hole = False
            for hole in poly[1:]:
                if _point_in_ring(lng, lat, hole):
                    in_hole = True
                    break
            if not in_hole:
                return True
    return False


def point_to_admin(lat: Optional[float], lng: Optional[float]) -> Tuple[Optional[str], Optional[str]]:
    """Return (admin1_name, admin2_name) for a coordinate, or (None, None)
    if the point falls outside Palestine or coords are missing."""
    if lat is None or lng is None:
        return (None, None)
    try:
        lat = float(lat); lng = float(lng)
    except (TypeError, ValueError):
        return (None, None)
    a1 = next(
        (f["properties"].get("adm1_name")
         for f in _admin1_features if _point_in_feature(lng, lat, f)),
        None,
    )
    a2 = next(
        (f["properties"].get("adm2_name")
         for f in _admin2_features if _point_in_feature(lng, lat, f)),
        None,
    )
    return (a1, a2)
