"""
West Bank Alert System — FastAPI application

Endpoints:
  GET  /                    API info and endpoint map
  GET  /health              Health check + uptime
  GET  /alerts              List alerts (filterable, paginated)
  GET  /alerts/latest       Latest N alerts
  GET  /alerts/{id}         Single alert by ID
  GET  /stats               Statistics + active channels
  GET  /incidents           Categorized incident feed (threats/military/attacks)
  GET  /incidents/summary   Situational summary — counts by category/zone/severity
  GET  /market              All market data (currency, gold, fuel)
  GET  /market/currency     ILS exchange rates (BOI)
  GET  /market/gold         Gold price USD + ILS
  GET  /market/fuel         Palestine fuel prices
  GET  /weather             Current weather for WB cities
  GET  /prayer-times        Prayer times for WB cities (AlAdhan)
  GET  /air-quality         Air quality / AQI for WB cities
  GET  /internet-status     Palestine internet connectivity (IODA)
  GET  /conditions          Full situational snapshot (all data combined)
  WS   /ws                  WebSocket real-time stream
  GET  /stream              SSE real-time stream (browser-friendly)
  GET  /webhooks            List webhook targets     [requires X-API-Key]
  POST /webhooks            Register webhook target  [requires X-API-Key]
  DEL  /webhooks/{id}       Remove webhook           [requires X-API-Key]
  GET  /admin/channels      List monitored channels  [requires X-API-Key]
  POST /admin/channels      Add channel              [requires X-API-Key]
  DEL  /admin/channels/{u}  Remove channel           [requires X-API-Key]
  POST /admin/inject        Inject alert manually    [requires X-API-Key]
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Dict, List, Optional, Set

import sentry_sdk
from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.security import APIKeyHeader

_sentry_dsn = os.getenv("SENTRY_DSN")
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "production"),
        release=os.getenv("SENTRY_RELEASE") or None,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
        send_default_pii=False,
    )

from . import database as db
from . import databank as dbk
from . import monitor
from . import webhooks
from . import checkpoint_db as cpdb
from . import db_pool
from . import market_data
from . import weather
from . import prayer_times
from . import air_quality
from . import internet_status
from . import incident_db
from . import area_status as area_mod
from .config import settings
from .models import Alert, AlertResponse, StatsResponse, WebhookTarget, RouteCheckRequest
from .checkpoint_models import (
    Checkpoint, CheckpointUpdate, CheckpointListResponse,
    CheckpointHistoryResponse, UpdateFeedResponse, CheckpointStatsResponse,
)
from .checkpoint_knowledge_base import load_knowledge_base
from .location_knowledge_base import load_location_kb


def _utc_iso(dt: datetime) -> str:
    """Convert datetime to ISO format with Z suffix (UTC timezone)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


import structlog

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)
logging.basicConfig(level=logging.INFO, format="%(message)s")
log = structlog.get_logger("api").bind(service="params-alerts-api")

START_TIME = time.time()


# ── WebSocket manager ─────────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self._clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.add(ws)
        log.info(f"WS connected ({len(self._clients)} clients)")

    def disconnect(self, ws: WebSocket):
        self._clients.discard(ws)

    async def broadcast_raw(self, payload: str):
        dead = set()
        for ws in self._clients.copy():
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._clients.discard(ws)

    async def broadcast(self, alert: Alert):
        if not self._clients:
            return
        event_data = {
            "id":        alert.id,
            "type":      alert.type,
            "severity":  alert.severity,
            "title":     alert.title,
            "body":      alert.body,
            "source":    alert.source,
            "area":      alert.area,
            "timestamp": _utc_iso(alert.timestamp),
        }
        if hasattr(alert, "event_subtype") and alert.event_subtype:
            event_data["event_subtype"] = alert.event_subtype
        payload = json.dumps({
            "event": "alert",
            "data": event_data,
        }, ensure_ascii=False)

        dead = set()
        for ws in self._clients.copy():
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._clients.discard(ws)


ws_manager    = ConnectionManager()
sse_queues:   List[asyncio.Queue] = []

# ── Checkpoint real-time ──────────────────────────────────────────────────────

cp_ws_manager  = ConnectionManager()
cp_sse_queues: List[asyncio.Queue] = []
area_sse_queues: List[asyncio.Queue] = []


async def _dispatch_checkpoint(updates: list):
    """Fan out checkpoint status changes to WS/SSE clients."""
    if not updates:
        return
    if not cp_ws_manager._clients and not cp_sse_queues:
        return
    payload = json.dumps({
        "event":   "checkpoint_update",
        "updates": [
            {
                "canonical_key": u["canonical_key"],
                "name_raw":      u["name_raw"],
                "status":        u["status"],
                "status_raw":    u.get("status_raw"),
                "source_type":   u["source_type"],
                "direction":     u.get("direction"),
                "timestamp":     _utc_iso(u["timestamp"])
                                 if isinstance(u["timestamp"], datetime)
                                 else u["timestamp"],
            }
            for u in updates
        ],
    }, ensure_ascii=False)
    await cp_ws_manager.broadcast_raw(payload)
    for q in list(cp_sse_queues):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass  # drop update for slow SSE consumers


async def _dispatch(alert: Alert):
    """Called by monitor when a new alert arrives. Fan out to all consumers."""
    await ws_manager.broadcast(alert)
    for q in list(sse_queues):
        try:
            q.put_nowait(alert)
        except asyncio.QueueFull:
            pass  # drop alert for slow SSE consumers
    await webhooks.fire_cached(alert)


async def _dispatch_area_status(areas: list):
    """Fan out area status updates to SSE clients."""
    if not area_sse_queues:
        return
    payload = json.dumps({
        "event": "area_status",
        "areas": areas,
        "total": len(areas),
    }, ensure_ascii=False, default=str)
    for q in list(area_sse_queues):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    cp_db_path = settings.DB_PATH.replace("alerts.db", "checkpoints.db")
    await db_pool.init_pool(settings.DB_PATH, cp_db_path)
    await db.init_db()
    await cpdb.init_checkpoint_db()
    from . import databank
    await databank.init_databank()

    # A2 — load learned classifier overrides (correction feedback loop).
    # Reloaded by the daily cron via in-place file refresh + container restart.
    from .classifier import refresh_overrides_from_db_sync
    n = refresh_overrides_from_db_sync(settings.DB_PATH)
    log.info(f"Classifier overrides loaded: {n} entries")

    # Load checkpoint whitelist (NEW: whitelist-first parsing system)
    log.info("Loading checkpoint whitelist...")
    await load_knowledge_base()
    log.info("Checkpoint whitelist loaded successfully")

    # Load location knowledge base (for geocoding alerts)
    log.info("Loading location knowledge base...")
    await load_location_kb()
    log.info("Location knowledge base loaded")

    # OCHA admin polygons for point-in-polygon admin1/admin2 stamping
    # on every new alert. (PR-2 cod-ab-pse data, image-baked.)
    from . import admin_lookup
    admin_lookup.init()

    # Init incident tables + compute initial area status
    await incident_db.init_incident_tables()
    await area_mod.compute_area_status()
    log.info("Incident tables + area status ready")

    monitor.set_broadcast_fn(_dispatch)
    monitor.set_checkpoint_broadcast_fn(_dispatch_checkpoint)
    monitor.set_area_broadcast_fn(_dispatch_area_status)
    monitor_task = asyncio.create_task(monitor.start())

    # Load learned vocabulary into runtime
    from .learner import load_learned_vocab
    await load_learned_vocab()

    # Wait for Telegram auth to complete, then launch background learning tasks
    async def _start_learner():
        await asyncio.sleep(8)
        tg_client = monitor.get_client()
        if tg_client and settings.checkpoint_channel_list:
            from .learner import run_startup_catchup, periodic_learning_cycle
            primary_cp = settings.checkpoint_channel_list[0]
            asyncio.create_task(run_startup_catchup(tg_client, primary_cp))
            asyncio.create_task(periodic_learning_cycle(tg_client, primary_cp))
        else:
            log.warning("Learner: Telegram client not ready or no checkpoint channel set")

    asyncio.create_task(_start_learner())

    yield
    monitor_task.cancel()
    await monitor.stop()
    await db_pool.close_pool()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="West Bank Alert System",
    description="Real-time security alert API — Telegram-sourced, locally hosted",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

from .middleware.api_key import ApiKeyMiddleware
app.add_middleware(ApiKeyMiddleware)

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_key(key: Optional[str] = Depends(api_key_header)):
    if key != settings.API_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    return key


# ── Info ──────────────────────────────────────────────────────────────────────

@app.get("/", tags=["info"])
async def root():
    return RedirectResponse(url="/dashboard")


@app.get("/dashboard", tags=["info"], response_class=FileResponse)
async def dashboard():
    import pathlib
    html_path = pathlib.Path(__file__).resolve().parent.parent / "dashboard.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="dashboard.html not found")
    return FileResponse(html_path, media_type="text/html")


@app.get("/tracker", tags=["info"], response_class=FileResponse)
async def tracker():
    import pathlib
    html_path = pathlib.Path(__file__).resolve().parent.parent / "tracker.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail="tracker.html not found")
    return FileResponse(html_path, media_type="text/html")


@app.get("/api", tags=["info"])
async def api_info():
    return {
        "service": "West Bank Alert System",
        "version": "1.0.0",
        "data_source": "Telegram channels (Telethon)",
        "note": "oref.org.il blocked from Palestinian IPs — Telegram only",
        "endpoints": {
            "dashboard":    "GET /dashboard",
            "alerts":       "GET /alerts",
            "latest":       "GET /alerts/latest",
            "stats":        "GET /stats",
            "checkpoints":  "GET /checkpoints",
            "nearby":       "GET /checkpoints/nearby",
            "geojson":      "GET /checkpoints/geojson",
            "market":          "GET /market",
            "currency":        "GET /market/currency",
            "gold":            "GET /market/gold",
            "fuel":            "GET /market/fuel",
            "weather":         "GET /weather",
            "prayer_times":    "GET /prayer-times",
            "air_quality":     "GET /air-quality",
            "internet_status": "GET /internet-status",
            "conditions":      "GET /conditions",
            "websocket":    "WS  /ws",
            "sse":          "GET /stream",
            "docs":         "GET /docs",
        }
    }


@app.get("/health", tags=["info"])
async def health():
    monitor_stats = monitor.get_stats()
    cp_last = await cpdb.get_last_update_time()

    is_cp_stale = True
    if cp_last:
        try:
            last_dt = datetime.fromisoformat(cp_last)
            is_cp_stale = (datetime.utcnow() - last_dt).total_seconds() > 6 * 3600
        except (ValueError, TypeError):
            pass

    return {
        "status":         "ok",
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "ws_clients":     len(ws_manager._clients),
        "sse_clients":    len(sse_queues),
        "cp_ws_clients":  len(cp_ws_manager._clients),
        "cp_sse_clients": len(cp_sse_queues),
        "monitor": {
            "connected":        monitor_stats.get("connected", False),
            "last_message_at":  monitor_stats.get("last_message_at"),
            "messages_today":   monitor_stats.get("messages_today", 0),
            "alerts_today":     monitor_stats.get("alerts_today", 0),
            "cp_updates_today": monitor_stats.get("cp_updates_today", 0),
        },
        "checkpoints": {
            "last_update": cp_last,
            "is_stale":    is_cp_stale,
        },
        "timestamp": _utc_iso(datetime.utcnow()),
    }


# ── Zone polygons for map overlays ────────────────────────────────────────────

@app.get("/zones", tags=["zones"])
async def zone_polygons():
    """
    Return WB sub-zone polygons as GeoJSON for map overlays.
    Used by the frontend to render zone-wide pulse effects for alerts.
    """
    from .classifier import WB_ZONES

    features = []
    for zone_name, zone_data in WB_ZONES.items():
        features.append({
            "type": "Feature",
            "properties": {
                "zone": zone_name,
                "center": list(zone_data["center"]),
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [zone_data["polygon"]],
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "total": len(features),
            "zones": list(WB_ZONES.keys()),
        },
    }



# ── Alerts ────────────────────────────────────────────────────────────────────

@app.get("/alerts", response_model=AlertResponse, tags=["alerts"])
async def list_alerts(
    type:           Optional[str]      = Query(None),
    severity:       Optional[str]      = Query(None),
    area:           Optional[str]      = Query(None),
    since:          Optional[datetime] = Query(None),
    until:          Optional[datetime] = Query(None),
    min_confidence: Optional[float]    = Query(None, ge=0.0, le=1.0),
    status:         Optional[str]      = Query(None, pattern="^(active|retracted|corrected)$"),
    page:           int                = Query(1, ge=1),
    per_page:       int                = Query(50, ge=1, le=200),
):
    """
    List alerts. Newest first. All parameters are optional.

    For AI agent polling: call every 30-60s and pass `since` to avoid
    re-processing old alerts. Use severity=critical for urgent-only mode.
    Use `min_confidence` to filter low-confidence classifier outputs.
    """
    offset = (page - 1) * per_page
    alerts, total = await db.get_alerts(
        type=type, severity=severity, area=area,
        since=since, until=until,
        min_confidence=min_confidence, status=status,
        limit=per_page, offset=offset,
    )
    return AlertResponse(alerts=alerts, total=total, page=page, per_page=per_page)


@app.get("/alerts/latest", response_model=List[Alert], tags=["alerts"])
async def latest_alerts(
    n:              int             = Query(10, ge=1, le=100),
    min_confidence: Optional[float] = Query(None, ge=0.0, le=1.0),
):
    """Return the N most recent alerts. Default 10."""
    alerts, _ = await db.get_alerts(limit=n, min_confidence=min_confidence)
    return alerts


@app.get("/alerts/active", response_model=AlertResponse, tags=["alerts"])
async def active_alerts(
    hours:          float           = Query(2.0, ge=0.5, le=24.0,
                                             description="Alerts from last N hours (default 2)"),
    min_confidence: Optional[float] = Query(None, ge=0.0, le=1.0),
):
    """
    Alerts from the last N hours. Default: 2 hours.
    Returns empty list when the situation is calm — ideal for frontends
    that need to display a current status indicator.
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    alerts, total = await db.get_alerts(since=since, limit=200, min_confidence=min_confidence)
    return AlertResponse(alerts=alerts, total=total, page=1, per_page=200)


# Bulk historical export — paid tier (Phase P3.1)
# Placed before /alerts/{alert_id} so the static path wins over the int catch-all.
@app.get("/alerts/export", tags=["alerts"])
async def export_alerts_endpoint(
    since:          Optional[datetime] = Query(None),
    until:          Optional[datetime] = Query(None),
    type:           Optional[str]      = Query(None),
    severity:       Optional[str]      = Query(None),
    area:           Optional[str]      = Query(None),
    min_confidence: Optional[float]    = Query(None, ge=0.0, le=1.0),
    format:         str                = Query("ndjson", pattern="^(ndjson|csv)$"),
    _: str = Depends(require_key),
):
    """
    Stream historical alerts as newline-delimited JSON or CSV.

    Streams in 500-row batches so memory stays bounded regardless of the
    requested window. Designed for ETL into customer warehouses; the order
    is timestamp ASC so consumers can checkpoint and resume.
    """
    if format == "csv":
        cols = [
            "id", "timestamp", "type", "severity", "title", "area", "zone",
            "source", "confidence", "source_reliability", "status", "body",
        ]

        async def csv_stream():
            yield (",".join(cols) + "\n").encode("utf-8")
            async for a in db.export_alerts(
                since=since, until=until, type=type, severity=severity,
                area=area, min_confidence=min_confidence,
            ):
                vals = [
                    str(a.id or ""),
                    _utc_iso(a.timestamp) if a.timestamp else "",
                    a.type or "",
                    a.severity or "",
                    (a.title or "").replace("\n", " ").replace('"', '""'),
                    (a.area or "").replace('"', '""'),
                    (getattr(a, "zone", None) or ""),
                    a.source or "",
                    f"{a.confidence:.3f}" if a.confidence is not None else "",
                    f"{a.source_reliability:.3f}" if a.source_reliability is not None else "",
                    getattr(a, "status", None) or "active",
                    (a.body or "").replace("\n", " ").replace('"', '""'),
                ]
                line = ",".join(f'"{v}"' for v in vals) + "\n"
                yield line.encode("utf-8")

        return StreamingResponse(
            csv_stream(),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="alerts-export.csv"'},
        )

    async def ndjson_stream():
        async for a in db.export_alerts(
            since=since, until=until, type=type, severity=severity,
            area=area, min_confidence=min_confidence,
        ):
            yield (a.model_dump_json() + "\n").encode("utf-8")

    return StreamingResponse(
        ndjson_stream(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": 'attachment; filename="alerts-export.ndjson"'},
    )


# ── Spatial / map / route endpoints ──────────────────────────────────────────
# X.1 + X.2: power the live map, navigation, and timeline-map frontends.
# Core query primitives (bbox + radius) reuse _haversine_km from checkpoint_db.

from .checkpoint_db import _haversine_km, get_checkpoints_nearby
from . import area_status as area_mod


@app.get("/alerts/map", tags=["alerts"])
async def alerts_map(
    bbox:           Optional[str]      = Query(None, description="minLat,minLng,maxLat,maxLng"),
    since:          Optional[datetime] = Query(None),
    types:          Optional[str]      = Query(None, description="Comma-separated alert types"),
    min_confidence: Optional[float]    = Query(None, ge=0.0, le=1.0),
    limit:          int                = Query(500, ge=1, le=2000),
):
    """Spatial alert query for live-map clients. Returns a GeoJSON
    FeatureCollection ready for Leaflet/Mapbox. Alerts without lat/lng
    are dropped from the feature set (use /alerts for unfiltered)."""
    bbox_tuple = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) != 4:
                raise ValueError("bbox must be minLat,minLng,maxLat,maxLng")
            bbox_tuple = tuple(parts)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="invalid bbox")

    type_list = [t.strip() for t in types.split(",")] if types else None

    # Pull a wider window then filter spatially in Python — alert volume
    # is small enough (~50/day) that this is fine without a real spatial
    # index. If volume grows >10k alerts/day, switch to R*Tree.
    fetched, _total = await db.get_alerts(
        type=None, severity=None, area=None,
        since=since, until=None,
        min_confidence=min_confidence, status="active",
        limit=2000, offset=0,
    )
    features = []
    for a in fetched:
        if a.latitude is None or a.longitude is None:
            continue
        if bbox_tuple and not (
            bbox_tuple[0] <= a.latitude  <= bbox_tuple[2]
            and bbox_tuple[1] <= a.longitude <= bbox_tuple[3]
        ):
            continue
        if type_list and a.type not in type_list:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [a.longitude, a.latitude]},
            "properties": {
                "id": a.id,
                "alert_type": a.type,
                "severity": a.severity,
                "title": a.title,
                "title_ar": a.title_ar,
                "area": a.area,
                "zone": a.zone,
                "geo_precision": a.geo_precision,
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                "confidence": a.confidence,
                "source": a.source,
                "count": a.count,
                "status": a.status,
            },
        })
        if len(features) >= limit:
            break

    return {
        "type": "FeatureCollection",
        "features": features,
        "meta": {
            "total_features": len(features),
            "bbox": list(bbox_tuple) if bbox_tuple else None,
            "since": since.isoformat() if since else None,
            "types_filter": type_list,
            "min_confidence": min_confidence,
        },
    }


@app.get("/alerts/regions/summary", tags=["alerts"])
async def alerts_regions_summary(
    since: Optional[datetime] = Query(None, description="Default = last 24h"),
):
    """Per-region alert counts + dominant event type. Used by the live map
    at low zoom levels (choropleth shading instead of dense pin markers)."""
    if since is None:
        since = datetime.utcnow() - timedelta(days=1)
    fetched, _total = await db.get_alerts(
        type=None, severity=None, area=None,
        since=since, until=None,
        min_confidence=None, status="active",
        limit=2000, offset=0,
    )
    by_region: Dict[str, dict] = {}
    for a in fetched:
        # Map zone -> human-readable region
        region = a.zone or "unknown"
        if region in ("gaza_strip",): region = "Gaza Strip"
        elif region in ("north", "middle", "south", "west_bank"): region = "West Bank"
        slot = by_region.setdefault(region, {"count": 0, "by_type": {}, "by_severity": {}})
        slot["count"] += 1
        slot["by_type"][a.type] = slot["by_type"].get(a.type, 0) + 1
        slot["by_severity"][a.severity] = slot["by_severity"].get(a.severity, 0) + 1

    # Compute dominant type per region for choropleth coloring
    for region, slot in by_region.items():
        slot["dominant_type"] = max(slot["by_type"].items(), key=lambda x: x[1])[0] if slot["by_type"] else None

    return {
        "since": since.isoformat(),
        "regions": by_region,
        "meta": {"total_alerts": sum(r["count"] for r in by_region.values())},
    }


@app.post("/route/check", tags=["routes"])
async def route_check(req: RouteCheckRequest):
    """Route-safety check for the navigator frontend. Given a sequence of
    waypoints + a corridor buffer, returns:
      - alerts active inside the corridor
      - checkpoints near the route + their current status
      - per-region area_status along the route
      - an overall advisory: AVOID | CAUTION | OK

    Public endpoint — no auth (per access policy: anonymous reads).
    Long-lived monitoring (WS /route/watch) lands separately.
    """
    if not req.waypoints or len(req.waypoints) < 1:
        raise HTTPException(status_code=400, detail="waypoints required (≥1)")
    for pt in req.waypoints:
        if not isinstance(pt, list) or len(pt) != 2:
            raise HTTPException(status_code=400, detail="each waypoint must be [lat, lng]")

    buffer_km = req.buffer_km or 2.0
    since = datetime.utcnow() - timedelta(hours=req.since_hours or 6)

    # 1. Alerts in corridor — pull recent alerts then filter by min-distance to any waypoint
    fetched, _ = await db.get_alerts(
        type=None, severity=None, area=None,
        since=since, until=None,
        min_confidence=req.min_confidence, status="active",
        limit=1000, offset=0,
    )
    in_corridor = []
    for a in fetched:
        if a.latitude is None or a.longitude is None:
            continue
        min_dist = min(
            _haversine_km(a.latitude, a.longitude, lat, lng)
            for lat, lng in req.waypoints
        )
        if min_dist <= buffer_km:
            in_corridor.append({
                "id": a.id,
                "alert_type": a.type,
                "severity": a.severity,
                "title": a.title,
                "title_ar": a.title_ar,
                "area": a.area,
                "lat": a.latitude,
                "lng": a.longitude,
                "distance_from_route_km": round(min_dist, 2),
                "timestamp": a.timestamp.isoformat() if a.timestamp else None,
                "confidence": a.confidence,
            })

    # 2. Checkpoints near the route
    nearby_cps = []
    if req.include_checkpoints:
        seen_keys = set()
        for lat, lng in req.waypoints:
            cps = await get_checkpoints_nearby(lat, lng, radius_km=buffer_km)
            for cp in cps:
                key = cp.get("canonical_key")
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                nearby_cps.append({
                    "key": key,
                    "name_en": cp.get("name_en"),
                    "name_ar": cp.get("name_ar"),
                    "region": cp.get("region"),
                    "current_status": cp.get("status"),
                    "lat": cp.get("latitude"),
                    "lng": cp.get("longitude"),
                    "distance_from_route_km": round(cp.get("distance_km", 0), 2),
                })

    # 3. Area status along the route (collect distinct regions touched)
    try:
        cached = area_mod.get_cached_area_status() or []
    except Exception:
        cached = []
    by_region_status = {}
    for a in cached:
        by_region_status[(a.get("region") or "").lower()] = a
    regions_touched = set()
    for a in in_corridor:
        if a.get("area"): regions_touched.add(a["area"])
    for cp in nearby_cps:
        if cp.get("region"): regions_touched.add(cp["region"])
    areas_along_route = []
    for region in regions_touched:
        status = by_region_status.get(region.lower()) or {}
        if status:
            areas_along_route.append({
                "region": region,
                "status": status.get("status"),
                "severity": status.get("severity"),
            })

    # 4. Compute advisory
    high_severity_recent = [a for a in in_corridor
                            if a["severity"] == "high"
                            and (datetime.utcnow() - datetime.fromisoformat(a["timestamp"].replace('Z',''))).total_seconds() < 3600
                           ] if any(a.get("timestamp") for a in in_corridor) else []
    closed_cps = [cp for cp in nearby_cps if (cp.get("current_status") or "").lower() in ("closed", "blocked")]
    if high_severity_recent or closed_cps:
        advisory = "AVOID"
    elif in_corridor or any((cp.get("current_status") or "").lower() in ("restricted", "limited") for cp in nearby_cps):
        advisory = "CAUTION"
    else:
        advisory = "OK"

    return {
        "waypoints": req.waypoints,
        "buffer_km": buffer_km,
        "window_hours": req.since_hours or 6,
        "advisory": advisory,
        "alerts_count": len(in_corridor),
        "alerts": in_corridor,
        "checkpoints": nearby_cps,
        "areas_along_route": areas_along_route,
        "computed_at": datetime.utcnow().isoformat(),
    }


@app.get("/alerts/{alert_id}", response_model=Alert, tags=["alerts"])
async def get_alert(alert_id: int):
    alert = await db.get_alert(alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@app.patch("/alerts/{alert_id}", response_model=Alert, tags=["alerts"])
async def correct_alert(
    alert_id: int,
    status: str = Query(..., pattern="^(retracted|corrected|active)$"),
    correction_note: Optional[str] = Query(None, max_length=500),
    _: str = Depends(require_key),
):
    """
    Mark an alert as retracted, corrected, or restored.

    Pushes a `{event: "correction", ...}` event to all WebSocket / SSE / webhook
    subscribers so client caches can update in place without a full re-fetch.
    """
    if status != "active" and not correction_note:
        raise HTTPException(
            status_code=400,
            detail="correction_note is required when status is retracted or corrected",
        )
    updated = await db.update_alert_status(alert_id, status, correction_note)
    if not updated:
        raise HTTPException(status_code=404, detail="Alert not found")

    correction_payload = json.dumps({
        "event": "correction",
        "alert": {
            "id": updated.id,
            "status": updated.status,
            "correction_note": updated.correction_note,
            "type": updated.type,
            "area": updated.area,
            "timestamp": _utc_iso(updated.timestamp),
        },
    }, ensure_ascii=False)

    # Mirror the dispatch fan-out used by new alerts: WS clients first (lowest
    # latency), then SSE queues, then webhooks. Each path is best-effort.
    try:
        await ws_manager.broadcast_raw(correction_payload)
    except Exception:
        log.exception("ws broadcast (correction) failed")
    for q in list(sse_queues):
        try:
            q.put_nowait(correction_payload)
        except Exception:
            pass
    try:
        await webhooks.fire_correction(updated)
    except Exception:
        log.exception("webhook fire_correction failed")

    return updated


# ── B6 — Active-learning review queue ────────────────────────────────────────

@app.get("/admin/review", tags=["admin"])
async def admin_review_queue(
    limit: int = Query(20, ge=1, le=100),
    _: str = Depends(require_key),
):
    """List borderline-confidence alerts (0.40–0.60) queued for admin review.
    POST a verdict via /admin/review/{id} to either confirm or retract."""
    async with db_pool.get_alerts_db() as conn:
        cur = await conn.execute(
            """SELECT q.alert_id, q.queued_at,
                      a.type, a.area, a.confidence, a.title, a.timestamp, a.source
               FROM alert_review_queue q
               JOIN alerts a ON a.id = q.alert_id
               WHERE q.reviewed_at IS NULL
               ORDER BY q.queued_at DESC
               LIMIT ?""",
            (limit,),
        )
        rows = await cur.fetchall()
    return {
        "count": len(rows),
        "queue": [
            {
                "alert_id": r[0], "queued_at": r[1],
                "type": r[2], "area": r[3], "confidence": r[4],
                "title": r[5], "timestamp": r[6], "source": r[7],
            }
            for r in rows
        ],
    }


@app.post("/admin/review/{alert_id}", tags=["admin"])
async def admin_review_verdict(
    alert_id: int,
    verdict: str = Query(..., pattern="^(true_positive|false_positive|unsure)$"),
    note: Optional[str] = Query(None, max_length=500),
    _: str = Depends(require_key),
):
    """Record a verdict on a queued alert. false_positive verdicts also
    PATCH the alert to status=retracted, which feeds the A2 learner the
    next time it runs."""
    now = datetime.utcnow().isoformat()
    async with db_pool.get_alerts_db() as conn:
        cur = await conn.execute(
            "UPDATE alert_review_queue SET reviewed_at = ?, verdict = ?, note = ? "
            "WHERE alert_id = ? AND reviewed_at IS NULL",
            (now, verdict, note, alert_id),
        )
        await conn.commit()
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="alert not in pending queue")

    # FP verdict → also retract the alert so the A2 learner sees it
    if verdict == "false_positive":
        await db.update_alert_status(alert_id, "retracted",
                                     note or "admin_review verdict: false_positive")

    return {"alert_id": alert_id, "verdict": verdict, "reviewed_at": now}


# ── A3 — Volume anomaly detection ────────────────────────────────────────────

@app.get("/admin/anomalies", tags=["admin"])
async def admin_anomalies(
    hours: int = Query(24, ge=1, le=168),
    refresh: bool = Query(True, description="Run the check before returning recent anomalies"),
    _: str = Depends(require_key),
):
    """Volume anomaly detector. By default runs the check first, then returns
    all anomalies detected in the last `hours` window. Set refresh=false to
    just read the persisted table without recomputing."""
    from . import anomaly
    if refresh:
        await anomaly.check_volume_anomalies()
    rows = await anomaly.list_recent_anomalies(hours=hours)
    return {"count": len(rows), "anomalies": rows, "window_hours": hours}


@app.get("/channel-reliability", tags=["alerts"])
async def list_channel_reliability():
    """
    Per-channel baseline reliability scores (0.0-1.0) used by the classifier
    to weight new alerts. Higher = historically more accurate. Public so
    consumers can document their own filtering choices.
    """
    return {"channels": await db.get_channel_reliability()}


@app.get("/stats", response_model=StatsResponse, tags=["alerts"])
async def stats():
    s = await db.get_stats()
    return StatsResponse(**s, uptime_seconds=round(time.time() - START_TIME, 1))


# ── Incidents API — categorized, deduplicated feed ───────────────────────────

# Alert type categories for the incidents API
_INCIDENT_CATEGORIES = {
    "threats":  {"west_bank_siren", "regional_attack", "rocket_attack", "airstrike", "explosion"},
    "military": {"idf_raid", "arrest_campaign", "idf_operation"},
    "attacks":  {"settler_attack", "shooting", "demolition", "injury_report"},
}


@app.get("/incidents", tags=["incidents"])
async def list_incidents(
    category: Optional[str] = Query(None, description="Filter: threats, military, attacks"),
    type:     Optional[str] = Query(None, description="Specific alert type"),
    area:     Optional[str] = Query(None, description="Area name (partial match)"),
    zone:     Optional[str] = Query(None, description="Sub-zone: north|middle|south (WB) or gaza_north|gaza_city|middle_gaza|khan_younis|rafah (Gaza)"),
    severity: Optional[str] = Query(None, description="Minimum severity: critical, high, medium, low"),
    hours:    float         = Query(24.0, ge=1, le=168, description="Time window in hours"),
    limit:    int           = Query(100, ge=1, le=500),
):
    """
    Categorized incident feed. All alerts are local threats — missiles/sirens
    share the same geographic space as West Bank operational events.

    Categories:
      - threats:  Missiles, sirens, airstrikes, explosions
      - military: IDF raids, arrest campaigns, military operations
      - attacks:  Settler attacks, shootings, demolitions, injuries

    Returns incidents sorted by severity (critical first), then by timestamp.
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    alerts, total = await db.get_alerts(
        type=type, severity=None, area=area, since=since, limit=500, offset=0,
    )

    # Apply category filter
    if category and category in _INCIDENT_CATEGORIES:
        cat_types = _INCIDENT_CATEGORIES[category]
        alerts = [a for a in alerts if a.type in cat_types]

    # Apply zone filter
    if zone:
        alerts = [a for a in alerts if getattr(a, "zone", None) == zone]

    # Apply severity floor
    if severity:
        sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        floor = sev_order.get(severity, 3)
        alerts = [a for a in alerts if sev_order.get(a.severity, 3) <= floor]

    # Sort: severity (critical first), then newest first
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    alerts.sort(key=lambda a: (sev_order.get(a.severity, 3), -(datetime.fromisoformat(str(a.timestamp)).timestamp() if isinstance(a.timestamp, str) else a.timestamp.timestamp())))

    alerts = alerts[:limit]

    return {
        "incidents": [a.model_dump() for a in alerts],
        "total": len(alerts),
        "category": category,
        "time_window_hours": hours,
        "categories": {
            cat: sum(1 for a in alerts if a.type in types)
            for cat, types in _INCIDENT_CATEGORIES.items()
        },
    }


@app.get("/incidents/summary", tags=["incidents"])
async def incident_summary(
    hours: float = Query(24.0, ge=1, le=168),
):
    """
    Situational summary — counts by category, zone, and severity.
    Useful for dashboard KPIs and status indicators.
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    alerts, total = await db.get_alerts(since=since, limit=500, offset=0)

    by_category = {cat: 0 for cat in _INCIDENT_CATEGORIES}
    by_zone = {
        # West Bank sub-zones
        "north": 0, "middle": 0, "south": 0, "west_bank": 0,
        # Gaza sub-zones
        "gaza_north": 0, "gaza_city": 0, "middle_gaza": 0,
        "khan_younis": 0, "rafah": 0, "gaza_strip": 0,
    }
    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_region = {"west_bank": 0, "gaza_strip": 0}
    by_area: dict = {}

    for a in alerts:
        # Category
        for cat, types in _INCIDENT_CATEGORIES.items():
            if a.type in types:
                by_category[cat] += 1
                break

        # Zone
        z = getattr(a, "zone", None) or "west_bank"
        if z in by_zone:
            by_zone[z] += 1

        # Region rollup (WB vs Gaza)
        gaza_zones = {"gaza_north", "gaza_city", "middle_gaza", "khan_younis", "rafah", "gaza_strip"}
        if z in gaza_zones:
            by_region["gaza_strip"] += 1
        else:
            by_region["west_bank"] += 1

        # Severity
        if a.severity in by_severity:
            by_severity[a.severity] += 1

        # Area
        if a.area:
            by_area[a.area] = by_area.get(a.area, 0) + 1

    # Top affected areas
    top_areas = sorted(by_area.items(), key=lambda x: x[1], reverse=True)[:10]

    return {
        "total": total,
        "time_window_hours": hours,
        "by_category": by_category,
        "by_zone": by_zone,
        "by_region": by_region,
        "by_severity": by_severity,
        "top_areas": [{"area": a, "count": c} for a, c in top_areas],
        "threat_level": (
            "critical" if by_severity["critical"] > 0
            else "high" if by_severity["high"] > 2
            else "elevated" if by_severity["high"] > 0 or by_severity["medium"] > 3
            else "normal"
        ),
    }

@app.get("/stats/today", tags=["incidents"])
async def stats_today():
    """
    Returns today's aggregate counts for specific operational events.
    Useful for the frontend to show daily tickers (arrests, injuries, etc.)
    """
    # Use midnight UTC today as the starting point
    now = datetime.utcnow()
    since = datetime(now.year, now.month, now.day)
    alerts, _ = await db.get_alerts(since=since, limit=1000, offset=0)

    total_arrests = 0
    total_injuries = 0
    settler_attacks = 0
    military_raids = 0

    for a in alerts:
        if a.type == "arrest_campaign" or getattr(a, "event_subtype", "") == "arrest":
            # Extract count if present (default to 1)
            total_arrests += getattr(a, "count", 1)
        elif a.type == "injury_report":
            total_injuries += getattr(a, "count", 1)
        elif a.type == "settler_attack":
            settler_attacks += 1
        elif a.type == "idf_raid":
            military_raids += 1

    return {
        "date": since.date().isoformat(),
        "total_arrests_today": total_arrests,
        "total_injuries_today": total_injuries,
        "settler_attacks_today": settler_attacks,
        "military_raids_today": military_raids
    }


# ── Long-term databank ────────────────────────────────────────────────────────

# Generic GET handler for the five entity tables. Filter keys are validated
# against the per-table whitelist in databank._TABLE_FILTERS.
_DATABANK_TABLES = (
    "people_killed", "people_injured", "people_detained",
    "structures_damaged", "actor_actions",
)


@app.get("/databank", tags=["databank"])
async def databank_index():
    """List databank tables and their current row counts. Useful for
    discovery: any consumer can see what's available + how rich it is.

    NOTE: row counts here are NOT the same as cumulative casualty/detention
    totals. people_killed has 60k named individuals + 800+ daily-aggregate
    rows from Gaza MoH bulletins; the official cumulative killed figure is
    higher than the row count because each daily aggregate row carries a
    `count` field (use `/databank/people_killed/summary` to read sum_count).
    For headline numbers see /api/v1/databank/totals on the gateway.
    """
    counts = await dbk.databank_counts()
    return {
        "notice": (
            "Row counts ≠ cumulative totals. people_killed has 60k named individuals "
            "(Tech4Palestine roster) PLUS 800+ daily aggregate rows from Gaza MoH "
            "(each row carries a `count` field). Use /databank/{table}/summary for "
            "sum_count, /api/v1/databank/totals for official headline figures."
        ),
        "tables": [
            {
                "name": t,
                "count": counts.get(t, 0),
                "filters": list(dbk._TABLE_FILTERS[t].keys()),
                "endpoints": {
                    "rows":    f"/databank/{t}",
                    "summary": f"/databank/{t}/summary",
                    "geojson": f"/databank/{t}?format=geojson",
                },
            }
            for t in _DATABANK_TABLES
        ],
        "as_of": datetime.utcnow().isoformat(),
    }


@app.get("/databank/{table}", tags=["databank"])
async def databank_query(
    table: str,
    request: Request,
    page:     int  = Query(1,  ge=1),
    per_page: int  = Query(100, ge=1, le=500),
    format:   str  = Query("json", pattern="^(json|geojson)$"),
):
    """Query a databank table. All filter keys are validated against the
    per-table whitelist; unknown keys are silently ignored. Returns
    `data` + `pagination` (default), or a GeoJSON FeatureCollection when
    `format=geojson` (rows without lat/lng are dropped from the feature set)."""
    if table not in _DATABANK_TABLES:
        raise HTTPException(status_code=404, detail=f"unknown table: {table}")
    # Anything in the query string that isn't reserved gets passed as a filter.
    reserved = {"page", "per_page", "format"}
    filters = {k: v for k, v in request.query_params.items() if k not in reserved}
    rows, total = await dbk.query_table(
        table, filters,
        limit=per_page, offset=(page - 1) * per_page,
    )
    if format == "geojson":
        fc = dbk.rows_to_geojson(rows)
        fc["meta"] = {"total": total, "page": page, "per_page": per_page, "filters": filters}
        return fc
    return {
        "data": rows,
        "pagination": {"total": total, "page": page, "per_page": per_page,
                        "pages": (total + per_page - 1) // per_page},
        "meta": {"table": table, "filters": filters},
    }


@app.get("/databank/{table}/summary", tags=["databank"])
async def databank_summary(
    table: str,
    request: Request,
    interval: str = Query("month", pattern="^(day|month|year)$"),
    group_by: Optional[str] = Query(None,
        description="Optional secondary grouping column "
                    "(e.g. place_region, gender, cause, actor_type)"),
):
    """Time-series + optional secondary grouping for dashboard rollups.
    Same filter keys as the main query endpoint."""
    if table not in _DATABANK_TABLES:
        raise HTTPException(status_code=404, detail=f"unknown table: {table}")
    reserved = {"interval", "group_by"}
    filters = {k: v for k, v in request.query_params.items() if k not in reserved}
    try:
        series = await dbk.summary_table(table, filters, interval=interval, group_by=group_by)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "data": series,
        "meta": {"table": table, "interval": interval, "group_by": group_by, "filters": filters},
    }


# ── Real-time: WebSocket ──────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    Real-time WebSocket. Receives JSON events the moment a Telegram message
    is processed. Recommended for AI agents.

    Message format:
      { "event": "alert", "data": { id, type, severity, title, body, source, area, timestamp } }
      { "event": "ping",  "ts": "..." }   keepalive every 30s
      { "event": "ack",   "ts": "..." }   response to any client message
    """
    await ws_manager.connect(ws)
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
                await ws.send_text(json.dumps({"event": "ack", "ts": _utc_iso(datetime.utcnow())}))
            except asyncio.TimeoutError:
                try:
                    await ws.send_text(json.dumps({"event": "ping", "ts": _utc_iso(datetime.utcnow())}))
                except Exception:
                    break
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect(ws)


# ── Real-time: SSE ────────────────────────────────────────────────────────────

@app.get("/stream", tags=["realtime"])
async def sse_stream():
    """
    Server-Sent Events. Use for browser dashboards and any client that
    cannot maintain a WebSocket.

    Browser usage:
      const es = new EventSource('http://your-server:8080/stream');
      es.onmessage = (e) => console.log(JSON.parse(e.data));
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    sse_queues.append(queue)

    async def generator() -> AsyncGenerator[str, None]:
        yield 'data: {"event":"connected"}\n\n'
        try:
            while True:
                try:
                    alert: Alert = await asyncio.wait_for(queue.get(), timeout=25)
                    payload = json.dumps({
                        "event":     "alert",
                        "id":        alert.id,
                        "type":      alert.type,
                        "severity":  alert.severity,
                        "title":     alert.title,
                        "body":      alert.body,
                        "source":    alert.source,
                        "area":      alert.area,
                        "timestamp": _utc_iso(alert.timestamp),
                        "event_subtype": getattr(alert, "event_subtype", None) or None,
                    }, ensure_ascii=False)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            if queue in sse_queues:
                sse_queues.remove(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Webhooks ──────────────────────────────────────────────────────────────────

@app.get("/webhooks", tags=["webhooks"])
async def list_webhooks(_: str = Depends(require_key)):
    return await db.get_webhooks()


@app.post("/webhooks", response_model=WebhookTarget, tags=["webhooks"])
async def register_webhook(wh: WebhookTarget, _: str = Depends(require_key)):
    """
    Register an HTTP endpoint to receive alert POSTs.

    Body: { "url": "...", "secret": "...", "alert_types": "rocket_attack,airstrike", "min_severity": "high" }
    All fields except url are optional. secret enables HMAC signature header.
    """
    result = await db.add_webhook(wh)
    webhooks.invalidate_cache()
    return result


@app.delete("/webhooks/{webhook_id}", tags=["webhooks"])
async def delete_webhook(webhook_id: int, _: str = Depends(require_key)):
    ok = await db.delete_webhook(webhook_id)
    webhooks.invalidate_cache()
    return {"deleted": ok, "id": webhook_id}


# ── Admin: channels ───────────────────────────────────────────────────────────

@app.get("/admin/channels", tags=["admin"])
async def list_channels(_: str = Depends(require_key)):
    return {"channels": await db.get_channels()}


@app.post("/admin/channels", tags=["admin"])
async def add_channel(username: str = Query(..., description="Channel username without @"),
                      _: str = Depends(require_key)):
    username = username.lstrip("@")
    await db.add_channel(username)
    return {"added": username, "note": "Restart the service to activate monitoring"}


@app.delete("/admin/channels/{username}", tags=["admin"])
async def remove_channel(username: str, _: str = Depends(require_key)):
    await db.remove_channel(username.lstrip("@"))
    return {"removed": username}


# ── Admin: manual inject ──────────────────────────────────────────────────────

@app.post("/admin/inject", response_model=Alert, tags=["admin"])
async def inject_alert(alert: Alert, _: str = Depends(require_key)):
    """
    Inject an alert from any source (not just Telegram).
    Also triggers WebSocket broadcast and webhooks, identical to a real alert.

    Use this for:
    - Testing your frontend/agent integration
    - Feeding alerts from non-Telegram sources
    - Manual urgent announcements

    Required fields: type, severity, title, body, source, raw_text, timestamp
    """
    if not alert.timestamp:
        alert.timestamp = datetime.utcnow()

    # Auto-extract zone and coordinates from raw_text if not provided
    if not alert.zone and alert.raw_text:
        from .classifier import _extract_zone, _normalize, WB_ZONES
        normed = _normalize(alert.raw_text)
        zone = _extract_zone(normed)
        if zone and zone in WB_ZONES:
            alert.zone = zone
            alert.latitude, alert.longitude = WB_ZONES[zone]["center"]

    stored = await db.insert_alert(alert)
    await _dispatch(stored)
    return stored


# ── Admin: history analysis ───────────────────────────────────────────────────

@app.post("/admin/analyze-history", tags=["admin"])
async def analyze_history(
    limit: int = Query(2000, ge=100, le=10000),
    days: Optional[int] = Query(None, ge=1, le=30),
    seed_db: bool = Query(False, description="Also seed checkpoint DB with results"),
    _: str = Depends(require_key),
):
    """
    Fetch historical messages from the checkpoint channel and extract
    all checkpoint names. Useful for building the checkpoint directory.

    - limit: max messages to fetch (default 2000)
    - days: only fetch messages from last N days
    - seed_db: if true, also seed the checkpoint database with found checkpoints
    """
    from .history_analyzer import analyze_channel, seed_db_from_results

    results = await analyze_channel(limit=limit, days=days)
    response = {
        "stats": results["stats"],
        "checkpoints_found": len(results.get("checkpoints", [])),
        "top_checkpoints": [
            {
                "name": cp["name_ar"],
                "canonical_key": cp["canonical_key"],
                "mentions": cp["total_mentions"],
                "last_status": cp["last_status"],
            }
            for cp in results.get("checkpoints", [])[:30]
        ],
    }

    if seed_db:
        seed_result = await seed_db_from_results(results)
        response["seed_result"] = seed_result

    return response


@app.post("/admin/analyze-security-history", tags=["admin"])
async def analyze_security_history(
    limit: int = Query(2000, ge=100, le=10000),
    _: str = Depends(require_key),
):
    """
    Fetch historical messages from the security alert channel and extract
    candidate terms for classifier expansion.

    Returns ranked lists of:
      - attack_verb_candidates: unknown Arabic words co-occurring with known attack vocab
      - wb_zone_candidates: place names appearing alongside West Bank attack verb messages

    Results are also stored in the security_vocab_candidates table for future review.
    Use GET /admin/security-vocab to retrieve stored candidates.
    """
    from .history_analyzer import analyze_security_channel
    return await analyze_security_channel(limit=limit)


@app.get("/admin/security-vocab", tags=["admin"])
async def get_security_vocab(
    category: Optional[str] = Query(None, description="attack_verb | wb_zone | area"),
    promoted: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: str = Depends(require_key),
):
    """
    List security vocabulary candidates discovered by analyze-security-history.
    Review these to find terms worth adding to classifier.py keyword sets.
    """
    return await db.get_security_vocab_candidates(
        category=category, promoted=promoted, limit=limit
    )


# ═══════════════════════════════════════════════════════════════════════════════
# MARKET DATA  —  currency, gold, fuel
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/market", tags=["market"])
async def market_all():
    """
    All market data in one call — currency exchange rates, gold price,
    and fuel prices. Each sub-section has its own TTL cache:
    currency=1h, gold=15min, fuel=24h.

    Ideal for dashboard widgets that need economic context alongside
    checkpoint and alert data.
    """
    return await market_data.get_all_market_data()


@app.get("/market/currency", tags=["market"])
async def market_currency():
    """
    ILS exchange rates from the Bank of Israel.
    Returns ILS per 1 unit of foreign currency (USD, EUR, JOD, GBP, EGP).
    Updated daily ~15:45 Israel Standard Time.  Cached 1 hour.
    """
    return await market_data.get_currency()


@app.get("/market/gold", tags=["market"])
async def market_gold():
    """
    Gold spot price in USD/oz and ILS/gram.
    USD price from metals.live, ILS cross-rate from Bank of Israel.
    Cached 15 minutes.
    """
    return await market_data.get_gold()


@app.get("/market/fuel", tags=["market"])
async def market_fuel():
    """
    Palestine retail fuel prices (gasoline + diesel) in USD and ILS per liter.
    Scraped from GlobalPetrolPrices.com. Typically updates monthly.
    Cached 24 hours.  Requires beautifulsoup4 to be installed.
    """
    return await market_data.get_fuel()


# ═══════════════════════════════════════════════════════════════════════════════
# WEATHER
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/weather", tags=["weather"])
async def weather_all(
    city: Optional[str] = Query(None, description="Filter by city name (English), comma-separated for multiple"),
):
    """
    Current weather for key West Bank cities via Open-Meteo (free, no API key).
    Returns temperature, wind, WMO weather code with English + Arabic descriptions.
    Cached 30 minutes.

    Cities: Nablus, Ramallah, Hebron, Jenin, Jericho, Tulkarm, Bethlehem, Qalqilya.
    Use ?city=Nablus,Ramallah to filter.
    """
    cities = [c.strip() for c in city.split(",") if c.strip()] if city else None
    return await weather.get_weather(cities=cities)


# ═══════════════════════════════════════════════════════════════════════════════
# PRAYER TIMES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/prayer-times", tags=["prayer-times"])
async def prayer_times_all(
    city: Optional[str] = Query(None, description="Filter by city name (English), comma-separated for multiple"),
):
    """
    Today's prayer times for West Bank cities via AlAdhan API (free, no key).
    Returns Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha for each city,
    plus Hijri date and Islamic holidays.

    Calculation method: Umm Al-Qura University, Makkah.
    Cached 30 minutes.  Use ?city=Nablus,Ramallah to filter.
    """
    cities = [c.strip() for c in city.split(",") if c.strip()] if city else None
    return await prayer_times.get_prayer_times(cities=cities)


# ═══════════════════════════════════════════════════════════════════════════════
# AIR QUALITY
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/air-quality", tags=["air-quality"])
async def air_quality_all(
    city: Optional[str] = Query(None, description="Filter by city name (English), comma-separated for multiple"),
):
    """
    Current air quality for West Bank cities via Open-Meteo (free, no key).
    Returns PM2.5, PM10, US AQI, European AQI per city, plus a region-wide summary.

    AQI categories: Good (0-50), Moderate (51-100), Unhealthy for Sensitive (101-150),
    Unhealthy (151-200), Very Unhealthy (201-300), Hazardous (301-500).

    Cached 1 hour.  Use ?city=Nablus to filter.
    """
    cities = [c.strip() for c in city.split(",") if c.strip()] if city else None
    return await air_quality.get_air_quality(cities=cities)


# ═══════════════════════════════════════════════════════════════════════════════
# INTERNET STATUS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/internet-status", tags=["internet-status"])
async def internet_status_all():
    """
    Palestine internet connectivity status via IODA (Georgia Tech).
    Free, no API key.

    Monitors three independent signals:
    - **BGP**: Visible routing prefixes — a drop means routing-level disruption
    - **ping-slash24**: External reachability probes — measures if Palestine is reachable
    - **merit-nt**: Google traffic volume — measures actual user activity

    Each source reports: current value, baseline, ratio, and status
    (normal / degraded / outage).  Overall status = worst of the three.

    Cached 5 minutes.
    """
    return await internet_status.get_internet_status()


# ═══════════════════════════════════════════════════════════════════════════════
# CONDITIONS  —  unified snapshot for dashboards
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/conditions", tags=["conditions"])
async def conditions_snapshot():
    """
    Full situational snapshot in one call — designed for dashboard consumption.

    Combines:
    - Checkpoint summary (open/closed counts, freshness)
    - Active alerts (last 2 hours)
    - Market data (currency, gold, fuel)
    - Weather for all WB cities
    - Prayer times for all WB cities
    - Air quality for all WB cities
    - Internet connectivity status

    Each section has its own cache TTL. Stale sections are flagged individually.
    Poll this every 60 seconds for a complete dashboard refresh.
    """
    # Run all fetches in parallel
    results = await asyncio.gather(
        cpdb.get_checkpoint_summary(),
        db.get_alerts(since=datetime.utcnow() - timedelta(hours=2), limit=50),
        market_data.get_all_market_data(),
        weather.get_weather(),
        prayer_times.get_prayer_times(),
        air_quality.get_air_quality(),
        internet_status.get_internet_status(),
        return_exceptions=True,
    )

    cp_summary, alerts_result, market_result, weather_result, \
        prayer_result, aq_result, inet_result = results

    # Safely unpack alerts
    active_alerts = []
    alert_count = 0
    if isinstance(alerts_result, tuple):
        active_alerts, alert_count = alerts_result
        active_alerts = [
            {
                "id": a.id, "type": a.type, "severity": a.severity,
                "title": a.title, "area": a.area,
                "timestamp": _utc_iso(a.timestamp),
            }
            for a in active_alerts[:20]  # cap at 20 for lightweight response
        ]

    def _safe(val):
        return val if isinstance(val, dict) else {"error": str(val)}

    return {
        "checkpoints":     _safe(cp_summary),
        "alerts": {
            "active_2h": active_alerts,
            "count_2h":  alert_count if isinstance(alert_count, int) else 0,
        },
        "market":          _safe(market_result),
        "weather":         _safe(weather_result),
        "prayer_times":    _safe(prayer_result),
        "air_quality":     _safe(aq_result),
        "internet_status": _safe(inet_result),
        "snapshot_at":     _utc_iso(datetime.utcnow()),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CHECKPOINT SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

# ── Checkpoints: read ─────────────────────────────────────────────────────────

@app.get("/checkpoints", response_model=CheckpointListResponse, tags=["checkpoints"])
async def list_checkpoints(
    status: Optional[str] = Query(None, description="Filter by status: open|closed|congested|slow|military"),
    region: Optional[str] = Query(None, description="Filter by region name"),
    active: bool = Query(True, description="Only checkpoints with status updates (default true)"),
    since: Optional[datetime] = Query(None, description="Only checkpoints updated after this ISO timestamp"),
):
    """
    Checkpoints with current status. By default returns only active checkpoints
    (those that have received at least one status update).

    Set ?active=false to include all directory entries.
    Use ?since= for polling — only get checkpoints updated after a timestamp.
    """
    items = await cpdb.get_all_checkpoints(
        status_filter=status, region=region,
        active_only=active, since=since,
    )
    return CheckpointListResponse(
        checkpoints=[Checkpoint(**c) for c in items],
        total=len(items),
        snapshot_at=datetime.utcnow(),
    )


@app.get("/checkpoints/closed", response_model=CheckpointListResponse, tags=["checkpoints"])
async def closed_checkpoints():
    """Shortcut — all currently closed checkpoints."""
    items = await cpdb.get_all_checkpoints(status_filter="closed")
    return CheckpointListResponse(
        checkpoints=[Checkpoint(**c) for c in items],
        total=len(items),
        snapshot_at=datetime.utcnow(),
    )


@app.get("/checkpoints/stats", response_model=CheckpointStatsResponse, tags=["checkpoints"])
async def checkpoint_stats():
    """Summary counts by status, confidence, update frequency."""
    s = await cpdb.get_checkpoint_stats()
    return CheckpointStatsResponse(
        **s,
        monitored_channel=",".join(settings.checkpoint_channel_list),
        snapshot_at=datetime.utcnow(),
    )


@app.get("/checkpoints/updates/feed", response_model=UpdateFeedResponse, tags=["checkpoints"])
async def updates_feed(
    source: Optional[str] = Query(None, description="admin | crowd"),
    checkpoint: Optional[str] = Query(None, description="Filter by canonical_key"),
    since: Optional[datetime] = Query(None, description="Only updates after this timestamp"),
    page:     int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """
    Raw update feed — every status report received, newest first.
    Use ?source=admin for admin-only, ?source=crowd for crowd-sourced.
    Use ?since= for polling — only get new updates.
    Use ?checkpoint= to filter by specific checkpoint.
    """
    offset = (page - 1) * per_page
    updates, total = await cpdb.get_updates(
        source_type=source, canonical_key=checkpoint,
        since=since, limit=per_page, offset=offset,
    )
    return UpdateFeedResponse(
        updates=[CheckpointUpdate(**u) for u in updates],
        total=total,
        page=page,
        per_page=per_page,
    )


@app.get("/checkpoints/stream", tags=["checkpoints"])
async def checkpoint_sse():
    """
    SSE stream for checkpoint status changes.
    Fires only when a checkpoint status changes.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    cp_sse_queues.append(queue)

    async def generator() -> AsyncGenerator[str, None]:
        yield 'data: {"event":"connected","channel":"checkpoints"}\n\n'
        try:
            while True:
                try:
                    payload: str = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            if queue in cp_sse_queues:
                cp_sse_queues.remove(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Checkpoints: nearby (geo) ────────────────────────────────────────────────

@app.get("/checkpoints/nearby", response_model=CheckpointListResponse, tags=["checkpoints"])
async def nearby_checkpoints(
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    radius_km: float = Query(10, ge=1, le=50, description="Search radius in km"),
    status: Optional[str] = Query(None),
):
    """
    Find checkpoints within radius_km of a point.
    Only returns checkpoints that have coordinates set.
    Results sorted by distance (nearest first).
    """
    items = await cpdb.get_checkpoints_nearby(lat, lng, radius_km, status_filter=status)
    return CheckpointListResponse(
        checkpoints=[Checkpoint(**{k: v for k, v in c.items() if k != "distance_km"}) for c in items],
        total=len(items),
        snapshot_at=datetime.utcnow(),
    )


# ── Checkpoints: GeoJSON ────────────────────────────────────────────────────

@app.get("/checkpoints/geojson", tags=["checkpoints"])
async def checkpoints_geojson(status: Optional[str] = Query(None)):
    """
    All checkpoints as a GeoJSON FeatureCollection.
    Only includes checkpoints with coordinates.
    Use for map overlays (Leaflet, Mapbox, etc.).
    """
    items = await cpdb.get_all_checkpoints(status_filter=status)
    features = []
    for c in items:
        if c.get("latitude") is None or c.get("longitude") is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [c["longitude"], c["latitude"]],
            },
            "properties": {
                "canonical_key":    c["canonical_key"],
                "name_ar":          c["name_ar"],
                "name_en":          c.get("name_en"),
                "region":           c.get("region"),
                "status":           c.get("status", "unknown"),
                "confidence":       c.get("confidence", "low"),
                "last_updated":     _utc_iso(c["last_updated"])
                                    if hasattr(c["last_updated"], "isoformat")
                                    else c["last_updated"],
                "last_source_type": c.get("last_source_type"),
            },
        })
    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "total": len(features),
            "snapshot_at": _utc_iso(datetime.utcnow()),
        },
    }


# ── Checkpoints: regions ──────────────────────────────────────────────────────

@app.get("/checkpoints/regions", tags=["checkpoints"])
async def checkpoint_regions():
    """List all regions with checkpoint counts."""
    regions = await cpdb.get_regions()
    return {"regions": regions}


@app.get("/checkpoints/summary", tags=["checkpoints"])
async def checkpoints_summary():
    """
    Lightweight snapshot for dashboard headers and status bars.
    Returns counts by status, freshness breakdown, last update time, and stale flag.

    Does NOT return individual checkpoint data — use GET /checkpoints for that.
    Designed to be polled every 30 seconds by frontends.

    Fields:
      - by_status:      { open: N, closed: N, congested: N, ... }
      - fresh_last_1h:  checkpoints updated in the last hour
      - fresh_last_6h:  checkpoints updated in the last 6 hours
      - total_active:   total checkpoints with any known status
      - last_update:    ISO timestamp of most recent checkpoint update
      - is_data_stale:  true if no updates in the last 6 hours
    """
    return await cpdb.get_checkpoint_summary()


@app.get("/checkpoints/vocab-discoveries", tags=["checkpoints"])
async def get_vocab_discoveries(
    promoted: Optional[bool] = Query(None, description="Filter by promoted status"),
    limit: int = Query(50, ge=1, le=200),
    _: str = Depends(require_key),
):
    """
    List vocabulary candidates discovered by the periodic learner.
    These are Arabic words that frequently co-occur with known status emojis
    but are not yet in the official STATUS_MAP.

    Review these periodically and add valuable ones to checkpoint_parser.py.
    Use ?promoted=false to see only pending candidates.
    """
    return await cpdb.get_vocab_discoveries(promoted=promoted, limit=limit)


# ── Admin: cleanup garbage ───────────────────────────────────────────────────

@app.post("/admin/cleanup-checkpoints", tags=["admin"])
async def cleanup_checkpoints(
    dry_run: bool = Query(True, description="Preview only, don't delete"),
    _: str = Depends(require_key),
):
    """
    Remove garbage checkpoint records (emojis in names, sentences as names, etc.).
    Use ?dry_run=true (default) to preview, ?dry_run=false to execute.
    """
    result = await cpdb.cleanup_garbage(dry_run=dry_run)
    return result


# ── Admin: seed checkpoint directory ─────────────────────────────────────────

@app.post("/admin/seed-checkpoints", tags=["admin"])
async def seed_checkpoints(_: str = Depends(require_key)):
    """
    Load known_checkpoints.json and seed the checkpoint database.
    Updates existing entries with coordinates and English names.
    """
    import json as _json
    from pathlib import Path

    seed_path = Path(__file__).resolve().parent.parent / "data" / "known_checkpoints.json"
    # Prefer bind-mounted /data path (Docker volume mount) over baked-in /app/data
    alt_path = Path("/data/known_checkpoints.json")
    if alt_path.exists():
        seed_path = alt_path
    if not seed_path.exists():
        raise HTTPException(status_code=404, detail="data/known_checkpoints.json not found")

    with open(seed_path, "r", encoding="utf-8") as f:
        data = _json.load(f)

    entries = []
    for cp in data:
        entries.append({
            "canonical_key": cp["canonical_key"],
            "name_ar": cp.get("name_ar", ""),
            "name_en": cp.get("name_en"),
            "region": cp.get("region"),
            "latitude": cp.get("latitude"),
            "longitude": cp.get("longitude"),
        })

    result = await cpdb.bulk_seed_checkpoints(entries)
    return {
        "seeded": True,
        "source": "data/known_checkpoints.json",
        "entries": len(entries),
        **result,
    }


# ── Areas: live status ──────────────────────────────────────────────────────

@app.get("/areas/status", tags=["areas"])
async def areas_status():
    """
    Live area-level security status computed from checkpoint data.
    Returns all regions with status (calm/restricted/military_presence/lockdown),
    checkpoint breakdown, severity score, and coordinates.
    """
    cached = area_mod.get_cached_area_status()
    if not cached:
        cached = await area_mod.compute_area_status()
    return {
        "areas": cached,
        "total": len(cached),
        "snapshot_at": _utc_iso(datetime.utcnow()),
    }


@app.get("/areas/status/{region}", tags=["areas"])
async def area_status_detail(region: str):
    """Single area detail by region key or English name."""
    detail = area_mod.get_area_detail(region)
    if not detail:
        raise HTTPException(status_code=404, detail=f"Area '{region}' not found")
    return detail


@app.get("/areas/stream", tags=["areas"])
async def area_sse():
    """SSE stream for area status changes. Fires when checkpoint data changes."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    area_sse_queues.append(queue)

    async def generator() -> AsyncGenerator[str, None]:
        yield 'data: {"event":"connected","channel":"areas"}\n\n'
        try:
            while True:
                try:
                    payload: str = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            if queue in area_sse_queues:
                area_sse_queues.remove(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Incidents: live grouped ─────────────────────────────────────────────────

@app.get("/incidents/live", tags=["incidents"])
async def live_incidents(
    limit: int = Query(50, ge=1, le=200),
):
    """Active grouped incidents (merged from security alerts)."""
    items = await incident_db.get_active_incidents(limit=limit)
    return {"incidents": items, "total": len(items)}


@app.get("/incidents/live/{incident_id}", tags=["incidents"])
async def live_incident_detail(incident_id: int):
    """Single incident with constituent alert IDs."""
    inc = await incident_db.get_incident(incident_id)
    if not inc:
        raise HTTPException(status_code=404, detail=f"Incident #{incident_id} not found")
    alert_ids = await incident_db.get_incident_alert_ids(incident_id)
    inc["alert_ids"] = alert_ids
    return inc


# ── Checkpoints: time-series ──────────────────────────────────────────────────

# These specific paths must be declared BEFORE the catch-all /checkpoints/{key}
# route below — FastAPI matches in declaration order.

@app.get("/checkpoints/uptime", tags=["checkpoints"])
async def checkpoints_uptime(
    from_: datetime = Query(..., alias="from"),
    to:    datetime = Query(...),
    canonical_key: Optional[str] = Query(None),
):
    """
    Uptime % per checkpoint over a time window.

    Returns, for each checkpoint, the share of the requested window spent in
    each known status (open / closed / restricted). Useful for "how often was
    checkpoint X closed last month" analyses.
    """
    if to <= from_:
        raise HTTPException(status_code=400, detail="`to` must be after `from`")
    rows = await cpdb.get_uptime_window(from_, to, canonical_key=canonical_key)
    return {
        "from": _utc_iso(from_),
        "to": _utc_iso(to),
        "checkpoints": rows,
        "total": len(rows),
    }


@app.get("/checkpoints/{key}/history", tags=["checkpoints"])
async def checkpoint_history_range(
    key: str,
    from_: Optional[datetime] = Query(None, alias="from"),
    to:    Optional[datetime] = Query(None),
    limit: int = Query(500, ge=1, le=5000),
):
    """
    Status transitions for a single checkpoint within a date range.

    `from`/`to` are optional ISO-8601 timestamps. Default returns the most
    recent `limit` transitions.
    """
    cp = await cpdb.get_checkpoint(key)
    if not cp:
        raise HTTPException(status_code=404, detail=f"Checkpoint '{key}' not found")
    history = await cpdb.get_checkpoint_history(
        key, limit=limit, from_dt=from_, to_dt=to,
    )
    return {
        "canonical_key": key,
        "from": _utc_iso(from_) if from_ else None,
        "to": _utc_iso(to) if to else None,
        "history": [CheckpointUpdate(**u).model_dump() for u in history],
        "total": len(history),
    }


# ── {key} route MUST be last — catches anything not matched above ──────────────

@app.get("/checkpoints/{key}", response_model=CheckpointHistoryResponse, tags=["checkpoints"])
async def get_checkpoint(
    key: str,
    history_limit: int = Query(50, ge=1, le=200),
):
    """
    Single checkpoint — current status + history.
    `key` is the canonical_key (Arabic name normalised with underscores).
    """
    cp = await cpdb.get_checkpoint(key)
    if not cp:
        raise HTTPException(status_code=404, detail=f"Checkpoint '{key}' not found")
    history = await cpdb.get_checkpoint_history(key, limit=history_limit)
    return CheckpointHistoryResponse(
        checkpoint=Checkpoint(**cp),
        history=[CheckpointUpdate(**u) for u in history],
        total=len(history),
    )


# ── Checkpoints: real-time WebSocket ──────────────────────────────────────────

@app.websocket("/checkpoints/ws")
async def checkpoint_ws(ws: WebSocket):
    """
    Real-time WebSocket for checkpoint status changes.

    Only fires when a checkpoint status actually changes.
    Message format:
      {
        "event": "checkpoint_update",
        "updates": [
          { canonical_key, name_raw, status, status_raw, source_type, timestamp }
        ]
      }
      { "event": "ping", "ts": "..." }
    """
    await cp_ws_manager.connect(ws)
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
                await ws.send_text(json.dumps({"event": "ack", "ts": _utc_iso(datetime.utcnow())}))
            except asyncio.TimeoutError:
                try:
                    await ws.send_text(json.dumps({"event": "ping", "ts": _utc_iso(datetime.utcnow())}))
                except Exception:
                    break
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        cp_ws_manager.disconnect(ws)


# ── Checkpoints: admin ────────────────────────────────────────────────────────

@app.patch("/checkpoints/{key}", tags=["checkpoints"])
async def update_checkpoint_meta(
    key: str,
    name_en:   Optional[str]   = Query(None),
    name_ar:   Optional[str]   = Query(None),
    region:    Optional[str]   = Query(None),
    latitude:  Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    _: str = Depends(require_key),
):
    """
    Set English name, corrected Arabic name, region, or coordinates for a checkpoint.
    Use this to build up the readable checkpoint directory over time.
    """
    cp = await cpdb.get_checkpoint(key)
    if not cp:
        raise HTTPException(status_code=404, detail=f"Checkpoint '{key}' not found")
    await cpdb.set_checkpoint_name(
        key, name_en=name_en, name_ar=name_ar, region=region,
        latitude=latitude, longitude=longitude,
    )
    return {
        "updated": key, "name_en": name_en, "name_ar": name_ar,
        "region": region, "latitude": latitude, "longitude": longitude,
    }
