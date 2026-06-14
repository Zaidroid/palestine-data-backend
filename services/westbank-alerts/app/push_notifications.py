"""
Web Push notifications (Tier-A rework, phase 3c).

Public users subscribe from the tracker PWA with a filter:
  { subscription: {endpoint, keys{p256dh, auth}},
    governorates: ["Ramallah", ...] | [] (= all),
    types: ["idf_raid", ...] | [] (= all),
    min_trust: 0.0-1.0,
    checkpoint_closures: bool }

Every dispatched alert (and checkpoint-closure event) is fanned out to
matching subscriptions via pywebpush/VAPID. Gone subscriptions (404/410)
are pruned automatically.

VAPID keys come from .env (VAPID_PRIVATE_KEY base64url raw, VAPID_CLAIMS_SUB
mailto:). Generate once:
  python -c "from py_vapid import Vapid01; v=Vapid01(); v.generate_keys(); \
             print(v.private_pem().decode())" > vapid_private.pem
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from .database import get_alerts_db
from .config import settings

log = logging.getLogger("push_notifications")

CREATE_SUBSCRIPTIONS = """
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint      TEXT UNIQUE NOT NULL,
    keys_json     TEXT NOT NULL,
    governorates  TEXT NOT NULL DEFAULT '[]',
    types         TEXT NOT NULL DEFAULT '[]',
    min_trust     REAL NOT NULL DEFAULT 0,
    checkpoint_closures INTEGER NOT NULL DEFAULT 0,
    checkpoint_keys TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL,
    last_success  TEXT,
    failures      INTEGER NOT NULL DEFAULT 0
)
"""


async def init_push_tables():
    async with get_alerts_db() as db:
        await db.execute(CREATE_SUBSCRIPTIONS)
        # migration for pre-checkpoint_keys databases
        cur = await db.execute("PRAGMA table_info(push_subscriptions)")
        cols = {row[1] for row in await cur.fetchall()}
        if "checkpoint_keys" not in cols:
            await db.execute(
                "ALTER TABLE push_subscriptions ADD COLUMN checkpoint_keys TEXT NOT NULL DEFAULT '[]'"
            )
        await db.commit()


async def add_subscription(sub: dict, governorates: list[str], types: list[str],
                           min_trust: float, checkpoint_closures: bool,
                           checkpoint_keys: list[str] | None = None) -> int:
    now = datetime.utcnow().isoformat()
    async with get_alerts_db() as db:
        cur = await db.execute(
            """INSERT INTO push_subscriptions(endpoint, keys_json, governorates, types,
                 min_trust, checkpoint_closures, checkpoint_keys, created_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(endpoint) DO UPDATE SET
                 keys_json=excluded.keys_json, governorates=excluded.governorates,
                 types=excluded.types, min_trust=excluded.min_trust,
                 checkpoint_closures=excluded.checkpoint_closures,
                 checkpoint_keys=excluded.checkpoint_keys, failures=0""",
            (sub["endpoint"], json.dumps(sub.get("keys", {})),
             json.dumps(governorates or []), json.dumps(types or []),
             float(min_trust or 0), 1 if checkpoint_closures else 0,
             json.dumps(checkpoint_keys or [], ensure_ascii=False), now),
        )
        await db.commit()
        return cur.lastrowid


async def remove_subscription(endpoint: str) -> bool:
    async with get_alerts_db() as db:
        cur = await db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint,))
        await db.commit()
        return cur.rowcount > 0


async def subscription_count() -> int:
    async with get_alerts_db() as db:
        cur = await db.execute("SELECT COUNT(*) FROM push_subscriptions")
        (n,) = await cur.fetchone()
    return n


def _vapid_ready() -> bool:
    return bool(getattr(settings, "VAPID_PRIVATE_KEY", "") and getattr(settings, "VAPID_CLAIMS_SUB", ""))


def get_vapid_public_key() -> Optional[str]:
    """Application-server public key (base64url, uncompressed point) for PushManager.subscribe."""
    if not _vapid_ready():
        return None
    try:
        import base64
        import os
        from py_vapid import Vapid01
        from cryptography.hazmat.primitives import serialization

        key = settings.VAPID_PRIVATE_KEY
        v = Vapid01.from_file(key) if os.path.exists(key) else Vapid01.from_raw(key.encode())
        raw = v.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    except Exception as e:
        log.error(f"VAPID public key derivation failed: {e}")
        return None


def _send_one(endpoint: str, keys_json: str, payload: str) -> tuple[bool, bool]:
    """Blocking send. Returns (delivered, gone)."""
    from pywebpush import webpush, WebPushException
    try:
        webpush(
            subscription_info={"endpoint": endpoint, "keys": json.loads(keys_json)},
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_CLAIMS_SUB},
            ttl=600,
        )
        return True, False
    except WebPushException as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code in (404, 410):
            return False, True
        log.warning(f"push failed ({code}): {e}")
        return False, False
    except Exception as e:
        log.warning(f"push error: {e}")
        return False, False


async def _fanout(payload: dict, match) -> int:
    """Send payload to all subscriptions where match(row) is True."""
    if not _vapid_ready():
        return 0
    async with get_alerts_db() as db:
        cur = await db.execute(
            "SELECT endpoint, keys_json, governorates, types, min_trust, checkpoint_closures, checkpoint_keys "
            "FROM push_subscriptions WHERE failures < 5"
        )
        rows = await cur.fetchall()

    if not rows:
        return 0
    data = json.dumps(payload, ensure_ascii=False)
    sent = 0
    gone: list[str] = []
    loop = asyncio.get_running_loop()
    for endpoint, keys_json, govs, types, min_trust, cp_closures, cp_keys in rows:
        try:
            if not match(json.loads(govs), json.loads(types), min_trust, bool(cp_closures), json.loads(cp_keys or "[]")):
                continue
        except Exception:
            continue
        delivered, is_gone = await loop.run_in_executor(None, _send_one, endpoint, keys_json, data)
        if delivered:
            sent += 1
        elif is_gone:
            gone.append(endpoint)
    if gone:
        async with get_alerts_db() as db:
            for ep in gone:
                await db.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (ep,))
            await db.commit()
        log.info(f"pruned {len(gone)} gone subscriptions")
    return sent


async def notify_alert(alert) -> int:
    """Push a new alert to matching subscriptions. Never raises."""
    try:
        gov = getattr(alert, "admin2", None)
        a_type = getattr(alert, "type", None) or ""
        trust = getattr(alert, "trust_score", None) or 0
        payload = {
            "kind": "alert",
            "title": getattr(alert, "title_ar", None) or getattr(alert, "title", "تنبيه"),
            "body": (getattr(alert, "raw_text", "") or getattr(alert, "body", ""))[:160],
            "governorate": gov,
            "type": a_type,
            "url": "/westbank.html",
        }

        def match(govs, types, min_trust, _cp, _cp_keys):
            if govs and (not gov or gov not in govs):
                return False
            if types and a_type not in types:
                return False
            if trust < min_trust:
                return False
            return True

        return await _fanout(payload, match)
    except Exception as e:
        log.warning(f"notify_alert failed: {e}")
        return 0


async def notify_checkpoint_closure(update: dict) -> int:
    """Push high-confidence checkpoint closures to opted-in subscriptions."""
    try:
        if update.get("status") != "closed":
            return 0
        name = update.get("name_ar") or update.get("name_raw") or update.get("canonical_key", "")
        gov_raw = update.get("governorate") or ""
        if not gov_raw:
            from .checkpoint_db import get_checkpoint_db
            async with get_checkpoint_db() as db:
                cur = await db.execute(
                    "SELECT governorate FROM checkpoints WHERE canonical_key=?",
                    (update.get("canonical_key"),),
                )
                row = await cur.fetchone()
                gov_raw = (row[0] if row else None) or ""
        payload = {
            "kind": "checkpoint",
            "title": f"إغلاق: {name}",
            "body": update.get("status_raw") or "مغلق",
            "governorate": gov_raw,
            "url": "/westbank.html",
        }

        def match(govs, _types, _min_trust, cp_closures, _cp_keys):
            if not cp_closures:
                return False
            if govs and (not gov_raw or gov_raw not in govs):
                return False
            return True

        return await _fanout(payload, match)
    except Exception as e:
        log.warning(f"notify_checkpoint_closure failed: {e}")
        return 0


async def notify_checkpoint_change(update: dict) -> int:
    """Push ANY status change of an individually watched checkpoint
    (saved-commute / watch-this-checkpoint subscriptions)."""
    try:
        key = update.get("canonical_key") or ""
        status = update.get("status") or ""
        if not key or not status:
            return 0
        name = update.get("name_ar") or update.get("name_raw") or key
        status_ar = {
            "open": "سالك", "closed": "مغلق", "congested": "أزمة",
            "slow": "بطيء", "idf": "تواجد جيش", "police": "شرطة",
            "inspection": "تفتيش",
        }.get(status, status)
        payload = {
            "kind": "watched_checkpoint",
            "title": f"{name}: {status_ar}",
            "body": update.get("status_raw") or status_ar,
            "canonical_key": key,
            "status": status,
            "url": f"/westbank.html#/map/cp/{key}",
        }

        def match(_govs, _types, _min_trust, _cp_closures, cp_keys):
            return bool(cp_keys) and key in cp_keys

        return await _fanout(payload, match)
    except Exception as e:
        log.warning(f"notify_checkpoint_change failed: {e}")
        return 0
