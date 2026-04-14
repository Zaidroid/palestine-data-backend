"""
Incident database — groups related alerts into incidents.

Uses alerts.db (same DB as alerts). Follows checkpoint_db.py pattern.
"""

import logging
from datetime import datetime
from typing import Optional

from .db_pool import get_alerts_db

log = logging.getLogger("incident_db")

CREATE_INCIDENTS = """
CREATE TABLE IF NOT EXISTS incidents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_type   TEXT NOT NULL,
    area            TEXT,
    area_ar         TEXT,
    zone            TEXT,
    latitude        REAL,
    longitude       REAL,
    severity        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    alert_count     INTEGER DEFAULT 1,
    first_alert_id  INTEGER,
    last_alert_id   INTEGER,
    started_at      TEXT NOT NULL,
    last_updated    TEXT NOT NULL,
    resolved_at     TEXT
)
"""

CREATE_INCIDENT_ALERTS = """
CREATE TABLE IF NOT EXISTS incident_alerts (
    incident_id INTEGER NOT NULL,
    alert_id    INTEGER NOT NULL,
    PRIMARY KEY (incident_id, alert_id)
)
"""

INCIDENT_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status)",
    "CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(incident_type)",
    "CREATE INDEX IF NOT EXISTS idx_incidents_area ON incidents(area)",
    "CREATE INDEX IF NOT EXISTS idx_incidents_updated ON incidents(last_updated DESC)",
]


async def init_incident_tables():
    async with get_alerts_db() as db:
        await db.execute(CREATE_INCIDENTS)
        await db.execute(CREATE_INCIDENT_ALERTS)
        for idx in INCIDENT_INDEXES:
            await db.execute(idx)
        await db.commit()
    log.info("Incident tables ready")


def _row_to_incident(row) -> dict:
    return {
        "id": row[0],
        "incident_type": row[1],
        "area": row[2],
        "area_ar": row[3],
        "zone": row[4],
        "latitude": row[5],
        "longitude": row[6],
        "severity": row[7],
        "status": row[8],
        "alert_count": row[9],
        "first_alert_id": row[10],
        "last_alert_id": row[11],
        "started_at": row[12],
        "last_updated": row[13],
        "resolved_at": row[14],
    }


async def create_incident(
    incident_type: str,
    area: Optional[str],
    area_ar: Optional[str],
    zone: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    severity: str,
    alert_id: int,
) -> int:
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            """INSERT INTO incidents
               (incident_type, area, area_ar, zone, latitude, longitude,
                severity, status, alert_count, first_alert_id, last_alert_id,
                started_at, last_updated)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                incident_type, area, area_ar, zone, latitude, longitude,
                severity, "active", 1, alert_id, alert_id,
                now, now,
            ),
        )
        incident_id = cur.lastrowid
        await db.execute(
            "INSERT INTO incident_alerts(incident_id, alert_id) VALUES(?,?)",
            (incident_id, alert_id),
        )
        await db.commit()
    log.info(f"Incident #{incident_id} created: {incident_type} @ {area}")
    return incident_id


_SEVERITY_RANK = {"low": 1, "medium": 2, "high": 3, "critical": 4}


async def merge_into_incident(incident_id: int, alert_id: int, severity: str):
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        # Get current severity to compare correctly
        cur = await db.execute(
            "SELECT severity FROM incidents WHERE id=?", (incident_id,)
        )
        row = await cur.fetchone()
        current_severity = row[0] if row else "low"
        new_severity = (
            severity
            if _SEVERITY_RANK.get(severity, 0) > _SEVERITY_RANK.get(current_severity, 0)
            else current_severity
        )
        await db.execute(
            """UPDATE incidents SET
                 alert_count = alert_count + 1,
                 last_alert_id = ?,
                 last_updated = ?,
                 severity = ?
               WHERE id = ?""",
            (alert_id, now, new_severity, incident_id),
        )
        await db.execute(
            "INSERT OR IGNORE INTO incident_alerts(incident_id, alert_id) VALUES(?,?)",
            (incident_id, alert_id),
        )
        await db.commit()
    log.info(f"Incident #{incident_id} merged alert #{alert_id}")


async def find_mergeable_incident(
    incident_type: str, area: Optional[str], window_iso: str
) -> Optional[dict]:
    """Find an active incident of the same type+area within the time window."""
    async with get_alerts_db() as db:
        if area:
            cur = await db.execute(
                "SELECT * FROM incidents "
                "WHERE status='active' AND incident_type=? AND area=? AND last_updated>=? "
                "ORDER BY last_updated DESC LIMIT 1",
                (incident_type, area, window_iso),
            )
        else:
            cur = await db.execute(
                "SELECT * FROM incidents "
                "WHERE status='active' AND incident_type=? AND area IS NULL AND last_updated>=? "
                "ORDER BY last_updated DESC LIMIT 1",
                (incident_type, window_iso),
            )
        row = await cur.fetchone()
    return _row_to_incident(row) if row else None


async def get_active_incidents(limit: int = 50) -> list[dict]:
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT * FROM incidents WHERE status='active' "
            "ORDER BY last_updated DESC LIMIT ?",
            (limit,),
        )
        rows = await cur.fetchall()
    return [_row_to_incident(r) for r in rows]


async def get_incident(incident_id: int) -> Optional[dict]:
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT * FROM incidents WHERE id=?", (incident_id,)
        )
        row = await cur.fetchone()
    return _row_to_incident(row) if row else None


async def get_incident_alert_ids(incident_id: int) -> list[int]:
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT alert_id FROM incident_alerts WHERE incident_id=? ORDER BY alert_id",
            (incident_id,),
        )
        rows = await cur.fetchall()
    return [r[0] for r in rows]


async def resolve_stale_incidents(max_age_hours: float):
    """Resolve incidents with no alerts in max_age_hours."""
    from datetime import timedelta
    cutoff = (datetime.utcnow() - timedelta(hours=max_age_hours)).isoformat()
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            "UPDATE incidents SET status='resolved', resolved_at=? "
            "WHERE status='active' AND last_updated < ?",
            (now, cutoff),
        )
        count = cur.rowcount
        if count:
            await db.commit()
            log.info(f"Auto-resolved {count} stale incident(s)")
    return count
