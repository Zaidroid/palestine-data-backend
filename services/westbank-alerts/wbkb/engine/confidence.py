"""The trust core.

Every fact in the KB carries a ``source``, a ``last_verified`` timestamp and a
``fact_kind`` that selects a half life. Effective confidence decays with age:

    effective = base(source) * 0.5 ** (age_days / half_life_days)

Conflicts between two facts for the same slot resolve by **authority rank**
(human ground truth > live feed > OCHA > rights docs > OSM > model inference);
ties break on effective confidence. This is what lets a single local
confirmation instantly override a model seed or even OCHA.
"""
from __future__ import annotations

from datetime import datetime, timezone

# source -> (base_confidence, authority_rank). Higher rank wins a conflict.
SOURCES: dict[str, tuple[float, int]] = {
    "human_local":    (0.98, 6),
    "live_feed":      (0.90, 5),
    "ocha_hdx":       (0.85, 4),
    "rights_doc":     (0.75, 3),
    "osm":            (0.70, 2),
    "model_inferred": (0.30, 1),
}

# fact_kind -> half life (days). Dynamic facts decay fast, physical/policy slow.
HALF_LIFE_DAYS: dict[str, float] = {
    "node_exists_permanent":    700.0,
    "node_exists_intermittent": 120.0,
    "edge_road_exists":         700.0,
    "edge_permission":          700.0,   # policy changes slowly
    "edge_gating":               30.0,   # which checkpoint controls an edge — dynamic
    "live_status":                1.5,   # open/closed right now
}
DEFAULT_HALF_LIFE = 120.0

# below this effective confidence a fact lands on the staleness worklist
STALE_THRESHOLD = 0.40


def base_confidence(source: str) -> float:
    return SOURCES.get(source, (0.30, 0))[0]


def authority_rank(source: str) -> int:
    return SOURCES.get(source, (0.30, 0))[1]


def half_life(fact_kind: str) -> float:
    return HALF_LIFE_DAYS.get(fact_kind, DEFAULT_HALF_LIFE)


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(timezone.utc)


def parse_ts(ts: str) -> datetime:
    """Tolerant ISO-8601 parse; assumes UTC if no offset given."""
    s = (ts or "").strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def age_days(last_verified: str, now: datetime | None = None) -> float:
    delta = _now(now) - parse_ts(last_verified)
    return max(0.0, delta.total_seconds() / 86400.0)


def effective_confidence(fact: dict, now: datetime | None = None) -> float:
    """base(source) decayed by age over the fact_kind's half life."""
    b = base_confidence(fact.get("source", "model_inferred"))
    hl = half_life(fact.get("fact_kind", ""))
    a = age_days(fact.get("last_verified", ""), now)
    return b * (0.5 ** (a / hl))


def is_stale(fact: dict, now: datetime | None = None) -> bool:
    return effective_confidence(fact, now) < STALE_THRESHOLD


def resolve(facts: list[dict], now: datetime | None = None) -> dict | None:
    """Pick the winning fact for a slot: highest authority rank, then highest
    effective confidence. ``facts`` is the list of competing facts for one slot."""
    if not facts:
        return None
    return max(
        facts,
        key=lambda f: (authority_rank(f.get("source", "model_inferred")), effective_confidence(f, now)),
    )
