"""MiniMax cross-channel incident clustering (Phase B / B3).

When the deterministic type+area merge in incident_grouper fails, ask MiniMax
whether the new alert is the SAME real-world event as one of a small set of recent
same-type incidents (different channels often word the location differently). The
returned id is validated against the candidate set, so the model can't point at an
incident that wasn't offered. Any failure / low confidence → no merge.
"""
from __future__ import annotations

import json
from typing import Optional

from .minimax_client import get_client

MERGE_MIN_CONFIDENCE = 0.7

_SYSTEM = (
    "You decide whether a new West Bank security alert describes the SAME real-world "
    "event as one of the candidate incidents (same place, same time window, same "
    "happening — different sources phrase locations differently). Return JSON "
    '{"same_event_id": <candidate id or null>, "confidence": 0..1}. Only return an id '
    "from the provided candidate list; if unsure, return null."
)
_SCHEMA = '{"same_event_id": <int|null>, "confidence": <0..1>}'


def _build_user(alert: dict, candidates: list) -> str:
    lines = [
        "NEW ALERT:",
        f"  type: {alert.get('incident_type')}",
        f"  area: {alert.get('area')}",
        f"  time: {alert.get('timestamp')}",
        f"  title: {alert.get('title')}",
        "",
        "CANDIDATE INCIDENTS:",
    ]
    for c in candidates:
        lines.append(
            f"  id={c.get('id')} | area={c.get('area')} | started={c.get('started_at')} "
            f"| {(c.get('narrative') or '')[:160]}")
    return "\n".join(lines)


async def should_merge_llm(alert: dict, candidates: list, *, client=None) -> dict:
    """Return {"incident_id": <id|None>, "confidence": float}."""
    if not candidates:
        return {"incident_id": None, "confidence": 0.0}
    client = client or get_client()
    cache_key = "inc:" + json.dumps(
        [alert.get("title"), alert.get("area"), sorted(c.get("id") for c in candidates)],
        ensure_ascii=False, sort_keys=True)
    result = await client.complete_json(_SYSTEM, _build_user(alert, candidates),
                                        schema_hint=_SCHEMA, cache_key=cache_key)
    if not result:
        return {"incident_id": None, "confidence": 0.0}

    raw_id = result.get("same_event_id")
    try:
        conf = float(result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        conf = 0.0
    valid_ids = {c.get("id") for c in candidates}
    if raw_id in valid_ids and conf >= MERGE_MIN_CONFIDENCE:
        return {"incident_id": raw_id, "confidence": conf}
    return {"incident_id": None, "confidence": conf}
