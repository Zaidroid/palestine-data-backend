"""Phase B / B2 — MiniMax checkpoint extraction fallback (app/llm/checkpoint_extractor.py).

Runs ONLY on messages the strict whitelist parser fails. The critical safety
property: the LLM can never invent a checkpoint — every extracted report must
resolve to a catalog canonical_key via kb.find_checkpoint, else it is dropped.
Coordinates never come from the LLM. Any LLM failure → [] → caller falls back to
the alerts pipeline (exactly today's behavior).

Run:  pytest test_checkpoint_extractor.py -v
"""
import asyncio

from app.checkpoint_knowledge_base import CheckpointKnowledgeBase
from app.checkpoint_parser import _normalise
from app.llm.checkpoint_extractor import extract_checkpoint_llm


def _run(coro):
    return asyncio.run(coro)


def _kb():
    kb = CheckpointKnowledgeBase()
    cps = [
        {"canonical_key": "حواره", "name_ar": "حوارة", "name_en": "Huwara", "aliases": ["حوارة"]},
        {"canonical_key": "عطاره", "name_ar": "عطارة", "name_en": "Atara", "aliases": ["عطاره"]},
    ]
    for cp in cps:
        kb.by_canonical_key[cp["canonical_key"]] = cp
        nn = _normalise(cp["name_ar"])
        kb.by_name_norm[nn] = cp["canonical_key"]
        kb.all_names.append((nn, cp["canonical_key"]))
        for a in cp.get("aliases", []):
            kb.aliases[_normalise(a)] = cp["canonical_key"]
    kb.all_names.sort(key=lambda x: -len(x[0]))
    return kb


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = 0

    async def complete_json(self, system, user, *, schema_hint="", cache_key=None):
        self.calls += 1
        return self.payload


def test_valid_report_kept_and_hallucination_dropped():
    payload = {"reports": [
        {"checkpoint_name": "حوارة", "status": "closed", "direction": "both"},
        {"checkpoint_name": "مفرق الخيال", "status": "open"},   # not in catalog → drop
    ]}
    out = _run(extract_checkpoint_llm("raw msg", _kb(), client=FakeClient(payload)))
    assert [u["canonical_key"] for u in out] == ["حواره"]
    u = out[0]
    assert u["status"] == "closed"
    assert u["direction"] == "both"
    assert u["raw_line"] == "raw msg"
    assert u["name_raw"] == "حوارة"        # canonical name from catalog, not LLM echo


def test_none_result_returns_empty():
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient(None)))
    assert out == []


def test_no_reports_returns_empty():
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient({"reports": []})))
    assert out == []


def test_invalid_status_dropped():
    payload = {"reports": [{"checkpoint_name": "عطارة", "status": "banana"}]}
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient(payload)))
    assert out == []


def test_unknown_status_dropped_as_no_information():
    payload = {"reports": [{"checkpoint_name": "عطارة", "status": "unknown"}]}
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient(payload)))
    assert out == []


def test_status_and_direction_synonyms_normalized():
    payload = {"reports": [{"checkpoint_name": "عطارة", "status": "army", "direction": "leaving"}]}
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient(payload)))
    assert out and out[0]["status"] == "idf" and out[0]["direction"] == "outbound"


def test_dedup_same_key_direction():
    payload = {"reports": [
        {"checkpoint_name": "حوارة", "status": "closed", "direction": "both"},
        {"checkpoint_name": "حوارة", "status": "closed", "direction": "both"},
    ]}
    out = _run(extract_checkpoint_llm("x", _kb(), client=FakeClient(payload)))
    assert len(out) == 1
