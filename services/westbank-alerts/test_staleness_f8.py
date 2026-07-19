"""F8 — a checkpoint not reported in >6h must not assert a live status.
Its effective_status degrades to 'unknown' and is_stale flips at 6h (was 12h),
so a 9h-old 'open' is no longer painted live. Permanent closures still win.

Run: pytest test_staleness_f8.py -v
"""
from datetime import datetime, timedelta
from app.serving import provenance as P


def _cp(status, age_hours, permanent=None):
    lu = datetime.utcnow() - timedelta(hours=age_hours)
    return {"status": status, "last_updated": lu.isoformat(), "permanent_status": permanent}


def test_9h_old_is_stale_and_unknown():
    cp = _cp("open", 9)
    fr = P.freshness(cp["last_updated"])
    assert fr["is_stale"] is True
    assert fr["freshness_band"] == "stale"
    assert P.effective_status(cp) == "unknown"


def test_3h_old_still_shown():
    cp = _cp("open", 3)
    fr = P.freshness(cp["last_updated"])
    assert fr["is_stale"] is False
    assert fr["freshness_band"] == "recent"
    assert P.effective_status(cp) == "open"


def test_boundary_just_under_6h_shown():
    cp = _cp("congested", 5.5)
    assert P.effective_status(cp) == "congested"
    assert P.freshness(cp["last_updated"])["is_stale"] is False


def test_permanent_closure_wins_over_stale():
    cp = _cp("open", 20, permanent="closed_since:2023-10")
    assert P.effective_status(cp) == "closed"
