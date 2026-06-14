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
    regenerate_narrative,
    get_recent_incidents_by_type,
    record_llm_cluster,
)
from .llm.incident_clusterer import should_merge_llm

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
        # F7 — refresh narrative on every merge so consumers see an
        # always-up-to-date summary of the incident state.
        try:
            await regenerate_narrative(existing["id"])
        except Exception as e:
            log.warning(f"narrative regen failed for incident #{existing['id']}: {e}")
        return existing["id"]

    # B3 — cross-channel clustering: the exact type+area merge missed, but another
    # channel may have reported the SAME event with different area wording. Ask
    # MiniMax to match against recent same-type incidents. Off by default; fail-safe
    # to creating a new incident (today's behavior) on any error / low confidence.
    if settings.MINIMAX_ENABLED:
        try:
            candidates = await get_recent_incidents_by_type(incident_type, window, limit=10)
            verdict = await should_merge_llm(
                {"title": getattr(alert, "title", None), "area": area,
                 "incident_type": incident_type,
                 "timestamp": str(getattr(alert, "timestamp", ""))},
                candidates,
            )
            iid = verdict.get("incident_id")
            if iid:
                await merge_into_incident(iid, alert.id, severity)
                await record_llm_cluster(alert.id, iid, verdict.get("confidence"))
                try:
                    await regenerate_narrative(iid)
                except Exception as e:
                    log.warning(f"narrative regen failed for incident #{iid}: {e}")
                log.info(f"[INCIDENT/LLM] alert #{alert.id} → incident #{iid} "
                         f"(conf {verdict.get('confidence')})")
                return iid
        except Exception as e:
            log.warning(f"LLM incident clustering failed: {e}")

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
    try:
        await regenerate_narrative(incident_id)
    except Exception as e:
        log.warning(f"narrative regen failed for incident #{incident_id}: {e}")
    return incident_id


async def auto_resolve_stale():
    """Resolve incidents with no recent alerts. Called from monitor heartbeat."""
    return await resolve_stale_incidents(settings.INCIDENT_AUTO_RESOLVE_HOURS)
