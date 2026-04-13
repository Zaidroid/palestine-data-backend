"""
Checkpoint database — async SQLite via aiosqlite.
Uses a separate DB file from the alerts system: /data/checkpoints.db
"""

import aiosqlite
import logging
import math
from datetime import datetime, timedelta
from typing import List, Optional

from .config import settings
from .db_pool import get_checkpoint_db

log = logging.getLogger("checkpoint_db")

CP_DB = settings.DB_PATH.replace("alerts.db", "checkpoints.db")

# ── Schema ────────────────────────────────────────────────────────────────────

CREATE_CHECKPOINTS = """
CREATE TABLE IF NOT EXISTS checkpoints (
    canonical_key   TEXT PRIMARY KEY,
    name_ar         TEXT NOT NULL,
    name_en         TEXT,
    region          TEXT,
    checkpoint_type TEXT DEFAULT 'checkpoint',
    latitude        REAL,
    longitude       REAL,
    created_at      TEXT NOT NULL
)
"""

CREATE_UPDATES = """
CREATE TABLE IF NOT EXISTS checkpoint_updates (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_key  TEXT NOT NULL,
    name_raw       TEXT NOT NULL,
    status         TEXT NOT NULL,
    status_raw     TEXT,
    direction      TEXT,
    source_type    TEXT NOT NULL,
    source_channel TEXT NOT NULL,
    source_msg_id  INTEGER,
    raw_line       TEXT,
    raw_message    TEXT,
    timestamp      TEXT NOT NULL,
    created_at     TEXT NOT NULL
)
"""

CREATE_STATUS = """
CREATE TABLE IF NOT EXISTS checkpoint_status (
    canonical_key    TEXT NOT NULL,
    direction        TEXT DEFAULT '',
    name_ar          TEXT NOT NULL,
    status           TEXT NOT NULL,
    status_raw       TEXT,
    confidence       TEXT NOT NULL,
    crowd_reports_1h INTEGER DEFAULT 0,
    last_updated     TEXT NOT NULL,
    last_source_type TEXT,
    last_msg_id      INTEGER,
    PRIMARY KEY (canonical_key, direction)
)
"""

CREATE_VOCAB_DISCOVERIES = """
CREATE TABLE IF NOT EXISTS vocab_discoveries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    word             TEXT NOT NULL,
    suggested_status TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    first_seen       TEXT NOT NULL,
    last_seen        TEXT NOT NULL,
    promoted         INTEGER DEFAULT 0,
    UNIQUE(word, suggested_status)
)
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_key       ON checkpoint_updates(canonical_key)",
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_timestamp ON checkpoint_updates(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_source    ON checkpoint_updates(source_type)",
    "CREATE INDEX IF NOT EXISTS idx_cp_status_status     ON checkpoint_status(status)",
]


async def init_checkpoint_db():
    async with get_checkpoint_db() as db:
        await db.execute(CREATE_CHECKPOINTS)
        await db.execute(CREATE_UPDATES)
        await db.execute(CREATE_STATUS)
        await db.execute(CREATE_VOCAB_DISCOVERIES)
        for idx in INDEXES:
            await db.execute(idx)
        # Migrations for existing DBs
        cursor = await db.execute("PRAGMA table_info(checkpoints)")
        cp_columns = {row[1] for row in await cursor.fetchall()}
        if "latitude" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN latitude REAL")
        if "longitude" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN longitude REAL")
        if "checkpoint_type" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN checkpoint_type TEXT DEFAULT 'checkpoint'")

        # Add direction to checkpoint_updates
        cursor = await db.execute("PRAGMA table_info(checkpoint_updates)")
        upd_columns = {row[1] for row in await cursor.fetchall()}
        if "direction" not in upd_columns:
            await db.execute("ALTER TABLE checkpoint_updates ADD COLUMN direction TEXT")

        # Migrate checkpoint_status to support direction as part of composite key.
        # Old table had PRIMARY KEY (canonical_key) only. We need (canonical_key, direction).
        # SQLite can't ALTER primary keys, so check and recreate if needed.
        cursor = await db.execute("PRAGMA table_info(checkpoint_status)")
        status_columns = {row[1] for row in await cursor.fetchall()}
        if "direction" not in status_columns:
            await db.execute("ALTER TABLE checkpoint_status RENAME TO checkpoint_status_old")
            await db.execute(CREATE_STATUS)
            await db.execute("""
                INSERT INTO checkpoint_status
                    (canonical_key, direction, name_ar, status, status_raw, confidence,
                     crowd_reports_1h, last_updated, last_source_type, last_msg_id)
                SELECT canonical_key, '', name_ar, status, status_raw, confidence,
                       crowd_reports_1h, last_updated, last_source_type, last_msg_id
                FROM checkpoint_status_old
            """)
            await db.execute("DROP TABLE checkpoint_status_old")

        await db.commit()
    log.info(f"Checkpoint DB ready at {CP_DB}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_checkpoint(row) -> dict:
    # Row order matches _CHECKPOINT_SELECT:
    # 0:canonical_key, 1:name_ar, 2:name_en, 3:region, 4:checkpoint_type,
    # 5:latitude, 6:longitude, 7:status, 8:status_raw, 9:direction,
    # 10:confidence, 11:crowd_reports_1h, 12:last_updated, 13:last_source_type
    last_updated = row[12]
    if last_updated:
        try:
            last_updated = datetime.fromisoformat(last_updated)
        except (ValueError, TypeError):
            last_updated = datetime.utcnow()
    else:
        last_updated = datetime.utcnow()

    age_seconds = (datetime.utcnow() - last_updated).total_seconds()
    last_active_hours = round(age_seconds / 3600, 1)
    is_stale = last_active_hours > settings.CHECKPOINT_STALE_HOURS

    direction = row[9] or None
    if direction == "":
        direction = None

    return {
        "canonical_key":    row[0],
        "name_ar":          row[1],
        "name_en":          row[2],
        "region":           row[3],
        "checkpoint_type":  row[4] or "checkpoint",
        "latitude":         row[5],
        "longitude":        row[6],
        "status":           row[7] or "unknown",
        "status_raw":       row[8],
        "direction":        direction,
        "confidence":       row[10] or "low",
        "crowd_reports_1h": row[11] or 0,
        "last_updated":     last_updated,
        "last_source_type": row[13],
        "last_active_hours": last_active_hours,
        "is_stale":          is_stale,
    }


def _row_to_update(row) -> dict:
    # Row order: id, canonical_key, name_raw, status, status_raw,
    #            source_type, source_channel, source_msg_id, raw_line, raw_message,
    #            timestamp, created_at, direction (added via ALTER TABLE at end)
    def _parse_dt(val):
        if val is None:
            return datetime.utcnow()
        if isinstance(val, datetime):
            return val
        try:
            return datetime.fromisoformat(val)
        except (ValueError, TypeError):
            return datetime.utcnow()

    return {
        "id":             row[0],
        "canonical_key":  row[1],
        "name_raw":       row[2],
        "status":         row[3],
        "status_raw":     row[4],
        "source_type":    row[5],
        "source_channel": row[6],
        "source_msg_id":  row[7],
        "raw_line":       row[8],
        "raw_message":    row[9],
        "timestamp":      _parse_dt(row[10]),
        "created_at":     _parse_dt(row[11]),
        "direction":      row[12] if len(row) > 12 else None,
    }


# ── Deduplication ─────────────────────────────────────────────────────────────

async def duplicate_check_cp(source_channel: str, msg_id: int, canonical_key: str) -> bool:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM checkpoint_updates "
            "WHERE source_channel=? AND source_msg_id=? AND canonical_key=? LIMIT 1",
            (source_channel, msg_id, canonical_key),
        )
        return await cur.fetchone() is not None


# ── Write operations ──────────────────────────────────────────────────────────

async def insert_checkpoint_update(upd: dict) -> int:
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        await db.execute(
            "INSERT OR IGNORE INTO checkpoints(canonical_key, name_ar, created_at) VALUES(?,?,?)",
            (upd["canonical_key"], upd["name_raw"], now),
        )
        cur = await db.execute(
            """INSERT INTO checkpoint_updates
               (canonical_key, name_raw, status, status_raw, direction, source_type,
                source_channel, source_msg_id, raw_line, raw_message, timestamp, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                upd["canonical_key"], upd["name_raw"], upd["status"], upd.get("status_raw"),
                upd.get("direction", ""),
                upd["source_type"], upd["source_channel"], upd.get("source_msg_id"),
                upd.get("raw_line"), upd.get("raw_message"),
                upd["timestamp"].isoformat() if isinstance(upd["timestamp"], datetime)
                else upd["timestamp"],
                now,
            ),
        )
        await db.commit()
        return cur.lastrowid


async def upsert_checkpoint_status(upd: dict, is_admin: bool, channel: str) -> str:
    now = datetime.utcnow()
    confidence = "high" if is_admin else "low"
    direction = upd.get("direction", "") or ""

    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT status FROM checkpoint_status WHERE canonical_key=? AND direction=?",
            (upd["canonical_key"], direction),
        )
        existing = await cur.fetchone()
        changed = existing is None or existing[0] != upd["status"]

        h1 = (now - timedelta(hours=1)).isoformat()
        cur = await db.execute(
            "SELECT COUNT(*) FROM checkpoint_updates "
            "WHERE canonical_key=? AND source_type='crowd' AND timestamp>=?",
            (upd["canonical_key"], h1),
        )
        (crowd_1h,) = await cur.fetchone()
        if not is_admin and crowd_1h >= 3:
            confidence = "medium"

        await db.execute(
            """INSERT INTO checkpoint_status
               (canonical_key, direction, name_ar, status, status_raw, confidence,
                crowd_reports_1h, last_updated, last_source_type, last_msg_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(canonical_key, direction) DO UPDATE SET
                 status=excluded.status,
                 status_raw=excluded.status_raw,
                 confidence=excluded.confidence,
                 crowd_reports_1h=excluded.crowd_reports_1h,
                 last_updated=excluded.last_updated,
                 last_source_type=excluded.last_source_type,
                 last_msg_id=excluded.last_msg_id""",
            (
                upd["canonical_key"], direction, upd["name_raw"],
                upd["status"], upd.get("status_raw"),
                confidence, crowd_1h, now.isoformat(), "admin" if is_admin else "crowd",
                upd.get("source_msg_id"),
            ),
        )
        await db.commit()
    return "changed" if changed else "same"


async def set_checkpoint_name(canonical_key: str, name_en: str = None,
                               name_ar: str = None, region: str = None,
                               latitude: float = None, longitude: float = None):
    async with get_checkpoint_db() as db:
        if name_en is not None:
            await db.execute(
                "UPDATE checkpoints SET name_en=? WHERE canonical_key=?",
                (name_en, canonical_key)
            )
        if name_ar is not None:
            await db.execute(
                "UPDATE checkpoints SET name_ar=? WHERE canonical_key=?",
                (name_ar, canonical_key)
            )
        if region is not None:
            await db.execute(
                "UPDATE checkpoints SET region=? WHERE canonical_key=?",
                (region, canonical_key)
            )
        if latitude is not None:
            await db.execute(
                "UPDATE checkpoints SET latitude=? WHERE canonical_key=?",
                (latitude, canonical_key)
            )
        if longitude is not None:
            await db.execute(
                "UPDATE checkpoints SET longitude=? WHERE canonical_key=?",
                (longitude, canonical_key)
            )
        await db.commit()


# ── Read operations ───────────────────────────────────────────────────────────

_CHECKPOINT_SELECT = """
    SELECT c.canonical_key, c.name_ar, c.name_en, c.region,
           c.checkpoint_type, c.latitude, c.longitude,
           s.status, s.status_raw, s.direction, s.confidence,
           s.crowd_reports_1h, s.last_updated, s.last_source_type
    FROM checkpoints c
    LEFT JOIN (
        SELECT canonical_key, status, status_raw, direction, confidence,
               crowd_reports_1h, last_updated, last_source_type
        FROM checkpoint_status
        WHERE rowid IN (
            SELECT MAX(rowid) FROM checkpoint_status GROUP BY canonical_key
        )
    ) s ON s.canonical_key = c.canonical_key
"""


async def get_all_checkpoints(
    status_filter: Optional[str] = None,
    region: Optional[str] = None,
    active_only: bool = False,
    since: Optional[datetime] = None,
) -> list:
    """
    Get checkpoints with optional filters.

    - status_filter: only checkpoints with this status
    - region: filter by region name
    - active_only: only checkpoints that have received at least one status update
    - since: only checkpoints updated after this time
    """
    conditions = []
    params = []

    if active_only or status_filter or since:
        conditions.append("s.canonical_key IS NOT NULL")

    if status_filter:
        conditions.append("s.status = ?")
        params.append(status_filter)

    if region:
        conditions.append("c.region = ?")
        params.append(region)

    if since:
        conditions.append("s.last_updated >= ?")
        params.append(since.isoformat())

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    query = f"{_CHECKPOINT_SELECT} {where} ORDER BY s.last_updated DESC NULLS LAST"

    async with get_checkpoint_db() as db:
        cur = await db.execute(query, params)
        rows = await cur.fetchall()
    return [_row_to_checkpoint(r) for r in rows]


async def get_checkpoint(canonical_key: str) -> Optional[dict]:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            f"{_CHECKPOINT_SELECT} WHERE c.canonical_key = ?",
            (canonical_key,),
        )
        row = await cur.fetchone()
    return _row_to_checkpoint(row) if row else None


async def get_checkpoint_history(canonical_key: str, limit: int = 50) -> list:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT id, canonical_key, name_raw, status, status_raw, "
            "source_type, source_channel, source_msg_id, raw_line, raw_message, "
            "timestamp, created_at, direction "
            "FROM checkpoint_updates "
            "WHERE canonical_key = ? "
            "ORDER BY timestamp DESC LIMIT ?",
            [canonical_key, limit],
        )
        rows = await cur.fetchall()
    return [_row_to_update(r) for r in rows]


async def get_updates(
    source_type: Optional[str] = None,
    canonical_key: Optional[str] = None,
    since: Optional[datetime] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple:
    conditions, params = [], []
    if source_type:
        conditions.append("source_type = ?")
        params.append(source_type)
    if canonical_key:
        conditions.append("canonical_key = ?")
        params.append(canonical_key)
    if since:
        conditions.append("timestamp >= ?")
        params.append(since.isoformat())
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with get_checkpoint_db() as db:
        cur = await db.execute(f"SELECT COUNT(*) FROM checkpoint_updates {where}", params)
        (total,) = await cur.fetchone()
        cur = await db.execute(
            f"SELECT id, canonical_key, name_raw, status, status_raw, "
            f"source_type, source_channel, source_msg_id, raw_line, raw_message, "
            f"timestamp, created_at, direction "
            f"FROM checkpoint_updates {where} "
            "ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            params + [limit, offset],
        )
        rows = await cur.fetchall()
    return [_row_to_update(r) for r in rows], total


async def get_all_canonical_keys() -> set[str]:
    async with get_checkpoint_db() as db:
        cur = await db.execute("SELECT canonical_key FROM checkpoints")
        rows = await cur.fetchall()
    return {r[0] for r in rows}


async def get_regions() -> list[dict]:
    """Get all regions with checkpoint counts."""
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            """SELECT c.region, COUNT(*) as total,
                      SUM(CASE WHEN s.status IS NOT NULL THEN 1 ELSE 0 END) as active
               FROM checkpoints c
               LEFT JOIN checkpoint_status s ON s.canonical_key = c.canonical_key
               WHERE c.region IS NOT NULL
               GROUP BY c.region
               ORDER BY total DESC"""
        )
        rows = await cur.fetchall()
    return [{"region": r[0], "total": r[1], "active": r[2]} for r in rows]


async def bulk_seed_checkpoints(entries: list[dict]) -> dict:
    inserted = 0
    updated = 0
    now = datetime.utcnow().isoformat()

    async with get_checkpoint_db() as db:
        for entry in entries:
            key = entry["canonical_key"]
            name_ar = entry.get("name_ar", "")
            name_en = entry.get("name_en")
            region = entry.get("region")
            cp_type = entry.get("checkpoint_type", "checkpoint")
            latitude = entry.get("latitude")
            longitude = entry.get("longitude")

            cur = await db.execute(
                "SELECT canonical_key FROM checkpoints WHERE canonical_key=?",
                (key,)
            )
            exists = await cur.fetchone()

            if exists:
                updates = []
                params = []
                if name_en:
                    updates.append("name_en = COALESCE(name_en, ?)")
                    params.append(name_en)
                if region:
                    updates.append("region = COALESCE(region, ?)")
                    params.append(region)
                if cp_type:
                    updates.append("checkpoint_type = ?")
                    params.append(cp_type)
                if latitude is not None:
                    updates.append("latitude = ?")
                    params.append(latitude)
                if longitude is not None:
                    updates.append("longitude = ?")
                    params.append(longitude)
                if updates:
                    params.append(key)
                    await db.execute(
                        f"UPDATE checkpoints SET {', '.join(updates)} WHERE canonical_key=?",
                        params,
                    )
                    updated += 1
            else:
                await db.execute(
                    "INSERT INTO checkpoints(canonical_key, name_ar, name_en, region, "
                    "checkpoint_type, latitude, longitude, created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (key, name_ar, name_en, region, cp_type, latitude, longitude, now),
                )
                inserted += 1

        await db.commit()

    log.info(f"Bulk seed: {inserted} inserted, {updated} updated")
    return {"inserted": inserted, "updated": updated, "total": len(entries)}


async def cleanup_garbage(dry_run: bool = False) -> dict:
    """
    Remove garbage checkpoint records:
    - Canonical keys with emojis, colons, parentheses
    - Keys longer than 30 chars (sentences, not names)
    - Keys with status words embedded
    """
    import re

    status_words_re = re.compile(
        r"(سالك|مغلق|مفتوح|مسكر|مقفل|مسدود|زحم|ضغط|بطي|جيش|عسكر)"
    )
    emoji_re = re.compile(
        r"[\U0001F300-\U0001F9FF\U00002600-\U000027BF✅❌🔴🟢🟡🟠🟣⛔🚫]"
    )

    async with get_checkpoint_db() as db:
        cur = await db.execute("SELECT canonical_key, name_ar FROM checkpoints")
        all_rows = await cur.fetchall()

        garbage_keys = []
        for key, name in all_rows:
            reasons = []
            if emoji_re.search(key) or emoji_re.search(name or ""):
                reasons.append("emoji")
            if ":" in key or "(" in key or ")" in key:
                reasons.append("punctuation")
            if len(key) > 30:
                reasons.append("too_long")
            # Check if key has status words embedded (but not at the very end since
            # that's the raw line format — we want keys that ARE status sentences)
            parts = key.replace("_", " ").split()
            if len(parts) > 4:
                status_count = sum(1 for p in parts if status_words_re.search(p))
                if status_count > 0:
                    reasons.append("status_in_name")

            if reasons:
                garbage_keys.append((key, reasons))

        if dry_run:
            return {"garbage_count": len(garbage_keys), "total": len(all_rows),
                    "samples": [(k, r) for k, r in garbage_keys[:20]]}

        deleted_checkpoints = 0
        for key, _ in garbage_keys:
            await db.execute("DELETE FROM checkpoint_updates WHERE canonical_key=?", (key,))
            await db.execute("DELETE FROM checkpoint_status WHERE canonical_key=?", (key,))
            await db.execute("DELETE FROM checkpoints WHERE canonical_key=?", (key,))
            deleted_checkpoints += 1

        await db.commit()

    return {
        "deleted_checkpoints": deleted_checkpoints,
        "total_before": len(all_rows),
        "total_after": len(all_rows) - deleted_checkpoints,
    }


async def get_checkpoint_stats() -> dict:
    now = datetime.utcnow()
    h1  = (now - timedelta(hours=1)).isoformat()
    h24 = (now - timedelta(hours=24)).isoformat()

    async with get_checkpoint_db() as db:
        # Total with known status
        total_active = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_status")).fetchone())[0]

        # Total in directory
        total_directory = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoints")).fetchone())[0]

        # Total with geo
        total_geo = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoints WHERE latitude IS NOT NULL")).fetchone())[0]

        by_status = {}
        async with db.execute(
            "SELECT status, COUNT(*) FROM checkpoint_status GROUP BY status"
        ) as cur:
            async for row in cur:
                by_status[row[0]] = row[1]

        by_conf = {}
        async with db.execute(
            "SELECT confidence, COUNT(*) FROM checkpoint_status GROUP BY confidence"
        ) as cur:
            async for row in cur:
                by_conf[row[0]] = row[1]

        by_type = {}
        async with db.execute(
            "SELECT COALESCE(checkpoint_type, 'checkpoint'), COUNT(*) FROM checkpoints GROUP BY checkpoint_type"
        ) as cur:
            async for row in cur:
                by_type[row[0]] = row[1]

        u1h  = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_updates WHERE timestamp>=?", (h1,)
        )).fetchone())[0]

        u24h = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_updates WHERE timestamp>=?", (h24,)
        )).fetchone())[0]

        adm24h = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_updates "
            "WHERE source_type='admin' AND timestamp>=?", (h24,)
        )).fetchone())[0]

    return dict(
        total_checkpoints=total_active,
        total_directory=total_directory,
        total_with_geo=total_geo,
        by_status=by_status,
        by_confidence=by_conf,
        by_type=by_type,
        updates_last_1h=u1h,
        updates_last_24h=u24h,
        admin_updates_24h=adm24h,
    )


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


async def get_checkpoints_nearby(
    lat: float, lng: float, radius_km: float = 10,
    status_filter: Optional[str] = None,
) -> list:
    delta = radius_km / 111.0
    query = f"""
        {_CHECKPOINT_SELECT}
        WHERE c.latitude IS NOT NULL
          AND c.latitude BETWEEN ? AND ?
          AND c.longitude BETWEEN ? AND ?
    """
    params: list = [lat - delta, lat + delta, lng - delta, lng + delta]
    if status_filter:
        query += " AND s.status = ?"
        params.append(status_filter)

    async with get_checkpoint_db() as db:
        cur = await db.execute(query, params)
        rows = await cur.fetchall()

    results = []
    for r in rows:
        cp = _row_to_checkpoint(r)
        dist = _haversine_km(lat, lng, cp["latitude"], cp["longitude"])
        if dist <= radius_km:
            cp["distance_km"] = round(dist, 2)
            results.append(cp)

    results.sort(key=lambda c: c["distance_km"])
    return results


# ── Vocab discoveries ─────────────────────────────────────────────────────────

async def insert_vocab_discovery(word: str, suggested_status: str, count: int) -> None:
    """
    Upsert a vocab discovery candidate. If the word+status pair already exists,
    update the occurrence count and last_seen timestamp.
    Called by learner.py — not auto-promoted, just stored for admin review.
    """
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        await db.execute(
            """INSERT INTO vocab_discoveries (word, suggested_status, occurrence_count, first_seen, last_seen)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(word, suggested_status) DO UPDATE SET
                 occurrence_count = MAX(excluded.occurrence_count, occurrence_count),
                 last_seen = excluded.last_seen""",
            (word, suggested_status, count, now, now),
        )
        await db.commit()


async def get_vocab_discoveries(promoted: Optional[bool] = None, limit: int = 100) -> list[dict]:
    """Return vocab discovery candidates. promoted=None returns all, True/False filters."""
    async with get_checkpoint_db() as db:
        if promoted is None:
            cur = await db.execute(
                "SELECT * FROM vocab_discoveries ORDER BY occurrence_count DESC LIMIT ?",
                (limit,),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM vocab_discoveries WHERE promoted=? "
                "ORDER BY occurrence_count DESC LIMIT ?",
                (1 if promoted else 0, limit),
            )
        rows = await cur.fetchall()
    return [
        {
            "id": r[0], "word": r[1], "suggested_status": r[2],
            "occurrence_count": r[3], "first_seen": r[4],
            "last_seen": r[5], "promoted": bool(r[6]),
        }
        for r in rows
    ]


# ── Summary snapshot ──────────────────────────────────────────────────────────

async def get_checkpoint_summary() -> dict:
    """
    Lightweight snapshot for dashboard headers and status bars.
    Returns counts by status, freshness, last update time, and stale flag.
    Designed to be polled every 30 seconds by frontends.
    """
    now = datetime.utcnow()
    h1  = (now - timedelta(hours=1)).isoformat()
    h6  = (now - timedelta(hours=6)).isoformat()

    async with get_checkpoint_db() as db:
        # Status breakdown
        by_status: dict = {}
        async with db.execute(
            "SELECT status, COUNT(*) FROM checkpoint_status GROUP BY status"
        ) as cur:
            async for row in cur:
                by_status[row[0]] = row[1]

        # Freshness counts
        fresh_1h = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_status WHERE last_updated >= ?", (h1,)
        )).fetchone())[0]

        fresh_6h = (await (await db.execute(
            "SELECT COUNT(*) FROM checkpoint_status WHERE last_updated >= ?", (h6,)
        )).fetchone())[0]

        # Last update timestamp across all checkpoints
        last_update_row = await (await db.execute(
            "SELECT MAX(last_updated) FROM checkpoint_status"
        )).fetchone()
        last_update = last_update_row[0] if last_update_row else None

    # Determine overall staleness (no updates in 6 hours = stale)
    is_stale = True
    if last_update:
        try:
            last_dt = datetime.fromisoformat(last_update)
            is_stale = (now - last_dt).total_seconds() > 6 * 3600
        except (ValueError, TypeError):
            pass

    return {
        "by_status":       by_status,
        "fresh_last_1h":   fresh_1h,
        "fresh_last_6h":   fresh_6h,
        "total_active":    sum(by_status.values()),
        "last_update":     last_update,
        "is_data_stale":   is_stale,
        "snapshot_at":     now.isoformat(),
    }


async def get_last_update_time() -> Optional[str]:
    """Return ISO timestamp of the most recent checkpoint status update."""
    async with get_checkpoint_db() as db:
        row = await (await db.execute(
            "SELECT MAX(last_updated) FROM checkpoint_status"
        )).fetchone()
    return row[0] if row else None
