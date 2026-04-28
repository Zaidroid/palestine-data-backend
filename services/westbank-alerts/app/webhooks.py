"""
Webhook delivery with retry logic.
Delivers JSON POST to all registered external endpoints on each new alert.
Uses a cached webhook list (refreshed every 60s) and a shared httpx client.
"""

import asyncio
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import httpx

from .config import settings
from .models import Alert

log = logging.getLogger("webhooks")


def _utc_iso(dt: datetime) -> str:
    """Convert datetime to ISO format with Z suffix (UTC timezone)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


SEV_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}

# F6 — Slack/Discord color codes per severity.
_SLACK_COLOR = {"critical": "#ef4444", "high": "#f97316", "medium": "#f5b454", "low": "#9aa0aa"}
_DISCORD_COLOR = {"critical": 0xef4444, "high": 0xf97316, "medium": 0xf5b454, "low": 0x9aa0aa}
_SEV_EMOJI = {"critical": "🚨", "high": "⚠️", "medium": "ℹ️", "low": "·"}


def _alert_summary_line(alert: Alert) -> str:
    parts = [_SEV_EMOJI.get(alert.severity, "·")]
    parts.append(f"*{alert.type.replace('_', ' ').title()}*")
    if alert.area:
        parts.append(f"— {alert.area}")
    if getattr(alert, "admin1", None):
        parts.append(f"({alert.admin1})")
    return " ".join(parts)


def _slack_payload(alert: Alert, event: str = "new_alert") -> bytes:
    """Slack incoming-webhook payload. Renders as a colored attachment with
    title + fields. Set webhooks.template='slack' and use a Slack
    incoming-webhook URL."""
    summary = _alert_summary_line(alert)
    if event == "correction":
        summary = f"📝 *Correction:* {alert.type} — {alert.area or '?'} → {getattr(alert, 'status', '?')}"
    fields = [
        {"title": "Severity", "value": alert.severity or "?", "short": True},
        {"title": "Source", "value": alert.source or "?", "short": True},
        {"title": "Confidence", "value": f"{getattr(alert, 'confidence', 0) or 0:.2f}", "short": True},
        {"title": "Trust", "value": f"{getattr(alert, 'trust_score', 0) or 0:.2f}", "short": True},
    ]
    payload = {
        "text": summary,
        "attachments": [{
            "color": _SLACK_COLOR.get(alert.severity, "#9aa0aa"),
            "title": alert.title or alert.type,
            "text": (alert.body or "")[:500],
            "fields": fields,
            "footer": f"id={alert.id} · {_utc_iso(alert.timestamp) if alert.timestamp else '?'}",
        }],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _discord_payload(alert: Alert, event: str = "new_alert") -> bytes:
    """Discord incoming-webhook payload (embed-rich)."""
    title = alert.title or alert.type
    if event == "correction":
        title = f"📝 Correction: {alert.type}"
    embed = {
        "title": title[:256],
        "description": (alert.body or "")[:2000],
        "color": _DISCORD_COLOR.get(alert.severity, 0x9aa0aa),
        "fields": [
            {"name": "Type", "value": alert.type or "?", "inline": True},
            {"name": "Severity", "value": alert.severity or "?", "inline": True},
            {"name": "Area", "value": alert.area or "?", "inline": True},
            {"name": "Source", "value": alert.source or "?", "inline": True},
            {"name": "Confidence", "value": f"{getattr(alert, 'confidence', 0) or 0:.2f}", "inline": True},
            {"name": "Trust", "value": f"{getattr(alert, 'trust_score', 0) or 0:.2f}", "inline": True},
        ],
        "footer": {"text": f"alert #{alert.id}"},
        "timestamp": _utc_iso(alert.timestamp) if alert.timestamp else None,
    }
    return json.dumps({
        "content": _alert_summary_line(alert),
        "embeds": [embed],
    }, ensure_ascii=False).encode("utf-8")


def _format_for_template(template: str, raw_payload: bytes, alert: Alert, event: str) -> bytes:
    """Translate the canonical raw payload to a platform-specific format."""
    t = (template or "raw").lower()
    if t == "slack":
        return _slack_payload(alert, event)
    if t == "discord":
        return _discord_payload(alert, event)
    return raw_payload  # "raw" or unknown — preserve canonical payload

# ── Webhook cache ────────────────────────────────────────────────────────────
_cached_webhooks: list = []
_cache_ts: float = 0
_CACHE_TTL = 60.0  # seconds

# ── Shared httpx client ──────────────────────────────────────────────────────
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=settings.WEBHOOK_TIMEOUT)
    return _http_client


def _csv_lower(value: Optional[str]) -> set:
    if not value:
        return set()
    return {v.strip().lower() for v in value.split(",") if v.strip()}


def _alert_matches(alert: Alert, wh) -> bool:
    if wh.alert_types:
        allowed = [t.strip() for t in wh.alert_types.split(",")]
        if alert.type not in allowed:
            return False
    if wh.min_severity:
        if SEV_RANK.get(alert.severity, 0) < SEV_RANK.get(wh.min_severity, 0):
            return False
    areas = _csv_lower(getattr(wh, "areas", None))
    if areas:
        a = (alert.area or "").lower()
        if not a or not any(target in a or a in target for target in areas):
            return False
    zones = _csv_lower(getattr(wh, "zones", None))
    if zones:
        z = (getattr(alert, "zone", None) or "").lower()
        if not z or z not in zones:
            return False
    cmin = getattr(wh, "confidence_min", None)
    if cmin is not None:
        c = getattr(alert, "confidence", None)
        # Legacy alerts (no score) pass only if threshold is at the floor.
        if c is None:
            if cmin > 0.5:
                return False
        elif c < cmin:
            return False
    return True


def _sign(payload: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(
        secret.encode(), payload, hashlib.sha256
    ).hexdigest()


async def _deliver(url: str, payload: bytes, secret: Optional[str]):
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if secret:
        headers["X-WB-Signature"] = _sign(payload, secret)

    client = _get_http_client()
    for attempt in range(1, settings.WEBHOOK_MAX_RETRIES + 1):
        try:
            resp = await client.post(url, content=payload, headers=headers)
            if resp.status_code < 500:
                log.debug(f"Webhook {url} → {resp.status_code}")
                return
            log.warning(f"Webhook {url} attempt {attempt} → {resp.status_code}")
        except Exception as e:
            log.warning(f"Webhook {url} attempt {attempt} error: {e}")
        if attempt < settings.WEBHOOK_MAX_RETRIES:
            await asyncio.sleep(2 ** attempt)

    log.error(f"Webhook {url} exhausted {settings.WEBHOOK_MAX_RETRIES} retries")


async def _refresh_cache():
    """Refresh the cached webhook list from DB if stale."""
    global _cached_webhooks, _cache_ts
    now = time.monotonic()
    if now - _cache_ts < _CACHE_TTL:
        return
    from . import database as db
    _cached_webhooks = await db.get_webhooks()
    _cache_ts = now


async def fire_cached(alert: Alert):
    """Called from main.py dispatch pipeline. Uses cached webhook targets."""
    await _refresh_cache()
    if not _cached_webhooks:
        return

    payload = json.dumps({
        "event": "new_alert",
        "alert": {
            "id":         alert.id,
            "type":       alert.type,
            "severity":   alert.severity,
            "title":      alert.title,
            "body":       alert.body,
            "source":     alert.source,
            "area":       alert.area,
            "zone":       getattr(alert, "zone", None),
            "timestamp":  _utc_iso(alert.timestamp),
            "created_at": _utc_iso(alert.created_at) if alert.created_at else None,
            "event_subtype": getattr(alert, "event_subtype", None) or None,
            "confidence": getattr(alert, "confidence", None),
            "source_reliability": getattr(alert, "source_reliability", None),
            "status": getattr(alert, "status", None) or "active",
        }
    }, ensure_ascii=False).encode("utf-8")

    tasks = []
    for wh in _cached_webhooks:
        if not _alert_matches(alert, wh):
            continue
        # F6 — re-format payload per webhook target's template choice.
        # Slack/Discord get reshaped; "raw" (default) sends the canonical payload.
        body = _format_for_template(getattr(wh, "template", None), payload, alert, "new_alert")
        tasks.append(asyncio.create_task(_deliver(wh.url, body, wh.secret)))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def fire_correction(alert: Alert):
    """Push a correction/retraction event to all subscribers that originally
    matched this alert. Runs alongside the normal fanout so dashboards can
    update their cached records in place."""
    await _refresh_cache()
    if not _cached_webhooks:
        return

    payload = json.dumps({
        "event": "correction",
        "alert": {
            "id": alert.id,
            "type": alert.type,
            "severity": alert.severity,
            "title": alert.title,
            "area": alert.area,
            "zone": getattr(alert, "zone", None),
            "status": getattr(alert, "status", None) or "active",
            "correction_note": getattr(alert, "correction_note", None),
            "timestamp": _utc_iso(alert.timestamp),
        }
    }, ensure_ascii=False).encode("utf-8")

    tasks = []
    for wh in _cached_webhooks:
        if not _alert_matches(alert, wh):
            continue
        body = _format_for_template(getattr(wh, "template", None), payload, alert, "correction")
        tasks.append(asyncio.create_task(_deliver(wh.url, body, wh.secret)))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def invalidate_cache():
    """Call when webhooks are added/removed to force refresh on next fire."""
    global _cache_ts
    _cache_ts = 0
