"""
Checkpoint History Analyzer — bulk extraction tool.

Fetches historical messages from the checkpoint Telegram channel, runs them
through the parser (word-based + emoji-based), and builds a comprehensive
checkpoint directory.

Usage:
  # Analyze last 2000 messages and output JSON
  python -m app.history_analyzer --limit 2000 --output data/checkpoint_directory.json

  # Analyze last 7 days
  python -m app.history_analyzer --days 7 --output data/checkpoint_directory.json

  # Analyze and seed the database directly
  python -m app.history_analyzer --limit 2000 --seed-db

  # Both: output JSON + seed DB
  python -m app.history_analyzer --limit 5000 --output data/checkpoint_directory.json --seed-db
"""

import asyncio
import argparse
import json
import logging
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Add project root to path for standalone execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from telethon import TelegramClient
from telethon.tl.types import ChannelParticipantsAdmins

from app.checkpoint_parser import (
    parse_message, parse_line, parse_emoji_line,
    is_admin_message, make_canonical_key, _has_status_emoji,
)
from app.config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("history_analyzer")


class CheckpointEntry:
    """Accumulates data for a single checkpoint across many messages."""

    def __init__(self, canonical_key: str, name_raw: str):
        self.canonical_key = canonical_key
        self.name_variants: dict[str, int] = defaultdict(int)  # raw_name → count
        self.name_variants[name_raw] += 1
        self.total_mentions = 1
        self.admin_mentions = 0
        self.crowd_mentions = 0
        self.status_counts: dict[str, int] = defaultdict(int)
        self.last_status: Optional[str] = None
        self.first_seen: Optional[datetime] = None
        self.last_seen: Optional[datetime] = None
        self.sample_messages: list[str] = []

    def add_mention(self, name_raw: str, status: str, source_type: str,
                    timestamp: Optional[datetime] = None, raw_message: str = ""):
        self.name_variants[name_raw] += 1
        self.total_mentions += 1
        self.status_counts[status] += 1
        self.last_status = status

        if source_type == "admin":
            self.admin_mentions += 1
        else:
            self.crowd_mentions += 1

        if timestamp:
            if self.first_seen is None or timestamp < self.first_seen:
                self.first_seen = timestamp
            if self.last_seen is None or timestamp > self.last_seen:
                self.last_seen = timestamp

        if raw_message and len(self.sample_messages) < 3:
            truncated = raw_message[:200]
            if truncated not in self.sample_messages:
                self.sample_messages.append(truncated)

    @property
    def most_common_name(self) -> str:
        return max(self.name_variants, key=self.name_variants.get)

    def to_dict(self) -> dict:
        return {
            "canonical_key": self.canonical_key,
            "name_ar": self.most_common_name,
            "name_variants": dict(self.name_variants),
            "total_mentions": self.total_mentions,
            "admin_mentions": self.admin_mentions,
            "crowd_mentions": self.crowd_mentions,
            "status_distribution": dict(self.status_counts),
            "last_status": self.last_status,
            "first_seen": self.first_seen.isoformat() if self.first_seen else None,
            "last_seen": self.last_seen.isoformat() if self.last_seen else None,
            "sample_messages": self.sample_messages,
        }


async def analyze_channel(
    limit: int = 2000,
    days: Optional[int] = None,
    channel: Optional[str] = None,
) -> dict:
    """
    Fetch messages from the checkpoint channel and extract all checkpoint data.

    Args:
        limit: Max messages to fetch (default 2000)
        days: If set, only fetch messages from last N days
        channel: Channel username override (default from settings)

    Returns dict with:
        - checkpoints: list of checkpoint entries
        - stats: analysis summary
    """
    channel = channel or (settings.checkpoint_channel_list[0] if settings.checkpoint_channel_list else "")
    if not channel:
        log.error("No checkpoint channel configured. Set CHECKPOINT_CHANNELS in .env")
        return {"checkpoints": [], "stats": {"error": "No channel configured"}}

    api_id = settings.TELEGRAM_API_ID
    api_hash = settings.TELEGRAM_API_HASH

    if not api_id or not api_hash:
        log.error("Telegram credentials not set.")
        return {"checkpoints": [], "stats": {"error": "No Telegram credentials"}}

    # Determine session path — handle running outside Docker
    session_dir = settings.TELEGRAM_SESSION_DIR
    if not os.path.isdir(session_dir):
        # Fallback to local ./session/ when not in Docker
        local_session = str(Path(__file__).resolve().parent.parent / "session")
        if os.path.isdir(local_session):
            session_dir = local_session
        else:
            os.makedirs(local_session, exist_ok=True)
            session_dir = local_session
    session_path = os.path.join(session_dir, "wb_alerts_analyzer")

    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()
    me = await client.get_me()
    log.info(f"Authenticated as {me.first_name} (+{me.phone})")

    try:
        entity = await client.get_entity(channel)
        log.info(f"Resolved @{channel} → id={entity.id}")
    except Exception as e:
        log.error(f"Could not resolve @{channel}: {e}")
        await client.disconnect()
        return {"checkpoints": [], "stats": {"error": f"Channel not found: {e}"}}

    # Fetch admin IDs for accurate admin detection
    admin_ids: set[int] = set()
    try:
        admins = await client.get_participants(entity, filter=ChannelParticipantsAdmins())
        admin_ids = {u.id for u in admins}
        log.info(f"Cached {len(admin_ids)} admin IDs")
    except Exception as e:
        log.warning(f"Could not fetch admin list: {e}. Using structural detection.")

    # Determine fetch parameters
    offset_date = None
    if days:
        offset_date = datetime.utcnow() - timedelta(days=days)
        log.info(f"Fetching messages since {offset_date.isoformat()}")

    # Fetch messages in batches
    all_messages = []
    batch_size = min(limit, 100)
    offset_id = 0
    total_fetched = 0

    log.info(f"Fetching up to {limit} messages from @{channel}...")

    while total_fetched < limit:
        remaining = limit - total_fetched
        fetch_count = min(batch_size, remaining)

        messages = await client.get_messages(
            entity,
            limit=fetch_count,
            offset_id=offset_id,
            offset_date=offset_date,
        )

        if not messages:
            break

        all_messages.extend(messages)
        offset_id = messages[-1].id
        total_fetched += len(messages)

        if len(messages) < fetch_count:
            break  # No more messages

        log.info(f"  Fetched {total_fetched}/{limit} messages...")
        await asyncio.sleep(0.5)  # Be kind to Telegram rate limits

    log.info(f"Total messages fetched: {len(all_messages)}")
    await client.disconnect()

    # ── Analyze messages ──────────────────────────────────────────────────

    checkpoint_map: dict[str, CheckpointEntry] = {}
    parsed_count = 0
    skipped_count = 0
    emoji_parsed_count = 0
    word_parsed_count = 0

    for msg in all_messages:
        raw = (msg.message or "").strip()
        if len(raw) < 2:
            skipped_count += 1
            continue

        # Determine admin status
        sender_id = getattr(msg, "sender_id", None) or getattr(msg, "from_id", None)
        if hasattr(sender_id, "user_id"):
            sender_id = sender_id.user_id

        if admin_ids and sender_id:
            is_admin = sender_id in admin_ids
        else:
            is_admin = is_admin_message(raw)

        source_type = "admin" if is_admin else "crowd"
        msg_ts = msg.date.replace(tzinfo=None) if msg.date else None

        # Parse the message
        updates = parse_message(raw, is_admin=is_admin)

        if not updates:
            skipped_count += 1
            continue

        parsed_count += 1

        for upd in updates:
            key = upd["canonical_key"]
            name_raw = upd["name_raw"]
            status = upd["status"]

            # Track parsing method
            if upd.get("status_raw") in ("✅", "🟢", "🔴", "🚫", "⛔", "❌", "🟠", "🟡", "🟣"):
                emoji_parsed_count += 1
            else:
                word_parsed_count += 1

            if key in checkpoint_map:
                checkpoint_map[key].add_mention(
                    name_raw, status, source_type,
                    timestamp=msg_ts, raw_message=raw,
                )
            else:
                entry = CheckpointEntry(key, name_raw)
                entry.status_counts[status] += 1
                entry.last_status = status
                if source_type == "admin":
                    entry.admin_mentions += 1
                else:
                    entry.crowd_mentions += 1
                if msg_ts:
                    entry.first_seen = msg_ts
                    entry.last_seen = msg_ts
                if raw:
                    entry.sample_messages.append(raw[:200])
                checkpoint_map[key] = entry

    # Sort by mention count (most referenced first)
    sorted_entries = sorted(
        checkpoint_map.values(),
        key=lambda e: e.total_mentions,
        reverse=True,
    )

    stats = {
        "channel": channel,
        "messages_fetched": len(all_messages),
        "messages_parsed": parsed_count,
        "messages_skipped": skipped_count,
        "unique_checkpoints": len(checkpoint_map),
        "word_parsed_updates": word_parsed_count,
        "emoji_parsed_updates": emoji_parsed_count,
        "analyzed_at": datetime.utcnow().isoformat(),
    }

    log.info(f"\n{'='*60}")
    log.info(f"  ANALYSIS COMPLETE")
    log.info(f"  Messages analyzed:    {len(all_messages)}")
    log.info(f"  Messages with data:   {parsed_count}")
    log.info(f"  Unique checkpoints:   {len(checkpoint_map)}")
    log.info(f"  Word-parsed updates:  {word_parsed_count}")
    log.info(f"  Emoji-parsed updates: {emoji_parsed_count}")
    log.info(f"{'='*60}")

    # Print top checkpoints
    log.info("\nTop checkpoints by mention count:")
    for entry in sorted_entries[:20]:
        log.info(
            f"  {entry.most_common_name:>30s}  "
            f"({entry.total_mentions:3d} mentions, "
            f"admin={entry.admin_mentions}, crowd={entry.crowd_mentions}) "
            f"last={entry.last_status}"
        )

    return {
        "checkpoints": [e.to_dict() for e in sorted_entries],
        "stats": stats,
    }


async def seed_db_from_results(results: dict, with_status: bool = True) -> dict:
    """Seed the checkpoint database with extracted entries and optionally their status."""
    from app.checkpoint_db import init_checkpoint_db, bulk_seed_checkpoints
    from app.db_pool import get_checkpoint_db

    await init_checkpoint_db()

    entries = []
    for cp in results.get("checkpoints", []):
        entries.append({
            "canonical_key": cp["canonical_key"],
            "name_ar": cp["name_ar"],
        })

    if not entries:
        log.warning("No checkpoints to seed.")
        return {"inserted": 0, "updated": 0, "total": 0}

    result = await bulk_seed_checkpoints(entries)
    log.info(f"DB seeded: {result}")

    # Also upsert status for checkpoints that have a last_status
    if with_status:
        status_count = 0
        now = datetime.utcnow().isoformat()
        async with get_checkpoint_db() as db:
            for cp in results.get("checkpoints", []):
                if not cp.get("last_status"):
                    continue
                # Only seed status if checkpoint has enough mentions to be real
                if cp.get("total_mentions", 0) < 2:
                    continue
                confidence = "high" if cp.get("admin_mentions", 0) > 0 else "low"
                if cp.get("crowd_mentions", 0) >= 3:
                    confidence = "medium" if confidence == "low" else confidence
                last_seen = cp.get("last_seen") or now
                await db.execute(
                    """INSERT INTO checkpoint_status
                       (canonical_key, name_ar, status, status_raw, confidence,
                        crowd_reports_1h, last_updated, last_source_type, direction)
                       VALUES (?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(canonical_key, direction) DO UPDATE SET
                         status=excluded.status,
                         confidence=excluded.confidence,
                         last_updated=excluded.last_updated,
                         last_source_type=excluded.last_source_type""",
                    (
                        cp["canonical_key"], cp["name_ar"], cp["last_status"], None,
                        confidence, cp.get("crowd_mentions", 0), last_seen,
                        "admin" if cp.get("admin_mentions", 0) > 0 else "crowd",
                        "",
                    ),
                )
                status_count += 1
            await db.commit()
        log.info(f"Status seeded for {status_count} checkpoints")
        result["status_seeded"] = status_count

    return result


async def analyze_security_channel(
    limit: int = 2000,
    channel: Optional[str] = None,
) -> dict:
    """
    Fetch messages from the security alert channel (e.g. Almustashaar) and
    extract candidate terms for classifier expansion:

      - candidate_wb_zones:     Arabic place names appearing with known attack verbs
      - candidate_attack_verbs: Unknown words appearing alongside known attack verbs
      - candidate_areas:        Proper nouns not yet in AREA_MAP

    Returns dict with ranked candidate lists for admin review.
    Results are written to the security_vocab_candidates DB table.
    """
    from app.classifier import (
        ATTACK_VERBS_AR, ATTACK_VERBS_EN, WB_ZONE, MENA_ZONE,
        NOISE_DOMINANT, _has_attack_verb,
    )
    from app.checkpoint_parser import _normalise as _clf_normalise
    from app.database import insert_security_vocab_candidate

    security_channel = channel or settings.TELEGRAM_CHANNELS.split(",")[0].strip()
    security_channel = security_channel.lstrip("@")
    if not security_channel:
        return {"error": "No security channel configured"}

    api_id   = settings.TELEGRAM_API_ID
    api_hash = settings.TELEGRAM_API_HASH
    if not api_id or not api_hash:
        return {"error": "No Telegram credentials"}

    session_dir = settings.TELEGRAM_SESSION_DIR
    if not os.path.isdir(session_dir):
        local_session = str(Path(__file__).resolve().parent.parent / "session")
        os.makedirs(local_session, exist_ok=True)
        session_dir = local_session
    session_path = os.path.join(session_dir, "wb_alerts_analyzer")

    client = TelegramClient(session_path, api_id, api_hash)
    await client.start()

    try:
        entity = await client.get_entity(security_channel)
        log.info(f"Security analysis: resolved @{security_channel}")
    except Exception as e:
        await client.disconnect()
        return {"error": f"Channel not found: {e}"}

    all_messages = []
    offset_id = 0
    batch_size = 100

    log.info(f"Security analysis: fetching up to {limit} messages from @{security_channel}...")
    while len(all_messages) < limit:
        remaining = limit - len(all_messages)
        msgs = await client.get_messages(entity, limit=min(batch_size, remaining), offset_id=offset_id)
        if not msgs:
            break
        all_messages.extend(msgs)
        offset_id = msgs[-1].id
        if len(msgs) < batch_size:
            break
        await asyncio.sleep(0.5)

    await client.disconnect()
    log.info(f"Security analysis: {len(all_messages)} messages fetched")

    # Known term sets for comparison
    known_wb  = {_clf_normalise(z) for z in WB_ZONE}
    known_mena = {_clf_normalise(z) for z in MENA_ZONE}
    known_attack = {_clf_normalise(v) for v in ATTACK_VERBS_AR + ATTACK_VERBS_EN}
    arabic_stop = {
        "في", "من", "على", "إلى", "الى", "عن", "مع", "هذا", "هذه", "التي",
        "الذي", "الذين", "وقد", "كان", "كانت", "يكون", "انه", "أنه", "انها",
        "أنها", "قد", "لم", "لن", "ان", "أن", "لا", "ما", "هو", "هي",
        "نحو", "حول", "بعد", "قبل", "خلال", "بين", "بسبب", "حيث",
    }

    # Count co-occurrences
    from collections import defaultdict
    attack_context_words: dict[str, int] = defaultdict(int)
    attack_context_samples: dict[str, str] = {}
    wb_candidates: dict[str, int] = defaultdict(int)
    area_candidates: dict[str, int] = defaultdict(int)

    parsed_msgs = 0
    for msg in all_messages:
        raw = (msg.message or "").strip()
        if len(raw) < 15:
            continue
        if not _has_attack_verb(raw):
            continue
        # Skip pure noise
        if sum(1 for kw in NOISE_DOMINANT if kw in raw) >= 2:
            continue
        parsed_msgs += 1

        words = re.sub(r"[^\u0600-\u06FF\u0020]", " ", raw).split()
        for w in words:
            w_n = _clf_normalise(w)
            if len(w_n) < 3:
                continue
            if w_n in arabic_stop:
                continue
            if w_n in known_attack:
                continue
            if w_n in known_wb or w_n in known_mena:
                continue
            # Candidate attack verb (appears alongside known attack vocab)
            attack_context_words[w_n] += 1
            if w_n not in attack_context_samples:
                attack_context_samples[w_n] = raw[:150]

        # Candidate WB zone: proper-noun-like words (3+ chars, capitalised or geographic)
        # Heuristic: words >= 4 chars appearing in messages with WB zone words
        if any(z in raw for z in WB_ZONE):
            for w in words:
                w_n = _clf_normalise(w)
                if len(w_n) >= 4 and w_n not in known_attack and w_n not in arabic_stop:
                    wb_candidates[w_n] += 1

    # Threshold: only candidates with >= 3 occurrences
    MIN_OCC = 3

    attack_verb_candidates = [
        {"term": t, "occurrences": c, "sample": attack_context_samples.get(t, "")}
        for t, c in sorted(attack_context_words.items(), key=lambda x: -x[1])
        if c >= MIN_OCC
    ][:50]

    wb_zone_candidates = [
        {"term": t, "occurrences": c}
        for t, c in sorted(wb_candidates.items(), key=lambda x: -x[1])
        if c >= MIN_OCC
        and t not in {_clf_normalise(v) for v in ATTACK_VERBS_AR + ATTACK_VERBS_EN}
    ][:50]

    # Write to DB
    for entry in attack_verb_candidates:
        await insert_security_vocab_candidate(
            entry["term"], "attack_verb", entry["occurrences"], entry.get("sample")
        )
    for entry in wb_zone_candidates:
        await insert_security_vocab_candidate(entry["term"], "wb_zone", entry["occurrences"])

    stats = {
        "channel": security_channel,
        "messages_fetched": len(all_messages),
        "messages_with_attack_verb": parsed_msgs,
        "attack_verb_candidates": len(attack_verb_candidates),
        "wb_zone_candidates": len(wb_zone_candidates),
        "analyzed_at": datetime.utcnow().isoformat(),
    }

    log.info(
        f"Security analysis complete: {parsed_msgs} relevant msgs, "
        f"{len(attack_verb_candidates)} attack verb candidates, "
        f"{len(wb_zone_candidates)} WB zone candidates"
    )

    return {
        "stats": stats,
        "attack_verb_candidates": attack_verb_candidates,
        "wb_zone_candidates": wb_zone_candidates,
    }


async def main():
    parser = argparse.ArgumentParser(
        description="Analyze checkpoint channel history to extract checkpoint directory.",
    )
    parser.add_argument("--limit", type=int, default=2000,
                        help="Max messages to fetch (default: 2000)")
    parser.add_argument("--days", type=int, default=None,
                        help="Only fetch messages from last N days")
    parser.add_argument("--channel", type=str, default=None,
                        help="Channel username override")
    parser.add_argument("--output", "-o", type=str, default=None,
                        help="Output JSON file path")
    parser.add_argument("--seed-db", action="store_true",
                        help="Seed checkpoint DB with extracted data")
    args = parser.parse_args()

    results = await analyze_channel(
        limit=args.limit,
        days=args.days,
        channel=args.channel,
    )

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        log.info(f"Results written to {out_path}")

    if args.seed_db:
        from app.db_pool import init_pool
        cp_db_path = settings.DB_PATH.replace("alerts.db", "checkpoints.db")
        await init_pool(settings.DB_PATH, cp_db_path)
        seed_result = await seed_db_from_results(results)
        log.info(f"Database seed result: {seed_result}")

    if not args.output and not args.seed_db:
        # Default: print summary to stdout
        print(json.dumps(results["stats"], indent=2, ensure_ascii=False))
        print(f"\nFound {len(results['checkpoints'])} unique checkpoints.")
        print("Use --output to save full results or --seed-db to populate the database.")


if __name__ == "__main__":
    asyncio.run(main())
