"""Phase C — candidate cycle orchestration (app/learner_checkpoints.run_candidate_cycle).

Drives the directory→candidate→vet→(promote|pending) pipeline with injected
collaborators against a temp DB. Verifies: known checkpoints are skipped, candidates
are seeded idempotently (absolute counts), vetting attaches a verdict, review-only
mode leaves them pending, and the strict gate promotes only when enabled + all gates pass.

Run:  pytest test_learner_cycle.py -v
"""
import asyncio

from app import db_pool
from app import checkpoint_db as cpdb
from app.learner_checkpoints import run_candidate_cycle


def _run(coro):
    return asyncio.run(coro)


class _KB:
    """Minimal KB: only 'حواره' is already known."""
    def find_checkpoint(self, name):
        return "حواره" if "حوار" in name else None
    by_canonical_key = {}
    by_name_norm = {}
    all_names = []


DIRECTORY = [
    {"name_ar": "حوارة", "total_mentions": 50},        # already known → skipped
    {"name_ar": "مفرق رنتيس", "total_mentions": 8},     # real → vetted
    {"name_ar": "كثافة سير", "total_mentions": 6},      # junk → vetted negative
    {"name_ar": "نادر", "total_mentions": 1},           # below DIRECTORY_MIN (3) → ignored
]


async def _fake_vetter(name):
    if "رنتيس" in name:
        return {"is_real_checkpoint": True, "suggested_name_ar": "رنتيس",
                "governorate": "Ramallah", "confidence": 0.95}
    return {"is_real_checkpoint": False, "confidence": 0.9}


def _fake_geocoder(name):
    return {"latitude": 32.0, "longitude": 35.05} if "رنتيس" in name else None


def test_cycle_review_only_leaves_candidates_pending(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            stats = await run_candidate_cycle(
                directory=DIRECTORY, kb=_KB(), vetter=_fake_vetter, geocoder=_fake_geocoder,
                min_mentions=5, min_confidence=0.9, auto_promote=False)
            pending = await cpdb.get_candidates(status="pending")
            promoted = await cpdb.get_candidates(status="promoted")
            return stats, pending, promoted
        finally:
            await db_pool.close_pool()

    stats, pending, promoted = _run(go())
    assert stats["skipped_known"] == 1               # Huwara skipped
    assert stats["upserted"] == 2                    # رنتيس + كثافة سير (نادر below min)
    assert stats["vetted"] == 2
    assert stats["promoted"] == 0                    # review-only
    names = {c["raw_name"]: c for c in pending}
    assert names["مفرق رنتيس"]["llm_verdict"] == "real"
    assert names["كثافة سير"]["llm_verdict"] == "not_a_checkpoint"
    assert promoted == []


def test_cycle_auto_promote_promotes_only_the_real_geocoded_one(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            stats = await run_candidate_cycle(
                directory=DIRECTORY, kb=_KB(), vetter=_fake_vetter, geocoder=_fake_geocoder,
                min_mentions=5, min_confidence=0.9, auto_promote=True)
            promoted = await cpdb.get_candidates(status="promoted")
            # the promoted candidate must now exist as a real checkpoint row
            async with db_pool.get_checkpoint_db() as db:
                cur = await db.execute(
                    "SELECT canonical_key, source_layer FROM checkpoints WHERE name_ar='رنتيس'")
                cp_row = await cur.fetchone()
            return stats, promoted, cp_row
        finally:
            await db_pool.close_pool()

    stats, promoted, cp_row = _run(go())
    assert stats["promoted"] == 1
    assert [c["raw_name"] for c in promoted] == ["مفرق رنتيس"]
    assert cp_row is not None and cp_row[1] == "manual"   # seeded into catalog as manual


def test_cycle_is_idempotent_on_rerun(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await run_candidate_cycle(directory=DIRECTORY, kb=_KB(), vetter=_fake_vetter,
                                      geocoder=_fake_geocoder, min_mentions=5,
                                      min_confidence=0.9, auto_promote=False)
            await run_candidate_cycle(directory=DIRECTORY, kb=_KB(), vetter=_fake_vetter,
                                      geocoder=_fake_geocoder, min_mentions=5,
                                      min_confidence=0.9, auto_promote=False)
            cand = [c for c in await cpdb.get_candidates() if c["raw_name"] == "مفرق رنتيس"][0]
            return cand
        finally:
            await db_pool.close_pool()

    cand = _run(go())
    assert cand["mentions"] == 8         # absolute set, not 8+8 — re-run did not inflate
