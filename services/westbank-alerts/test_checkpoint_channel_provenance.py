"""Phase 1 plumbing: the reporting channel of a checkpoint's latest status must
survive the aggregate (checkpoint_status) to the serving row, so the /v2 trust
layer can weight it. Previously checkpoint_status stored last_source_type and
last_msg_id but dropped the channel, so per-channel trust had no data to use.

Round-trips the REAL path: upsert_checkpoint_status -> checkpoint_status ->
_CHECKPOINT_SELECT -> _row_to_checkpoint.
"""
import asyncio
from datetime import datetime

from app import db_pool
from app import checkpoint_db as cpdb

_CP_COLS = ("canonical_key,name_ar,name_en,region,checkpoint_type,latitude,longitude,"
            "created_at,source_layer,obstacle_type,permanent_status")


def _run(coro):
    return asyncio.run(coro)


def test_upsert_carries_source_channel_to_serving_row(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await cpdb.init_checkpoint_db()
            # Catalog row so the LEFT JOIN returns the checkpoint.
            async with db_pool.get_checkpoint_db() as db:
                await db.execute(
                    f"INSERT INTO checkpoints ({_CP_COLS}) VALUES ({','.join('?' * 11)})",
                    ("حواره", "حوارة", "Huwara", "nablus", "checkpoint", 32.1, 35.2,
                     datetime.utcnow().isoformat(), "telegram", None, None))
                await db.commit()
            # A crowd report from a reputable checkpoint channel.
            await cpdb.upsert_checkpoint_status(
                {"canonical_key": "حواره", "name_raw": "حوارة", "status": "open",
                 "status_raw": "سالك", "direction": "",
                 "source_channel": "ahwalaltreq", "source_msg_id": 123},
                is_admin=False, channel="ahwalaltreq")
            return await cpdb.get_checkpoint("حواره")
        finally:
            await db_pool.close_pool()

    cp = _run(go())
    assert cp["source_channel"] == "ahwalaltreq"
