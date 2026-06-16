"""Phase 0 / S2 — provenance & normalization layer (app/serving/provenance.py).

These are pure functions (no I/O) that derive the canonical serving fields the
/v2 feeds and the route endpoints share: freshness bands, source trust, and the
staleness-honest `effective_status` (so the map stops painting stale data as live).

Run:  pytest test_provenance.py -v
"""
from datetime import datetime, timedelta

from app.serving import provenance as P


NOW = datetime(2026, 6, 14, 12, 0, 0)


# ── freshness ───────────────────────────────────────────────────────────────

def test_freshness_none_when_never_updated():
    f = P.freshness(None, now=NOW)
    assert f["freshness_band"] == "none"
    assert f["is_stale"] is True
    assert f["age_hours"] is None
    assert f["last_updated"] is None


def test_freshness_live_within_one_hour():
    f = P.freshness(NOW - timedelta(minutes=30), now=NOW)
    assert f["freshness_band"] == "live"
    assert f["is_stale"] is False
    assert f["age_hours"] == 0.5


def test_freshness_recent_between_one_and_stale_threshold():
    f = P.freshness(NOW - timedelta(hours=3), now=NOW, stale_hours=12)
    assert f["freshness_band"] == "recent"
    assert f["is_stale"] is False


def test_freshness_stale_past_threshold():
    f = P.freshness(NOW - timedelta(hours=20), now=NOW, stale_hours=12)
    assert f["freshness_band"] == "stale"
    assert f["is_stale"] is True


def test_freshness_accepts_iso_string():
    f = P.freshness((NOW - timedelta(hours=2)).isoformat(), now=NOW)
    assert f["freshness_band"] == "recent"


# ── freshness_score (Phase 2b — continuous decay, smooths the hard 12h cliff) ──

def test_freshness_score_decays_exponentially():
    assert P.freshness(NOW, now=NOW)["freshness_score"] == 1.0
    half = NOW - timedelta(hours=P.FRESHNESS_HALF_LIFE_HOURS)
    assert P.freshness(half, now=NOW)["freshness_score"] == 0.5


def test_freshness_score_is_continuous_across_the_12h_band_edge():
    # The categorical band flips recent->stale at 12h, but the score must NOT
    # jump — 11h59 and 12h01 are nearly equal (no perception cliff).
    before = P.freshness(NOW - timedelta(hours=11, minutes=59), now=NOW)["freshness_score"]
    after = P.freshness(NOW - timedelta(hours=12, minutes=1), now=NOW)["freshness_score"]
    assert abs(before - after) < 0.02


def test_freshness_score_zero_when_never_reported():
    assert P.freshness(None, now=NOW)["freshness_score"] == 0.0


# ── effective_status (the staleness-honesty fix) ─────────────────────────────

def test_effective_status_permanently_closed_overrides_fresh_open():
    cp = {"status": "open", "permanent_status": "closed_since:2023-10",
          "last_updated": NOW - timedelta(minutes=5)}
    assert P.effective_status(cp, now=NOW) == "closed"


def test_effective_status_fresh_open_is_open():
    cp = {"status": "open", "last_updated": NOW - timedelta(minutes=10)}
    assert P.effective_status(cp, now=NOW) == "open"


def test_effective_status_stale_report_is_unknown_not_painted_live():
    cp = {"status": "closed", "last_updated": NOW - timedelta(hours=20)}
    assert P.effective_status(cp, now=NOW) == "unknown"


def test_effective_status_never_reported_is_unknown():
    cp = {"status": "unknown", "last_updated": None}
    assert P.effective_status(cp, now=NOW) == "unknown"


# ── source trust ─────────────────────────────────────────────────────────────

def test_trust_admin_beats_crowd_beats_none():
    assert P.source_trust("admin") > P.source_trust("crowd") > P.source_trust(None)


def test_trust_crowd_uses_channel_reliability_when_provided():
    # Phase 1: a crowd report from a reputable checkpoint channel beats the
    # flat 0.4 prior — trust must discriminate by channel.
    assert P.source_trust("crowd", channel_reliability=0.75) == 0.75


def test_trust_crowd_defaults_to_flat_prior_without_reliability():
    # Backward compatible: when no reliability is resolved, keep the 0.4 prior.
    assert P.source_trust("crowd") == 0.4


def test_trust_crowd_capped_below_admin_and_floored():
    # Crowd never reaches admin (0.9); a near-zero channel keeps a little signal.
    assert P.source_trust("crowd", channel_reliability=0.99) == 0.85
    assert P.source_trust("crowd", channel_reliability=0.05) == 0.2


def test_trust_admin_stays_authoritative_regardless_of_channel():
    assert P.source_trust("admin", channel_reliability=0.6) == 0.9


# ── checkpoint_envelope ──────────────────────────────────────────────────────

def _cp(**over):
    base = {
        "canonical_key": "حواره", "name_ar": "حوارة", "name_en": "Huwara",
        "region": "nablus", "governorate": "Nablus", "oslo_area": "C",
        "checkpoint_type": "checkpoint", "latitude": 32.1587, "longitude": 35.2538,
        "geo_precision": "checkpoint", "status": "closed", "status_raw": "مغلق",
        "direction": "both", "confidence": "high", "crowd_reports_1h": 2,
        "last_updated": NOW - timedelta(minutes=20), "last_source_type": "admin",
        "source_layer": "telegram", "obstacle_type": None,
        "permanent_status": None, "last_msg_id": 999, "source_channel": "ahwalaltreq",
    }
    base.update(over)
    return base


def test_checkpoint_envelope_shape_and_nesting():
    env = P.checkpoint_envelope(_cp(), now=NOW)
    assert env["canonical_key"] == "حواره"
    assert env["coordinates"] == {"lat": 32.1587, "lon": 35.2538, "precision": "checkpoint"}
    assert env["live"]["status"] == "closed"
    assert env["live"]["confidence"] == "high"
    assert env["freshness"]["freshness_band"] == "live"  # 20 min ago
    assert env["source_trust"]["last_source_type"] == "admin"
    assert env["source_layer"] == "telegram"
    assert env["effective_status"] == "closed"
    assert env["provenance"]["source_channel"] == "ahwalaltreq"


def test_checkpoint_envelope_stale_row_effective_unknown():
    env = P.checkpoint_envelope(_cp(last_updated=NOW - timedelta(hours=30)), now=NOW)
    assert env["freshness"]["freshness_band"] == "stale"
    assert env["effective_status"] == "unknown"


def test_checkpoint_envelope_threads_channel_reliability():
    # Phase 1: a crowd report's trust reflects the channel's reliability weight,
    # resolved by the caller and passed in (provenance stays I/O-free).
    env = P.checkpoint_envelope(_cp(last_source_type="crowd"),
                                channel_reliability=0.75, now=NOW)
    assert env["source_trust"]["trust"] == 0.75


def test_checkpoint_envelope_permanent_closure_marks_closed_even_if_stale():
    env = P.checkpoint_envelope(
        _cp(status="open", permanent_status="closed_since:2023-10",
            last_updated=NOW - timedelta(hours=40)), now=NOW)
    assert env["effective_status"] == "closed"
    assert env["permanent_status"] == "closed_since:2023-10"


# ── incident_envelope (consolidated news/incident feed) ──────────────────────

def _incident(**over):
    base = {
        "id": 7, "incident_type": "idf_raid", "severity": "high", "status": "active",
        "area": "Jenin", "area_ar": "جنين", "zone": "north",
        "latitude": 32.46, "longitude": 35.30, "narrative": "raid summary",
        "alert_count": 3, "first_alert_id": 10, "last_alert_id": 14,
        "last_updated": NOW - timedelta(minutes=15),
    }
    base.update(over)
    return base


def test_incident_envelope_aggregates_confidence_and_sources():
    members = [
        {"id": 10, "source": "qudsn", "confidence": 0.5, "trust_score": 0.4},
        {"id": 12, "source": "wafa", "confidence": 0.8, "trust_score": 0.7},
        {"id": 14, "source": "qudsn", "confidence": 0.6, "trust_score": 0.5},
    ]
    env = P.incident_envelope(_incident(), members, now=NOW)
    assert env["confidence"] == 0.8
    assert env["trust_score"] == 0.7
    assert env["source_trust"]["distinct_sources"] == 2          # qudsn, wafa
    assert env["corroboration"]["distinct_channel_count"] == 2
    assert env["provenance"]["member_alert_ids"] == [10, 12, 14]
    assert env["provenance"]["alert_count"] == 3
    assert env["coordinates"] == {"lat": 32.46, "lon": 35.30}
    assert env["freshness"]["freshness_band"] == "live"
    assert env["narrative"] == "raid summary"


def test_incident_envelope_handles_no_members():
    env = P.incident_envelope(_incident(), [], now=NOW)
    assert env["confidence"] is None
    assert env["source_trust"]["distinct_sources"] == 0
