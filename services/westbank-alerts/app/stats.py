"""Pure aggregation for the home-screen operational stat cards.

Kept free of FastAPI / DB imports so the counting logic is unit-testable in
isolation (see test_stats_today.py).
"""
from typing import Iterable

# This is a West Bank tracker. OCHA point-in-polygon stamps each alert's
# admin1 when its coordinates resolve; Gaza-wide casualty roundups carry
# admin1 == "Gaza Strip" and must not inflate West Bank daily counts.
_NON_WB_ADMIN1 = {"Gaza Strip"}


def _is_west_bank(alert) -> bool:
    """False only when an alert is positively geofenced outside the West
    Bank. Un-geocoded alerts (admin1 is None) are kept: coarse zone tags are
    too noisy to exclude on, and dropping them would hide real WB events
    that simply did not resolve to a polygon."""
    return getattr(alert, "admin1", None) not in _NON_WB_ADMIN1


def aggregate_today_counts(alerts: Iterable) -> dict:
    """Count today's operational events for the four home-screen stat cards.

    Injuries are counted as DISTINCT REPORTS (one each), not by the
    classifier's free-text `count`. That field captures the largest number
    near a casualty verb, which is routinely a cumulative figure ("90
    martyred prisoners") and grossly overstates a single day. Arrests keep
    their small per-event counts ("اعتقل 5" → 5). Alerts geofenced outside
    the West Bank are excluded from every card.
    """
    total_arrests = 0
    total_injuries = 0
    settler_attacks = 0
    military_raids = 0

    for a in alerts:
        if not _is_west_bank(a):
            continue
        if a.type == "arrest_campaign" or getattr(a, "event_subtype", "") == "arrest":
            total_arrests += getattr(a, "count", None) or 1
        elif a.type == "injury_report":
            total_injuries += 1
        elif a.type == "settler_attack":
            settler_attacks += 1
        elif a.type == "idf_raid":
            military_raids += 1

    return {
        "total_arrests_today": total_arrests,
        "total_injuries_today": total_injuries,
        "settler_attacks_today": settler_attacks,
        "military_raids_today": military_raids,
    }
