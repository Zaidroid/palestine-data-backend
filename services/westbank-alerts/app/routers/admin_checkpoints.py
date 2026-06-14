"""Phase C — checkpoint candidate review + self-improvement metrics.

Admin endpoints (X-API-Key) to work the review queue, plus a public /quality/checkpoints
metrics view. Promotion reuses the same path as auto-promotion so the source of truth
and the live DB converge.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import APIKeyHeader
from pydantic import BaseModel

from .. import checkpoint_db as cpdb
from ..config import settings
from ..learner_checkpoints import _promote
from ..llm.minimax_client import get_client
from ..serving import provenance as P

router = APIRouter(tags=["self-improvement"])

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _require_key(key: Optional[str] = Depends(_api_key_header)):
    if key != settings.API_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    return key


@router.get("/admin/checkpoint-candidates")
async def list_candidates(status: Optional[str] = Query("pending"),
                          limit: int = Query(200, ge=1, le=1000),
                          _: str = Depends(_require_key)):
    cands = await cpdb.get_candidates(status=status, limit=limit)
    return {"candidates": cands, "total": len(cands), "status": status}


class CandidateAction(BaseModel):
    action: str  # "approve" | "reject"


@router.post("/admin/checkpoint-candidates/{candidate_id}")
async def review_candidate(candidate_id: int, body: CandidateAction,
                           _: str = Depends(_require_key)):
    cand = await cpdb.get_candidate(candidate_id)
    if not cand:
        raise HTTPException(status_code=404, detail=f"Candidate #{candidate_id} not found")
    if body.action == "approve":
        from ..checkpoint_knowledge_base import get_knowledge_base
        await _promote(cand, get_knowledge_base())
        return {"id": candidate_id, "status": "promoted"}
    if body.action == "reject":
        await cpdb.set_candidate_review(candidate_id, status="rejected", reviewed_by="admin")
        return {"id": candidate_id, "status": "rejected"}
    raise HTTPException(status_code=400, detail="action must be 'approve' or 'reject'")


@router.post("/admin/ingest-obstacles")
async def ingest_obstacles(_: str = Depends(_require_key)):
    """Pull OSM obstacles, dedupe vs the catalog, seed new ones as a static 'osm'
    layer. Idempotent. (OCHA HDX shapefile ingest is a documented follow-up.)"""
    from ..ingest import run_osm_ingest
    return await run_osm_ingest()


@router.get("/quality/checkpoints")
async def checkpoint_quality():
    """Self-improvement + freshness metrics (public, mirrors /quality/eval)."""
    counts = await cpdb.candidate_counts()
    cps = await cpdb.get_all_checkpoints()
    bands = {"live": 0, "recent": 0, "stale": 0, "none": 0}
    for c in cps:
        b = P.freshness(c.get("last_updated_iso"),
                        stale_hours=settings.CHECKPOINT_STALE_HOURS)["freshness_band"]
        bands[b] = bands.get(b, 0) + 1
    return {
        "candidates": counts,
        "freshness": bands,
        "total_checkpoints": len(cps),
        "llm": get_client().stats(),
        "auto_promote_enabled": settings.CANDIDATE_AUTO_PROMOTE,
    }
