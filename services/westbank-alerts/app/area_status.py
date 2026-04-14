"""
Area Status — computed view over checkpoint data.

Groups checkpoint_status records by region and computes an area-level
security status (calm / restricted / military_presence / lockdown).

No separate DB table — recomputed from live checkpoint data on demand
and cached in memory.
"""

import logging
from datetime import datetime
from typing import Optional

from .checkpoint_db import get_all_checkpoints
from .location_knowledge_base import get_location_kb

log = logging.getLogger("area_status")

# Status hierarchy: lockdown > military_presence > restricted > calm
STATUS_WEIGHTS = {
    "lockdown": 4,
    "military_presence": 3,
    "restricted": 2,
    "calm": 1,
}

# Checkpoint statuses that count as "military"
MILITARY_STATUSES = {"idf", "police", "inspection"}

# In-memory cache
_area_cache: list[dict] = []
_cache_at: Optional[datetime] = None


def _compute_status(
    total: int, closed: int, idf: int, police: int, inspection: int
) -> str:
    military = idf + police + inspection
    if total == 0:
        return "calm"
    closed_ratio = closed / total
    if closed_ratio >= 0.5 or idf >= 3:
        return "lockdown"
    if idf >= 1:
        return "military_presence"
    if closed >= 1 or police >= 1 or inspection >= 1:
        return "restricted"
    return "calm"


def _severity_score(status: str, closed: int, idf: int, police: int) -> int:
    base = {"calm": 0, "restricted": 2, "military_presence": 5, "lockdown": 8}
    score = base.get(status, 0)
    score += min(closed, 5)  # +1 per closed checkpoint, cap at 5
    score += idf * 2
    score += police
    return min(score, 10)


async def compute_area_status() -> list[dict]:
    """Compute area-level status from live checkpoint data."""
    global _area_cache, _cache_at

    checkpoints = await get_all_checkpoints(active_only=True)

    # Group by region
    regions: dict[str, list[dict]] = {}
    for cp in checkpoints:
        region = cp.get("region")
        if not region:
            continue
        regions.setdefault(region, []).append(cp)

    loc_kb = get_location_kb()
    results = []

    for region, cps in sorted(regions.items()):
        total = len(cps)
        by_status: dict[str, int] = {}
        latest_update = None

        for cp in cps:
            s = cp.get("status", "unknown")
            by_status[s] = by_status.get(s, 0) + 1
            lu = cp.get("last_updated")
            if lu and (latest_update is None or lu > latest_update):
                latest_update = lu

        open_count = by_status.get("open", 0)
        closed_count = by_status.get("closed", 0)
        idf_count = by_status.get("idf", 0)
        police_count = by_status.get("police", 0)
        inspection_count = by_status.get("inspection", 0)

        status = _compute_status(
            total, closed_count, idf_count, police_count, inspection_count
        )
        score = _severity_score(status, closed_count, idf_count, police_count)

        # Resolve area metadata from location KB
        area_ar = region
        area_en = region
        lat, lng = None, None
        zone = None

        if loc_kb:
            loc_key = loc_kb.find_location(region)
            if not loc_key:
                loc_key = loc_kb.by_english.get(region.lower())
            if loc_key:
                loc = loc_kb.get_location(loc_key)
                if loc:
                    area_ar = loc.get("name_ar", region)
                    area_en = loc.get("name_en", region)
                    lat = loc.get("latitude")
                    lng = loc.get("longitude")
                    zone = loc.get("zone")

        results.append({
            "area": region,
            "area_ar": area_ar,
            "area_en": area_en,
            "zone": zone,
            "latitude": lat,
            "longitude": lng,
            "status": status,
            "severity_score": score,
            "total_checkpoints": total,
            "open": open_count,
            "closed": closed_count,
            "idf": idf_count,
            "police": police_count,
            "inspection": inspection_count,
            "by_status": by_status,
            "last_updated": latest_update.isoformat()
            if isinstance(latest_update, datetime)
            else latest_update,
        })

    # Sort by severity score descending
    results.sort(key=lambda x: -x["severity_score"])

    _area_cache = results
    _cache_at = datetime.utcnow()
    log.info(f"Area status recomputed: {len(results)} areas")
    return results


def get_cached_area_status() -> list[dict]:
    """Return cached area status (empty list if never computed)."""
    return _area_cache


def get_area_detail(region: str) -> Optional[dict]:
    """Return single area from cache by region key."""
    for area in _area_cache:
        if area["area"] == region or area["area_en"].lower() == region.lower():
            return area
    return None
