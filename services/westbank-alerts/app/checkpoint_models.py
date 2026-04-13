from pydantic import BaseModel, field_serializer
from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum


class CheckpointStatus(str, Enum):
    open      = "open"
    closed    = "closed"
    congested = "congested"
    slow      = "slow"
    military  = "military"
    unknown   = "unknown"


class CheckpointType(str, Enum):
    checkpoint     = "checkpoint"      # Military checkpoint (حاجز)
    gate           = "gate"            # Gate / barrier (بوابة)
    police         = "police"          # Israeli police station (شرطة)
    traffic_signal = "traffic_signal"  # Traffic signals / junction (اشارات)
    roundabout     = "roundabout"      # Roundabout (دوار)
    bridge         = "bridge"          # Bridge / overpass (جسر)
    entrance       = "entrance"        # Town/village entrance (مدخل)
    bypass_road    = "bypass_road"     # Bypass / alternative road (التفافي)
    tunnel         = "tunnel"          # Tunnel (نفق)
    crossing       = "crossing"        # Border crossing point


class Direction(str, Enum):
    inbound  = "inbound"   # الداخل — entering / going in
    outbound = "outbound"  # الخارج — leaving / going out
    both     = "both"      # بالاتجاهين — both directions


class Confidence(str, Enum):
    high   = "high"    # from admin message
    medium = "medium"  # multiple crowd reports agree
    low    = "low"     # single crowd report


def _serialize_datetime(dt: datetime) -> str:
    """Serialize datetime to ISO format with Z suffix to indicate UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class Checkpoint(BaseModel):
    canonical_key:    str
    name_ar:          str
    name_en:          Optional[str] = None
    region:           Optional[str] = None
    checkpoint_type:  Optional[str] = "checkpoint"
    latitude:         Optional[float] = None
    longitude:        Optional[float] = None
    status:           str
    status_raw:       Optional[str] = None
    direction:        Optional[str] = None    # inbound | outbound | both | null
    confidence:       str
    crowd_reports_1h: int = 0
    last_updated:     datetime
    last_source_type: Optional[str] = None
    last_active_hours: Optional[float] = None
    is_stale:          bool = False

    @field_serializer('last_updated')
    def serialize_last_updated(self, dt: datetime) -> str:
        return _serialize_datetime(dt)

    class Config:
        use_enum_values = True


class CheckpointUpdate(BaseModel):
    id:             Optional[int] = None
    canonical_key:  str
    name_raw:       str
    status:         str
    status_raw:     Optional[str] = None
    direction:      Optional[str] = None    # inbound | outbound | both | null
    source_type:    str          # admin | crowd
    source_channel: str
    source_msg_id:  Optional[int] = None
    raw_line:       Optional[str] = None
    raw_message:    Optional[str] = None
    timestamp:      datetime
    created_at:     Optional[datetime] = None

    @field_serializer('timestamp', 'created_at')
    def serialize_dt(self, dt: Optional[datetime]) -> Optional[str]:
        if dt is None:
            return None
        return _serialize_datetime(dt)


class CheckpointListResponse(BaseModel):
    checkpoints: List[Checkpoint]
    total:       int
    snapshot_at: datetime

    @field_serializer('snapshot_at')
    def serialize_snapshot_at(self, dt: datetime) -> str:
        return _serialize_datetime(dt)


class CheckpointHistoryResponse(BaseModel):
    checkpoint:  Checkpoint
    history:     List[CheckpointUpdate]
    total:       int


class UpdateFeedResponse(BaseModel):
    updates:  List[CheckpointUpdate]
    total:    int
    page:     int
    per_page: int


class CheckpointStatsResponse(BaseModel):
    total_checkpoints: int
    total_directory:   int = 0
    total_with_geo:    int = 0
    by_status:         dict
    by_confidence:     dict
    by_type:           dict = {}
    updates_last_1h:   int
    updates_last_24h:  int
    admin_updates_24h: int
    monitored_channel: str
    snapshot_at:       datetime

    @field_serializer('snapshot_at')
    def serialize_snapshot_at(self, dt: datetime) -> str:
        return _serialize_datetime(dt)
