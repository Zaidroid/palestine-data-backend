"""Phase C — MiniMax candidate vetter (app/llm/candidate_vetter.py).

Run:  pytest test_candidate_vetter.py -v
"""
import asyncio

from app.llm.candidate_vetter import vet_checkpoint_candidate


def _run(coro):
    return asyncio.run(coro)


class FakeClient:
    def __init__(self, payload):
        self.payload = payload

    async def complete_json(self, system, user, *, schema_hint="", cache_key=None):
        return self.payload


def test_vet_returns_structured_verdict():
    out = _run(vet_checkpoint_candidate("مفرق رنتيس", client=FakeClient(
        {"is_real_checkpoint": True, "suggested_name_ar": "رنتيس",
         "governorate": "Ramallah", "confidence": 0.88})))
    assert out["is_real_checkpoint"] is True
    assert out["suggested_name_ar"] == "رنتيس"
    assert out["governorate"] == "Ramallah"
    assert out["confidence"] == 0.88


def test_vet_negative_verdict():
    out = _run(vet_checkpoint_candidate("كثافة سير", client=FakeClient(
        {"is_real_checkpoint": False, "confidence": 0.95})))
    assert out["is_real_checkpoint"] is False


def test_vet_returns_none_when_llm_unavailable():
    assert _run(vet_checkpoint_candidate("x", client=FakeClient(None))) is None


def test_vet_defaults_missing_confidence_to_zero():
    out = _run(vet_checkpoint_candidate("شيء", client=FakeClient({"is_real_checkpoint": True})))
    assert out["confidence"] == 0.0
