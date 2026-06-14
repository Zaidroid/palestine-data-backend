"""Regression tests for the /stats/today home-card aggregation (app/stats.py).

Pins two fixes:
- C (2026-06-14): the "injuries" card read 309 because /stats/today summed the
  classifier's free-text `count` over every injury_report since midnight UTC
  with no geofence (three "90"s + Gaza roundups 16+6+3 → 309). Fixed: count
  distinct reports, exclude admin1=="Gaza Strip".
- A: raids and detentions were inflated by duplicate channel reports of one
  event, and detentions still summed the free-text count. Fixed: count distinct
  events (raids by location signature, detentions by name-or-location).

Run:  python3 test_stats_today.py
"""
import sys
from datetime import datetime

from app.models import Alert
from app.stats import aggregate_today_counts


def _alert(type_, count=None, admin1=None, event_subtype=None,
           area=None, admin2=None, title="t", source="test", raw_text="x"):
    return Alert(
        type=type_, severity="medium", title=title, body="b",
        source=source, raw_text=raw_text, timestamp=datetime(2026, 6, 14, 9, 0, 0),
        count=count, admin1=admin1, event_subtype=event_subtype, area=area, admin2=admin2,
    )


def _inj(count=None, admin1=None):
    return _alert("injury_report", count=count, admin1=admin1)


# ── C: injuries ───────────────────────────────────────────────────────────────

def test_injuries_count_distinct_reports_not_extracted_numbers():
    out = aggregate_today_counts([_inj(count=90), _inj(count=16)])
    assert out["total_injuries_today"] == 2, out  # not 106


def test_gaza_stamped_alerts_excluded_from_west_bank_injuries():
    out = aggregate_today_counts([
        _inj(count=1, admin1="Gaza Strip"),
        _inj(count=1, admin1="West Bank"),
        _inj(count=1, admin1=None),
    ])
    assert out["total_injuries_today"] == 2, out


def test_today_real_distribution_drops_309_to_14():
    shape = [
        (90, None), (90, None), (90, None),
        (16, "Gaza Strip"), (6, "Gaza Strip"), (3, "Gaza Strip"),
        (1, None), (1, None), (1, "Gaza Strip"), (1, None),
        (1, "West Bank"), (1, None), (1, None), (1, None), (1, None),
        (1, "Gaza Strip"), (1, None), (1, None), (1, "West Bank"), (1, "Gaza Strip"),
    ]
    assert sum((c or 1) for c, _ in shape) == 309
    out = aggregate_today_counts([_inj(count=c, admin1=a) for c, a in shape])
    assert out["total_injuries_today"] == 14, out


# ── A: raids + detentions dedupe ───────────────────────────────────────────────

def test_raids_dedupe_same_town_one_event():
    """One raid reported by five channels (same town) = one raid."""
    al = [_alert("idf_raid", area="جنين", title="اقتحام جنين", source=s)
          for s in ("a", "b", "c", "d", "e")]
    assert aggregate_today_counts(al)["military_raids_today"] == 1


def test_raid_with_arrest_subtype_is_detention_not_raid():
    out = aggregate_today_counts([_alert("idf_raid", area="نابلس", event_subtype="arrest")])
    assert out["military_raids_today"] == 0, out
    assert out["total_arrests_today"] == 1, out


def test_detentions_dedupe_by_location_and_no_count_sum():
    """Same-town arrest campaign reported twice with count=30 → one event, not 60."""
    al = [_alert("arrest_campaign", area="الخليل", count=30, source="a"),
          _alert("arrest_campaign", area="الخليل", count=30, source="b")]
    assert aggregate_today_counts(al)["total_arrests_today"] == 1


def test_detentions_dedupe_by_named_person_across_towns():
    """Same named detainee reported from two different area tags → one person."""
    al = [_alert("arrest_campaign", area="رام الله", source="a",
                 raw_text="اعتقال الشاب احمد علي من رام الله بعد اقتحام"),
          _alert("arrest_campaign", area="القدس", source="b",
                 raw_text="اعتقال الشاب احمد علي خلال مداهمة")]
    assert aggregate_today_counts(al)["total_arrests_today"] == 1


def test_raids_arrests_settler_preserved():
    """New semantics: raids = distinct WB raids (no arrest-subtype); detentions =
    distinct events, NOT summed counts; settler unchanged; Gaza excluded."""
    out = aggregate_today_counts([
        _alert("idf_raid", area="جنين"),
        _alert("idf_raid", area="نابلس", event_subtype="arrest"),   # → detention
        _alert("arrest_campaign", area="الخليل", count=2),           # → detention, no sum
        _alert("settler_attack", area="رام الله"),
        _alert("idf_raid", area="غزة", admin1="Gaza Strip"),         # excluded
    ])
    assert out["military_raids_today"] == 1, out    # only جنين
    assert out["total_arrests_today"] == 2, out     # نابلس + الخليل distinct, not 5
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
