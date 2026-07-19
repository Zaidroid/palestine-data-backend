"""/quality/accuracy — serves the latest measured audit numbers + live counters.

Calls the endpoint function directly (codebase idiom, no TestClient/DB setup).
Run:  pytest test_quality_accuracy.py -v
"""
import asyncio
from app.main import quality_accuracy


def test_quality_accuracy_serves_audit_and_live_counters():
    body = asyncio.run(quality_accuracy())
    assert body["docs"] == "/docs/ACCURACY.md"
    # audit block from data/accuracy_audit.json
    assert body["audit"]["measured_at"] == "2026-07-19"
    assert "m1_precision" in body["audit"]
    # live pipeline counters (present even if zero at boot)
    for k in ("messages_today", "security_discarded_today", "cp_whitelist_miss_today"):
        assert k in body["live"]
