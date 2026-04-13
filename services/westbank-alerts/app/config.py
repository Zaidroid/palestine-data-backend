from pydantic_settings import BaseSettings
from typing import List
import os


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
    API_SECRET_KEY: str = "dev-secret-change-me"

    # Storage
    DB_PATH: str = "/data/alerts.db"
    MAX_ALERTS_STORED: int = 20000

    # Checkpoint channels (comma-separated usernames without @)
    CHECKPOINT_CHANNELS: str = ""

    # Webhooks
    WEBHOOK_TIMEOUT: int = 8
    WEBHOOK_MAX_RETRIES: int = 3

    # Checkpoint staleness threshold — checkpoints older than this are marked stale
    CHECKPOINT_STALE_HOURS: float = 12.0

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
    def session_path(self) -> str:
        os.makedirs(self.TELEGRAM_SESSION_DIR, exist_ok=True)
        return os.path.join(self.TELEGRAM_SESSION_DIR, "wb_alerts")


settings = Settings()
