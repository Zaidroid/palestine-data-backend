"""Phase E / E3 — crowdsource report endpoint (POST /v2/report)."""
from __future__ import annotations

import hashlib
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..checkpoint_knowledge_base import get_knowledge_base
from ..reports import process_report

router = APIRouter(prefix="/v2", tags=["report"])


class ReportRequest(BaseModel):
    status: str
    canonical_key: Optional[str] = None
    direction: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None


@router.post("/report")
async def submit_report(req: ReportRequest, request: Request):
    ua = request.headers.get("user-agent", "")
    ip = request.client.host if request.client else "unknown"
    reporter_hash = hashlib.sha256(f"{ip}|{ua}".encode("utf-8")).hexdigest()[:32]
    try:
        res = await process_report(req.model_dump(), reporter_hash, kb=get_knowledge_base())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if res.get("status") == "rate_limited":
        raise HTTPException(status_code=429, detail="Too many reports — slow down")
    return res
