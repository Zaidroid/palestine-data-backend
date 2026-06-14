"""Checkpoint self-improvement loop (Phase C).

Turns the silently-ignored corpus candidates (data/checkpoint_directory.json, ~750
names) and live parser-misses into a real review pipeline:

    directory / misses → checkpoint_candidates (mentions accrue)
                       → geocode (geo_resolver) + LLM vet (MiniMax)
                       → auto-promote ONLY if every gate passes; else await human review

Auto-promotion ships OFF (CANDIDATE_AUTO_PROMOTE=False) — the cycle just populates the
review queue until precision is observed. The promotion gate is a pure function so it
is exhaustively tested.
"""
from __future__ import annotations

import logging
from pathlib import Path

from . import checkpoint_db as cpdb
from .checkpoint_parser import _normalise
from .config import settings

log = logging.getLogger("learner_cp")


def should_auto_promote(candidate: dict, *, min_mentions: int,
                        min_confidence: float, enabled: bool) -> bool:
    """Strict gate — ALL must hold: feature enabled, enough mentions, geocoded,
    LLM says it's a real checkpoint, and confidence clears the bar."""
    if not enabled:
        return False
    if (candidate.get("mentions") or 0) < min_mentions:
        return False
    if candidate.get("suggested_lat") is None or candidate.get("suggested_lon") is None:
        return False
    if candidate.get("llm_verdict") != "real":
        return False
    if (candidate.get("llm_confidence") or 0) < min_confidence:
        return False
    return True


def _load_directory() -> list:
    for p in (Path("/data/checkpoint_directory.json"),
              Path(__file__).resolve().parent.parent / "data" / "checkpoint_directory.json"):
        if p.exists():
            import json
            data = json.loads(p.read_text(encoding="utf-8"))
            return data.get("checkpoints", []) if isinstance(data, dict) else (data or [])
    return []


async def run_candidate_cycle(*, directory=None, kb=None, vetter=None, geocoder=None,
                              min_mentions=None, min_confidence=None,
                              auto_promote=None) -> dict:
    """One self-improvement pass. All collaborators are injectable for testing.

    Returns a small stats dict. Never raises on a single candidate failure.
    """
    from .checkpoint_knowledge_base import get_knowledge_base

    directory = _load_directory() if directory is None else directory
    kb = get_knowledge_base() if kb is None else kb
    min_mentions = settings.CANDIDATE_MIN_MENTIONS if min_mentions is None else min_mentions
    min_confidence = settings.CANDIDATE_MIN_CONFIDENCE if min_confidence is None else min_confidence
    auto_promote = settings.CANDIDATE_AUTO_PROMOTE if auto_promote is None else auto_promote
    if vetter is None:
        from .llm.candidate_vetter import vet_checkpoint_candidate
        vetter = vet_checkpoint_candidate
    if geocoder is None:
        from .geo_resolver import resolve_place
        geocoder = resolve_place

    stats = {"seen": 0, "upserted": 0, "vetted": 0, "promoted": 0, "skipped_known": 0}

    # 1) seed/refresh candidates from the corpus directory (idempotent: absolute counts)
    for entry in directory:
        name_ar = entry.get("name_ar") or entry.get("canonical_key")
        total = entry.get("total_mentions", 0)
        if not name_ar or total < cpdb_DIRECTORY_MIN():
            continue
        stats["seen"] += 1
        if kb is not None and kb.find_checkpoint(name_ar):
            stats["skipped_known"] += 1
            continue
        await cpdb.upsert_candidate(raw_name=name_ar, normalized=_normalise(name_ar),
                                    mentions=total, suggested_name_ar=name_ar, absolute=True)
        stats["upserted"] += 1

    # 2) vet + (optionally) promote the strongest un-vetted pending candidates
    for cand in await cpdb.get_candidates(status="pending"):
        if (cand.get("mentions") or 0) < min_mentions or cand.get("llm_verdict"):
            continue
        try:
            verdict = await vetter(cand["raw_name"])
        except Exception as e:  # noqa: BLE001
            log.warning("vet failed for %r: %s", cand.get("raw_name"), e)
            continue
        if not verdict:
            continue
        geo = None
        try:
            geo = geocoder(verdict.get("suggested_name_ar") or cand["raw_name"])
        except Exception:  # noqa: BLE001
            geo = None
        lat = (geo or {}).get("latitude")
        lon = (geo or {}).get("longitude")
        await cpdb.set_candidate_llm(
            cand["id"],
            verdict="real" if verdict.get("is_real_checkpoint") else "not_a_checkpoint",
            confidence=float(verdict.get("confidence") or 0.0),
            suggested_name_ar=verdict.get("suggested_name_ar"),
            governorate=verdict.get("governorate"), lat=lat, lon=lon)
        stats["vetted"] += 1

        refreshed = await cpdb.get_candidate(cand["id"])
        if should_auto_promote(refreshed, min_mentions=min_mentions,
                               min_confidence=min_confidence, enabled=auto_promote):
            await _promote(refreshed, kb)
            stats["promoted"] += 1

    return stats


async def run_candidate_periodic(interval_hours: float = 6.0, first_delay_s: float = 120.0):
    """Background worker: populate + vet the candidate review queue every interval.
    Safe by default — auto-promotion is gated by CANDIDATE_AUTO_PROMOTE (off)."""
    import asyncio
    await asyncio.sleep(first_delay_s)
    while True:
        try:
            stats = await run_candidate_cycle()
            log.info("[CANDIDATE/CYCLE] %s", stats)
        except Exception as e:  # noqa: BLE001
            log.warning("candidate cycle failed: %s", e)
        await asyncio.sleep(interval_hours * 3600)


def cpdb_DIRECTORY_MIN() -> int:
    # mirror learner.DIRECTORY_MIN_MENTIONS (3) without importing the heavy module
    return 3


async def _promote(candidate: dict, kb) -> None:
    """Promote a vetted candidate into the live catalog + KB."""
    key = _normalise(candidate.get("suggested_name_ar") or candidate["raw_name"]).replace(" ", "_")
    entry = {
        "canonical_key": key,
        "name_ar": candidate.get("suggested_name_ar") or candidate["raw_name"],
        "governorate": candidate.get("governorate"),
        "latitude": candidate.get("suggested_lat"),
        "longitude": candidate.get("suggested_lon"),
        "source_layer": "manual",
    }
    await cpdb.bulk_seed_checkpoints([entry])
    await cpdb.set_candidate_review(candidate["id"], status="promoted", reviewed_by="auto")
    if kb is not None:
        try:
            kb.by_canonical_key[key] = entry
            nn = _normalise(entry["name_ar"])
            kb.by_name_norm[nn] = key
            kb.all_names.append((nn, key))
            kb.all_names.sort(key=lambda x: -len(x[0]))
        except Exception:  # noqa: BLE001
            pass
    log.info("[CANDIDATE/PROMOTE] %r → %s", candidate.get("raw_name"), key)
