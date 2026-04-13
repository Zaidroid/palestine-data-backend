"""
Shared SQLite connection pool — one persistent connection per database.

aiosqlite connections are NOT thread-safe but ARE safe for concurrent async
usage within a single event loop (aiosqlite serialises calls internally).
A single long-lived connection avoids:
  - Connection setup/teardown overhead on every query
  - "database is locked" errors from overlapping short-lived connections
  - Missing WAL mode benefits (WAL is per-connection, not per-file)

Usage:
    from .db_pool import get_alerts_db, get_checkpoint_db

    async with get_alerts_db() as db:
        ...
"""

import aiosqlite
import logging
from contextlib import asynccontextmanager
from typing import Optional

log = logging.getLogger("db_pool")

_alerts_conn: Optional[aiosqlite.Connection] = None
_checkpoint_conn: Optional[aiosqlite.Connection] = None


async def _open(path: str) -> aiosqlite.Connection:
    conn = await aiosqlite.connect(path)
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA synchronous=NORMAL")
    await conn.execute("PRAGMA busy_timeout=5000")
    conn.row_factory = None  # keep default tuple rows
    return conn


async def init_pool(alerts_path: str, checkpoint_path: str) -> None:
    """Open persistent connections. Call once at startup (from lifespan)."""
    global _alerts_conn, _checkpoint_conn
    import os
    os.makedirs(os.path.dirname(alerts_path), exist_ok=True)
    os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
    _alerts_conn = await _open(alerts_path)
    _checkpoint_conn = await _open(checkpoint_path)
    log.info(f"DB pool ready — alerts: {alerts_path}, checkpoints: {checkpoint_path}")


async def close_pool() -> None:
    """Close persistent connections. Call at shutdown."""
    global _alerts_conn, _checkpoint_conn
    if _alerts_conn:
        await _alerts_conn.close()
        _alerts_conn = None
    if _checkpoint_conn:
        await _checkpoint_conn.close()
        _checkpoint_conn = None
    log.info("DB pool closed")


@asynccontextmanager
async def get_alerts_db():
    """Yield the shared alerts DB connection."""
    if _alerts_conn is None:
        raise RuntimeError("DB pool not initialised — call init_pool() first")
    yield _alerts_conn


@asynccontextmanager
async def get_checkpoint_db():
    """Yield the shared checkpoint DB connection."""
    if _checkpoint_conn is None:
        raise RuntimeError("DB pool not initialised — call init_pool() first")
    yield _checkpoint_conn
