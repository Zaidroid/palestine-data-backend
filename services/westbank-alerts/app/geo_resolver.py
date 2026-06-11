"""
Geo resolver — stamps coordinates, governorate and Oslo-area classification
onto checkpoint rows, and classifies arbitrary points for alert enrichment.

Two capabilities:

1. resolve_place(name_ar) — coordinate resolution ladder for a checkpoint /
   place phrase:
     a. checkpoint KB exact/alias/fuzzy        → precision "checkpoint"
     b. location KB after stripping checkpoint stopwords, token-by-token
        (longest first), then bigrams, then substring → precision "town"
   Checkpoints are usually named after the town/junction they guard, so a
   town-center fallback is accurate to ~1-2 km — flagged as approximate.

2. classify_point(lat, lon) — pure-python point-in-polygon against
   data/admin/admin2.geojson (governorate) and data/admin/oslo.geojson
   (Oslo classes). Area "B" is derived by elimination: inside a West Bank
   governorate but in no Oslo class polygon → "B" (the source layer only
   ships A/C/H1/H2/Nature Reserve/EJ/No Man's Land).
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

log = logging.getLogger("geo_resolver")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ADMIN_CANDIDATES = [DATA_DIR / "admin", Path("/data/admin")]

# Words that describe the checkpoint rather than the place it guards.
_STOPWORDS = {
    "مدخل", "بوابه", "حاجز", "اشارات", "اشاره", "خط", "طلوع", "البلد",
    "الشمالي", "الجنوبي", "الغربي", "الشرقي", "شارع", "مفرق", "جسر",
    "نقطه", "معبر", "قريه", "بلده", "عسكري", "برج", "دوار", "اتجاهين",
    "بحري", "الطريق", "نزول", "تحويله",
}

_ALEF = re.compile(r"[إأآٱا]")
_TAA = re.compile(r"ة")
_YAA = re.compile(r"[ىي]")


def _norm(s: str) -> str:
    s = _ALEF.sub("ا", s or "")
    s = _TAA.sub("ه", s)
    s = _YAA.sub("ي", s)
    return re.sub(r"\s+", " ", re.sub(r"[^؀-ۿa-z0-9 ]", "", s.lower())).strip()


# ── point-in-polygon ─────────────────────────────────────────────────────────

def _ring_contains(ring, lon: float, lat: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _polygon_contains(coords, lon: float, lat: float) -> bool:
    """Polygon coords = [outer, hole, hole...]."""
    if not coords or not _ring_contains(coords[0], lon, lat):
        return False
    for hole in coords[1:]:
        if _ring_contains(hole, lon, lat):
            return False
    return True


def _geom_contains(geom: dict, lon: float, lat: float) -> bool:
    if geom["type"] == "Polygon":
        return _polygon_contains(geom["coordinates"], lon, lat)
    if geom["type"] == "MultiPolygon":
        return any(_polygon_contains(p, lon, lat) for p in geom["coordinates"])
    return False


def _bbox(geom: dict):
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0])
            ys.append(c[1])
        else:
            for x in c:
                walk(x)

    walk(geom["coordinates"])
    return (min(xs), min(ys), max(xs), max(ys))


class _PolygonIndex:
    def __init__(self, features: list, name_of):
        self.items = []
        for f in features:
            geom = f.get("geometry")
            if not geom:
                continue
            self.items.append((name_of(f), _bbox(geom), geom))

    def locate(self, lon: float, lat: float) -> Optional[str]:
        for name, (x0, y0, x1, y1), geom in self.items:
            if x0 <= lon <= x1 and y0 <= lat <= y1 and _geom_contains(geom, lon, lat):
                return name
        return None


_gov_index: Optional[_PolygonIndex] = None
_oslo_index: Optional[_PolygonIndex] = None


def _load_geojson(filename: str) -> Optional[dict]:
    for base in ADMIN_CANDIDATES:
        p = base / filename
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                log.error(f"Failed reading {p}: {e}")
    return None


def load_polygon_indexes() -> None:
    """Load governorate + Oslo polygons. Call once at startup."""
    global _gov_index, _oslo_index
    adm2 = _load_geojson("admin2.geojson")
    if adm2:
        wb = [f for f in adm2["features"] if f["properties"].get("adm1_name") == "West Bank"]
        _gov_index = _PolygonIndex(wb, lambda f: f["properties"].get("adm2_name"))
        log.info(f"Loaded {len(wb)} West Bank governorate polygons")
    oslo = _load_geojson("oslo.geojson")
    if oslo:
        _oslo_index = _PolygonIndex(oslo["features"], lambda f: f["properties"].get("CLASS"))
        log.info(f"Loaded {len(oslo['features'])} Oslo-class polygons")


def classify_point(lat: Optional[float], lon: Optional[float]) -> dict:
    """Return {"governorate": ..., "oslo_area": ...} for a WGS84 point."""
    out = {"governorate": None, "oslo_area": None}
    if lat is None or lon is None:
        return out
    if _gov_index:
        out["governorate"] = _gov_index.locate(lon, lat)
    if _oslo_index:
        cls = _oslo_index.locate(lon, lat)
        if cls is None and out["governorate"]:
            cls = "B"  # inside a WB governorate but in no shipped class → Area B
        out["oslo_area"] = cls
    return out


# ── coordinate resolution ────────────────────────────────────────────────────

def resolve_place(name_ar: str) -> Optional[dict]:
    """
    Resolve an Arabic place/checkpoint phrase to coordinates.
    Returns {"latitude", "longitude", "region", "name_en", "precision"} or None.
    """
    if not name_ar or len(name_ar.strip()) < 2:
        return None

    normed = _norm(name_ar)
    parts = [t for t in normed.split(" ") if t not in _STOPWORDS]

    # 1. curated checkpoint KB (exact coords)
    from .checkpoint_knowledge_base import get_knowledge_base
    cp_kb = get_knowledge_base()
    if cp_kb:
        def cp_hit(key: Optional[str]) -> Optional[dict]:
            if not key:
                return None
            cp = cp_kb.get_checkpoint(key)
            if cp and cp.get("latitude") and cp.get("longitude"):
                return {
                    "latitude": cp["latitude"],
                    "longitude": cp["longitude"],
                    "region": cp.get("region"),
                    "name_en": cp.get("name_en"),
                    "precision": "checkpoint",
                }
            return None

        r = cp_hit(cp_kb.find_checkpoint(name_ar))
        if r:
            return r
        # retry after stripping checkpoint stopwords ("الكونتينر بحري اتجاهين" → "الكونتينر"),
        # then token/bigram lookups straight against the KB indexes
        stripped = " ".join(parts)
        if stripped and stripped != normed:
            r = cp_hit(cp_kb.find_checkpoint(stripped))
            if r:
                return r
        for i in range(len(parts) - 1):
            big = f"{parts[i]} {parts[i + 1]}"
            r = cp_hit(cp_kb.by_name_norm.get(big) or cp_kb.aliases.get(big))
            if r:
                return r
        for t in sorted([t for t in parts if len(t) > 2], key=len, reverse=True):
            r = cp_hit(cp_kb.by_name_norm.get(t) or cp_kb.aliases.get(t))
            if r:
                return r

    # 2. location KB (town the checkpoint is named after)
    from .location_knowledge_base import get_location_kb
    loc_kb = get_location_kb()
    if not loc_kb:
        return None

    def hit(key: Optional[str]) -> Optional[dict]:
        if not key:
            return None
        coords = loc_kb.get_coordinates(key)
        if not coords:
            return None
        loc = loc_kb.get_location(key) or {}
        return {
            "latitude": coords[0],
            "longitude": coords[1],
            "region": loc.get("governorate"),
            "name_en": loc.get("name_en"),
            "precision": "town",
        }

    joined = normed.replace(" ", "")

    # exact / alias
    r = hit(loc_kb.by_name_norm.get(normed) or loc_kb.aliases.get(normed))
    if r:
        return r

    # bigrams (more specific than single tokens)
    for i in range(len(parts) - 1):
        big = f"{parts[i]} {parts[i + 1]}"
        r = hit(loc_kb.by_name_norm.get(big) or loc_kb.aliases.get(big))
        if r:
            return r
    # single tokens, longest first
    for t in sorted([t for t in parts if len(t) > 2], key=len, reverse=True):
        r = hit(loc_kb.by_name_norm.get(t) or loc_kb.aliases.get(t))
        if r:
            return r
    # substring scan (longest KB names first)
    for name_norm, key in loc_kb.all_names:
        if len(name_norm) > 3 and name_norm.replace(" ", "") in joined:
            r = hit(key)
            if r:
                return r
    return None


# ── checkpoint backfill ──────────────────────────────────────────────────────

async def geocode_checkpoints(force: bool = False) -> dict:
    """
    Stamp coordinates + governorate + oslo_area on checkpoint rows.
    force=False only touches rows missing coordinates; force=True re-resolves all.
    Idempotent — safe to run at startup and on demand.
    """
    from .checkpoint_db import get_checkpoint_db

    stats = {"scanned": 0, "resolved": 0, "exact": 0, "approx": 0, "unresolved": 0, "classified": 0}
    async with get_checkpoint_db() as db:
        where = "" if force else "WHERE latitude IS NULL OR oslo_area IS NULL OR governorate IS NULL"
        cur = await db.execute(f"SELECT canonical_key, name_ar, latitude, longitude FROM checkpoints {where}")
        rows = await cur.fetchall()
        for key, name_ar, lat, lon in rows:
            stats["scanned"] += 1
            if lat is None or force:
                r = resolve_place(name_ar or key)
                if r:
                    lat, lon = r["latitude"], r["longitude"]
                    stats["resolved"] += 1
                    stats["exact" if r["precision"] == "checkpoint" else "approx"] += 1
                    await db.execute(
                        "UPDATE checkpoints SET latitude=?, longitude=?, "
                        "region=COALESCE(region, ?), name_en=COALESCE(name_en, ?), geo_precision=? "
                        "WHERE canonical_key=?",
                        (lat, lon, r.get("region"), r.get("name_en"), r["precision"], key),
                    )
                else:
                    stats["unresolved"] += 1
                    continue
            cls = classify_point(lat, lon)
            if cls["governorate"] or cls["oslo_area"]:
                stats["classified"] += 1
                await db.execute(
                    "UPDATE checkpoints SET governorate=?, oslo_area=? WHERE canonical_key=?",
                    (cls["governorate"], cls["oslo_area"], key),
                )
        await db.commit()
    log.info(f"geocode_checkpoints: {stats}")
    return stats
