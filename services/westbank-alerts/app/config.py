from pydantic_settings import BaseSettings
from typing import List
import os
import sys


class Settings(BaseSettings):
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
    CHECKPOINT_STALE_HOURS: float = 12.0

    # Incident grouping
    INCIDENT_MERGE_WINDOW_HOURS: float = 2.0
    INCIDENT_AUTO_RESOLVE_HOURS: float = 4.0

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
