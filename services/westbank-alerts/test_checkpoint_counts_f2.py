"""F2 — checkpoint summary/stats must count DISTINCT checkpoints (not per-direction
status rows) and separate fresh from stale, so the customer-facing headline stops
being ~2.5x inflated and stale-inclusive.

Run: pytest test_checkpoint_counts_f2.py -v
"""
import asyncio
from datetime import datetime, timedelta

from app import db_pool
from app import checkpoint_db as cpdb

_ST = ("canonical_key,direction,name_ar,status,status_raw,confidence,"
       "crowd_reports_1h,last_updated,last_source_type,last_msg_id")
_CP = ("canonical_key,name_ar,name_en,region,checkpoint_type,latitude,longitude,created_at")


async def _seed():
    now = datetime.utcnow()
    fresh = now.isoformat()
    fresher = (now - timedelta(minutes=5)).isoformat()
    stale = (now - timedelta(hours=30)).isoformat()
    async with db_pool.get_checkpoint_db() as db:
        async def cp(k):
            await db.execute(f"INSERT INTO checkpoints ({_CP}) VALUES (?,?,?,?,?,?,?,?)",
                             (k, k, k, "nablus", "checkpoint", 32.1, 35.2, fresh))
        async def st(k, d, status, lu):
            await db.execute(f"INSERT INTO checkpoint_status ({_ST}) VALUES (?,?,?,?,?,?,?,?,?,?)",
                             (k, d, k, status, status, "medium", 0, lu, "crowd", 1))
        for k in ("A", "B", "C"):
            await cp(k)
        # A: two directions, both fresh — must count ONCE (freshest wins = open)
        await st("A", "inbound", "open", fresh)
        await st("A", "outbound", "closed", fresher)
        # B: single, STALE (30h)
        await st("B", "", "open", stale)
        # C: single, fresh
        await st("C", "", "congested", fresh)
        await db.commit()


def _run(coro):
    return asyncio.run(coro)


def test_summary_counts_distinct_not_per_direction(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed()
            return await cpdb.get_checkpoint_summary()
        finally:
            await db_pool.close_pool()
    s = _run(go())
    # 3 distinct checkpoints (A counted once despite 2 direction rows)
    assert s["total_active"] == 3
    assert sum(s["by_status"].values()) == 3
    # A's freshest direction is 'open' (fresh > fresher) → open counted, not closed
    assert s["by_status"].get("open") == 2  # A + B
    # fresh (<=6h): A + C = 2; B is stale
    assert s["fresh_last_6h"] == 2
    # honest stale + directory keys present
    assert s["stale"] == 1
    assert s["total_directory"] == 3
    # fresh-only status breakdown excludes the stale B
    assert s["by_status_fresh_6h"].get("open") == 1   # only A (B is stale)


def test_stats_total_is_distinct(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "a.db"), str(tmp_path / "c.db"))
        try:
            await cpdb.init_checkpoint_db()
            await _seed()
            return await cpdb.get_checkpoint_stats()
        finally:
            await db_pool.close_pool()
    st = _run(go())
    assert st["total_checkpoints"] == 3          # distinct, not 4 status rows
    assert sum(st["by_status"].values()) == 3
    assert st["total_directory"] == 3
