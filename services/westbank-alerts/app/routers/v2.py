"""Phase A — unified, validated canonical feeds (/v2).

Additive, read-only endpoints that give the frontend ONE normalized source of
truth for checkpoints and incidents, with freshness + source-trust + provenance +
a staleness-honest `effective_status`. The v1 endpoints are untouched; these derive
from the same tables via the provenance layer so the two never diverge.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from .. import checkpoint_db as cpdb
from .. import incident_db
from ..config import settings
from ..db_pool import get_alerts_db
from ..serving import provenance as P

router = APIRouter(prefix="/v2", tags=["v2"])

_STALE = settings.CHECKPOINT_STALE_HOURS


def _cp_envelope(cp: dict) -> dict:
    # Use the RAW last_updated (None when never reported) so freshness can return
    # band "none" instead of treating a never-reported checkpoint as fresh.
    src = {**cp, "last_updated": cp.get("last_updated_iso")}
    return P.checkpoint_envelope(src, stale_hours=_STALE)


@router.get("/checkpoints")
async def v2_checkpoints(
    region: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="filter by effective_status"),
):
    cps = await cpdb.get_all_checkpoints(region=region)
    envs = [_cp_envelope(c) for c in cps]
    if status:
        envs = [e for e in envs if e["effective_status"] == status]
    return {"checkpoints": envs, "total": len(envs),
            "stale_hours": _STALE}


@router.get("/checkpoints/geojson")
async def v2_checkpoints_geojson(region: Optional[str] = Query(None)):
    cps = await cpdb.get_all_checkpoints(region=region)
    features = []
    for c in cps:
        env = _cp_envelope(c)
        lat, lon = env["coordinates"]["lat"], env["coordinates"]["lon"]
        if lat is None or lon is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": env,
        })
    return {"type": "FeatureCollection", "features": features}


async def _members_by_incident(incident_ids: list) -> dict:
    """One batched query → {incident_id: [member alert dicts]}."""
    if not incident_ids:
        return {}
    placeholders = ",".join("?" * len(incident_ids))
    async with get_alerts_db() as db:
        cur = await db.execute(
            f"SELECT ia.incident_id, a.id, a.source, a.confidence, a.trust_score "
            f"FROM incident_alerts ia JOIN alerts a ON a.id = ia.alert_id "
            f"WHERE ia.incident_id IN ({placeholders}) AND a.status='active' "
            f"ORDER BY a.id",
            incident_ids,
        )
        rows = await cur.fetchall()
    out: dict = {}
    for inc_id, aid, source, conf, trust in rows:
        out.setdefault(inc_id, []).append(
            {"id": aid, "source": source, "confidence": conf, "trust_score": trust})
    return out


@router.get("/incidents")
async def v2_incidents(limit: int = Query(50, ge=1, le=200)):
    incidents = await incident_db.get_active_incidents(limit=limit)
    members = await _members_by_incident([i["id"] for i in incidents])
    envs = [P.incident_envelope(i, members.get(i["id"], []), stale_hours=_STALE)
            for i in incidents]
    return {"incidents": envs, "total": len(envs)}


@router.get("/incidents/{incident_id}")
async def v2_incident_detail(incident_id: int):
    inc = await incident_db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident #{incident_id} not found")
    members = await _members_by_incident([incident_id])
    return P.incident_envelope(inc, members.get(incident_id, []), stale_hours=_STALE)
