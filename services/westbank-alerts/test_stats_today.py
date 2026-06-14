"""Regression tests for the /stats/today home-card aggregation (app/stats.py).

Pins the 2026-06-14 bug where the "injuries" home card read 309. The
endpoint summed the classifier's free-text `count` over every injury_report
since midnight UTC, so three alerts that each mis-extracted "90" from a
cumulative prisoner-death figure, plus Gaza-wide casualty roundups
(16 + 6 + 3), ballooned ~14 West Bank reports into 309.

Run:  python3 test_stats_today.py
"""
import sys
from datetime import datetime

from app.models import Alert
from app.stats import aggregate_today_counts


def _alert(type_, count=None, admin1=None, event_subtype=None):
    return Alert(
        type=type_, severity="medium", title="t", body="b",
        source="test", raw_text="x", timestamp=datetime(2026, 6, 14, 9, 0, 0),
        count=count, admin1=admin1, event_subtype=event_subtype,
    )


def _inj(count=None, admin1=None):
    return _alert("injury_report", count=count, admin1=admin1)


def test_injuries_count_distinct_reports_not_extracted_numbers():
    """A single report's free-text count (often a cumulative figure) must
    not stand in for a day's injuries — each report counts once."""
    out = aggregate_today_counts([_inj(count=90), _inj(count=16)])
    assert out["total_injuries_today"] == 2, out  # not 106


def test_gaza_stamped_alerts_excluded_from_west_bank_injuries():
    """admin1 == 'Gaza Strip' is geofenced out; West-Bank and un-geocoded
    (admin1 is None) reports are kept."""
    out = aggregate_today_counts([
        _inj(count=1, admin1="Gaza Strip"),
        _inj(count=1, admin1="West Bank"),
        _inj(count=1, admin1=None),
    ])
    assert out["total_injuries_today"] == 2, out


def test_today_real_distribution_drops_309_to_14():
    """The faithful (count, admin1) shape of the 20 live injury_report
    alerts on 2026-06-14: old logic = 309, fixed = 14."""
    shape = [
        (90, None), (90, None), (90, None),
        (16, "Gaza Strip"), (6, "Gaza Strip"), (3, "Gaza Strip"),
        (1, None), (1, None), (1, "Gaza Strip"), (1, None),
        (1, "West Bank"), (1, None), (1, None), (1, None), (1, None),
        (1, "Gaza Strip"), (1, None), (1, None), (1, "West Bank"), (1, "Gaza Strip"),
    ]
    assert sum((c or 1) for c, _ in shape) == 309  # what the old endpoint returned
    out = aggregate_today_counts([_inj(count=c, admin1=a) for c, a in shape])
    assert out["total_injuries_today"] == 14, out  # 1-per-report, 6 Gaza dropped


def test_raids_arrests_settler_preserved():
    """Non-injury cards keep their existing semantics; arrests keep their
    small per-event counts; Gaza-stamped events are geofenced out too."""
    out = aggregate_today_counts([
        _alert("idf_raid"),
        _alert("idf_raid", event_subtype="arrest", count=3),
        _alert("arrest_campaign", count=2),
        _alert("settler_attack"),
        _alert("idf_raid", admin1="Gaza Strip"),
    ])
    assert out["military_raids_today"] == 1, out
    assert out["total_arrests_today"] == 5, out  # 3 + 2
    assert out["settler_attacks_today"] == 1, out


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = []
    for t in tests:
        try:
            t()
            print(f"  PASS {t.__name__}")
        except Exception as e:
            failures.append((t.__name__, e))
            print(f"  FAIL {t.__name__}: {e}")
    print(f"stats_today: {len(tests) - len(failures)}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
