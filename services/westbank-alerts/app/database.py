import aiosqlite
import re
from datetime import datetime, timedelta
from typing import List, Optional
from .models import Alert, WebhookTarget
from .config import settings
from .db_pool import get_alerts_db

DB = settings.DB_PATH

# ── Content deduplication ────────────────────────────────────────────────────

_STRIP_EMOJI = re.compile(
    r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
    r"\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U0000FE00-\U0000FE0F"
    r"\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF"
    r"\U00002600-\U000026FF\u200d\u2640-\u2642\u2764\u2714\u2716\u2728]+",
    re.UNICODE,
)
_COLLAPSE_WS = re.compile(r"\s+")


def _content_fingerprint(text: str) -> str:
    """Normalize text for similarity comparison: strip emoji, URLs, whitespace."""
    t = _STRIP_EMOJI.sub("", text)
    t = re.sub(r"https?://\S+", "", t)       # strip URLs
    t = re.sub(r"[✅🚨⚠️💥🚀🔴🟢🟡🤍🚫]", "", t)  # common decorators
    t = _COLLAPSE_WS.sub(" ", t).strip()
    return t


def _text_similarity(a: str, b: str) -> float:
    """Simple Jaccard similarity on word sets."""
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)

CREATE_ALERTS = """
CREATE TABLE IF NOT EXISTS alerts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    type          TEXT NOT NULL,
    severity      TEXT NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    source        TEXT NOT NULL,
    source_msg_id INTEGER,
    area          TEXT,
    raw_text      TEXT NOT NULL,
    timestamp     TEXT NOT NULL,
    created_at    TEXT NOT NULL
)
"""

CREATE_WEBHOOKS = """
CREATE TABLE IF NOT EXISTS webhooks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    url          TEXT NOT NULL UNIQUE,
    secret       TEXT,
    active       INTEGER DEFAULT 1,
    alert_types  TEXT,
    min_severity TEXT,
    created_at   TEXT NOT NULL
)
"""

CREATE_CHANNELS = """
CREATE TABLE IF NOT EXISTS channels (
    username  TEXT PRIMARY KEY,
    added_at  TEXT NOT NULL,
    active    INTEGER DEFAULT 1
)
"""

CREATE_SECURITY_VOCAB = """
CREATE TABLE IF NOT EXISTS security_vocab_candidates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    term        TEXT NOT NULL,
    category    TEXT NOT NULL,
    occurrences INTEGER DEFAULT 1,
    sample_msg  TEXT,
    first_seen  TEXT NOT NULL,
    promoted    INTEGER DEFAULT 0,
    UNIQUE(term, category)
)
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_type      ON alerts(type)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_severity  ON alerts(severity)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_area      ON alerts(area)",
]


async def init_db():
    async with get_alerts_db() as db:
        await db.execute(CREATE_ALERTS)
        await db.execute(CREATE_WEBHOOKS)
        await db.execute(CREATE_CHANNELS)
        await db.execute(CREATE_SECURITY_VOCAB)
        for idx in CREATE_INDEXES:
            await db.execute(idx)
        # Migration: add event_subtype column to existing DBs
        cursor = await db.execute("PRAGMA table_info(alerts)")
        alert_cols = {row[1] for row in await cursor.fetchall()}
        if "event_subtype" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN event_subtype TEXT")
        if "zone" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN zone TEXT")
        if "latitude" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN latitude REAL")
        if "longitude" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN longitude REAL")
        if "title_ar" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN title_ar TEXT")

        # Seed channels from env on first run
        cur = await db.execute("SELECT COUNT(*) FROM channels")
        (count,) = await cur.fetchone()
        if count == 0:
            now = datetime.utcnow().isoformat()
            for ch in settings.channel_list:
                await db.execute(
                    "INSERT OR IGNORE INTO channels(username, added_at) VALUES(?,?)",
                    (ch, now)
                )
        await db.commit()


def _row_to_alert(row) -> Alert:
    return Alert(
        id=row[0], type=row[1], severity=row[2], title=row[3],
        body=row[4], source=row[5], source_msg_id=row[6], area=row[7],
        raw_text=row[8],
        timestamp=datetime.fromisoformat(row[9]),
        created_at=datetime.fromisoformat(row[10]),
        event_subtype=row[11] if len(row) > 11 else None,
        zone=row[12] if len(row) > 12 else None,
        latitude=row[13] if len(row) > 13 else None,
        longitude=row[14] if len(row) > 14 else None,
        title_ar=row[15] if len(row) > 15 else None,
    )


async def insert_alert(alert: Alert) -> Alert:
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            """INSERT INTO alerts
               (type, severity, title, body, source, source_msg_id, area, zone,
                raw_text, timestamp, created_at, event_subtype, latitude, longitude,
                title_ar)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (alert.type, alert.severity, alert.title, alert.body,
             alert.source, alert.source_msg_id, alert.area,
             getattr(alert, "zone", None),
             alert.raw_text, alert.timestamp.isoformat(), now,
             getattr(alert, "event_subtype", None),
             getattr(alert, "latitude", None),
             getattr(alert, "longitude", None),
             getattr(alert, "title_ar", None))
        )
        await db.commit()
        alert.id = cur.lastrowid
        alert.created_at = datetime.fromisoformat(now)
    return alert


_last_prune_count = 0

async def prune_alerts_if_needed():
    """Prune old alerts periodically — called from monitor heartbeat, not every insert."""
    global _last_prune_count
    _last_prune_count += 1
    if _last_prune_count < 100:  # prune every ~100 calls (~8 minutes at 5s poll)
        return
    _last_prune_count = 0
    async with get_alerts_db() as db:
        await db.execute(
            f"""DELETE FROM alerts WHERE id NOT IN (
                SELECT id FROM alerts ORDER BY timestamp DESC LIMIT {settings.MAX_ALERTS_STORED}
            )"""
        )
        await db.commit()


async def get_alerts(
    type: Optional[str] = None,
    severity: Optional[str] = None,
    area: Optional[str] = None,
    since: Optional[datetime] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple:
    conditions, params = [], []
    if type:     conditions.append("type = ?");      params.append(type)
    if severity: conditions.append("severity = ?");  params.append(severity)
    if area:     conditions.append("area LIKE ?");   params.append(f"%{area}%")
    if since:    conditions.append("timestamp >= ?"); params.append(since.isoformat())

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    async with get_alerts_db() as db:
        cur = await db.execute(f"SELECT COUNT(*) FROM alerts {where}", params)
        (total,) = await cur.fetchone()
        cur = await db.execute(
            f"SELECT * FROM alerts {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        )
        rows = await cur.fetchall()
    return [_row_to_alert(r) for r in rows], total


async def get_alert(alert_id: int) -> Optional[Alert]:
    async with get_alerts_db() as db:
        cur = await db.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,))
        row = await cur.fetchone()
    return _row_to_alert(row) if row else None


async def duplicate_check(source: str, source_msg_id: int) -> bool:
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT 1 FROM alerts WHERE source=? AND source_msg_id=? LIMIT 1",
            (source, source_msg_id)
        )
        return await cur.fetchone() is not None


async def content_duplicate_check(raw_text: str, window_minutes: int = 30) -> bool:
    """Check if a similar alert was already inserted within the time window.

    Uses word-level Jaccard similarity (>0.6) on normalized text to catch
    repeated messages with slight emoji/word variations.
    """
    fingerprint = _content_fingerprint(raw_text)
    if len(fingerprint) < 15:
        return False  # too short to compare meaningfully

    since = (datetime.utcnow() - timedelta(minutes=window_minutes)).isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT raw_text FROM alerts WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 50",
            (since,)
        )
        rows = await cur.fetchall()

    for (existing_raw,) in rows:
        existing_fp = _content_fingerprint(existing_raw)
        if _text_similarity(fingerprint, existing_fp) > 0.6:
            return True

    return False


async def get_stats() -> dict:
    now = datetime.utcnow()
    h1  = (now - timedelta(hours=1)).isoformat()
    h24 = (now - timedelta(hours=24)).isoformat()

    async with get_alerts_db() as db:
        total = (await (await db.execute("SELECT COUNT(*) FROM alerts")).fetchone())[0]
        last24 = (await (await db.execute(
            "SELECT COUNT(*) FROM alerts WHERE timestamp>=?", (h24,))).fetchone())[0]
        last1  = (await (await db.execute(
            "SELECT COUNT(*) FROM alerts WHERE timestamp>=?", (h1,))).fetchone())[0]

        by_type, by_sev, by_area = {}, {}, {}
        async with db.execute("SELECT type, COUNT(*) FROM alerts GROUP BY type") as cur:
            async for row in cur: by_type[row[0]] = row[1]
        async with db.execute("SELECT severity, COUNT(*) FROM alerts GROUP BY severity") as cur:
            async for row in cur: by_sev[row[0]] = row[1]

        # Ensure all expected severity levels are present (even with 0 count)
        for severity in ['critical', 'high', 'medium', 'low']:
            by_sev.setdefault(severity, 0)

        async with db.execute(
            "SELECT area, COUNT(*) FROM alerts WHERE area IS NOT NULL GROUP BY area ORDER BY 2 DESC LIMIT 15"
        ) as cur:
            async for row in cur: by_area[row[0]] = row[1]

        channels = []
        async with db.execute("SELECT username FROM channels WHERE active=1") as cur:
            async for row in cur: channels.append(row[0])

    return dict(
        total_alerts=total, alerts_last_24h=last24, alerts_last_hour=last1,
        by_type=by_type, by_severity=by_sev, by_area=by_area,
        monitored_channels=channels,
    )


async def get_channels() -> List[str]:
    async with get_alerts_db() as db:
        cur = await db.execute("SELECT username FROM channels WHERE active=1")
        rows = await cur.fetchall()
    return [r[0] for r in rows]


async def add_channel(username: str) -> bool:
    async with get_alerts_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO channels(username, added_at, active) VALUES(?,?,1)",
            (username, datetime.utcnow().isoformat())
        )
        await db.commit()
    return True


async def remove_channel(username: str) -> bool:
    async with get_alerts_db() as db:
        await db.execute("UPDATE channels SET active=0 WHERE username=?", (username,))
        await db.commit()
    return True


def _row_to_webhook(row) -> WebhookTarget:
    return WebhookTarget(
        id=row[0], url=row[1], secret=row[2], active=bool(row[3]),
        alert_types=row[4], min_severity=row[5],
        created_at=datetime.fromisoformat(row[6]),
    )


async def get_webhooks() -> List[WebhookTarget]:
    async with get_alerts_db() as db:
        cur = await db.execute("SELECT * FROM webhooks WHERE active=1")
        rows = await cur.fetchall()
    return [_row_to_webhook(r) for r in rows]


async def add_webhook(wh: WebhookTarget) -> WebhookTarget:
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            "INSERT INTO webhooks(url,secret,active,alert_types,min_severity,created_at) VALUES(?,?,?,?,?,?)",
            (wh.url, wh.secret, 1, wh.alert_types, wh.min_severity, now)
        )
        await db.commit()
        wh.id = cur.lastrowid
        wh.created_at = datetime.fromisoformat(now)
    return wh


async def delete_webhook(webhook_id: int) -> bool:
    async with get_alerts_db() as db:
        await db.execute("UPDATE webhooks SET active=0 WHERE id=?", (webhook_id,))
        await db.commit()
    return True


# ── Security vocab candidates ─────────────────────────────────────────────────

async def insert_security_vocab_candidate(
    term: str, category: str, occurrences: int, sample_msg: Optional[str] = None
) -> None:
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        await db.execute(
            """INSERT INTO security_vocab_candidates
               (term, category, occurrences, sample_msg, first_seen)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(term, category) DO UPDATE SET
                 occurrences = MAX(excluded.occurrences, occurrences),
                 sample_msg  = COALESCE(sample_msg, excluded.sample_msg)""",
            (term, category, occurrences, sample_msg, now),
        )
        await db.commit()


async def get_security_vocab_candidates(
    category: Optional[str] = None,
    promoted: Optional[bool] = None,
    limit: int = 100,
) -> list:
    conditions, params = [], []
    if category:
        conditions.append("category = ?")
        params.append(category)
    if promoted is not None:
        conditions.append("promoted = ?")
        params.append(1 if promoted else 0)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    async with get_alerts_db() as db:
        cur = await db.execute(
            f"SELECT * FROM security_vocab_candidates {where} "
            "ORDER BY occurrences DESC LIMIT ?",
            params + [limit],
        )
        rows = await cur.fetchall()
    return [
        {
            "id": r[0], "term": r[1], "category": r[2],
            "occurrences": r[3], "sample_msg": r[4],
            "first_seen": r[5], "promoted": bool(r[6]),
        }
        for r in rows
    ]
