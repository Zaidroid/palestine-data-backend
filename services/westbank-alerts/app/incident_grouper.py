"""
Incident Grouper — merges alerts into incidents.

When a new alert arrives, either merge it into an existing active incident
(same type + area within INCIDENT_MERGE_WINDOW_HOURS) or create a new one.
"""

import logging
from datetime import datetime, timedelta

from .config import settings
from .incident_db import (
    find_mergeable_incident,
    create_incident,
    merge_into_incident,
    resolve_stale_incidents,
)

log = logging.getLogger("incident_grouper")


async def process_alert_into_incident(alert) -> int:
    """
    Process a classified alert into the incident system.
    Returns the incident ID (new or merged).

    alert: models.Alert instance (after insert_alert)
    """
    incident_type = alert.type
    area = alert.area
    severity = alert.severity

    window = (
        datetime.utcnow()
        - timedelta(hours=settings.INCIDENT_MERGE_WINDOW_HOURS)
    ).isoformat()

    existing = await find_mergeable_incident(incident_type, area, window)

    if existing:
        await merge_into_incident(existing["id"], alert.id, severity)
        return existing["id"]

    area_ar = getattr(alert, "title_ar", None)
    zone = getattr(alert, "zone", None)
    latitude = getattr(alert, "latitude", None)
    longitude = getattr(alert, "longitude", None)

    incident_id = await create_incident(
        incident_type=incident_type,
        area=area,
        area_ar=area_ar,
        zone=zone,
        latitude=latitude,
        longitude=longitude,
        severity=severity,
        alert_id=alert.id,
    )
    return incident_id


async def auto_resolve_stale():
    """Resolve incidents with no recent alerts. Called from monitor heartbeat."""
    return await resolve_stale_incidents(settings.INCIDENT_AUTO_RESOLVE_HOURS)
