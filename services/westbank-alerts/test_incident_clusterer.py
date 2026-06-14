"""Phase B / B3 — MiniMax cross-channel incident clustering
(app/llm/incident_clusterer.py).

Runs ONLY when the deterministic type+area merge fails, to catch the same event
reported by different channels with slightly different area wording. Safety:
the returned incident id MUST be one of the candidates (no hallucinated ids); any
LLM failure or low confidence → no merge (today's behavior: create a new incident).

Run:  pytest test_incident_clusterer.py -v
"""
import asyncio

from app.llm.incident_clusterer import should_merge_llm


def _run(coro):
    return asyncio.run(coro)


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    async def complete_json(self, system, user, *, schema_hint="", cache_key=None):
        self.calls += 1
        return self.payload


_ALERT = {"title": "Army raids Jenin camp", "area": "Jenin camp",
          "incident_type": "idf_raid", "timestamp": "2026-06-14T12:00:00"}
_CANDIDATES = [
    {"id": 5, "incident_type": "idf_raid", "area": "Jenin", "narrative": "raid ongoing",
     "started_at": "2026-06-14T11:40:00"},
    {"id": 6, "incident_type": "idf_raid", "area": "Tulkarem", "narrative": "different",
     "started_at": "2026-06-14T11:50:00"},
]


def test_high_confidence_match_returns_candidate_id():
    out = _run(should_merge_llm(_ALERT, _CANDIDATES,
                                client=FakeClient({"same_event_id": 5, "confidence": 0.9})))
    assert out["incident_id"] == 5
    assert out["confidence"] == 0.9


def test_no_match_returns_none():
    out = _run(should_merge_llm(_ALERT, _CANDIDATES,
                                client=FakeClient({"same_event_id": None, "confidence": 0.2})))
    assert out["incident_id"] is None


def test_hallucinated_id_not_in_candidates_is_rejected():
    out = _run(should_merge_llm(_ALERT, _CANDIDATES,
                                client=FakeClient({"same_event_id": 999, "confidence": 0.95})))
    assert out["incident_id"] is None


def test_low_confidence_below_threshold_no_merge():
    out = _run(should_merge_llm(_ALERT, _CANDIDATES,
                                client=FakeClient({"same_event_id": 5, "confidence": 0.4})))
    assert out["incident_id"] is None


def test_llm_unavailable_returns_none():
    out = _run(should_merge_llm(_ALERT, _CANDIDATES, client=FakeClient(None)))
    assert out["incident_id"] is None


def test_empty_candidates_short_circuits_without_calling_llm():
    fc = FakeClient({"same_event_id": 5, "confidence": 0.9})
    out = _run(should_merge_llm(_ALERT, [], client=fc))
    assert out["incident_id"] is None
    assert fc.calls == 0
