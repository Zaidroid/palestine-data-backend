"""
Telegram monitor — polling-based.

Handles two channel types:
  - Security alert channels  → security classifier  → alerts DB
  - Checkpoint channel       → checkpoint parser    → checkpoints DB

Polling bypasses Telethon's MTProto timestamp check which silently drops
messages when there is clock skew between the container and Telegram servers.
"""

import asyncio
import logging
from datetime import datetime
from typing import Callable, List, Optional, Set

from telethon import TelegramClient
from telethon.tl.types import ChannelParticipantsAdmins

from .classifier import classify, is_security_relevant, classify_wb_operational
from .checkpoint_parser import is_admin_message, parse_message
from .checkpoint_matcher import load_checkpoint_index, match_message, get_index
from .checkpoint_whitelist_parser import parse_message_whitelist
from .checkpoint_knowledge_base import get_knowledge_base
from .config import settings
from .database import duplicate_check, content_duplicate_check, get_channels, insert_alert, prune_alerts_if_needed
from .checkpoint_db import (
    duplicate_check_cp, insert_checkpoint_update, upsert_checkpoint_status
)
from .models import Alert

log = logging.getLogger("monitor")

POLL_INTERVAL = 5

_broadcast_alert_fn:      Optional[Callable] = None
_broadcast_checkpoint_fn: Optional[Callable] = None

client: Optional[TelegramClient] = None
_admin_ids: Set[int] = set()

# ── Monitor stats ─────────────────────────────────────────────────────────────

_stats: dict = {
    "connected":        False,
    "last_message_at":  None,
    "messages_today":   0,
    "alerts_today":     0,
    "cp_updates_today": 0,
    "_stats_date":      None,  # track which day the counters belong to
}


def get_stats() -> dict:
    _maybe_reset_daily()
    return {k: v for k, v in _stats.items() if not k.startswith("_")}


def _maybe_reset_daily():
    today = datetime.utcnow().date().isoformat()
    if _stats["_stats_date"] != today:
        _stats["messages_today"] = 0
        _stats["alerts_today"] = 0
        _stats["cp_updates_today"] = 0
        _stats["_stats_date"] = today


def _record_message(is_alert: bool = False, is_cp: bool = False):
    _maybe_reset_daily()
    _stats["last_message_at"] = datetime.utcnow().isoformat()
    _stats["messages_today"] += 1
    if is_alert:
        _stats["alerts_today"] += 1
    if is_cp:
        _stats["cp_updates_today"] += 1


def set_broadcast_fn(fn: Callable):
    global _broadcast_alert_fn
    _broadcast_alert_fn = fn


def set_checkpoint_broadcast_fn(fn: Callable):
    global _broadcast_checkpoint_fn
    _broadcast_checkpoint_fn = fn


def get_client() -> Optional[TelegramClient]:
    """Expose the authenticated Telegram client for reuse (e.g. history analyzer)."""
    return client


# ── Security alert pipeline ───────────────────────────────────────────────────

async def _process_security_message(message, channel_username: str):
    raw = (message.message or "").strip()
    if len(raw) < 10:
        return

    if await duplicate_check(channel_username, message.id):
        return

    # Content-based dedup: catch repeated messages with slight variations
    if await content_duplicate_check(raw):
        log.debug(f"CONTENT_DUP @{channel_username}: {raw[:80]}")
        return

    classified = None

    # Tier 1: missile/siren/regional attacks
    if is_security_relevant(raw):
        classified = classify(raw, channel_username)

    # Tier 2: WB operational events (raids, settler attacks, road closures, etc.)
    if classified is None:
        classified = classify_wb_operational(raw, channel_username)

    if classified is None:
        log.debug(f"DISCARD @{channel_username}: {raw[:80]}")
        return

    alert = Alert(
        **classified,
        source_msg_id=message.id,
        timestamp=(
            message.date.replace(tzinfo=None)
            if message.date else datetime.utcnow()
        ),
    )
    alert = await insert_alert(alert)
    log.info(
        f"[ALERT/{alert.severity.upper()}] {alert.title} "
        f"(source: @{channel_username}, area: {alert.area})"
    )
    _record_message(is_alert=True)
    if _broadcast_alert_fn:
        await _broadcast_alert_fn(alert)


# ── Checkpoint pipeline ───────────────────────────────────────────────────────

async def _process_checkpoint_message(message, channel_username: str):
    raw = (message.message or "").strip()
    if len(raw) < 2:
        return

    # Determine if sender is admin
    sender_id = getattr(message, "sender_id", None) or getattr(message, "from_id", None)
    if hasattr(sender_id, "user_id"):
        sender_id = sender_id.user_id

    if _admin_ids and sender_id:
        is_admin = sender_id in _admin_ids
    else:
        is_admin = is_admin_message(raw)

    # NEW: Use whitelist-first parsing (strict validation against known checkpoints)
    kb = get_knowledge_base()
    if kb:
        updates = parse_message_whitelist(raw, kb)
    else:
        # Fallback to old parser if knowledge base isn't loaded yet
        log.warning("[CHECKPOINT] Knowledge base not loaded, using fallback parser")
        index = get_index()
        if index:
            updates = match_message(raw, index)
        else:
            updates = parse_message(raw, is_admin=is_admin)

    if not updates:
        log.debug(
            f"[CHECKPOINT/NOMATCH] @{channel_username} msg={message.id}: "
            f"{raw[:80]!r}"
        )
        return

    source_type = "admin" if is_admin else "crowd"
    log.info(
        f"[CHECKPOINT/{source_type.upper()}] "
        f"@{channel_username} msg={message.id}: "
        f"{len(updates)} checkpoint(s) matched"
    )

    changed_checkpoints = []
    for upd in updates:
        if await duplicate_check_cp(channel_username, message.id, upd["canonical_key"]):
            continue

        upd["source_type"]    = source_type
        upd["source_channel"] = channel_username
        upd["source_msg_id"]  = message.id
        upd["raw_message"]    = raw
        upd["timestamp"]      = (
            message.date.replace(tzinfo=None)
            if message.date else datetime.utcnow()
        )

        await insert_checkpoint_update(upd)
        result = await upsert_checkpoint_status(upd, is_admin=is_admin, channel=channel_username)

        log.info(
            f"  {upd['name_raw']} → {upd['status']} "
            f"(raw: {upd.get('status_raw')}) [{result}]"
        )

        changed_checkpoints.append(upd)

    if changed_checkpoints and _broadcast_checkpoint_fn:
        await _broadcast_checkpoint_fn(changed_checkpoints)

    if updates:
        _record_message(is_cp=True)


# ── Polling loop ──────────────────────────────────────────────────────────────

async def _poll_channel(entity, username: str, last_id: dict, is_checkpoint: bool) -> int:
    """
    Fetch ALL new messages since last_id[username] using min_id parameter.
    Telethon's min_id fetches only messages with id > min_id — no burst is missed.
    Returns the count of messages processed.
    """
    try:
        current_last = last_id.get(username, 0)
        messages = await client.get_messages(entity, limit=200, min_id=current_last)
        if not messages:
            return 0

        # Process oldest-first so DB ordering is consistent
        processed = 0
        new_max = current_last
        for msg in reversed(messages):
            if msg.id <= current_last:
                continue
            new_max = max(new_max, msg.id)
            processed += 1
            if is_checkpoint:
                await _process_checkpoint_message(msg, username)
            else:
                await _process_security_message(msg, username)

        if new_max > current_last:
            last_id[username] = new_max
            if processed > 0:
                log.info(
                    f"[POLL] @{username}: +{processed} msg(s) "
                    f"(id {current_last}→{new_max})"
                )
        return processed
    except Exception as e:
        log.warning(f"Poll error @{username}: {e}")
        return 0


async def _fetch_admin_ids(entity, label: str):
    global _admin_ids
    try:
        admins = await client.get_participants(entity, filter=ChannelParticipantsAdmins())
        _admin_ids = {u.id for u in admins}
        log.info(f"Cached {len(_admin_ids)} admin IDs for {label}")
    except Exception as e:
        log.warning(f"Could not fetch admin list for {label}: {e}. Using structural detection.")


# ── Entry point ───────────────────────────────────────────────────────────────

async def start():
    global client

    if not settings.TELEGRAM_API_ID or not settings.TELEGRAM_API_HASH:
        log.warning("Telegram credentials not set. Monitor disabled.")
        return

    client = TelegramClient(
        settings.session_path,
        settings.TELEGRAM_API_ID,
        settings.TELEGRAM_API_HASH,
    )

    try:
        await client.start()
    except Exception as e:
        log.error(f"Telegram auth failed: {e}. Run setup_session.py first.")
        return

    me = await client.get_me()
    log.info(f"Telegram authenticated as {me.first_name} (+{me.phone})")
    _stats["connected"] = True

    # Build channel map: username → (entity, is_checkpoint)
    channel_map: dict[str, tuple] = {}

    # Security alert channels
    security_channels = await get_channels()
    for ch in security_channels:
        try:
            entity = await client.get_entity(ch)
            channel_map[ch.lower()] = (entity, False)
            log.info(f"Resolved security channel @{ch} → id={entity.id}")
        except Exception as e:
            log.warning(f"Could not resolve @{ch}: {e}")

    # Checkpoint channels (supports comma-separated list)
    for cp_ch in settings.checkpoint_channel_list:
        try:
            cp_entity = await client.get_entity(cp_ch)
            channel_map[cp_ch.lower()] = (cp_entity, True)
            log.info(f"Resolved checkpoint channel @{cp_ch} → id={cp_entity.id}")
            await _fetch_admin_ids(cp_entity, f"@{cp_ch}")
        except Exception as e:
            log.warning(f"Could not resolve checkpoint channel @{cp_ch}: {e}")

    if not channel_map:
        log.error("No channels resolved. Check .env")
        return

    # Load checkpoint name index for entity matching
    try:
        idx = await load_checkpoint_index()
        log.info(f"Checkpoint matcher ready: {idx.size} checkpoints indexed")
    except Exception as e:
        log.warning(f"Could not load checkpoint index: {e}. Using parser-only mode.")

    # Seed last_id to avoid replaying history on startup
    last_id: dict = {}
    for username, (entity, _) in channel_map.items():
        try:
            msgs = await client.get_messages(entity, limit=1)
            last_id[username] = msgs[0].id if msgs else 0
            log.info(f"@{username} — starting from msg id={last_id[username]}")
        except Exception as e:
            last_id[username] = 0
            log.warning(f"Could not seed last_id @{username}: {e}")

    log.info(
        f"Polling {len(channel_map)} channel(s) every {POLL_INTERVAL}s: "
        f"{list(channel_map.keys())}"
    )

    _cycle_count = 0
    _consecutive_errors = 0
    while True:
        _cycle_count += 1

        # Auto-reconnect if Telegram connection dropped
        if not client.is_connected():
            log.warning("Telegram disconnected — reconnecting...")
            try:
                await client.connect()
                _consecutive_errors = 0
                log.info("Telegram reconnected successfully")
            except Exception as e:
                log.error(f"Reconnect failed: {e}. Retrying in 30s...")
                await asyncio.sleep(30)
                continue

        for username, (entity, is_cp) in channel_map.items():
            result = await _poll_channel(entity, username, last_id, is_cp)
            if result == 0 and not client.is_connected():
                _consecutive_errors += 1
            else:
                _consecutive_errors = 0

        # Force reconnect after 10 consecutive failed cycles
        if _consecutive_errors >= 10:
            log.warning(f"[RECONNECT] {_consecutive_errors} failed cycles — forcing reconnect")
            try:
                await client.disconnect()
            except Exception:
                pass
            try:
                await client.connect()
                _consecutive_errors = 0
                log.info("Telegram force-reconnected successfully")
            except Exception as e:
                log.error(f"Force reconnect failed: {e}")

        # Heartbeat log every 60 cycles (~5 minutes)
        if _cycle_count % 60 == 0:
            log.info(
                f"[HEARTBEAT] cycle={_cycle_count} "
                f"msgs_today={_stats['messages_today']} "
                f"alerts={_stats['alerts_today']} "
                f"cp_updates={_stats['cp_updates_today']}"
            )
            await prune_alerts_if_needed()
        await asyncio.sleep(POLL_INTERVAL)


async def get_active_channels() -> List[str]:
    return await get_channels()


async def stop():
    global client
    if client and client.is_connected():
        await client.disconnect()
        log.info("Telegram client disconnected")
