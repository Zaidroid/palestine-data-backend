"""Phase 0 / S3 — additive, idempotent schema migration (init_checkpoint_db).

Verifies the new Phase-0 columns/tables exist, that running the migration twice is
a no-op, and that a LEGACY checkpoints.db (original columns only, with data) migrates
forward without losing rows — this is what happens to the live /data/checkpoints.db
on next boot.

Run:  pytest test_migration.py -v
"""
import asyncio

import aiosqlite

from app import db_pool
from app.checkpoint_db import init_checkpoint_db


def _run(coro):
    return asyncio.run(coro)


NEW_COLS = {"source_layer", "obstacle_type", "permanent_status",
            "external_ref", "verified_at", "updated_at"}
NEW_TABLES = {"checkpoint_candidates", "user_reports", "llm_cache"}


async def _schema():
    async with db_pool.get_checkpoint_db() as db:
        cur = await db.execute("PRAGMA table_info(checkpoints)")
        cols = {r[1] for r in await cur.fetchall()}
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in await cur.fetchall()}
    return cols, tables


def test_migration_adds_columns_and_tables_idempotently(tmp_path):
    cp = str(tmp_path / "checkpoints.db")
    al = str(tmp_path / "alerts.db")

    async def go():
        await db_pool.init_pool(al, cp)
        try:
            await init_checkpoint_db()
            await init_checkpoint_db()  # must be idempotent
            return await _schema()
        finally:
            await db_pool.close_pool()

    cols, tables = _run(go())
    assert NEW_COLS <= cols, NEW_COLS - cols
    assert NEW_TABLES <= tables, NEW_TABLES - tables
    # default for source_layer must be the curated/telegram layer
    # (checked via a round-trip below)


def test_legacy_db_migrates_without_dropping_rows(tmp_path):
    cp = str(tmp_path / "checkpoints.db")
    al = str(tmp_path / "alerts.db")

    async def go():
        # Build a LEGACY checkpoints table (original columns only) with one row.
        conn = await aiosqlite.connect(cp)
        await conn.execute(
            "CREATE TABLE checkpoints (canonical_key TEXT PRIMARY KEY, name_ar TEXT NOT NULL, "
            "name_en TEXT, region TEXT, checkpoint_type TEXT DEFAULT 'checkpoint', "
            "created_at TEXT NOT NULL)"
        )
        await conn.execute(
            "INSERT INTO checkpoints (canonical_key, name_ar, created_at) VALUES (?,?,?)",
            ("حواره", "حوارة", "2026-01-01T00:00:00"),
        )
        await conn.commit()
        await conn.close()

        await db_pool.init_pool(al, cp)
        try:
            await init_checkpoint_db()
            cols, tables = await _schema()
            async with db_pool.get_checkpoint_db() as db:
                cur = await db.execute(
                    "SELECT canonical_key, source_layer FROM checkpoints WHERE canonical_key=?",
                    ("حواره",),
                )
                row = await cur.fetchone()
            return cols, tables, row
        finally:
            await db_pool.close_pool()

    cols, tables, row = _run(go())
    assert NEW_COLS <= cols
    assert NEW_TABLES <= tables
    assert row is not None and row[0] == "حواره"   # legacy row preserved
    assert row[1] == "telegram"                     # default source_layer applied
