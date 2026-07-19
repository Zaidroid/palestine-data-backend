from pydantic_settings import BaseSettings
from typing import List
import os
import sys


class Settings(BaseSettings):
    # Web Push (VAPID) — empty disables push silently
    VAPID_PRIVATE_KEY: str = ""      # path to PEM or base64url raw key
    VAPID_CLAIMS_SUB: str = ""       # e.g. mailto:zsalem33@gmail.com

    # Telegram
    TELEGRAM_API_ID: int = 0
    TELEGRAM_API_HASH: str = ""
    TELEGRAM_PHONE: str = ""
    TELEGRAM_SESSION_DIR: str = "/session"
    TELEGRAM_CHANNELS: str = ""          # comma-separated usernames

    # Location priority
    YOUR_CITY_AR: str = "نابلس"
    YOUR_CITY_EN: str = "Nablus"

    # API
    API_PORT: int = 8080
    API_SECRET_KEY: str = ""

    # Storage
    DB_PATH: str = "/data/alerts.db"
    MAX_ALERTS_STORED: int = 0  # 0 = never prune (keep full alert history)

    # Checkpoint channels (comma-separated usernames without @)
    CHECKPOINT_CHANNELS: str = ""

    # Gaza daily bulletin channels (MoH casualty reports, etc.)
    GAZA_BULLETIN_CHANNELS: str = ""

    # Webhooks
    WEBHOOK_TIMEOUT: int = 8
    WEBHOOK_MAX_RETRIES: int = 3

    # Checkpoint staleness threshold — checkpoints older than this are marked stale
    CHECKPOINT_STALE_HOURS: float = 6.0

    # Incident grouping
    INCIDENT_MERGE_WINDOW_HOURS: float = 2.0
    INCIDENT_AUTO_RESOLVE_HOURS: float = 4.0

    # F10 — Tesseract Arabic OCR for media-only Telegram posts. Off by
    # default — operator should benchmark before enabling. When true,
    # _process_security_message downloads the message media, OCRs it,
    # and feeds the extracted text through the classifier.
    OCR_ENABLED: bool = False
    OCR_TIMEOUT_SECONDS: float = 10.0
    OCR_MAX_PIXELS: int = 4_000_000  # Skip very large images (latency cap)

    # ── MiniMax LLM (hybrid extraction / news clustering / candidate vetting) ──
    # Off by default; the deterministic rule/whitelist pipeline always runs first
    # and the LLM is a fallback/enrichment tier that fails safe to rules.
    MINIMAX_ENABLED: bool = False
    MINIMAX_BASE_URL: str = "https://api.minimax.io/v1"
    MINIMAX_API_KEY: str = ""
    MINIMAX_MODEL: str = "MiniMax-Text-01"   # reliable for Arabic; M3 garbles numbers
    MINIMAX_TIMEOUT_S: float = 20.0
    MINIMAX_DAILY_BUDGET: int = 0            # 0 = unlimited (subscription has generous limits)

    # ── Routing (self-hosted Valhalla on the Palestine OSM extract) ──
    # Dark-launchable: ROUTING_ENABLED gates the /v2/route endpoint so the engine can
    # be deployed and tiles built before the frontend is switched over.
    ROUTING_ENABLED: bool = False
    VALHALLA_URL: str = "http://valhalla:8002"
    ROUTE_CORRIDOR_M: float = 400.0          # "actually on this road" threshold. Wider (e.g. 1000)
                                             # sweeps in village-access gates ~800m off the highway as
                                             # false positives; city-entry gates are covered separately
                                             # by the gateway advisory, so the corridor stays tight.
    ROUTE_EXCLUDE_BOX_M: float = 200.0       # avoid-polygon size around a closed checkpoint

    # ── Checkpoint self-improvement (candidate → vet → review → promote) ──
    CANDIDATE_MIN_MENTIONS: int = 5          # min corpus mentions before a candidate is vetted
    CANDIDATE_MIN_CONFIDENCE: float = 0.9    # LLM confidence required for auto-promotion
    CANDIDATE_AUTO_PROMOTE: bool = False     # ship review-only; enable after observing precision

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def channel_list(self) -> List[str]:
        return [c.strip() for c in self.TELEGRAM_CHANNELS.split(",") if c.strip()]

    @property
    def checkpoint_channel_list(self) -> List[str]:
        return [c.strip().lstrip("@") for c in self.CHECKPOINT_CHANNELS.split(",") if c.strip()]

    @property
    def gaza_bulletin_channel_list(self) -> List[str]:
        return [c.strip().lstrip("@") for c in self.GAZA_BULLETIN_CHANNELS.split(",") if c.strip()]

    @property
    def session_path(self) -> str:
        os.makedirs(self.TELEGRAM_SESSION_DIR, exist_ok=True)
        return os.path.join(self.TELEGRAM_SESSION_DIR, "wb_alerts")


settings = Settings()


# ── Startup validation ────────────────────────────────────────────────────────
# API_SECRET_KEY must be a real, sufficiently-long secret set via env or .env.
# We refuse to boot with the old dev default or an empty value, so a misconfigured
# deploy fails loudly instead of shipping with a publicly-known admin key.
_FORBIDDEN_API_KEYS = {"", "dev-secret-change-me", "changeme", "change-me", "secret"}
if settings.API_SECRET_KEY in _FORBIDDEN_API_KEYS or len(settings.API_SECRET_KEY) < 16:
    sys.stderr.write(
        "FATAL: API_SECRET_KEY must be set to a real secret of at least 16 characters.\n"
        "Edit services/westbank-alerts/.env and set API_SECRET_KEY=<32+ random chars>, "
        "then run `docker compose up -d --force-recreate alerts`.\n"
    )
    sys.exit(1)
