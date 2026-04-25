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
    count           INTEGER DEFAULT 1,   -- 1 for named; aggregate (e.g. "138 killed on 2023-10-08") for daily-bulletin rows
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
        # Migration: add `count` column to existing people_killed tables
        cur = await db.execute("PRAGMA table_info(people_killed)")
        cols = {row[1] for row in await cur.fetchall()}
        if "count" not in cols:
            await db.execute("ALTER TABLE people_killed ADD COLUMN count INTEGER DEFAULT 1")
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
        "lat", "lng", "cause", "count", "source_alert_id", "source_dataset",
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
    record.setdefault("count", 1)
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


# ── Generic query helper for the public /databank/* endpoints ────────────────

# Whitelist of (table, column-set) — protects the dynamic WHERE builder from
# user-supplied filter keys.
_TABLE_FILTERS = {
    "people_killed": {
        "from":         ("date >= ?", "date"),
        "to":           ("date <= ?", "date"),
        "place":        ("place_name LIKE ?", "like"),
        "region":       ("place_region = ?", "exact"),
        "age_min":      ("age >= ?", "int"),
        "age_max":      ("age <= ?", "int"),
        "gender":       ("gender = ?", "exact"),
        "cause":        ("cause = ?", "exact"),
        "source":       ("source_dataset = ?", "exact"),
    },
    "people_injured": {
        "from":   ("date >= ?", "date"),
        "to":     ("date <= ?", "date"),
        "place":  ("place_name LIKE ?", "like"),
        "region": ("place_region = ?", "exact"),
        "source": ("source_dataset = ?", "exact"),
    },
    "people_detained": {
        "from":   ("date_arrested >= ?", "date"),
        "to":     ("date_arrested <= ?", "date"),
        "place":  ("place_name LIKE ?", "like"),
        "region": ("place_region = ?", "exact"),
        "status": ("status = ?", "exact"),
        "gender": ("gender = ?", "exact"),
        "source": ("source_dataset = ?", "exact"),
    },
    "structures_damaged": {
        "from":   ("date >= ?", "date"),
        "to":     ("date <= ?", "date"),
        "type":   ("type = ?", "exact"),
        "place":  ("place_name LIKE ?", "like"),
        "region": ("place_region = ?", "exact"),
        "source": ("source_dataset = ?", "exact"),
    },
    "actor_actions": {
        "from":     ("date >= ?", "date"),
        "to":       ("date <= ?", "date"),
        "actor":    ("actor_type = ?", "exact"),
        "type":     ("action_type = ?", "exact"),
        "place":    ("place_name LIKE ?", "like"),
        "region":   ("place_region = ?", "exact"),
        "source":   ("source_dataset = ?", "exact"),
    },
}

_TABLE_DATE_COLUMN = {
    "people_killed":      "date",
    "people_injured":     "date",
    "people_detained":    "date_arrested",
    "structures_damaged": "date",
    "actor_actions":      "date",
}


def _build_where(table: str, filters: dict) -> tuple[str, list]:
    """Translate a {filter_key: value} dict into a parameterized WHERE clause.
    Unknown keys are silently dropped (no SQL injection vector)."""
    clauses, params = [], []
    spec = _TABLE_FILTERS.get(table, {})
    for k, v in filters.items():
        if v is None or v == "" or k not in spec:
            continue
        clause, kind = spec[k]
        if kind == "like":
            params.append(f"%{v}%")
        else:
            params.append(v)
        clauses.append(clause)
    return ("WHERE " + " AND ".join(clauses)) if clauses else "", params


async def query_table(
    table: str,
    filters: dict,
    limit: int = 100,
    offset: int = 0,
    order_desc: bool = True,
) -> tuple[list[dict], int]:
    """Filtered + paginated read of a databank table. Returns (rows, total)."""
    if table not in _TABLE_FILTERS:
        raise ValueError(f"unknown databank table: {table}")
    where, params = _build_where(table, filters)
    date_col = _TABLE_DATE_COLUMN[table]
    direction = "DESC" if order_desc else "ASC"
    async with get_alerts_db() as db:
        cur = await db.execute(f"SELECT COUNT(*) FROM {table} {where}", params)
        total = (await cur.fetchone())[0]
        cur = await db.execute(
            f"SELECT * FROM {table} {where} ORDER BY {date_col} {direction} LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        rows = await cur.fetchall()
        col_names = [d[0] for d in cur.description]
    return [dict(zip(col_names, r)) for r in rows], total


async def summary_table(
    table: str,
    filters: dict,
    interval: str = "month",   # day | month | year
    group_by: Optional[str] = None,  # place_region | gender | cause | actor_type | type
) -> list[dict]:
    """Time-series + optional secondary grouping for dashboard rollups."""
    if table not in _TABLE_FILTERS:
        raise ValueError(f"unknown databank table: {table}")
    if interval not in ("day", "month", "year"):
        raise ValueError(f"interval must be day | month | year, got {interval!r}")
    where, params = _build_where(table, filters)
    date_col = _TABLE_DATE_COLUMN[table]
    # SQLite date truncation
    bucket_expr = {
        "day":   f"substr({date_col}, 1, 10)",
        "month": f"substr({date_col}, 1, 7)",
        "year":  f"substr({date_col}, 1, 4)",
    }[interval]
    select_cols = [f"{bucket_expr} AS bucket", "COUNT(*) AS count"]
    group_cols = [bucket_expr]
    if group_by:
        # Whitelist by intersecting with table columns at query time
        async with get_alerts_db() as db:
            cur = await db.execute(f"PRAGMA table_info({table})")
            valid = {row[1] for row in await cur.fetchall()}
        if group_by not in valid:
            raise ValueError(f"group_by={group_by!r} not a column of {table}")
        select_cols.insert(1, group_by)
        group_cols.append(group_by)

    sql = (
        f"SELECT {', '.join(select_cols)} FROM {table} {where} "
        f"GROUP BY {', '.join(group_cols)} ORDER BY bucket DESC"
    )
    async with get_alerts_db() as db:
        cur = await db.execute(sql, params)
        rows = await cur.fetchall()
        col_names = [d[0] for d in cur.description]
    return [dict(zip(col_names, r)) for r in rows]


def rows_to_geojson(rows: list[dict]) -> dict:
    """Project rows to a FeatureCollection. Rows without lat/lng are skipped."""
    features = []
    for r in rows:
        lat, lng = r.get("lat"), r.get("lng")
        if lat is None or lng is None:
            continue
        props = {k: v for k, v in r.items() if k not in ("lat", "lng")}
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lng, lat]},
            "properties": props,
        })
    return {"type": "FeatureCollection", "features": features}
