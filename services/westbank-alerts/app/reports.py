"""Crowdsource report + verify (Phase E / E3).

A user-submitted checkpoint status. When it matches a curated checkpoint (by key or by
nearest coordinate) it is applied as a CROWD update through the existing
insert/upsert path — so it benefits from the established crowd-confidence logic
(≥3 agreeing crowd reports within an hour → confidence "medium") and never outranks an
admin report. An unrecognised name is queued as a review candidate (Phase C). Volume per
reporter is rate-limited.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from . import checkpoint_db as cpdb
from .checkpoint_parser import _normalise

VALID_STATUSES = {"open", "closed", "congested", "slow", "idf", "police", "inspection"}


async def process_report(payload: dict, reporter_hash: str, *, kb=None,
                         now: Optional[datetime] = None, max_per_min: int = 10) -> dict:
    status = payload.get("status")
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid status: {status}")

    now = now or datetime.utcnow()
    since = (now - timedelta(seconds=60)).isoformat()
    if await cpdb.count_recent_user_reports(reporter_hash, since) >= max_per_min:
        return {"status": "rate_limited"}

    key = payload.get("canonical_key")
    lat, lon = payload.get("lat"), payload.get("lon")
    direction = payload.get("direction") or ""

    matched = None
    if key and (kb is None or kb.is_known(key)):
        matched = key
    elif lat is not None and lon is not None:
        near = await cpdb.find_nearest_checkpoint(lat, lon)
        if near:
            matched = near["canonical_key"]

    await cpdb.insert_user_report(matched, status, direction or None, lat, lon, reporter_hash)

    if matched:
        upd = {
            "canonical_key": matched, "name_raw": matched, "status": status,
            "status_raw": "user", "direction": direction,
            "source_type": "crowd", "source_channel": "user_report",
            "source_msg_id": None, "raw_message": "user report", "raw_line": "user report",
            "timestamp": now,
        }
        await cpdb.insert_checkpoint_update(upd)
        await cpdb.upsert_checkpoint_status(upd, is_admin=False, channel="user_report")
        return {"status": "recorded", "canonical_key": matched, "applied": True}

    queued = False
    if key:
        await cpdb.upsert_candidate(raw_name=key, normalized=_normalise(key), mentions=1)
        queued = True
    return {"status": "recorded", "applied": False, "queued_as_candidate": queued}
