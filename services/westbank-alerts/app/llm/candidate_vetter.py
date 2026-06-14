"""MiniMax candidate vetter (Phase C).

Given a corpus-discovered Arabic name, ask MiniMax whether it is a real West Bank
checkpoint/gate (vs traffic chatter, a status word, a generic noun), and what its
canonical Arabic name + governorate are. Used as ONE gate in the promotion pipeline —
its verdict is always combined with a real geocode + a mention threshold before any
auto-promotion. Returns None on any LLM failure (→ candidate stays pending).
"""
from __future__ import annotations

import hashlib
from typing import Optional

from .minimax_client import get_client

_SYSTEM = (
    "You verify candidate place names harvested from West Bank road-conditions chatter. "
    "Decide whether the name is a REAL Israeli military checkpoint, gate, or barrier "
    "location (not a status word like 'كثافة سير'/'مغلق', not a generic noun, not a "
    "vehicle/person). Give the canonical Arabic name and the governorate."
)
_SCHEMA = ('{"is_real_checkpoint": <true|false>, "suggested_name_ar": "<arabic>", '
           '"governorate": "<English governorate>", "confidence": <0..1>}')


def _cache_key(name: str) -> str:
    return "vet:" + hashlib.sha256(name.encode("utf-8")).hexdigest()


async def vet_checkpoint_candidate(name: str, *, context: Optional[str] = None,
                                   client=None) -> Optional[dict]:
    client = client or get_client()
    user = name if not context else f"{name}\n\nContext:\n{context}"
    result = await client.complete_json(_SYSTEM, user, schema_hint=_SCHEMA,
                                        cache_key=_cache_key(name))
    if not result:
        return None
    try:
        conf = float(result.get("confidence") or 0.0)
    except (TypeError, ValueError):
        conf = 0.0
    return {
        "is_real_checkpoint": bool(result.get("is_real_checkpoint")),
        "suggested_name_ar": result.get("suggested_name_ar") or name,
        "governorate": result.get("governorate"),
        "confidence": conf,
    }
