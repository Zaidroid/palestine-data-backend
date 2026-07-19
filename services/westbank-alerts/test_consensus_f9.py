"""F9 — consensus must not let a couple of recent contrarian reports override a
large agreeing cohort (measured: بيت إيل served 'closed' despite 14 'open' vs 2
'closed'). A strongly-supported status resists a recent minority; small/ambiguous
splits still follow recency (a genuine state change should still win).

Run: pytest test_consensus_f9.py -v
"""
from app.checkpoint_db import _consensus_status


def _win(reports):
    return _consensus_status(reports)[0]


def test_large_cohort_not_overridden_by_recent_minority():
    # 14 open (older) vs 2 closed (recent) → open must win (the F9 bug case)
    reports = [("open", "crowd", 40 + i) for i in range(14)] + \
              [("closed", "crowd", 2), ("closed", "crowd", 5)]
    assert _win(reports) == "open"


def test_small_recent_change_still_wins():
    # was closed (3 reports, older) → 1 recent open. Small cohort, recency applies.
    reports = [("closed", "crowd", 50), ("closed", "crowd", 55), ("closed", "crowd", 60),
               ("open", "crowd", 2)]
    assert _win(reports) == "open"


def test_admin_still_authoritative():
    # a single admin report outweighs a few crowd reports (unchanged behavior)
    reports = [("open", "crowd", 5), ("open", "crowd", 6), ("closed", "admin", 3)]
    assert _win(reports) == "closed"


def test_hazard_cohort_beats_recent_open():
    # 5 recent police reports vs 1 newest open → police holds (safety-relevant)
    reports = [("police", "crowd", 10 + i) for i in range(5)] + [("open", "crowd", 1)]
    assert _win(reports) == "police"
