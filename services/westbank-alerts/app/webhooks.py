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


def _alert_matches(alert: Alert, wh) -> bool:
    if wh.alert_types:
        allowed = [t.strip() for t in wh.alert_types.split(",")]
        if alert.type not in allowed:
            return False
    if wh.min_severity:
        if SEV_RANK.get(alert.severity, 0) < SEV_RANK.get(wh.min_severity, 0):
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
            "timestamp":  _utc_iso(alert.timestamp),
            "created_at": _utc_iso(alert.created_at) if alert.created_at else None,
            "event_subtype": getattr(alert, "event_subtype", None) or None,
        }
    }, ensure_ascii=False).encode("utf-8")

    tasks = [
        asyncio.create_task(_deliver(wh.url, payload, wh.secret))
        for wh in _cached_webhooks
        if _alert_matches(alert, wh)
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def invalidate_cache():
    """Call when webhooks are added/removed to force refresh on next fire."""
    global _cache_ts
    _cache_ts = 0
