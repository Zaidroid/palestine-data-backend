"""MiniMax checkpoint extraction fallback (Phase B / B2).

Second-tier extractor for messages the strict whitelist parser fails on. It asks
MiniMax to pull structured status reports out of messy Arabic, then validates every
report HARD against the curated catalog:

  * the name must resolve to a known canonical_key (kb.find_checkpoint) — otherwise
    the report is dropped. The LLM can never mint a checkpoint outside the catalog.
  * the status must be a known status enum value.
  * coordinates are NEVER taken from the LLM — they come from the catalog later.

Returns updates in the SAME dict shape the strict parser emits, so the monitor reuses
insert_checkpoint_update / upsert_checkpoint_status unchanged. Any failure → [].
"""
from __future__ import annotations

import hashlib
from typing import Optional

from ..checkpoint_strict_validator import CheckpointStrictValidator
from .minimax_client import get_client

VALID_STATUSES = {"open", "closed", "congested", "slow", "idf", "police", "inspection"}

_STATUS_SYNONYMS = {
    "open": "open", "passable": "open", "flowing": "open", "clear": "open",
    "closed": "closed", "blocked": "closed", "shut": "closed",
    "congested": "congested", "congestion": "congested", "traffic": "congested",
    "jam": "congested", "busy": "congested", "crowded": "congested",
    "slow": "slow",
    "idf": "idf", "army": "idf", "military": "idf", "soldiers": "idf", "troops": "idf",
    "police": "police",
    "inspection": "inspection", "checking": "inspection", "search": "inspection",
}

_DIRECTION_SYNONYMS = {
    "inbound": "inbound", "in": "inbound", "entering": "inbound", "into": "inbound",
    "outbound": "outbound", "out": "outbound", "leaving": "outbound", "exiting": "outbound",
    "both": "both", "both_directions": "both", "two-way": "both", "bidirectional": "both",
}

_SYSTEM = (
    "You extract Israeli military checkpoint status reports from short Arabic "
    "road-conditions messages from the West Bank. Return ONLY the checkpoints whose "
    "status is explicitly reported. Do NOT guess, translate, or invent names — copy the "
    "Arabic name as written. status must be one of: open, closed, congested, slow, idf, "
    "police, inspection. direction is inbound, outbound, both, or omitted."
)
_SCHEMA = ('{"reports": [{"checkpoint_name": "<arabic>", "status": "<enum>", '
           '"direction": "<inbound|outbound|both|>", "status_raw": "<arabic word>"}]}')


def _norm_status(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return _STATUS_SYNONYMS.get(str(s).strip().lower())


def _norm_direction(d: Optional[str]) -> Optional[str]:
    if not d:
        return None
    return _DIRECTION_SYNONYMS.get(str(d).strip().lower())


def _cache_key(raw: str) -> str:
    return "cpext:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def extract_checkpoint_llm(raw: str, kb, *, client=None) -> list:
    """Return strict-parser-shaped update dicts, or [] on any miss/failure."""
    if kb is None:
        return []
    client = client or get_client()
    result = await client.complete_json(_SYSTEM, raw, schema_hint=_SCHEMA,
                                        cache_key=_cache_key(raw))
    if not result:
        return []

    out = []
    seen = set()
    for r in (result.get("reports") or []):
        name = (r.get("checkpoint_name") or "").strip()
        if not name:
            continue
        key = kb.find_checkpoint(name)        # ← hallucination guard
        if not key:
            continue
        entry = kb.get_checkpoint(key) or {}
        name_ar = entry.get("name_ar") or name

        status = _norm_status(r.get("status"))
        if status not in VALID_STATUSES:
            continue
        direction = _norm_direction(r.get("direction"))

        ok, _reason = CheckpointStrictValidator.validate_parsed_checkpoint(
            name_ar, status, direction)
        if not ok:
            continue

        dedup = (key, direction or "")
        if dedup in seen:
            continue
        seen.add(dedup)

        out.append({
            "canonical_key": key,
            "name_raw": name_ar,
            "status": status,
            "status_raw": (r.get("status_raw") or status),
            "direction": direction or "",
            "raw_line": raw,
            "extraction_method": "llm",
        })
    return out
