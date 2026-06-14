"""Phase E / E3 — crowdsource report + verify (app/reports.py:process_report).

A user report that matches a catalog checkpoint is applied as a CROWD status update
(reusing the existing upsert path, so the ≥3-reports/hour confidence bump applies);
an unknown name is queued as a review candidate; abusive volume is rate-limited.

Run:  pytest test_reports.py -v
"""
import asyncio
from datetime import datetime, timedelta

from app import db_pool
from app import checkpoint_db as cpdb
from app.reports import process_report


def _run(coro):
    return asyncio.run(coro)


class _KB:
    def __init__(self, known):
        self._known = set(known)

    def is_known(self, key):
        return key in self._known


async def _seed_known():
    await cpdb.bulk_seed_checkpoints([{
        "canonical_key": "حواره", "name_ar": "حوارة", "name_en": "Huwara",
        "region": "nablus", "latitude": 32.1587, "longitude": 35.2538}])


def test_report_for_known_checkpoint_applies_crowd_update(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_known()
            res = await process_report({"canonical_key": "حواره", "status": "closed"},
                                       reporter_hash="h1", kb=_KB(["حواره"]))
            cp = await cpdb.get_checkpoint("حواره")
            return res, cp
        finally:
            await db_pool.close_pool()

    res, cp = _run(go())
    assert res["applied"] is True
    assert res["canonical_key"] == "حواره"
    assert cp["status"] == "closed"
    assert cp["last_source_type"] in ("crowd", None) or cp["confidence"] in ("low", "medium")


def test_three_reports_bump_confidence_to_medium(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_known()
            for i in range(3):
                await process_report({"canonical_key": "حواره", "status": "closed"},
                                     reporter_hash=f"h{i}", kb=_KB(["حواره"]))
            return await cpdb.get_checkpoint("حواره")
        finally:
            await db_pool.close_pool()

    cp = _run(go())
    assert cp["status"] == "closed"
    assert cp["confidence"] == "medium"      # existing crowd logic: >=3 crowd/hour → medium


def test_unknown_name_is_queued_as_candidate(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            res = await process_report({"canonical_key": "مكان مجهول", "status": "closed"},
                                       reporter_hash="h1", kb=_KB([]))   # not known
            cands = await cpdb.get_candidates(status="pending")
            return res, cands
        finally:
            await db_pool.close_pool()

    res, cands = _run(go())
    assert res["applied"] is False
    assert res["queued_as_candidate"] is True
    assert any(c["raw_name"] == "مكان مجهول" for c in cands)


def test_rate_limit(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed_known()
            r1 = await process_report({"canonical_key": "حواره", "status": "open"},
                                      reporter_hash="spammer", kb=_KB(["حواره"]), max_per_min=2)
            r2 = await process_report({"canonical_key": "حواره", "status": "open"},
                                      reporter_hash="spammer", kb=_KB(["حواره"]), max_per_min=2)
            r3 = await process_report({"canonical_key": "حواره", "status": "open"},
                                      reporter_hash="spammer", kb=_KB(["حواره"]), max_per_min=2)
            return r1, r2, r3
        finally:
            await db_pool.close_pool()

    r1, r2, r3 = _run(go())
    assert r1["status"] == "recorded" and r2["status"] == "recorded"
    assert r3["status"] == "rate_limited"


def test_invalid_status_rejected(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            try:
                await process_report({"canonical_key": "حواره", "status": "banana"},
                                     reporter_hash="h1", kb=_KB(["حواره"]))
                return "no error"
            except ValueError:
                return "rejected"
        finally:
            await db_pool.close_pool()

    assert _run(go()) == "rejected"
