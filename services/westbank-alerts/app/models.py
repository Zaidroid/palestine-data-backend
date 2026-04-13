from pydantic import BaseModel, field_serializer
from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum


class AlertType(str, Enum):
    # Tier 1: Active missile/siren threats
    west_bank_siren = "west_bank_siren"   # Missile sirens / impacts affecting West Bank
    regional_attack = "regional_attack"   # Attacks on MENA countries or Israel proper
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
    latitude: Optional[float] = None  # Zone center latitude (for map display)
    longitude: Optional[float] = None  # Zone center longitude (for map display)

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
