"""Phase C — checkpoint candidate review pipeline.

DB CRUD for checkpoint_candidates + the pure auto-promotion gate. The gate is
deliberately strict (every condition must hold) and gated by an `enabled` flag so
auto-promotion ships OFF (review-only) until precision is observed.

Run:  pytest test_candidates.py -v
"""
import asyncio

from app import db_pool
from app import checkpoint_db as cpdb
from app.learner_checkpoints import should_auto_promote


def _run(coro):
    return asyncio.run(coro)


def test_candidate_crud_and_mention_accumulation(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await cpdb.upsert_candidate(raw_name="مفرق رنتيس", normalized="مفرق رنتيس", mentions=3)
            await cpdb.upsert_candidate(raw_name="مفرق رنتيس", normalized="مفرق رنتيس", mentions=2)
            pending = await cpdb.get_candidates(status="pending")
            # add LLM verdict + coords, then mark promoted
            cid = pending[0]["id"]
            await cpdb.set_candidate_llm(cid, verdict="real", confidence=0.92,
                                         suggested_name_ar="رنتيس", governorate="Ramallah",
                                         lat=32.0, lon=35.05)
            await cpdb.set_candidate_review(cid, status="promoted", reviewed_by="auto")
            after_pending = await cpdb.get_candidates(status="pending")
            promoted = await cpdb.get_candidates(status="promoted")
            return pending, after_pending, promoted
        finally:
            await db_pool.close_pool()

    pending, after_pending, promoted = _run(go())
    assert len(pending) == 1
    assert pending[0]["mentions"] == 5            # 3 + 2 accumulated on the unique normalized key
    assert after_pending == []                    # moved out of pending
    assert promoted[0]["llm_confidence"] == 0.92
    assert promoted[0]["suggested_name_ar"] == "رنتيس"


# ── pure promotion gate ──────────────────────────────────────────────────────

def _cand(**over):
    base = {"mentions": 6, "suggested_lat": 32.0, "suggested_lon": 35.0,
            "llm_verdict": "real", "llm_confidence": 0.95}
    base.update(over)
    return base


def test_gate_promotes_when_all_conditions_hold():
    assert should_auto_promote(_cand(), min_mentions=5, min_confidence=0.9, enabled=True)


def test_gate_blocked_when_disabled():
    assert not should_auto_promote(_cand(), min_mentions=5, min_confidence=0.9, enabled=False)


def test_gate_requires_geocode():
    assert not should_auto_promote(_cand(suggested_lat=None), min_mentions=5,
                                   min_confidence=0.9, enabled=True)


def test_gate_requires_min_mentions():
    assert not should_auto_promote(_cand(mentions=2), min_mentions=5,
                                   min_confidence=0.9, enabled=True)


def test_gate_requires_positive_llm_verdict():
    assert not should_auto_promote(_cand(llm_verdict="not_a_checkpoint"), min_mentions=5,
                                   min_confidence=0.9, enabled=True)


def test_gate_requires_confidence_threshold():
    assert not should_auto_promote(_cand(llm_confidence=0.6), min_mentions=5,
                                   min_confidence=0.9, enabled=True)
