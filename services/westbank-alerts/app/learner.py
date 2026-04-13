"""
Learner — startup catchup and periodic self-learning cycle.

Runs two background tasks launched from main.py lifespan():

  1. run_startup_catchup()  — on startup, fetch last 500 messages from the
     checkpoint channel and push them through the normal pipeline so any
     messages received while the service was down are not missed.

  2. periodic_learning_cycle()  — every 6 hours, fetch recent messages,
     extract candidate vocabulary patterns (new status words co-occurring
     with known emojis), refresh the in-memory CheckpointIndex from the DB,
     and log discoveries. Candidate words are written to the vocab_discoveries
     table for admin review — nothing is auto-promoted.

No ML, no external APIs — everything is deterministic co-occurrence counting.
"""

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from .checkpoint_parser import (
    _normalise, _has_status_emoji, _extract_emoji_status,
    STATUS_MAP, FILLER_WORDS, make_canonical_key, parse_message, is_admin_message,
)
from .checkpoint_matcher import CheckpointIndex, get_index, _is_clean_name
from .checkpoint_db import insert_vocab_discovery
from .db_pool import get_checkpoint_db

log = logging.getLogger("learner")

# Minimum mentions in checkpoint_directory.json to be added to the live index
DIRECTORY_MIN_MENTIONS = 3

# Minimum co-occurrence count before a word is written as a vocab candidate
VOCAB_MIN_OCCURRENCES = 3


# ── Index population ──────────────────────────────────────────────────────────

async def refresh_index_from_db(index: CheckpointIndex) -> int:
    """
    Pull all canonical_keys from checkpoint_status (proven real by having
    received actual updates) and add any new entries to the live index.
    Returns the number of new entries added.
    """
    added = 0
    existing_keys = set(index._names.values())

    async with get_checkpoint_db() as db:
        cur = await db.execute(
            """SELECT c.canonical_key, c.name_ar
               FROM checkpoints c
               JOIN checkpoint_status s ON s.canonical_key = c.canonical_key"""
        )
        rows = await cur.fetchall()

    for key, name_ar in rows:
        if key in existing_keys:
            continue
        if not name_ar or len(name_ar) < 2:
            continue
        if not _is_clean_name(name_ar):
            continue
        index.add(key, name_ar)
        existing_keys.add(key)
        added += 1

    if added > 0:
        index.build()
        log.info(f"Index refreshed from DB: +{added} new checkpoints")

    return added


# ── Vocab pattern extraction ──────────────────────────────────────────────────

def extract_vocab_patterns(messages: list[str]) -> dict:
    """
    Scan raw messages for unknown words co-occurring with known status emojis.

    Strategy: for each line that has a known status emoji (✅/❌/🔴 etc.),
    extract the canonical status from the emoji, then scan the remaining
    words on that line. Any word that:
      - Is NOT already in STATUS_MAP
      - Is NOT a filler word
      - Is >= 3 chars (normalised)
      - Is purely Arabic text
    ... is counted as a candidate for that status.

    Words that reach VOCAB_MIN_OCCURRENCES occurrences with a consistent
    status are returned as candidates for admin review.

    Returns:
      {
        "candidate_status_words": [(word, status, count), ...],
        "total_lines_scanned": int,
        "total_emoji_lines": int,
      }
    """
    known_status_normalised = {_normalise(k) for k in STATUS_MAP}
    filler_normalised = {_normalise(w) for w in FILLER_WORDS}

    # word_norm → {status → count}
    word_status_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    total_lines = 0
    emoji_lines = 0

    for msg in messages:
        for line in msg.split("\n"):
            line = line.strip()
            if not line:
                continue
            total_lines += 1

            if not _has_status_emoji(line):
                continue

            status, _emoji = _extract_emoji_status(line)
            if not status:
                continue
            emoji_lines += 1

            # Strip emojis and split into words
            from .checkpoint_parser import _strip_emojis
            clean = _strip_emojis(line)
            for word in clean.split():
                word_n = _normalise(word)
                # Skip known, filler, short, non-Arabic
                if len(word_n) < 3:
                    continue
                if word_n in known_status_normalised:
                    continue
                if word_n in filler_normalised:
                    continue
                # Only Arabic script (codepoint range)
                if not all("\u0600" <= c <= "\u06FF" or c == " " for c in word_n):
                    continue
                word_status_counts[word_n][status] += 1

    # Collect candidates: word must appear >= VOCAB_MIN_OCCURRENCES times
    # with a single dominant status (>= 80% of occurrences agree)
    candidates = []
    for word_n, status_counts in word_status_counts.items():
        total = sum(status_counts.values())
        if total < VOCAB_MIN_OCCURRENCES:
            continue
        dominant_status = max(status_counts, key=status_counts.get)
        dominant_count = status_counts[dominant_status]
        if dominant_count / total >= 0.80:
            candidates.append((word_n, dominant_status, total))

    candidates.sort(key=lambda x: -x[2])

    return {
        "candidate_status_words": candidates,
        "total_lines_scanned": total_lines,
        "total_emoji_lines": emoji_lines,
    }


# ── Startup catchup ───────────────────────────────────────────────────────────

async def run_startup_catchup(client, cp_channel: str, limit: int = 500) -> dict:
    """
    On startup, fetch the last `limit` messages from the checkpoint channel
    and push them through the normal parse_message pipeline.

    This catches any messages that arrived while the service was down.
    Uses min_id=0 to get the most recent `limit` messages in bulk.

    Returns {"processed": int, "checkpoints_found": int}
    """
    from .checkpoint_db import duplicate_check_cp, insert_checkpoint_update, upsert_checkpoint_status
    from .checkpoint_matcher import get_index, match_message

    cp_channel = cp_channel.strip().lstrip("@")
    if not cp_channel:
        log.warning("Startup catchup: no checkpoint channel configured, skipping.")
        return {"processed": 0, "checkpoints_found": 0}

    log.info(f"Startup catchup: fetching last {limit} msgs from @{cp_channel}...")

    try:
        entity = await client.get_entity(cp_channel)
    except Exception as e:
        log.warning(f"Startup catchup: could not resolve @{cp_channel}: {e}")
        return {"processed": 0, "checkpoints_found": 0}

    try:
        messages = await client.get_messages(entity, limit=limit)
    except Exception as e:
        log.warning(f"Startup catchup: failed to fetch messages: {e}")
        return {"processed": 0, "checkpoints_found": 0}

    processed = 0
    checkpoints_found = 0

    index = get_index()

    for msg in reversed(messages):  # oldest first
        raw = (msg.message or "").strip()
        if len(raw) < 2:
            continue

        # Determine admin status
        sender_id = getattr(msg, "sender_id", None) or getattr(msg, "from_id", None)
        if hasattr(sender_id, "user_id"):
            sender_id = sender_id.user_id

        is_admin = is_admin_message(raw)

        if index:
            updates = match_message(raw, index)
        else:
            updates = parse_message(raw, is_admin=is_admin)

        if not updates:
            continue

        processed += 1
        source_type = "admin" if is_admin else "crowd"
        msg_ts = msg.date.replace(tzinfo=None) if msg.date else datetime.utcnow()

        for upd in updates:
            if await duplicate_check_cp(cp_channel, msg.id, upd["canonical_key"]):
                continue

            upd["source_type"] = source_type
            upd["source_channel"] = cp_channel
            upd["source_msg_id"] = msg.id
            upd["raw_message"] = raw
            upd["timestamp"] = msg_ts

            await insert_checkpoint_update(upd)
            await upsert_checkpoint_status(upd, is_admin=is_admin, channel=cp_channel)
            checkpoints_found += 1

    log.info(
        f"Startup catchup complete: {processed} msgs processed, "
        f"{checkpoints_found} checkpoint updates stored"
    )

    # Refresh index with any newly discovered checkpoints
    idx = get_index()
    if idx:
        new_in_index = await refresh_index_from_db(idx)
        if new_in_index:
            log.info(f"Startup catchup: added {new_in_index} new checkpoints to live index")

    return {"processed": processed, "checkpoints_found": checkpoints_found}


# ── Periodic learning cycle ───────────────────────────────────────────────────

async def periodic_learning_cycle(
    client,
    cp_channel: str,
    interval_hours: float = 6.0,
) -> None:
    """
    Long-running coroutine. Every `interval_hours`:
      1. Fetch last 200 messages from the checkpoint channel
      2. Extract candidate vocabulary patterns (new status words)
      3. Write candidates to vocab_discoveries table for admin review
      4. Refresh in-memory index from DB

    Designed to be fire-and-forget — wrapped in try/except so a crash
    in one cycle doesn't kill the coroutine.
    """
    cp_channel = cp_channel.strip().lstrip("@")
    if not cp_channel:
        log.warning("Periodic learner: no checkpoint channel configured.")
        return

    interval_seconds = interval_hours * 3600

    # Stagger first run — wait one full interval before first cycle
    # so startup catchup has time to finish and the index is settled
    log.info(
        f"Periodic learner scheduled: first run in {interval_hours:.1f}h, "
        f"then every {interval_hours:.1f}h"
    )
    await asyncio.sleep(interval_seconds)

    while True:
        try:
            log.info("Periodic learner: starting learning cycle...")
            await _run_one_learning_cycle(client, cp_channel)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"Periodic learner: cycle error: {e}", exc_info=True)
        await asyncio.sleep(interval_seconds)


async def _run_one_learning_cycle(client, cp_channel: str) -> None:
    try:
        entity = await client.get_entity(cp_channel)
        messages = await client.get_messages(entity, limit=200)
    except Exception as e:
        log.warning(f"Periodic learner: could not fetch messages: {e}")
        return

    raw_texts = [
        (msg.message or "").strip()
        for msg in messages
        if (msg.message or "").strip()
    ]

    # 1. Extract vocab patterns
    result = extract_vocab_patterns(raw_texts)
    candidates = result["candidate_status_words"]

    log.info(
        f"Periodic learner: scanned {result['total_lines_scanned']} lines, "
        f"{result['total_emoji_lines']} with status emojis, "
        f"{len(candidates)} vocab candidates found"
    )

    # 2. Write candidates to DB for admin review
    written = 0
    for word, status, count in candidates:
        try:
            await insert_vocab_discovery(word, status, count)
            written += 1
        except Exception as e:
            log.debug(f"Periodic learner: could not write vocab candidate '{word}': {e}")

    if written > 0:
        log.info(f"Periodic learner: wrote {written} vocab candidates to DB")

    # 3. Refresh live index with any new checkpoints from DB
    idx = get_index()
    if idx:
        new_count = await refresh_index_from_db(idx)
        if new_count:
            log.info(f"Periodic learner: +{new_count} new checkpoints added to live index")
