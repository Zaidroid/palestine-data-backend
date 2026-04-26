"""
ACLED conflict-volume baseline lookup.

Loads acled-pse-{political-violence,civilian-targeting,demonstrations}.json
once and exposes is_admin2_elevated(admin2, alert_type) — true when the
admin2's most recent ACLED month exceeds 1.5x the trailing 5-month mean
AND has at least 5 events (absolute floor avoids low-base-rate noise).

Used by monitor.py as a second base-rate corroboration source alongside
Insecurity Insight historical_corroboration. Distinct signal: ACLED says
"this admin2 is currently active in this event type" rather than
"this region has documented incidents historically."
"""

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# (event_file_key, admin2) -> list of {date_period, events, fatalities}
# sorted descending by date_period.
_BASELINES: dict = {}
_LOADED: bool = False

# Live AlertType → ACLED file key.
ALERT_TO_ACLED: dict = {
    "gaza_strike":    "political-violence",
    "idf_raid":       "political-violence",
    "injury_report":  "political-violence",
    "settler_attack": "civilian-targeting",
}


def _candidate_paths(filename: str) -> list[Path]:
    return [
        Path("/app/data/conflict") / filename,
        Path("/data/conflict") / filename,
        Path(__file__).resolve().parent.parent / "data" / "conflict" / filename,
    ]


def _load_one(event_key: str) -> None:
    filename = f"acled-pse-{event_key}.json"
    for path in _candidate_paths(filename):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            rows = data.get("rows", []) or []
            for r in rows:
                a2 = r.get("admin2")
                period = r.get("date_period")
                if not a2 or not period:
                    continue
                key = (event_key, a2)
                _BASELINES.setdefault(key, []).append({
                    "date_period": period,
                    "events": r.get("events") or 0,
                    "fatalities": r.get("fatalities") or 0,
                })
            log.info(f"conflict_baseline: loaded {len(rows)} ACLED rows from {path}")
            return
        except Exception as e:
            log.warning(f"conflict_baseline: failed {path}: {e}")
    log.warning(f"conflict_baseline: {filename} not found in any candidate path")


def _ensure_loaded() -> None:
    global _LOADED
    if _LOADED:
        return
    for key in {"political-violence", "civilian-targeting", "demonstrations"}:
        _load_one(key)
    # Sort each series descending by period so [0] is most recent.
    for key, series in _BASELINES.items():
        series.sort(key=lambda r: r["date_period"], reverse=True)
    _LOADED = True


def is_admin2_elevated(admin2: str, alert_type: str) -> dict:
    """Return {elevated, recent_period, recent_events, baseline_mean} or
    {elevated: False} when no signal can be computed (unmapped type, unknown
    admin2, or insufficient history)."""
    if not admin2 or not alert_type:
        return {"elevated": False}
    event_key = ALERT_TO_ACLED.get(alert_type)
    if not event_key:
        return {"elevated": False}
    _ensure_loaded()
    series = _BASELINES.get((event_key, admin2))
    # Need recent (1 complete month back, since the latest entry is the
    # partial current month and would always look under baseline) plus 5
    # baseline months — so 7 entries minimum.
    if not series or len(series) < 7:
        return {"elevated": False}
    recent = series[1]
    baseline = series[2:7]
    mean = sum(r["events"] for r in baseline) / len(baseline)
    elevated = (recent["events"] >= 5) and (recent["events"] > 1.5 * mean)
    return {
        "elevated": elevated,
        "recent_period": recent["date_period"],
        "recent_events": recent["events"],
        "baseline_mean": round(mean, 2),
        "event_key": event_key,
    }
