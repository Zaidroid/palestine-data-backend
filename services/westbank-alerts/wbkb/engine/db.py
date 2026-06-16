"""SQLite persistence — the reliable backbone.

Design choices that make this a backbone rather than a prototype store:
- **WAL + atomic writes**: a crash mid-write never corrupts the KB.
- **Append-only `facts` log**: every ingestion/confirmation is an immutable row.
  The "current" KB is a derived view (highest authority, then most recent /
  highest effective confidence per slot). This gives a full audit trail, time
  travel, and the confirmation-override semantics with no update logic.
- **`live_status`** is the one mutable, bounded table (last-status-wins per
  feed_key) that a feed worker writes and the router reads.

Matches the existing westbank-alerts SQLite infra (checkpoints.db / alerts.db),
so it is already covered by the nightly backup on .114.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "wbkb.db"
SCHEMA_VERSION = "1"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  type         TEXT,
  subtype      TEXT,
  name_en      TEXT,
  name_ar      TEXT,
  governorate  TEXT,
  lat          REAL,
  lng          REAL,
  coord_source TEXT,
  status_class TEXT,
  feed_key     TEXT,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL,
  to_id            TEXT NOT NULL,
  road_ref         TEXT,
  corridor         TEXT,
  class            TEXT,
  base_minutes     REAL,
  passes_settlement INTEGER DEFAULT 0,
  oneway           INTEGER DEFAULT 0,
  notes            TEXT
);

-- append-only provenance log. NEVER updated or deleted in normal operation.
CREATE TABLE IF NOT EXISTS facts (
  fact_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_kind   TEXT NOT NULL,           -- 'node' | 'edge'
  entity_id     TEXT NOT NULL,
  slot          TEXT NOT NULL,           -- exists | road_exists | permission | gating
  value_json    TEXT NOT NULL,           -- JSON-encoded value (bool / str / list)
  source        TEXT NOT NULL,
  fact_kind     TEXT NOT NULL,
  last_verified TEXT NOT NULL,           -- ISO; drives decay
  note          TEXT,
  recorded_at   TEXT NOT NULL            -- when this row was inserted
);
CREATE INDEX IF NOT EXISTS idx_facts_slot ON facts(entity_kind, entity_id, slot);

-- live checkpoint status (bounded, last-wins). Feed worker writes, router reads.
CREATE TABLE IF NOT EXISTS live_status (
  feed_key   TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  ts         TEXT NOT NULL,
  channel    TEXT,
  source     TEXT DEFAULT 'live_feed'
);
"""


def connect(path: Path | str = DB_PATH) -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Idempotent: create tables + stamp schema version."""
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (SCHEMA_VERSION,),
    )
    conn.commit()


def is_seeded(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM facts LIMIT 1").fetchone() is not None
