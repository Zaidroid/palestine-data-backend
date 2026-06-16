"""Phase 1: the /v2 checkpoint envelope threads per-channel reliability into
the crowd trust score. _cp_envelope is pure given (cp, rel_map) — no DB — so
the rel_map lookup, case-insensitive channel match, and fallback are unit-tested
here; the bulk DB getter (get_channel_reliability_map) is exercised live.
"""
import os
os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

from app.routers import v2

_REL = {"ahwalaltreq": 0.75, "rt_arabic": 0.45}


def _cp(**over):
    base = {
        "canonical_key": "x", "source_channel": "AhwalAlTreq",
        "last_source_type": "crowd", "status": "open", "last_updated_iso": None,
    }
    base.update(over)
    return base


def test_crowd_trust_uses_channel_weight_case_insensitive():
    # "AhwalAlTreq" matches the lowercased "ahwalaltreq" key.
    assert v2._cp_envelope(_cp(), _REL)["source_trust"]["trust"] == 0.75


def test_crowd_trust_falls_back_for_unknown_channel():
    assert v2._cp_envelope(_cp(source_channel="randomchan"), _REL)["source_trust"]["trust"] == 0.4


def test_admin_trust_unaffected_by_channel_weight():
    assert v2._cp_envelope(_cp(last_source_type="admin"), _REL)["source_trust"]["trust"] == 0.9


def test_no_rel_map_preserves_legacy_crowd_prior():
    assert v2._cp_envelope(_cp())["source_trust"]["trust"] == 0.4
