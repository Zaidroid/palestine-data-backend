"""Provenance & normalization layer (Phase 0 / S2).

Pure functions (no I/O) that derive the canonical serving fields the /v2 feeds and
the route endpoints share, so freshness/trust/`effective_status` are computed in
exactly one place. Import-clean: does NOT import app.config, so it is unit-testable
without the API_SECRET_KEY boot guard.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Union

DEFAULT_STALE_HOURS = 6.0
LIVE_HOURS = 1.0  # <= this age → "live"
# Phase 2b: a continuous freshness score (1.0 at age 0, halving every
# FRESHNESS_HALF_LIFE_HOURS) so consumers downweight aging data smoothly instead
# of falling off the hard stale-band cliff. The categorical band stays for the
# map's safety floor; the score is the gradient.
FRESHNESS_HALF_LIFE_HOURS = 6.0

_TRUST = {"admin": 0.9, "crowd": 0.4}
# Phase 1: a crowd report's trust is driven by the reporting channel's observed
# reliability (resolved by the caller), bounded so it keeps a floor of signal
# and never reaches admin (0.9). Falls back to the flat 0.4 prior when the
# caller has no reliability for the channel.
_CROWD_TRUST_FLOOR = 0.2
_CROWD_TRUST_CEIL = 0.85


def _as_datetime(value: Union[datetime, str, None]) -> Optional[datetime]:
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def freshness(
    last_updated: Union[datetime, str, None],
    *,
    stale_hours: float = DEFAULT_STALE_HOURS,
    now: Optional[datetime] = None,
) -> dict:
    """Classify how fresh a status is.

    Bands: "none" (never reported), "live" (<=1h), "recent" (<=stale_hours),
    "stale" (>stale_hours). `is_stale` is True for both "stale" and "none" — a
    never-reported or long-stale checkpoint must not be painted as live.
    """
    now = now or datetime.utcnow()
    lu = _as_datetime(last_updated)
    if lu is None:
        return {"last_updated": None, "age_hours": None,
                "is_stale": True, "freshness_band": "none", "freshness_score": 0.0}

    age_hours = round((now - lu).total_seconds() / 3600, 1)
    if age_hours <= LIVE_HOURS:
        band = "live"
    elif age_hours <= stale_hours:
        band = "recent"
    else:
        band = "stale"
    score = round(0.5 ** (max(0.0, age_hours) / FRESHNESS_HALF_LIFE_HOURS), 3)
    return {
        "last_updated": lu.isoformat(),
        "age_hours": age_hours,
        "is_stale": band == "stale",
        "freshness_band": band,
        "freshness_score": score,
    }


def _is_permanently_closed(permanent_status: Optional[str]) -> bool:
    return bool(permanent_status) and permanent_status.lower().startswith("closed")


def effective_status(
    cp: dict,
    *,
    stale_hours: float = DEFAULT_STALE_HOURS,
    now: Optional[datetime] = None,
) -> str:
    """The status the map should color by.

    Permanent closure (e.g. Huwara since Oct-2023) wins over any live report.
    Otherwise a stale/never-reported checkpoint resolves to "unknown" rather than
    its last-seen status — we do not assert a 20h-old "open" is still true.
    """
    if _is_permanently_closed(cp.get("permanent_status")):
        return "closed"
    fresh = freshness(cp.get("last_updated"), stale_hours=stale_hours, now=now)
    if fresh["freshness_band"] in ("stale", "none"):
        return "unknown"
    return cp.get("status") or "unknown"


def source_trust(
    last_source_type: Optional[str],
    channel_reliability: Optional[float] = None,
) -> float:
    """Trust score for a checkpoint's most recent report.

    admin reports stay authoritative (0.9). A crowd report is scored by the
    reporting channel's reliability weight when the caller supplies one
    (bounded to [_CROWD_TRUST_FLOOR, _CROWD_TRUST_CEIL] so it carries a floor
    of signal and never reaches admin); otherwise the flat 0.4 prior is used.
    """
    if last_source_type == "admin":
        return _TRUST["admin"]
    if last_source_type == "crowd":
        if channel_reliability is None:
            return _TRUST["crowd"]
        return round(min(_CROWD_TRUST_CEIL,
                         max(_CROWD_TRUST_FLOOR, channel_reliability)), 3)
    return _TRUST.get(last_source_type or "", 0.0)


def checkpoint_envelope(
    cp: dict,
    *,
    stale_hours: float = DEFAULT_STALE_HOURS,
    now: Optional[datetime] = None,
    channel_reliability: Optional[float] = None,
) -> dict:
    """Canonical checkpoint record for the /v2 feeds and route endpoints.

    `cp` is a `checkpoint_db._row_to_checkpoint`-style dict (optionally enriched
    with the Phase-0 columns source_layer/obstacle_type/permanent_status). Missing
    keys default sensibly so callers can pass v1 rows during migration.
    """
    fresh = freshness(cp.get("last_updated"), stale_hours=stale_hours, now=now)
    return {
        "canonical_key": cp.get("canonical_key"),
        "name_ar": cp.get("name_ar"),
        "name_en": cp.get("name_en"),
        "region": cp.get("region"),
        "governorate": cp.get("governorate"),
        "oslo_area": cp.get("oslo_area"),
        "checkpoint_type": cp.get("checkpoint_type") or "checkpoint",
        "coordinates": {
            "lat": cp.get("latitude"),
            "lon": cp.get("longitude"),
            "precision": cp.get("geo_precision"),
        },
        "source_layer": cp.get("source_layer") or "telegram",
        "obstacle_type": cp.get("obstacle_type"),
        "permanent_status": cp.get("permanent_status"),
        "live": {
            "status": cp.get("status") or "unknown",
            "direction": cp.get("direction"),
            "status_raw": cp.get("status_raw"),
            "confidence": cp.get("confidence") or "low",
            "crowd_reports_1h": cp.get("crowd_reports_1h") or 0,
        },
        "freshness": fresh,
        "source_trust": {
            "last_source_type": cp.get("last_source_type"),
            "trust": source_trust(cp.get("last_source_type"), channel_reliability),
        },
        "provenance": {
            "last_msg_id": cp.get("last_msg_id"),
            "source_channel": cp.get("source_channel"),
        },
        "effective_status": effective_status(cp, stale_hours=stale_hours, now=now),
    }


def incident_envelope(
    incident: dict,
    members: list,
    *,
    stale_hours: float = DEFAULT_STALE_HOURS,
    now: Optional[datetime] = None,
) -> dict:
    """Canonical incident record for /v2/incidents.

    `incident` is an `incident_db._row_to_incident`-style dict; `members` is a list
    of the constituent alert dicts (keys: id, source, confidence, trust_score).
    Source diversity across channels IS the corroboration signal.
    """
    confs = [m.get("confidence") for m in members if m.get("confidence") is not None]
    trusts = [m.get("trust_score") for m in members if m.get("trust_score") is not None]
    sources = sorted({m.get("source") for m in members if m.get("source")})
    member_ids = [m.get("id") for m in members if m.get("id") is not None]
    return {
        "id": incident.get("id"),
        "incident_type": incident.get("incident_type"),
        "severity": incident.get("severity"),
        "status": incident.get("status"),
        "area": incident.get("area"),
        "area_ar": incident.get("area_ar"),
        "zone": incident.get("zone"),
        "coordinates": {"lat": incident.get("latitude"), "lon": incident.get("longitude")},
        "narrative": incident.get("narrative"),
        "confidence": max(confs) if confs else None,
        "trust_score": max(trusts) if trusts else None,
        "source_trust": {"distinct_sources": len(sources), "sources": sources},
        "provenance": {
            "member_alert_ids": member_ids,
            "first_alert_id": incident.get("first_alert_id"),
            "last_alert_id": incident.get("last_alert_id"),
            "alert_count": incident.get("alert_count"),
        },
        "freshness": freshness(incident.get("last_updated"), stale_hours=stale_hours, now=now),
        "corroboration": {"distinct_channel_count": len(sources)},
    }
