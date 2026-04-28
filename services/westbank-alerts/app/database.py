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

CREATE_CHANNEL_RELIABILITY = """
CREATE TABLE IF NOT EXISTS channel_reliability (
    channel      TEXT PRIMARY KEY,
    weight       REAL NOT NULL,
    basis        TEXT,
    last_updated TEXT NOT NULL
)
"""

# Baseline reliability weights — tuned from historical false-positive rates.
# Higher = more trusted. Used to compute per-alert confidence.
CHANNEL_RELIABILITY_SEED = [
    ("Almustashaar",    1.00, "Official PA/IDF communiqué aggregator"),
    ("WAFA",            0.90, "Palestinian national news agency (official)"),
    ("wafa_ps",         0.90, "WAFA Arabic mirror"),
    ("QudsN",           0.80, "Quds News Network — high volume, cross-verified"),
    ("qudsn",           0.80, "Quds News Network — alt handle"),
    ("Shihab",          0.70, "Shihab Agency — fast but occasional duplication"),
    ("shehabagency",    0.70, "Shihab agency alt"),
    ("PalinfoAr",       0.70, "Palinfo Arabic"),
    ("ajanews",         0.60, "Al Jazeera Arabic news feed"),
    ("AlMayadeenNews",  0.50, "Al Mayadeen — editorial overlay common"),
    ("MOHMediaGaza",    0.80, "Gaza Health Ministry — bulletins only"),
    # B2 RSS sources
    ("aljazeera_ar",  0.65, "Al Jazeera Arabic RSS"),
    ("anadolu_ar",    0.55, "Anadolu Agency Arabic RSS"),
    ("rt_arabic",     0.45, "RT Arabic RSS — framing bias"),
    ("skynews_ar",    0.55, "Sky News Arabia RSS — fast breaking news"),
]

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
        await db.execute(CREATE_CHANNEL_RELIABILITY)
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
        if "confidence" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN confidence REAL")
        if "source_reliability" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN source_reliability REAL")
        if "status" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN status TEXT DEFAULT 'active'")
        if "correction_note" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN correction_note TEXT")
        if "geo_precision" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN geo_precision TEXT")
        if "geo_source_phrase" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN geo_source_phrase TEXT")
        if "count" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN count INTEGER")
        if "temporal_certainty" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN temporal_certainty TEXT")
        # B2: multi-source ingestion. Existing rows are all Telegram-sourced.
        if "source_type" not in alert_cols:
            await db.execute(
                "ALTER TABLE alerts ADD COLUMN source_type TEXT DEFAULT 'telegram'"
            )
            await db.execute(
                "UPDATE alerts SET source_type='telegram' WHERE source_type IS NULL"
            )
        # OCHA admin stamps via point-in-polygon (cod-ab-pse polygons).
        # Filled by app/admin_lookup.py on every new alert; existing rows
        # backfilled by scripts/backfill-admin-stamps.py.
        if "admin1" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN admin1 TEXT")
        if "admin2" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN admin2 TEXT")
        # Per-alert audit trail of how much confidence came from historical
        # corroboration (Insecurity Insight + ACLED). 0 = no boost; >0 means
        # base-rate evidence supported this alert. Surfaced via /quality/corroboration.
        if "historical_boost" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN historical_boost REAL DEFAULT 0")
        # F2 — composite trust_score = confidence * source_reliability.
        # Single sortable number that consumers can filter on instead of
        # juggling confidence + source_reliability + historical_boost.
        # Recomputed whenever confidence changes (B1, historical, ACLED bumps).
        if "trust_score" not in alert_cols:
            await db.execute("ALTER TABLE alerts ADD COLUMN trust_score REAL")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_trust ON alerts(trust_score)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_admin1 ON alerts(admin1)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_admin2 ON alerts(admin2)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_confidence ON alerts(confidence)")
        # Spatial indexes for bbox / radius queries (T2.11 + T2.12)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_lat ON alerts(latitude)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_lng ON alerts(longitude)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_alerts_geo_precision ON alerts(geo_precision)")

        # Webhook subscriber filters (Phase P3.2)
        cursor = await db.execute("PRAGMA table_info(webhooks)")
        wh_cols = {row[1] for row in await cursor.fetchall()}
        if "areas" not in wh_cols:
            await db.execute("ALTER TABLE webhooks ADD COLUMN areas TEXT")
        if "zones" not in wh_cols:
            await db.execute("ALTER TABLE webhooks ADD COLUMN zones TEXT")
        if "confidence_min" not in wh_cols:
            await db.execute("ALTER TABLE webhooks ADD COLUMN confidence_min REAL")
        if "customer_key_id" not in wh_cols:
            await db.execute("ALTER TABLE webhooks ADD COLUMN customer_key_id INTEGER")

        # Seed channels from env — always INSERT OR IGNORE to pick up newly added channels
        now = datetime.utcnow().isoformat()
        for ch in settings.channel_list:
            await db.execute(
                "INSERT OR IGNORE INTO channels(username, added_at) VALUES(?,?)",
                (ch, now)
            )

        # Seed channel reliability baseline — only fills empty rows; never overwrites
        # operator-tuned weights.
        for ch, weight, basis in CHANNEL_RELIABILITY_SEED:
            await db.execute(
                "INSERT OR IGNORE INTO channel_reliability(channel, weight, basis, last_updated) "
                "VALUES(?,?,?,?)",
                (ch, weight, basis, now),
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
        confidence=row[16] if len(row) > 16 else None,
        source_reliability=row[17] if len(row) > 17 else None,
        status=(row[18] if len(row) > 18 and row[18] else "active"),
        correction_note=row[19] if len(row) > 19 else None,
        geo_precision=row[20] if len(row) > 20 else None,
        geo_source_phrase=row[21] if len(row) > 21 else None,
        count=row[22] if len(row) > 22 else None,
        temporal_certainty=row[23] if len(row) > 23 else None,
        source_type=row[24] if len(row) > 24 else None,
        admin1=row[25] if len(row) > 25 else None,
        admin2=row[26] if len(row) > 26 else None,
        trust_score=row[28] if len(row) > 28 else None,
    )


def compute_trust_score(confidence: Optional[float], source_reliability: Optional[float]) -> float:
    """F2 — composite trust score (0.0-1.0). Pure multiplication of the two
    component signals. Defaults: confidence=0.5, source_reliability=0.7
    (the default seed weight). Both already account for upstream boosts
    (B1 corroboration + historical_boost are folded into confidence)."""
    c = confidence if confidence is not None else 0.5
    s = source_reliability if source_reliability is not None else 0.7
    return round(min(1.0, max(0.0, c * s)), 3)


async def insert_alert(alert: Alert) -> Alert:
    now = datetime.utcnow().isoformat()
    trust = compute_trust_score(
        getattr(alert, "confidence", None),
        getattr(alert, "source_reliability", None),
    )
    async with get_alerts_db() as db:
        cur = await db.execute(
            """INSERT INTO alerts
               (type, severity, title, body, source, source_msg_id, area, zone,
                raw_text, timestamp, created_at, event_subtype, latitude, longitude,
                title_ar, confidence, source_reliability, status, correction_note,
                geo_precision, geo_source_phrase, count, temporal_certainty,
                source_type, admin1, admin2, trust_score)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (alert.type, alert.severity, alert.title, alert.body,
             alert.source, alert.source_msg_id, alert.area,
             getattr(alert, "zone", None),
             alert.raw_text, alert.timestamp.isoformat(), now,
             getattr(alert, "event_subtype", None),
             getattr(alert, "latitude", None),
             getattr(alert, "longitude", None),
             getattr(alert, "title_ar", None),
             getattr(alert, "confidence", None),
             getattr(alert, "source_reliability", None),
             getattr(alert, "status", None) or "active",
             getattr(alert, "correction_note", None),
             getattr(alert, "geo_precision", None),
             getattr(alert, "geo_source_phrase", None),
             getattr(alert, "count", None),
             getattr(alert, "temporal_certainty", None),
             getattr(alert, "source_type", None) or "telegram",
             getattr(alert, "admin1", None),
             getattr(alert, "admin2", None),
             trust)
        )
        await db.commit()
        alert.id = cur.lastrowid
        alert.created_at = datetime.fromisoformat(now)
        setattr(alert, "trust_score", trust)
    return alert


async def update_alert_status(
    alert_id: int, status: str, correction_note: Optional[str] = None
) -> Optional[Alert]:
    """Mark an alert as retracted / corrected. Returns the updated alert, or None
    if the id was not found. Callers are responsible for broadcasting the change."""
    async with get_alerts_db() as db:
        cur = await db.execute(
            "UPDATE alerts SET status=?, correction_note=? WHERE id=?",
            (status, correction_note, alert_id),
        )
        await db.commit()
        if cur.rowcount == 0:
            return None
        cur = await db.execute("SELECT * FROM alerts WHERE id=?", (alert_id,))
        row = await cur.fetchone()
    return _row_to_alert(row) if row else None


_last_prune_count = 0

async def prune_alerts_if_needed():
    """Prune old alerts periodically — called from monitor heartbeat, not every insert.
    MAX_ALERTS_STORED=0 disables pruning entirely (full history retention)."""
    global _last_prune_count
    if settings.MAX_ALERTS_STORED <= 0:
        return
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
    until: Optional[datetime] = None,
    min_confidence: Optional[float] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple:
    conditions, params = [], []
    if type:     conditions.append("type = ?");      params.append(type)
    if severity: conditions.append("severity = ?");  params.append(severity)
    if area:     conditions.append("area LIKE ?");   params.append(f"%{area}%")
    if since:    conditions.append("timestamp >= ?"); params.append(since.isoformat())
    if until:    conditions.append("timestamp <= ?"); params.append(until.isoformat())
    if min_confidence is not None:
        # Treat NULL confidence as passing the filter when threshold <= 0.5 (legacy
        # rows have no score but were classifier-accepted). Above 0.5, require a
        # numeric score meeting the threshold.
        if min_confidence <= 0.5:
            conditions.append("(confidence IS NULL OR confidence >= ?)")
        else:
            conditions.append("confidence >= ?")
        params.append(min_confidence)
    if status:   conditions.append("status = ?");    params.append(status)

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


async def export_alerts(
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    type: Optional[str] = None,
    severity: Optional[str] = None,
    area: Optional[str] = None,
    min_confidence: Optional[float] = None,
    batch_size: int = 500,
):
    """Async generator yielding Alert objects in batches for bulk export.

    Keeps memory bounded (one batch at a time) — used by /alerts/export to stream
    historical alerts without materializing the full dataset in RAM.
    """
    conditions, params = [], []
    if type:     conditions.append("type = ?");      params.append(type)
    if severity: conditions.append("severity = ?");  params.append(severity)
    if area:     conditions.append("area LIKE ?");   params.append(f"%{area}%")
    if since:    conditions.append("timestamp >= ?"); params.append(since.isoformat())
    if until:    conditions.append("timestamp <= ?"); params.append(until.isoformat())
    if min_confidence is not None:
        conditions.append("(confidence IS NULL OR confidence >= ?)")
        params.append(min_confidence)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    offset = 0
    while True:
        async with get_alerts_db() as db:
            cur = await db.execute(
                f"SELECT * FROM alerts {where} ORDER BY timestamp ASC LIMIT ? OFFSET ?",
                params + [batch_size, offset],
            )
            rows = await cur.fetchall()
        if not rows:
            return
        for r in rows:
            yield _row_to_alert(r)
        if len(rows) < batch_size:
            return
        offset += batch_size


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


async def recent_similar_alerts(
    event_type: str,
    area: Optional[str],
    since_minutes: int = 30,
    exclude_source: Optional[str] = None,
) -> list[Alert]:
    """B1 — find prior alerts of the same (type, area) within `since_minutes`.

    Used by the classifier to compute cross-channel corroboration: if N
    distinct sources reported the same event in the same window, boost
    confidence on every member of the group.

    Pass `exclude_source` to skip alerts from the same channel as the
    incoming one (so we count distinct channels, not repeats).
    """
    if not event_type or not area:
        return []
    since = (datetime.utcnow() - timedelta(minutes=since_minutes)).isoformat()
    where = ["type = ?", "area = ?", "timestamp >= ?", "status = 'active'"]
    params: list = [event_type, area, since]
    if exclude_source:
        where.append("source != ?")
        params.append(exclude_source)
    async with get_alerts_db() as db:
        cur = await db.execute(
            f"SELECT * FROM alerts WHERE {' AND '.join(where)} ORDER BY timestamp DESC LIMIT 20",
            params,
        )
        rows = await cur.fetchall()
    return [_row_to_alert(r) for r in rows]


async def bump_corroboration(
    alert_ids: list[int], new_confidence_floor: float
) -> None:
    """When a new alert corroborates older alerts in the same window,
    bump their confidence (MAX) so the boost is symmetric. Caller passes
    the recomputed confidence floor; existing higher values are kept.
    Also recomputes trust_score = confidence * source_reliability."""
    if not alert_ids:
        return
    placeholders = ",".join(["?"] * len(alert_ids))
    async with get_alerts_db() as db:
        await db.execute(
            f"UPDATE alerts "
            f"SET confidence = MAX(confidence, ?), "
            f"    trust_score = MIN(1.0, MAX(0.0, "
            f"        MAX(confidence, ?) * COALESCE(source_reliability, 0.7))) "
            f"WHERE id IN ({placeholders})",
            [new_confidence_floor, new_confidence_floor, *alert_ids],
        )
        await db.commit()


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
        areas=row[7] if len(row) > 7 else None,
        zones=row[8] if len(row) > 8 else None,
        confidence_min=row[9] if len(row) > 9 else None,
        customer_key_id=row[10] if len(row) > 10 else None,
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
            """INSERT INTO webhooks
               (url, secret, active, alert_types, min_severity, created_at,
                areas, zones, confidence_min, customer_key_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (wh.url, wh.secret, 1, wh.alert_types, wh.min_severity, now,
             wh.areas, wh.zones, wh.confidence_min, wh.customer_key_id)
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


# ── Channel reliability (Phase P3.6) ──────────────────────────────────────────

async def get_channel_reliability(channel: Optional[str] = None):
    """Return the reliability weight for a single channel (or all, if None).

    Lookup is case-insensitive against the handle stored in `channels` — callers
    pass the raw `source` field of an alert, which is the @ handle without the @.
    Missing channels default to 0.5 (neutral prior).

    The list form (channel=None) augments each entry with a 30-day
    observed FP-rate snapshot: total alerts emitted, count retracted,
    auto_tp from the B6 review queue, and the resulting fp_rate. This
    makes the seed weight auditable — consumers can see whether the
    static reliability number is supported by recent behavior."""
    async with get_alerts_db() as db:
        if channel:
            cur = await db.execute(
                "SELECT weight FROM channel_reliability WHERE lower(channel) = lower(?)",
                (channel,),
            )
            row = await cur.fetchone()
            return float(row[0]) if row else 0.5
        cur = await db.execute(
            "SELECT channel, weight, basis, last_updated FROM channel_reliability ORDER BY weight DESC"
        )
        rows = await cur.fetchall()

        # Observed FP rate per channel over the last 30 days.
        cur = await db.execute(
            """SELECT lower(source) AS ch,
                      COUNT(*) AS total,
                      SUM(CASE WHEN status = 'retracted' THEN 1 ELSE 0 END) AS retracted
               FROM alerts
               WHERE timestamp >= datetime('now','-30 days')
                 AND source IS NOT NULL
               GROUP BY lower(source)"""
        )
        obs = {r[0]: {"total_30d": r[1], "retracted_30d": r[2] or 0} for r in await cur.fetchall()}

        # B6 auto-resolutions (verdict='auto_tp') count as implicit
        # confirmations from silence — surface them too.
        cur = await db.execute(
            """SELECT lower(a.source) AS ch, COUNT(*) AS auto_tp
               FROM alert_review_queue q
               JOIN alerts a ON a.id = q.alert_id
               WHERE q.verdict = 'auto_tp'
                 AND q.reviewed_at >= datetime('now','-30 days')
               GROUP BY lower(a.source)"""
        )
        for ch, n in await cur.fetchall():
            obs.setdefault(ch, {"total_30d": 0, "retracted_30d": 0})["auto_tp_30d"] = n

    out = []
    for r in rows:
        ch_lower = (r[0] or "").lower()
        observed = obs.get(ch_lower, {"total_30d": 0, "retracted_30d": 0, "auto_tp_30d": 0})
        observed.setdefault("auto_tp_30d", 0)
        total = observed["total_30d"]
        observed["fp_rate_30d"] = (
            round(observed["retracted_30d"] / total, 4) if total else None
        )
        out.append({
            "channel": r[0], "weight": float(r[1]),
            "basis": r[2], "last_updated": r[3],
            "observed": observed,
        })
    return out


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
