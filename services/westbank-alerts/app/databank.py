"""
Long-term entity databank.

Stores normalized people / structure records derived from real-time alerts
and from external rosters (Tech4Palestine martyrs, Gaza MoH bulletins,
B'Tselem demolitions, Addameer prisoners). Tables grow over time and are
queryable independently of the live alert stream.

Schema goals:
- `stable_id` is a deterministic hash so the same person/event from two
  sources collapses into one row across re-ingest runs.
- Every row carries `source_dataset` + `source_url` so consumers can audit
  provenance, and `confidence` so they can filter by quality.
- `source_alert_id` links real-time-extracted rows back to their originating
  alert. Backfilled rows leave it NULL.
"""

import hashlib
import logging
from datetime import datetime
from typing import Any, Optional

from .db_pool import get_alerts_db

log = logging.getLogger("databank")


# ── Schema ────────────────────────────────────────────────────────────────────

CREATE_PEOPLE_KILLED = """
CREATE TABLE IF NOT EXISTS people_killed (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_id       TEXT UNIQUE NOT NULL,
    name_ar         TEXT,
    name_en         TEXT,
    age             INTEGER,
    gender          TEXT,                -- male | female | other | unknown
    date            TEXT,                -- YYYY-MM-DD when killed (NULL if unknown)
    date_precision  TEXT,                -- exact | day | month | year | unknown
    place_name      TEXT,
    place_region    TEXT,
    lat             REAL,
    lng             REAL,
    cause           TEXT,                -- bullet | airstrike | raid | settler_attack | demolition | missile | other
    source_alert_id INTEGER,             -- FK to alerts.id (NULL for backfill)
    source_dataset  TEXT NOT NULL,       -- tech4palestine | gaza_moh | btselem | classifier | ...
    source_url      TEXT,
    attribution_text TEXT,
    confidence      REAL DEFAULT 0.7,
    notes           TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
)
"""

CREATE_PEOPLE_INJURED = """
CREATE TABLE IF NOT EXISTS people_injured (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_id       TEXT UNIQUE NOT NULL,
    count           INTEGER NOT NULL,    -- aggregate count (named individuals rare in injury reports)
    severity_hint   TEXT,                -- critical | serious | moderate | light | unknown
    date            TEXT,
    place_name      TEXT,
    place_region    TEXT,
    lat             REAL,
    lng             REAL,
    cause           TEXT,
    source_alert_id INTEGER,
    source_dataset  TEXT NOT NULL,
    source_url      TEXT,
    attribution_text TEXT,
    confidence      REAL DEFAULT 0.7,
    notes           TEXT,
    created_at      TEXT NOT NULL
)
"""

CREATE_PEOPLE_DETAINED = """
CREATE TABLE IF NOT EXISTS people_detained (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_id         TEXT UNIQUE NOT NULL,
    name_ar           TEXT,
    name_en           TEXT,
    age               INTEGER,
    gender            TEXT,
    date_arrested     TEXT,
    date_released     TEXT,
    place_name        TEXT,
    place_region      TEXT,
    lat               REAL,
    lng               REAL,
    status            TEXT DEFAULT 'arrested',  -- arrested | administrative | released | sentenced
    detention_facility TEXT,
    sentence_months   INTEGER,
    count             INTEGER DEFAULT 1,        -- aggregate when names unknown
    source_alert_id   INTEGER,
    source_dataset    TEXT NOT NULL,
    source_url        TEXT,
    attribution_text  TEXT,
    confidence        REAL DEFAULT 0.7,
    notes             TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
)
"""

CREATE_STRUCTURES_DAMAGED = """
CREATE TABLE IF NOT EXISTS structures_damaged (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_id       TEXT UNIQUE NOT NULL,
    type            TEXT,                -- home | school | mosque | infrastructure | agricultural | other
    owner_name      TEXT,
    date            TEXT,
    place_name      TEXT,
    place_region    TEXT,
    lat             REAL,
    lng             REAL,
    cause           TEXT,                -- demolition | airstrike | settler_attack | raid_damage
    source_alert_id INTEGER,
    source_dataset  TEXT NOT NULL,
    source_url      TEXT,
    attribution_text TEXT,
    confidence      REAL DEFAULT 0.7,
    notes           TEXT,
    created_at      TEXT NOT NULL
)
"""

CREATE_ACTOR_ACTIONS = """
CREATE TABLE IF NOT EXISTS actor_actions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    stable_id       TEXT UNIQUE NOT NULL,
    actor_type      TEXT NOT NULL,       -- idf | settlers | police | israeli_authority | unknown
    actor_name      TEXT,                -- specific unit / settlement when known
    action_type     TEXT NOT NULL,       -- raid | shooting | demolition | arrest_campaign | settler_attack | checkpoint_action
    date            TEXT NOT NULL,
    place_name      TEXT,
    place_region    TEXT,
    lat             REAL,
    lng             REAL,
    target_count    INTEGER,
    source_alert_id INTEGER,
    source_dataset  TEXT NOT NULL,
    source_url      TEXT,
    attribution_text TEXT,
    confidence      REAL DEFAULT 0.7,
    notes           TEXT,
    created_at      TEXT NOT NULL
)
"""

CREATE_DATABANK_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_killed_date    ON people_killed(date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_killed_region  ON people_killed(place_region)",
    "CREATE INDEX IF NOT EXISTS idx_killed_dataset ON people_killed(source_dataset)",
    "CREATE INDEX IF NOT EXISTS idx_killed_lat     ON people_killed(lat)",
    "CREATE INDEX IF NOT EXISTS idx_killed_lng     ON people_killed(lng)",

    "CREATE INDEX IF NOT EXISTS idx_injured_date   ON people_injured(date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_injured_region ON people_injured(place_region)",

    "CREATE INDEX IF NOT EXISTS idx_detained_date  ON people_detained(date_arrested DESC)",
    "CREATE INDEX IF NOT EXISTS idx_detained_status ON people_detained(status)",

    "CREATE INDEX IF NOT EXISTS idx_structures_date ON structures_damaged(date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_structures_type ON structures_damaged(type)",

    "CREATE INDEX IF NOT EXISTS idx_actions_date    ON actor_actions(date DESC)",
    "CREATE INDEX IF NOT EXISTS idx_actions_actor   ON actor_actions(actor_type)",
    "CREATE INDEX IF NOT EXISTS idx_actions_type    ON actor_actions(action_type)",
]


async def init_databank():
    """Create databank tables + indexes. Idempotent. Call from app startup."""
    async with get_alerts_db() as db:
        await db.execute(CREATE_PEOPLE_KILLED)
        await db.execute(CREATE_PEOPLE_INJURED)
        await db.execute(CREATE_PEOPLE_DETAINED)
        await db.execute(CREATE_STRUCTURES_DAMAGED)
        await db.execute(CREATE_ACTOR_ACTIONS)
        for idx in CREATE_DATABANK_INDEXES:
            await db.execute(idx)
        await db.commit()
    log.info("databank tables initialized")


# ── Stable-id hashing ─────────────────────────────────────────────────────────

def stable_id(*parts: Any) -> str:
    """Deterministic hash over the joined parts so the same logical entity
    from two sources collapses into one row. Use the most distinctive
    identifying fields (name, dob, t4p_id) — never include source_url etc."""
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


# ── Insert helpers (UPSERT semantics on stable_id) ────────────────────────────

async def upsert_person_killed(record: dict) -> int:
    """Insert or update a people_killed row. Returns the row id."""
    now = datetime.utcnow().isoformat()
    record.setdefault("created_at", now)
    record["updated_at"] = now
    cols = [
        "stable_id", "name_ar", "name_en", "age", "gender",
        "date", "date_precision", "place_name", "place_region",
        "lat", "lng", "cause", "source_alert_id", "source_dataset",
        "source_url", "attribution_text", "confidence", "notes",
        "created_at", "updated_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_cols = [c for c in cols if c not in ("stable_id", "created_at")]
    update_clause = ",".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO people_killed ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    values = [record.get(c) for c in cols]
    async with get_alerts_db() as db:
        cur = await db.execute(sql, values)
        await db.commit()
        return cur.lastrowid


async def upsert_person_injured(record: dict) -> int:
    now = datetime.utcnow().isoformat()
    record.setdefault("created_at", now)
    cols = [
        "stable_id", "count", "severity_hint", "date",
        "place_name", "place_region", "lat", "lng", "cause",
        "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_cols = [c for c in cols if c not in ("stable_id", "created_at")]
    update_clause = ",".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO people_injured ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    values = [record.get(c) for c in cols]
    async with get_alerts_db() as db:
        cur = await db.execute(sql, values)
        await db.commit()
        return cur.lastrowid


async def upsert_person_detained(record: dict) -> int:
    now = datetime.utcnow().isoformat()
    record.setdefault("created_at", now)
    record["updated_at"] = now
    cols = [
        "stable_id", "name_ar", "name_en", "age", "gender",
        "date_arrested", "date_released", "place_name", "place_region",
        "lat", "lng", "status", "detention_facility", "sentence_months",
        "count", "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at", "updated_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_cols = [c for c in cols if c not in ("stable_id", "created_at")]
    update_clause = ",".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO people_detained ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    values = [record.get(c) for c in cols]
    async with get_alerts_db() as db:
        cur = await db.execute(sql, values)
        await db.commit()
        return cur.lastrowid


async def upsert_structure_damaged(record: dict) -> int:
    now = datetime.utcnow().isoformat()
    record.setdefault("created_at", now)
    cols = [
        "stable_id", "type", "owner_name", "date",
        "place_name", "place_region", "lat", "lng", "cause",
        "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_cols = [c for c in cols if c not in ("stable_id", "created_at")]
    update_clause = ",".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO structures_damaged ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    values = [record.get(c) for c in cols]
    async with get_alerts_db() as db:
        cur = await db.execute(sql, values)
        await db.commit()
        return cur.lastrowid


async def upsert_actor_action(record: dict) -> int:
    now = datetime.utcnow().isoformat()
    record.setdefault("created_at", now)
    cols = [
        "stable_id", "actor_type", "actor_name", "action_type",
        "date", "place_name", "place_region", "lat", "lng",
        "target_count", "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_cols = [c for c in cols if c not in ("stable_id", "created_at")]
    update_clause = ",".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO actor_actions ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    values = [record.get(c) for c in cols]
    async with get_alerts_db() as db:
        cur = await db.execute(sql, values)
        await db.commit()
        return cur.lastrowid


# ── Stats ─────────────────────────────────────────────────────────────────────

async def databank_counts() -> dict:
    async with get_alerts_db() as db:
        out = {}
        for tbl in (
            "people_killed", "people_injured", "people_detained",
            "structures_damaged", "actor_actions",
        ):
            cur = await db.execute(f"SELECT COUNT(*) FROM {tbl}")
            row = await cur.fetchone()
            out[tbl] = row[0] if row else 0
        return out
