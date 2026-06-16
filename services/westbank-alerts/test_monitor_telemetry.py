"""Telemetry counters for the Phase-0 measurement window.

These count the two things that are otherwise INVISIBLE (discarded/unmatched
messages are never stored, so they can't be measured from the DB or API):
  - security messages the classifier drops  (false-negative ceiling)
  - checkpoint messages the strict whitelist can't match (coverage gap → Phase 3)

The counts surface through monitor.get_stats() → /health, accumulate per day,
and reset at UTC midnight like the existing counters.
"""
import os
os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

from app import monitor


def _fresh_stats():
    # Force the daily-reset path so every test starts from zeroed counters.
    monitor._stats["_stats_date"] = None
    monitor._maybe_reset_daily()


def test_telemetry_counters_start_at_zero_and_increment():
    _fresh_stats()
    s0 = monitor.get_stats()
    assert s0["security_seen_today"] == 0
    assert s0["security_discarded_today"] == 0
    assert s0["cp_messages_seen_today"] == 0
    assert s0["cp_whitelist_miss_today"] == 0

    # security_seen is the denominator paired with security_discarded: Telegram
    # WB-channel messages that reach the classifier (RSS excluded at the call
    # site), so discard_rate = discarded / seen reflects the WB-channel signal.
    monitor._record_security_seen()
    monitor._record_security_seen()
    monitor._record_security_seen()
    monitor._record_discard()
    monitor._record_cp_seen()
    monitor._record_cp_seen()
    monitor._record_cp_miss()

    s1 = monitor.get_stats()
    assert s1["security_seen_today"] == 3
    assert s1["security_discarded_today"] == 1
    assert s1["cp_messages_seen_today"] == 2
    assert s1["cp_whitelist_miss_today"] == 1


def test_telemetry_resets_at_utc_day_rollover():
    _fresh_stats()
    monitor._record_discard()
    monitor._record_cp_miss()
    assert monitor.get_stats()["security_discarded_today"] == 1

    # Simulate yesterday's counters carrying a stale date → next read resets.
    monitor._stats["_stats_date"] = "1999-01-01"
    s = monitor.get_stats()
    assert s["security_seen_today"] == 0
    assert s["security_discarded_today"] == 0
    assert s["cp_whitelist_miss_today"] == 0
