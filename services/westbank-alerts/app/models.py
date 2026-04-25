from pydantic import BaseModel, field_serializer
from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum


class AlertType(str, Enum):
    # Tier 1: Active missile/siren threats
    west_bank_siren = "west_bank_siren"   # Missile sirens / impacts affecting West Bank
    regional_attack = "regional_attack"   # Attacks on MENA countries or Israel proper
    gaza_strike     = "gaza_strike"       # Israeli airstrike / shelling on Gaza Strip
    # Tier 2: WB operational events
    idf_raid           = "idf_raid"           # IDF forces entering towns / raids
    settler_attack     = "settler_attack"     # Settler violence events
    road_closure       = "road_closure"       # Road/route closure (not a checkpoint)
    flying_checkpoint  = "flying_checkpoint"  # Temporary / mobile checkpoint
    injury_report      = "injury_report"      # Confirmed casualties / injuries
    demolition         = "demolition"         # Home/structure demolitions
    arrest_campaign    = "arrest_campaign"    # Mass arrest operations
    # Legacy types (kept for old DB records)
    rocket_attack  = "rocket_attack"
    idf_operation  = "idf_operation"
    airstrike      = "airstrike"
    explosion      = "explosion"
    shooting       = "shooting"
    general        = "general"


class Severity(str, Enum):
    critical = "critical"   # Active threat in YOUR configured city
    high     = "high"       # Confirmed attack anywhere in West Bank
    medium   = "medium"     # Nearby, unconfirmed, or movement reports
    low      = "low"        # General security updates, movements


def _serialize_datetime(dt: datetime) -> str:
    """Serialize datetime to ISO format with Z suffix to indicate UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class Alert(BaseModel):
    id: Optional[int] = None
    type: AlertType
    severity: Severity
    title: str
    title_ar: Optional[str] = None      # Arabic title for RTL display
    body: str
    source: str                       # Telegram channel username
    source_msg_id: Optional[int] = None
    area: Optional[str] = None        # Extracted city/camp name
    zone: Optional[str] = None        # WB sub-zone: north, middle, south
    raw_text: str
    timestamp: datetime               # Original Telegram message time (UTC)
    created_at: Optional[datetime] = None
    event_subtype: Optional[str] = None  # e.g. 'arrest', 'search', 'stone_throwing'
    latitude: Optional[float] = None  # Resolved latitude (point/town/zone/region per geo_precision)
    longitude: Optional[float] = None
    geo_precision: Optional[str] = None      # "checkpoint" | "town" | "zone" | "region"
    geo_source_phrase: Optional[str] = None  # Text that resolved the coords (for debugging + learner)
    confidence: Optional[float] = None       # 0.0-1.0 — classifier+source-weighted score
    source_reliability: Optional[float] = None  # 0.0-1.0 — channel-level baseline trust
    status: Optional[str] = "active"         # active | retracted | corrected
    correction_note: Optional[str] = None    # Set when status != active

    @field_serializer('timestamp', 'created_at')
    def serialize_dt(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        return _serialize_datetime(dt)

    class Config:
        use_enum_values = True


class AlertResponse(BaseModel):
    alerts: List[Alert]
    total: int
    page: int
    per_page: int


class WebhookTarget(BaseModel):
    id: Optional[int] = None
    url: str
    secret: Optional[str] = None
    active: bool = True
    alert_types: Optional[str] = None   # comma-separated or None for all
    min_severity: Optional[str] = None
    areas: Optional[str] = None              # comma-separated area names (case-insensitive)
    zones: Optional[str] = None              # comma-separated WB zones: north, middle, south
    confidence_min: Optional[float] = None   # 0.0-1.0 — skip alerts below this score
    customer_key_id: Optional[int] = None    # FK to keys.db (future per-tenant enforcement)
    created_at: Optional[datetime] = None


class StatsResponse(BaseModel):
    total_alerts: int
    alerts_last_24h: int
    alerts_last_hour: int
    by_type: dict
    by_severity: dict
    by_area: dict
    monitored_channels: List[str]
    uptime_seconds: float
