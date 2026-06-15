"""City-gateway engine (Phase F).

Encodes how Palestinians actually navigate: each city has entry/exit GATEWAYS, and
when the working one closes there's a known detour. Given a city's gateway list and
the live checkpoint status, this resolves each gateway's state (open/closed/unknown)
and builds a human advisory ("Enter via Deir Sharaf. Huwara closed → use Awarta.").

Data lives in data/city_gateways.json. The pure function `build_city_gateway_status`
takes the city dict + a {canonical_key: effective_status} map + the KB (for name→key
resolution), so it is fully unit-tested without I/O.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger("gateways")

_CLOSED_STATES = {"closed"}
_OPEN_STATES = {"open", "congested", "slow", "idf", "police", "inspection"}


def _gateway_state(role: str, live_status: Optional[str]) -> str:
    """closed (role or live), open (live usable), or unknown (no fresh data)."""
    if role == "closed" or live_status in _CLOSED_STATES:
        return "closed"
    if live_status in _OPEN_STATES:
        return "open"
    return "unknown"


def build_city_gateway_status(city_data: dict, status_by_key: dict, kb=None) -> dict:
    gateways = []
    open_names, closed_entries = [], []
    for g in city_data.get("gateways", []):
        key = kb.find_checkpoint(g["name_ar"]) if kb is not None else None
        live = status_by_key.get(key) if key else None
        state = _gateway_state(g.get("role", "unknown"), live)
        entry = {
            "name_ar": g["name_ar"],
            "name_en": g.get("name_en", g["name_ar"]),
            "side": g.get("side"),
            "connects_to": g.get("connects_to"),
            "role": g.get("role", "unknown"),
            "state": state,
            "live_status": live or "unknown",
            "detour_if_closed": g.get("detour_if_closed"),
            "confidence": g.get("confidence", "low"),
            "canonical_key": key,
            "in_catalog": key is not None,
        }
        gateways.append(entry)
        if state == "open":
            open_names.append(entry["name_en"])
        elif state == "closed":
            closed_entries.append({"name_en": entry["name_en"], "detour_if_closed": entry["detour_if_closed"]})

    parts = []
    if open_names:
        parts.append("Enter/leave via " + ", ".join(open_names) + ".")
    for c in closed_entries:
        if c["detour_if_closed"]:
            parts.append(f"{c['name_en']} closed → use {c['detour_if_closed']}.")
        else:
            parts.append(f"{c['name_en']} closed.")
    if not parts:
        parts.append("No confirmed open gateway — status uncertain, check live reports.")

    return {
        "city_ar": city_data.get("name_ar"),
        "city_en": city_data.get("name_en"),
        "gateways": gateways,
        "open_gateways": open_names,
        "closed_gateways": closed_entries,
        "advisory": " ".join(parts),
    }


# ── I/O wrapper ───────────────────────────────────────────────────────────────
_CITY_GATEWAYS: Optional[dict] = None


def _load() -> dict:
    global _CITY_GATEWAYS
    if _CITY_GATEWAYS is None:
        for p in (Path("/data/city_gateways.json"),
                  Path(__file__).resolve().parent.parent.parent / "data" / "city_gateways.json"):
            if p.exists():
                _CITY_GATEWAYS = json.loads(p.read_text(encoding="utf-8"))
                break
        else:
            _CITY_GATEWAYS = {}
    return _CITY_GATEWAYS


def list_cities() -> list:
    return sorted(_load().keys())


async def get_city_gateways(city_key: str) -> Optional[dict]:
    """Live gateway status for a city, or None if the city isn't in the KB."""
    data = _load().get(city_key)
    if not data:
        return None
    from .. import checkpoint_db as cpdb
    from ..checkpoint_knowledge_base import get_knowledge_base
    from . import provenance as P

    cps = await cpdb.get_all_checkpoints()
    status_by_key = {
        c["canonical_key"]: P.effective_status({**c, "last_updated": c.get("last_updated_iso")})
        for c in cps
    }
    return build_city_gateway_status(data, status_by_key, kb=get_knowledge_base())
