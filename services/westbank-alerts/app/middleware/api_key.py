"""
API-key tagging middleware — mirrors src/api/middleware/apiKey.js on the Node side.

Reads Authorization: Bearer pdb_live_<32-hex>, looks the hashed key up in the
shared SQLite registry (mounted read-only at $KEYS_DB_PATH), and attaches a
`customer` object to request.state for downstream handlers / metering.

Non-enforcing: missing or unknown keys resolve to the anonymous tier. Paid-route
enforcement will layer on top of this in Phase C.
"""

import hashlib
import logging
import os
import sqlite3
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp

log = logging.getLogger("api.apikey")

_BEARER_PREFIX = "Bearer pdb_live_"
_HEX_LEN = 32  # 32 hex chars after the prefix
_ANON = {"tier": "anonymous"}


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _extract_raw_key(header: str) -> Optional[str]:
    if not header.startswith(_BEARER_PREFIX):
        return None
    raw = header[len("Bearer ") :]
    # Must match pdb_live_<32 hex chars>
    if len(raw) != len("pdb_live_") + _HEX_LEN:
        return None
    suffix = raw[len("pdb_live_") :]
    if any(c not in "0123456789abcdef" for c in suffix.lower()):
        return None
    return raw


def _lookup(db_path: str, raw: str) -> Optional[dict]:
    if not db_path or not os.path.exists(db_path):
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=0.5)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, customer_id, tier, active FROM api_keys WHERE key_hash = ?",
            (_hash(raw),),
        ).fetchone()
        conn.close()
        if row and row["active"]:
            return {
                "id": row["customer_id"],
                "key_id": row["id"],
                "tier": row["tier"],
            }
    except Exception as e:
        log.warning("api_key lookup failed: %s", e)
    return None


class ApiKeyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, db_path: Optional[str] = None):
        super().__init__(app)
        self.db_path = db_path or os.getenv("KEYS_DB_PATH", "/app/data/keys.db")

    async def dispatch(self, request: Request, call_next):
        header = request.headers.get("authorization", "")
        raw = _extract_raw_key(header)
        record = _lookup(self.db_path, raw) if raw else None
        request.state.customer = record or _ANON
        return await call_next(request)
