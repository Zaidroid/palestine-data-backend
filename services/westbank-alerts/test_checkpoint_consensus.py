"""Phase 2a: checkpoint status is a recency-decayed, source-weighted consensus
over recent reports — NOT last-write-wins. A lone spam/contradictory report can
no longer flip the map when several recent reports agree; admin reports dominate;
sparse checkpoints stay responsive (the freshest report wins when it's the only
recent signal). Confidence reflects agreement, not raw count.

_consensus_status is pure (status, source_type, age_minutes) -> (status,
confidence, agreement_ratio), so it is unit-tested here without a DB.
"""
import os
os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

from app.checkpoint_db import _consensus_status


def test_single_crowd_report_caps_at_medium():
    # Full agreement, but crowd-only → caps at "medium" (high needs an admin report).
    status, conf, ratio = _consensus_status([("open", "crowd", 0.0)])
    assert status == "open"
    assert ratio == 1.0
    assert conf == "medium"


def test_admin_backed_strong_agreement_is_high():
    reports = [("closed", "admin", 0.0)] + [("closed", "crowd", 1.0)] * 2
    status, conf, ratio = _consensus_status(reports)
    assert status == "closed"
    assert ratio >= 0.75 and conf == "high"


def test_lone_spam_does_not_flip_recent_majority():
    # 5 fresh crowd "open" + 1 fresh crowd "closed" → stays open (crowd → medium).
    reports = [("open", "crowd", 1.0)] * 5 + [("closed", "crowd", 0.0)]
    status, conf, ratio = _consensus_status(reports)
    assert status == "open"
    assert ratio >= 0.75 and conf == "medium"


def test_admin_outweighs_crowd():
    # One fresh admin "closed" beats three fresh crowd "open".
    reports = [("open", "crowd", 0.0)] * 3 + [("closed", "admin", 0.0)]
    status, conf, ratio = _consensus_status(reports)
    assert status == "closed"


def test_recency_lets_fresh_report_win_over_stale():
    # A stale "open" (2h ago) loses to a fresh "closed" — sparse checkpoints stay
    # responsive instead of clinging to an old status.
    status, _, _ = _consensus_status([("open", "crowd", 120.0), ("closed", "crowd", 0.0)])
    assert status == "closed"


def test_split_reports_yield_low_confidence():
    # Genuine disagreement (3 vs 3, all fresh) → contested → not high confidence.
    reports = [("open", "crowd", 0.0)] * 3 + [("closed", "crowd", 0.0)] * 3
    _, conf, ratio = _consensus_status(reports)
    assert ratio <= 0.5 and conf in ("low", "medium")


def test_no_reports_returns_none_low():
    status, conf, ratio = _consensus_status([])
    assert status is None and conf == "low" and ratio == 0.0


# ── integration: real upsert path must use consensus, not last-write-wins ──────
import asyncio
from datetime import datetime
from app import db_pool
from app import checkpoint_db as cpdb

_CP_COLS = ("canonical_key,name_ar,name_en,region,checkpoint_type,latitude,longitude,"
            "created_at,source_layer,obstacle_type,permanent_status")


def _run(coro):
    return asyncio.run(coro)


def _report(status, raw, msg):
    return {"canonical_key": "حواره", "name_raw": "حوارة", "status": status,
            "status_raw": raw, "direction": "", "source_type": "crowd",
            "source_channel": "ahwalaltreq", "source_msg_id": msg,
            "timestamp": datetime.utcnow()}


def test_lone_spam_report_does_not_flip_served_status(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            async with db_pool.get_checkpoint_db() as db:
                await db.execute(
                    f"INSERT INTO checkpoints ({_CP_COLS}) VALUES ({','.join('?' * 11)})",
                    ("حواره", "حوارة", "Huwara", "nablus", "checkpoint", 32.1, 35.2,
                     datetime.utcnow().isoformat(), "telegram", None, None))
                await db.commit()
            # Four fresh crowd "open" reports.
            for i in range(4):
                r = _report("open", "سالك", i)
                await cpdb.insert_checkpoint_update(r)
                await cpdb.upsert_checkpoint_status(r, is_admin=False, channel="ahwalaltreq")
            # One fresh crowd "closed" — a lone contradictory/spam report.
            spam = _report("closed", "مغلق", 99)
            await cpdb.insert_checkpoint_update(spam)
            await cpdb.upsert_checkpoint_status(spam, is_admin=False, channel="ahwalaltreq")
            return await cpdb.get_checkpoint("حواره")
        finally:
            await db_pool.close_pool()

    cp = _run(go())
    # Under last-write-wins this would be "closed"; consensus keeps it "open".
    assert cp["status"] == "open"
