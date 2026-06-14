"""Phase B / B1 — bulk_seed_checkpoints must propagate the Phase-0 catalog fields
(source_layer / obstacle_type / permanent_status) so curated facts like Huwara's
permanent closure and the OCHA/OSM static layer actually reach the served DB.

Run:  pytest test_seed_fields.py -v
"""
import asyncio

from app import db_pool
from app import checkpoint_db as cpdb


def _run(coro):
    return asyncio.run(coro)


def test_seed_writes_and_updates_new_fields(tmp_path):
    async def go():
        await db_pool.init_pool(str(tmp_path / "alerts.db"), str(tmp_path / "checkpoints.db"))
        try:
            await cpdb.init_checkpoint_db()
            # New entry carrying source_layer + obstacle_type
            await cpdb.bulk_seed_checkpoints([{
                "canonical_key": "بيت_ايبا", "name_ar": "بيت إيبا", "name_en": "Beit Iba",
                "region": "nablus", "checkpoint_type": "checkpoint",
                "latitude": 32.224, "longitude": 35.18,
                "source_layer": "manual", "obstacle_type": "checkpoint",
            }])
            # Existing entry, then re-seed to SET permanent_status (curation update)
            await cpdb.bulk_seed_checkpoints([{
                "canonical_key": "حواره", "name_ar": "حوارة",
                "latitude": 32.1587, "longitude": 35.2538,
            }])
            await cpdb.bulk_seed_checkpoints([{
                "canonical_key": "حواره", "name_ar": "حوارة",
                "permanent_status": "closed_since:2023-10",
            }])
            async with db_pool.get_checkpoint_db() as db:
                cur = await db.execute(
                    "SELECT canonical_key, source_layer, obstacle_type, permanent_status "
                    "FROM checkpoints WHERE canonical_key IN ('بيت_ايبا','حواره') "
                    "ORDER BY canonical_key")
                rows = await cur.fetchall()
            return {r[0]: r for r in rows}
        finally:
            await db_pool.close_pool()

    rows = _run(go())
    beit_iba = rows["بيت_ايبا"]
    assert beit_iba[1] == "manual"            # source_layer
    assert beit_iba[2] == "checkpoint"        # obstacle_type
    huwara = rows["حواره"]
    assert huwara[3] == "closed_since:2023-10"  # permanent_status set on re-seed
