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
    last_source_channel TEXT,
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

CREATE_LEARNED_VOCAB = """
CREATE TABLE IF NOT EXISTS learned_vocab (
    word             TEXT PRIMARY KEY,
    status           TEXT NOT NULL,
    confidence       REAL NOT NULL DEFAULT 0.0,
    source_count     INTEGER NOT NULL DEFAULT 0,
    auto_promoted    INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    last_seen        TEXT NOT NULL
)
"""

# ── Phase 0 / S3 — review queue, crowdsource reports, LLM cache ─────────────────
CREATE_CHECKPOINT_CANDIDATES = """
CREATE TABLE IF NOT EXISTS checkpoint_candidates (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_name              TEXT NOT NULL,
    normalized            TEXT NOT NULL,
    suggested_canonical_key TEXT,
    suggested_name_ar     TEXT,
    suggested_lat         REAL,
    suggested_lon         REAL,
    governorate           TEXT,
    mentions              INTEGER DEFAULT 1,
    first_seen            TEXT NOT NULL,
    last_seen             TEXT NOT NULL,
    llm_verdict           TEXT,
    llm_confidence        REAL,
    status                TEXT NOT NULL DEFAULT 'pending',
    reviewed_at           TEXT,
    reviewed_by           TEXT,
    UNIQUE(normalized)
)
"""

CREATE_USER_REPORTS = """
CREATE TABLE IF NOT EXISTS user_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_key  TEXT,
    status         TEXT NOT NULL,
    direction      TEXT,
    latitude       REAL,
    longitude      REAL,
    reporter_hash  TEXT,
    created_at     TEXT NOT NULL,
    verified       INTEGER DEFAULT 0,
    corroborations INTEGER DEFAULT 0
)
"""

CREATE_LLM_CACHE = """
CREATE TABLE IF NOT EXISTS llm_cache (
    cache_key     TEXT PRIMARY KEY,
    response_json TEXT,
    model         TEXT,
    created_at    TEXT NOT NULL
)
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_key       ON checkpoint_updates(canonical_key)",
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_timestamp ON checkpoint_updates(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_cp_updates_source    ON checkpoint_updates(source_type)",
    "CREATE INDEX IF NOT EXISTS idx_cp_status_status     ON checkpoint_status(status)",
    "CREATE INDEX IF NOT EXISTS idx_cp_candidates_status ON checkpoint_candidates(status)",
    "CREATE INDEX IF NOT EXISTS idx_user_reports_key     ON user_reports(canonical_key)",
    "CREATE INDEX IF NOT EXISTS idx_user_reports_created ON user_reports(created_at DESC)",
]


async def init_checkpoint_db():
    async with get_checkpoint_db() as db:
        await db.execute(CREATE_CHECKPOINTS)
        await db.execute(CREATE_UPDATES)
        await db.execute(CREATE_STATUS)
        await db.execute(CREATE_VOCAB_DISCOVERIES)
        await db.execute(CREATE_LEARNED_VOCAB)
        await db.execute(CREATE_CHECKPOINT_CANDIDATES)
        await db.execute(CREATE_USER_REPORTS)
        await db.execute(CREATE_LLM_CACHE)
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
        # Geo enrichment (geo_resolver.py): admin + Oslo classification and
        # how the coordinates were resolved ("checkpoint" exact vs "town" approx).
        if "governorate" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN governorate TEXT")
        if "oslo_area" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN oslo_area TEXT")
        if "geo_precision" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN geo_precision TEXT")
        # Phase 0 / S3 — static-vs-live data model + provenance.
        # source_layer distinguishes Telegram-tracked checkpoints from imported
        # OCHA/OSM static obstacles; permanent_status carries e.g. Huwara's
        # "closed_since:2023-10"; external_ref makes OCHA/OSM re-imports idempotent.
        if "source_layer" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN source_layer TEXT DEFAULT 'telegram'")
        if "obstacle_type" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN obstacle_type TEXT")
        if "permanent_status" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN permanent_status TEXT")
        if "external_ref" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN external_ref TEXT")
        if "verified_at" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN verified_at TEXT")
        if "updated_at" not in cp_columns:
            await db.execute("ALTER TABLE checkpoints ADD COLUMN updated_at TEXT")

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

        # Phase 1: carry the reporting channel of the latest status so per-channel
        # trust has data. Re-query columns (the block above may have recreated it).
        cursor = await db.execute("PRAGMA table_info(checkpoint_status)")
        status_columns = {row[1] for row in await cursor.fetchall()}
        if "last_source_channel" not in status_columns:
            await db.execute("ALTER TABLE checkpoint_status ADD COLUMN last_source_channel TEXT")

        # ── One-time migration: split "military" into idf/police/inspection ──
        cur = await db.execute(
            "SELECT COUNT(*) FROM checkpoint_updates WHERE status='military'"
        )
        (mil_count,) = await cur.fetchone()
        if mil_count > 0:
            log.info(f"Migrating {mil_count} 'military' records → idf/police/inspection...")
            # Police: شرطه, شرطة
            await db.execute(
                "UPDATE checkpoint_updates SET status='police' "
                "WHERE status='military' AND status_raw IN ('شرطه','شرطة')"
            )
            await db.execute(
                "UPDATE checkpoint_status SET status='police' "
                "WHERE status='military' AND status_raw IN ('شرطه','شرطة')"
            )
            # Inspection: تفتيش
            await db.execute(
                "UPDATE checkpoint_updates SET status='inspection' "
                "WHERE status='military' AND status_raw IN ('تفتيش')"
            )
            await db.execute(
                "UPDATE checkpoint_status SET status='inspection' "
                "WHERE status='military' AND status_raw IN ('تفتيش')"
            )
            # IDF: everything else that was military
            await db.execute(
                "UPDATE checkpoint_updates SET status='idf' WHERE status='military'"
            )
            await db.execute(
                "UPDATE checkpoint_status SET status='idf' WHERE status='military'"
            )
            log.info("Military status migration complete")

        await db.commit()
    log.info(f"Checkpoint DB ready at {CP_DB}")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_checkpoint(row) -> dict:
    # Row order matches _CHECKPOINT_SELECT:
    # 0:canonical_key, 1:name_ar, 2:name_en, 3:region, 4:checkpoint_type,
    # 5:latitude, 6:longitude, 7:status, 8:status_raw, 9:direction,
    # 10:confidence, 11:crowd_reports_1h, 12:last_updated, 13:last_source_type,
    # 14:governorate, 15:oslo_area, 16:geo_precision,
    # 17:source_layer, 18:obstacle_type, 19:permanent_status, 20:last_msg_id,
    # 21:last_source_channel
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
        "governorate":      row[14] if len(row) > 14 else None,
        "oslo_area":        row[15] if len(row) > 15 else None,
        "geo_precision":    row[16] if len(row) > 16 else None,
        "source_layer":     (row[17] if len(row) > 17 else None) or "telegram",
        "obstacle_type":    row[18] if len(row) > 18 else None,
        "permanent_status": row[19] if len(row) > 19 else None,
        "last_msg_id":      row[20] if len(row) > 20 else None,
        "source_channel":   row[21] if len(row) > 21 else None,
        # Raw last_updated (None when no status row) — provenance uses this to tell
        # "never reported" (freshness band "none") from "reported just now".
        "last_updated_iso": row[12],
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

# Status / restriction / generic words that should never be a checkpoint name.
# Matched against the normalized canonical_key and name_ar. Two layers:
#  - EXACT_GARBAGE: drop iff canonical_key is exactly this (single-word ones
#    are too dangerous to substring-match; "محسوم" alone is garbage but a
#    legit checkpoint name might end with the substring innocently)
#  - SUBSTRING_GARBAGE: drop if canonical_key contains this token as a
#    standalone segment (between underscores)
_EXACT_GARBAGE = {
    "محسوم",                        # generic "barrier"
    "كثافه_سير", "كثافة_سير",       # traffic congestion
    "سالكات", "سالكه", "سالك",      # open/clear (status words alone)
    "مغلقات", "مغلقه", "مغلق",      # closed (status words alone)
    "للنمر_الصفراء_فقط",           # yellow plates only
    "للنمر_الصفراء",
    "انسحبو", "انسحب",              # "withdrew" — verb leaked as name
    "تماما",                        # "completely" — adverb
}

# Substrings that, when appearing in the canonical_key (between word
# boundaries), strongly indicate the parser captured status text.
# These match concatenated-phrase garbage like "حزما_المعبر_كثافه_سير"
# (Hizma crossing — traffic congestion) or "سالكات_تماما".
_GARBAGE_TOKENS = (
    "كثافه_سير", "كثافة_سير",
    "_سالكات", "سالكات_",
    "_مغلقات", "مغلقات_",
    "_سالككك",                     # typo pattern (سالك + extra ك repetitions)
    "_تماما",
    "للنمر_الصفراء",
)


def _accept_checkpoint_name(upd: dict) -> bool:
    """Return True if the parsed update should be persisted as a checkpoint.

    Order of checks:
      1. Whitelist (curated KB) wins — always accept.
      2. Exact-garbage match → reject.
      3. Substring-garbage token in canonical_key → reject.
      4. Length sanity (1-char or 80+ char) → reject.
      5. Otherwise accept.
    """
    key = upd.get("canonical_key", "") or ""
    name = upd.get("name_raw", "") or ""

    # 1. Whitelist short-circuit
    try:
        from .checkpoint_knowledge_base import get_knowledge_base
        kb = get_knowledge_base()
        if kb is not None and kb.is_known(key):
            return True
    except Exception:
        pass

    # 2. Exact garbage
    if key in _EXACT_GARBAGE or name.strip() in _EXACT_GARBAGE:
        return False

    # 3. Substring garbage
    for token in _GARBAGE_TOKENS:
        if token in key:
            return False

    # 4. Sanity bounds — checkpoint names are usually 2-40 chars
    if len(key) < 2 or len(key) > 80:
        return False

    return True


async def insert_checkpoint_update(upd: dict) -> int:
    """Insert a parsed update with smart accept/reject:

      1. If canonical_key is in the curated whitelist → ACCEPT (always)
      2. If name matches status-word / garbage patterns → REJECT
         ("كثافة سير", "للنمر الصفراء فقط", "سالكات", "مغلقات",
         "محسوم" alone, typo patterns like "سالككك", concatenated
         phrases ending in status words)
      3. Otherwise → ACCEPT (provisional — real places not yet in the
         whitelist will accumulate and can be promoted later)

    The garbage that prompted this gate (2026-04-29 user report):
       'كثافة سير'         = 'traffic congestion'   (pure status)
       'للنمر الصفراء فقط' = 'yellow plates only'   (restriction)
       'محسوم'              = 'barrier'              (generic noun)
       'سالكات تماما'      = 'all completely open'   (concatenated status)
    """
    if not _accept_checkpoint_name(upd):
        log.debug(
            f"[CP/REJECT-GARBAGE] {upd['canonical_key']!r} "
            f"({upd.get('name_raw','')[:40]!r})"
        )
        return 0

    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        await db.execute(
            "INSERT OR IGNORE INTO checkpoints(canonical_key, name_ar, created_at) VALUES(?,?,?)",
            (upd["canonical_key"], upd["name_raw"], now),
        )
        # Geo-enrich rows that still lack coordinates (new or legacy). All
        # lookups are in-memory KB scans — cheap enough to run inline.
        cur = await db.execute(
            "SELECT latitude FROM checkpoints WHERE canonical_key=?",
            (upd["canonical_key"],),
        )
        row = await cur.fetchone()
        if row and row[0] is None:
            try:
                from . import geo_resolver
                r = geo_resolver.resolve_place(upd.get("name_raw") or upd["canonical_key"])
                if r:
                    cls = geo_resolver.classify_point(r["latitude"], r["longitude"])
                    await db.execute(
                        "UPDATE checkpoints SET latitude=?, longitude=?, "
                        "region=COALESCE(region, ?), name_en=COALESCE(name_en, ?), "
                        "geo_precision=?, governorate=?, oslo_area=? WHERE canonical_key=?",
                        (r["latitude"], r["longitude"], r.get("region"), r.get("name_en"),
                         r["precision"], cls["governorate"], cls["oslo_area"],
                         upd["canonical_key"]),
                    )
            except Exception as e:
                log.debug(f"geo-enrich failed for {upd['canonical_key']!r}: {e}")
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


# ── Phase 2a: status consensus ────────────────────────────────────────────────

_CONSENSUS_HALF_LIFE_MIN = 30.0
_CONSENSUS_WINDOW_HOURS = 6.0          # reports older than this are ignored (decay ~0)
_CONSENSUS_SRC_WEIGHT = {"admin": 5.0, "crowd": 1.0}


def _consensus_status(reports, *, half_life_min: float = _CONSENSUS_HALF_LIFE_MIN):
    """Recency-decayed, source-weighted vote over recent reports.

    reports: iterable of (status, source_type, age_minutes).
    Returns (winning_status, confidence_label, agreement_ratio).

    Each report's weight = source_weight (admin >> crowd) * 0.5**(age/half_life),
    so a lone spam report can't outvote several recent agreeing reports, while a
    sparse checkpoint's freshest report still wins (it's the only live signal).
    Confidence is the winner's share of total weight (agreement) — not a raw count.
    """
    weights: dict = {}
    admin_backed: set = set()
    for status, src, age_min in reports:
        if not status:
            continue
        decay = 0.5 ** (max(0.0, age_min) / half_life_min)
        weights[status] = weights.get(status, 0.0) + _CONSENSUS_SRC_WEIGHT.get(src, 1.0) * decay
        if src == "admin":
            admin_backed.add(status)
    if not weights:
        return None, "low", 0.0
    total = sum(weights.values())
    win = max(weights, key=weights.get)
    ratio = round(weights[win] / total, 3) if total else 0.0
    # "high" requires both strong agreement AND an authoritative (admin) report
    # backing the winner — crowd-only consensus caps at "medium" (it can be
    # flooded by one channel; high confidence is reserved for official sources).
    if ratio >= 0.75 and win in admin_backed:
        conf = "high"
    elif ratio >= 0.5:
        conf = "medium"
    else:
        conf = "low"
    return win, conf, ratio


async def upsert_checkpoint_status(upd: dict, is_admin: bool, channel: str) -> str:
    now = datetime.utcnow()
    direction = upd.get("direction", "") or ""

    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT status FROM checkpoint_status WHERE canonical_key=? AND direction=?",
            (upd["canonical_key"], direction),
        )
        existing = await cur.fetchone()

        # Phase 2a: the displayed status is a recency-decayed, source-weighted
        # CONSENSUS over recent reports (the new report is already in
        # checkpoint_updates), not last-write-wins — a lone spam/contradictory
        # report can no longer flip the map. Confidence reflects agreement.
        h1 = now - timedelta(hours=1)
        window_start = (now - timedelta(hours=_CONSENSUS_WINDOW_HOURS)).isoformat()
        cur = await db.execute(
            "SELECT status, source_type, timestamp FROM checkpoint_updates "
            "WHERE canonical_key=? AND COALESCE(direction,'')=? AND timestamp>=?",
            (upd["canonical_key"], direction, window_start),
        )
        reports = []
        crowd_1h = 0
        for status, src, ts in await cur.fetchall():
            try:
                t = datetime.fromisoformat(ts) if ts else now
            except (ValueError, TypeError):
                t = now
            reports.append((status, src, max(0.0, (now - t).total_seconds() / 60.0)))
            if src == "crowd" and t >= h1:
                crowd_1h += 1

        consensus, confidence, _ratio = _consensus_status(reports)
        if consensus is None:  # no reports in window (shouldn't happen post-insert)
            consensus = upd["status"]
            confidence = "high" if is_admin else "low"
        # status_raw is only meaningful when the displayed status matches THIS report.
        status_raw = upd.get("status_raw") if consensus == upd["status"] else None
        changed = existing is None or existing[0] != consensus

        await db.execute(
            """INSERT INTO checkpoint_status
               (canonical_key, direction, name_ar, status, status_raw, confidence,
                crowd_reports_1h, last_updated, last_source_type, last_msg_id,
                last_source_channel)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(canonical_key, direction) DO UPDATE SET
                 status=excluded.status,
                 status_raw=excluded.status_raw,
                 confidence=excluded.confidence,
                 crowd_reports_1h=excluded.crowd_reports_1h,
                 last_updated=excluded.last_updated,
                 last_source_type=excluded.last_source_type,
                 last_msg_id=excluded.last_msg_id,
                 last_source_channel=excluded.last_source_channel""",
            (
                upd["canonical_key"], direction, upd["name_raw"],
                consensus, status_raw,
                confidence, crowd_1h, now.isoformat(), "admin" if is_admin else "crowd",
                upd.get("source_msg_id"), channel,
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
           s.crowd_reports_1h, s.last_updated, s.last_source_type,
           c.governorate, c.oslo_area, c.geo_precision,
           c.source_layer, c.obstacle_type, c.permanent_status, s.last_msg_id,
           s.last_source_channel
    FROM checkpoints c
    LEFT JOIN (
        SELECT canonical_key, status, status_raw, direction, confidence,
               crowd_reports_1h, last_updated, last_source_type, last_msg_id,
               last_source_channel
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
    known_only: bool = True,
) -> list:
    """
    Get checkpoints with optional filters.

    - status_filter: only checkpoints with this status
    - region: filter by region name
    - active_only: only checkpoints that have received at least one status update
    - since: only checkpoints updated after this time
    - known_only: only checkpoints in the curated whitelist (F3 serve-guard —
      hides un-curated/junk rows from the public map+list without deleting them)
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
    cps = [_row_to_checkpoint(r) for r in rows]
    if known_only:
        from .checkpoint_knowledge_base import get_knowledge_base, filter_to_known
        cps = filter_to_known(cps, get_knowledge_base())
    return cps


async def get_checkpoint(canonical_key: str) -> Optional[dict]:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            f"{_CHECKPOINT_SELECT} WHERE c.canonical_key = ?",
            (canonical_key,),
        )
        row = await cur.fetchone()
    return _row_to_checkpoint(row) if row else None


async def get_checkpoint_history(
    canonical_key: str,
    limit: int = 50,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
) -> list:
    conditions = ["canonical_key = ?"]
    params: list = [canonical_key]
    if from_dt:
        conditions.append("timestamp >= ?")
        params.append(from_dt.isoformat())
    if to_dt:
        conditions.append("timestamp <= ?")
        params.append(to_dt.isoformat())
    where = " AND ".join(conditions)

    async with get_checkpoint_db() as db:
        cur = await db.execute(
            f"SELECT id, canonical_key, name_raw, status, status_raw, "
            f"source_type, source_channel, source_msg_id, raw_line, raw_message, "
            f"timestamp, created_at, direction "
            f"FROM checkpoint_updates "
            f"WHERE {where} "
            f"ORDER BY timestamp DESC LIMIT ?",
            params + [limit],
        )
        rows = await cur.fetchall()
    return [_row_to_update(r) for r in rows]


async def get_uptime_window(
    from_dt: datetime,
    to_dt: datetime,
    canonical_key: Optional[str] = None,
) -> list:
    """Compute % open / closed / restricted per checkpoint over a time window.

    Walks status transitions in chronological order, attributing the duration
    of each (status, checkpoint) span to the totals. Spans are clamped to the
    requested window so partial overlaps account correctly. The final span runs
    to `to_dt` (or now, whichever is earlier)."""
    conditions = ["timestamp <= ?"]
    params: list = [to_dt.isoformat()]
    if canonical_key:
        conditions.append("canonical_key = ?")
        params.append(canonical_key)
    where = " AND ".join(conditions)

    async with get_checkpoint_db() as db:
        cur = await db.execute(
            f"SELECT canonical_key, status, timestamp "
            f"FROM checkpoint_updates "
            f"WHERE {where} AND status IS NOT NULL "
            f"ORDER BY canonical_key ASC, timestamp ASC",
            params,
        )
        rows = await cur.fetchall()

    window_end = min(to_dt, datetime.utcnow())
    if window_end <= from_dt:
        return []

    by_key: dict[str, list] = {}
    for key, status, ts in rows:
        try:
            t = datetime.fromisoformat(ts)
        except ValueError:
            continue
        by_key.setdefault(key, []).append((t, status))

    results = []
    window_seconds = (window_end - from_dt).total_seconds()
    for key, events in by_key.items():
        # Find baseline status entering the window: last event before from_dt.
        baseline = None
        in_window = []
        for t, status in events:
            if t < from_dt:
                baseline = status
            else:
                in_window.append((t, status))

        spans: list[tuple[datetime, datetime, str]] = []
        cursor_t = from_dt
        cursor_status = baseline
        for t, status in in_window:
            t_clamped = min(t, window_end)
            if cursor_status is not None and t_clamped > cursor_t:
                spans.append((cursor_t, t_clamped, cursor_status))
            cursor_t = t_clamped
            cursor_status = status
        if cursor_status is not None and window_end > cursor_t:
            spans.append((cursor_t, window_end, cursor_status))

        totals: dict[str, float] = {}
        for start, end, status in spans:
            totals[status] = totals.get(status, 0.0) + (end - start).total_seconds()

        observed = sum(totals.values())
        pct = {
            s: round((sec / window_seconds) * 100, 2)
            for s, sec in totals.items()
        }
        results.append({
            "canonical_key": key,
            "seconds_by_status": {s: round(sec, 1) for s, sec in totals.items()},
            "pct_by_status": pct,
            "observed_seconds": round(observed, 1),
            "window_seconds": round(window_seconds, 1),
            "transitions": len(in_window),
        })

    results.sort(key=lambda r: r.get("pct_by_status", {}).get("closed", 0), reverse=True)
    return results


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


async def get_sources_summary(hours: int = 24) -> list[dict]:
    """Per-source-channel checkpoint update activity over the last N hours.
    Returns one row per (source_channel, source_type) with update counts +
    distinct checkpoints touched. Powers the tracker dashboard's source
    panel which previously only saw the alerts pipeline (not checkpoints,
    which are the primary source of route-safety data)."""
    since = (datetime.utcnow() - timedelta(hours=hours)).isoformat()
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            """SELECT source_channel, source_type,
                      COUNT(*) AS updates,
                      COUNT(DISTINCT canonical_key) AS distinct_checkpoints,
                      MAX(timestamp) AS last_at
               FROM checkpoint_updates
               WHERE timestamp >= ?
               GROUP BY source_channel, source_type
               ORDER BY updates DESC""",
            (since,),
        )
        rows = await cur.fetchall()
    return [
        {
            "source_channel": r[0],
            "source_type": r[1],            # "admin" | "crowd"
            "updates": r[2],
            "distinct_checkpoints": r[3],
            "last_at": r[4],
        }
        for r in rows
    ]


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
            # Phase-0 catalog fields (curation source of truth → DB columns).
            source_layer = entry.get("source_layer")
            obstacle_type = entry.get("obstacle_type")
            permanent_status = entry.get("permanent_status")
            external_ref = entry.get("external_ref")

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
                # Curated facts are authoritative — set explicitly when provided.
                if source_layer is not None:
                    updates.append("source_layer = ?")
                    params.append(source_layer)
                if obstacle_type is not None:
                    updates.append("obstacle_type = ?")
                    params.append(obstacle_type)
                if permanent_status is not None:
                    updates.append("permanent_status = ?")
                    params.append(permanent_status)
                if external_ref is not None:
                    updates.append("external_ref = COALESCE(external_ref, ?)")
                    params.append(external_ref)
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
                    "checkpoint_type, latitude, longitude, created_at, "
                    "source_layer, obstacle_type, permanent_status, external_ref) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (key, name_ar, name_en, region, cp_type, latitude, longitude, now,
                     source_layer or "telegram", obstacle_type, permanent_status, external_ref),
                )
                inserted += 1

        await db.commit()

    log.info(f"Bulk seed: {inserted} inserted, {updated} updated")
    return {"inserted": inserted, "updated": updated, "total": len(entries)}


# ── Checkpoint candidates (Phase C — review/promote pipeline) ────────────────────
_CANDIDATE_COLS = (
    "id, raw_name, normalized, suggested_canonical_key, suggested_name_ar, "
    "suggested_lat, suggested_lon, governorate, mentions, first_seen, last_seen, "
    "llm_verdict, llm_confidence, status, reviewed_at, reviewed_by"
)


def _row_to_candidate(r) -> dict:
    return {
        "id": r[0], "raw_name": r[1], "normalized": r[2],
        "suggested_canonical_key": r[3], "suggested_name_ar": r[4],
        "suggested_lat": r[5], "suggested_lon": r[6], "governorate": r[7],
        "mentions": r[8], "first_seen": r[9], "last_seen": r[10],
        "llm_verdict": r[11], "llm_confidence": r[12], "status": r[13],
        "reviewed_at": r[14], "reviewed_by": r[15],
    }


async def upsert_candidate(raw_name: str, normalized: str, mentions: int = 1,
                           suggested_name_ar: Optional[str] = None,
                           suggested_lat: Optional[float] = None,
                           suggested_lon: Optional[float] = None,
                           governorate: Optional[str] = None,
                           absolute: bool = False) -> int:
    """Insert a new candidate or update an existing one (by normalized).

    absolute=False → accumulate mentions (live parser-miss counting).
    absolute=True  → set mentions to the given value (directory seeding, where the
                     count is already cumulative and re-running must be idempotent)."""
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT id FROM checkpoint_candidates WHERE normalized=?", (normalized,))
        row = await cur.fetchone()
        if row:
            if absolute:
                await db.execute(
                    "UPDATE checkpoint_candidates SET mentions = ?, last_seen = ? "
                    "WHERE id = ?", (mentions, now, row[0]))
            else:
                await db.execute(
                    "UPDATE checkpoint_candidates SET mentions = mentions + ?, last_seen = ? "
                    "WHERE id = ?", (mentions, now, row[0]))
            cid = row[0]
        else:
            cur = await db.execute(
                "INSERT INTO checkpoint_candidates (raw_name, normalized, suggested_name_ar, "
                "suggested_lat, suggested_lon, governorate, mentions, first_seen, last_seen, "
                "status) VALUES (?,?,?,?,?,?,?,?,?, 'pending')",
                (raw_name, normalized, suggested_name_ar, suggested_lat, suggested_lon,
                 governorate, mentions, now, now))
            cid = cur.lastrowid
        await db.commit()
    return cid


async def get_candidates(status: Optional[str] = None, limit: int = 200) -> list:
    q = f"SELECT {_CANDIDATE_COLS} FROM checkpoint_candidates"
    params = []
    if status:
        q += " WHERE status = ?"
        params.append(status)
    q += " ORDER BY mentions DESC LIMIT ?"
    params.append(limit)
    async with get_checkpoint_db() as db:
        cur = await db.execute(q, params)
        rows = await cur.fetchall()
    return [_row_to_candidate(r) for r in rows]


async def get_candidate(candidate_id: int) -> Optional[dict]:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            f"SELECT {_CANDIDATE_COLS} FROM checkpoint_candidates WHERE id = ?",
            (candidate_id,))
        row = await cur.fetchone()
    return _row_to_candidate(row) if row else None


async def set_candidate_llm(candidate_id: int, verdict: str, confidence: float,
                            suggested_name_ar: Optional[str] = None,
                            governorate: Optional[str] = None,
                            lat: Optional[float] = None,
                            lon: Optional[float] = None) -> None:
    async with get_checkpoint_db() as db:
        await db.execute(
            "UPDATE checkpoint_candidates SET llm_verdict=?, llm_confidence=?, "
            "suggested_name_ar=COALESCE(?, suggested_name_ar), "
            "governorate=COALESCE(?, governorate), "
            "suggested_lat=COALESCE(?, suggested_lat), "
            "suggested_lon=COALESCE(?, suggested_lon) WHERE id=?",
            (verdict, confidence, suggested_name_ar, governorate, lat, lon, candidate_id))
        await db.commit()


async def set_candidate_review(candidate_id: int, status: str,
                               reviewed_by: Optional[str] = None) -> None:
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        await db.execute(
            "UPDATE checkpoint_candidates SET status=?, reviewed_at=?, reviewed_by=? WHERE id=?",
            (status, now, reviewed_by, candidate_id))
        await db.commit()


async def candidate_counts() -> dict:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT status, COUNT(*) FROM checkpoint_candidates GROUP BY status")
        rows = await cur.fetchall()
    return {r[0]: r[1] for r in rows}


# ── User crowdsource reports (Phase E / E3) ──────────────────────────────────────
async def insert_user_report(canonical_key: Optional[str], status: str,
                             direction: Optional[str], lat: Optional[float],
                             lon: Optional[float], reporter_hash: str) -> int:
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "INSERT INTO user_reports (canonical_key, status, direction, latitude, "
            "longitude, reporter_hash, created_at) VALUES (?,?,?,?,?,?,?)",
            (canonical_key, status, direction, lat, lon, reporter_hash, now))
        rid = cur.lastrowid
        await db.commit()
    return rid


async def count_recent_user_reports(reporter_hash: str, since_iso: str) -> int:
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM user_reports WHERE reporter_hash=? AND created_at>=?",
            (reporter_hash, since_iso))
        (n,) = await cur.fetchone()
    return n


async def find_nearest_checkpoint(lat: float, lon: float, max_km: float = 0.5) -> Optional[dict]:
    """Nearest curated checkpoint within max_km, for matching a coord-only report."""
    cps = await get_all_checkpoints()
    best, best_d = None, max_km
    for c in cps:
        clat, clon = c.get("latitude"), c.get("longitude")
        if clat is None or clon is None:
            continue
        d = _haversine_km(lat, lon, clat, clon)
        if d <= best_d:
            best, best_d = c, d
    return best


async def canonicalize_and_clean(dry_run: bool = True) -> dict:
    """
    Structural cleanup of the checkpoints table (2026-06 corpus rework):

    1. MERGE: keys that aren't KB-canonical but resolve to a KB checkpoint
       (e.g. parse-era variants "مدخل_سلفيت_الشمالي" → KB "سلفيت الشمالي").
       Their updates/status history moves to the canonical key.
    2. DELETE: keys that resolve to nothing — not in the KB, not a known
       town (geo_resolver) — i.e. parser junk like "سيارة"/"وخارج".
       Guard: keys with ≥10 updates in the last 30 days are KEPT and
       reported instead (recurring signal worth promoting, not junk).
    """
    from .checkpoint_knowledge_base import get_knowledge_base
    from . import geo_resolver

    kb = get_knowledge_base()
    if not kb or kb.size() == 0:
        return {"error": "knowledge base not loaded"}

    merges: list[tuple[str, str]] = []   # (old_key, canonical_key)
    deletes: list[str] = []
    kept_for_review: list[tuple[str, int]] = []
    d30 = (datetime.utcnow() - timedelta(days=30)).isoformat()

    async with get_checkpoint_db() as db:
        cur = await db.execute("SELECT canonical_key, name_ar FROM checkpoints")
        rows = await cur.fetchall()

        for key, name in rows:
            if kb.is_known(key):
                continue
            text = (name or key).replace("_", " ")
            canonical = kb.find_checkpoint(text)
            if canonical and canonical != key:
                merges.append((key, canonical))
                continue
            if canonical == key:
                continue
            # not KB-resolvable — is it at least a real place?
            if geo_resolver.resolve_place(text):
                continue  # legit unknown locality — keep as provisional
            cur2 = await db.execute(
                "SELECT COUNT(*) FROM checkpoint_updates WHERE canonical_key=? AND timestamp>=?",
                (key, d30),
            )
            (recent,) = await cur2.fetchone()
            if recent >= 10:
                kept_for_review.append((key, recent))
            else:
                deletes.append(key)

        if not dry_run:
            for old, canon in merges:
                await db.execute(
                    "UPDATE checkpoint_updates SET canonical_key=? WHERE canonical_key=?",
                    (canon, old),
                )
                # keep the newest status row per (key, direction)
                await db.execute(
                    """DELETE FROM checkpoint_status WHERE canonical_key=? AND EXISTS (
                         SELECT 1 FROM checkpoint_status s2
                         WHERE s2.canonical_key=? AND s2.direction=checkpoint_status.direction
                           AND s2.last_updated >= checkpoint_status.last_updated)""",
                    (old, canon),
                )
                await db.execute(
                    "UPDATE OR IGNORE checkpoint_status SET canonical_key=? WHERE canonical_key=?",
                    (canon, old),
                )
                await db.execute("DELETE FROM checkpoint_status WHERE canonical_key=?", (old,))
                await db.execute("DELETE FROM checkpoints WHERE canonical_key=?", (old,))
            for key in deletes:
                await db.execute("DELETE FROM checkpoint_updates WHERE canonical_key=?", (key,))
                await db.execute("DELETE FROM checkpoint_status WHERE canonical_key=?", (key,))
                await db.execute("DELETE FROM checkpoints WHERE canonical_key=?", (key,))
            await db.commit()

    log.info(
        f"canonicalize_and_clean dry_run={dry_run}: "
        f"{len(merges)} merges, {len(deletes)} deletes, {len(kept_for_review)} kept-for-review"
    )
    return {
        "dry_run": dry_run,
        "total": len(rows),
        "merges": len(merges),
        "merge_samples": merges[:25],
        "deletes": len(deletes),
        "delete_samples": deletes[:40],
        "kept_for_review": kept_for_review[:20],
    }


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
        async with db.execute(
            "SELECT canonical_key, status, confidence, last_updated FROM checkpoint_status"
        ) as cur:
            status_rows = await cur.fetchall()

        async with db.execute(
            "SELECT canonical_key, latitude, COALESCE(checkpoint_type, 'checkpoint') FROM checkpoints"
        ) as cur:
            cp_rows = await cur.fetchall()

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

    # F2/F3: curated (whitelist) checkpoints only, collapsed to distinct (freshest
    # direction wins) so total_checkpoints reflects real checkpoints, not per-direction rows.
    from .checkpoint_knowledge_base import get_knowledge_base
    kb = get_knowledge_base()
    if kb is not None:
        cp_rows = [r for r in cp_rows if kb.is_known(r[0])]

    # confidence per distinct checkpoint comes from the freshest direction row
    best_conf: dict = {}
    for key, _status, conf, lu in status_rows:
        if kb is not None and not kb.is_known(key):
            continue
        if key not in best_conf or (lu or "") > (best_conf[key][1] or ""):
            best_conf[key] = (conf, lu)
    distinct = _collapse_status_by_checkpoint(
        [(r[0], r[1], r[3]) for r in status_rows], kb)

    by_status: dict = {}
    by_conf: dict = {}
    for _key, (status, _lu) in distinct.items():
        by_status[status] = by_status.get(status, 0) + 1
    for _key, (conf, _lu) in best_conf.items():
        by_conf[conf] = by_conf.get(conf, 0) + 1

    by_type: dict = {}
    total_geo = 0
    for _key, lat, ctype in cp_rows:
        by_type[ctype] = by_type.get(ctype, 0) + 1
        if lat is not None:
            total_geo += 1

    return dict(
        total_checkpoints=len(distinct),
        total_directory=len(cp_rows),
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

def _collapse_status_by_checkpoint(rows, kb):
    """F2 — checkpoint_status has one row per (checkpoint, direction). Collapse to
    one entry per DISTINCT checkpoint (freshest direction wins) so counts reflect
    real checkpoints, not inflated per-direction rows. rows: (key, status, last_updated).
    Returns {canonical_key: (status, last_updated)}."""
    best: dict = {}
    for key, status, lu in rows:
        if kb is not None and not kb.is_known(key):
            continue
        if key not in best or (lu or "") > (best[key][1] or ""):
            best[key] = (status, lu)
    return best


async def get_checkpoint_summary() -> dict:
    """
    Lightweight snapshot for dashboard headers and status bars.
    Counts DISTINCT checkpoints (not per-direction status rows) and separates
    freshly-reported from stale, so the headline is neither inflated nor
    stale-inclusive. Designed to be polled every 30 seconds by frontends.
    """
    now = datetime.utcnow()
    h1  = (now - timedelta(hours=1)).isoformat()
    h6  = (now - timedelta(hours=6)).isoformat()

    async with get_checkpoint_db() as db:
        async with db.execute(
            "SELECT canonical_key, status, last_updated FROM checkpoint_status"
        ) as cur:
            rows = await cur.fetchall()
        async with db.execute("SELECT canonical_key FROM checkpoints") as cur:
            cp_keys = [r[0] for r in await cur.fetchall()]

    # F2/F3: count only curated (whitelist) checkpoints, collapsed to distinct.
    from .checkpoint_knowledge_base import get_knowledge_base
    kb = get_knowledge_base()
    distinct = _collapse_status_by_checkpoint(rows, kb)
    total_directory = len([k for k in cp_keys if kb is None or kb.is_known(k)])

    by_status: dict = {}
    by_status_fresh_6h: dict = {}
    fresh_1h = fresh_6h = stale = 0
    last_update = None
    for _key, (status, lu) in distinct.items():
        by_status[status] = by_status.get(status, 0) + 1
        if lu and lu >= h1:
            fresh_1h += 1
        if lu and lu >= h6:
            fresh_6h += 1
            by_status_fresh_6h[status] = by_status_fresh_6h.get(status, 0) + 1
        else:
            stale += 1
        if lu and (last_update is None or lu > last_update):
            last_update = lu

    # Feed-level liveness (did we receive ANY update in 6h). Per-checkpoint
    # staleness is the `stale` count above — don't conflate the two.
    is_stale = True
    if last_update:
        try:
            is_stale = (now - datetime.fromisoformat(last_update)).total_seconds() > 6 * 3600
        except (ValueError, TypeError):
            pass

    return {
        "by_status":          by_status,           # distinct checkpoints by current status
        "by_status_fresh_6h": by_status_fresh_6h,  # only checkpoints reported in the last 6h
        "fresh_last_1h":      fresh_1h,
        "fresh_last_6h":      fresh_6h,
        "stale":              stale,               # reported >6h ago (served status may be outdated)
        "total_active":       len(distinct),       # distinct checkpoints with any report
        "total_directory":    total_directory,     # catalog size (the denominator)
        "last_update":        last_update,
        "is_data_stale":      is_stale,             # feed liveness, NOT per-checkpoint freshness
        "snapshot_at":        now.isoformat(),
    }


async def get_last_update_time() -> Optional[str]:
    """Return ISO timestamp of the most recent checkpoint status update."""
    async with get_checkpoint_db() as db:
        row = await (await db.execute(
            "SELECT MAX(last_updated) FROM checkpoint_status"
        )).fetchone()
    return row[0] if row else None


# ── Learned vocabulary ───────────────────────────────────────────────────────

async def get_learned_vocab() -> dict[str, str]:
    """Return all auto-promoted vocab as {word: status} for runtime use."""
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            "SELECT word, status FROM learned_vocab WHERE auto_promoted=1"
        )
        rows = await cur.fetchall()
    return {r[0]: r[1] for r in rows}


async def promote_vocab(word: str, status: str, confidence: float, source_count: int):
    """Auto-promote a discovered vocab word to the learned vocabulary."""
    now = datetime.utcnow().isoformat()
    async with get_checkpoint_db() as db:
        await db.execute(
            """INSERT INTO learned_vocab (word, status, confidence, source_count, auto_promoted, created_at, last_seen)
               VALUES (?, ?, ?, ?, 1, ?, ?)
               ON CONFLICT(word) DO UPDATE SET
                 status=excluded.status,
                 confidence=excluded.confidence,
                 source_count=excluded.source_count,
                 last_seen=excluded.last_seen""",
            (word, status, confidence, source_count, now, now),
        )
        await db.commit()
    log.info(f"Vocab promoted: '{word}' → {status} (conf={confidence:.2f}, n={source_count})")
