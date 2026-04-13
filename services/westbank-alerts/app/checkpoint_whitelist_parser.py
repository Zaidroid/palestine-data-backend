"""
Checkpoint Whitelist Parser — strict whitelist-first parsing.

Replaces the old cascading fallback approach. Only accepts checkpoints that:
1. Match the known checkpoints whitelist
2. Pass strict validation (no status/direction/filler in names)
3. Have valid status and direction information

Uses CheckpointKnowledgeBase for all name lookups.
"""

import re
import logging
from typing import Optional
from .checkpoint_parser import (
    _normalise,
    _strip_emojis,
    _is_skippable,
    parse_colon_line,
    _extract_emoji_status,
    _find_any_status,
    _extract_direction_from_words,
    _classify_direction,
    _get_direction_normalised,
    _get_status_normalised,
    _is_status_word,
    _truncate_at_conjunction,
    STATUS_MAP,
    DIRECTION_WORDS,
)
from .checkpoint_knowledge_base import CheckpointKnowledgeBase
from .checkpoint_strict_validator import CheckpointStrictValidator

log = logging.getLogger("checkpoint_whitelist_parser")


def _extract_direction_before_parse(text: str) -> tuple[str, Optional[str]]:
    """
    Extract direction words from text and return cleaned text + direction.

    Returns (cleaned_text, direction) where direction is None, "inbound", "outbound", or "both".
    This prevents direction words from contaminating the checkpoint name.
    """
    words = text.split()
    direction = None
    words_to_keep = []

    dir_norm = _get_direction_normalised()

    for w in words:
        w_norm = _normalise(w)
        if w_norm in dir_norm:
            d = _classify_direction(w)
            if d:
                direction = d
            # Don't add direction words to the kept words
        else:
            words_to_keep.append(w)

    return " ".join(words_to_keep).strip(), direction


def parse_message_whitelist(text: str, knowledge_base: CheckpointKnowledgeBase) -> list[dict]:
    """
    Parse a message using whitelist-first approach.

    Only returns checkpoints that:
    1. Match the known checkpoints list
    2. Pass strict validation
    3. Have valid status

    Returns list of dicts with: canonical_key, name_raw, status, status_raw, direction, raw_line
    """
    if not text or len(text.strip()) < 3:
        return []

    results = []
    seen_keys: set[tuple[str, str]] = set()  # (canonical_key, direction) dedup

    for line in text.split("\n"):
        line_stripped = line.strip()
        if not line_stripped or _is_skippable(line_stripped):
            continue

        # Try colon format first (admin lists are usually well-structured)
        if ":" in line_stripped:
            parsed_items = _parse_colon_line_whitelist(line_stripped, knowledge_base)
            if parsed_items:
                for item in parsed_items:
                    if item:
                        dedup_key = (item["canonical_key"], item.get("direction") or "")
                        if dedup_key not in seen_keys:
                            results.append(item)
                            seen_keys.add(dedup_key)
                continue

        # Try word-based parsing
        parsed = _parse_line_whitelist(line_stripped, knowledge_base)
        if parsed:
            dedup_key = (parsed["canonical_key"], parsed.get("direction") or "")
            if dedup_key not in seen_keys:
                results.append(parsed)
                seen_keys.add(dedup_key)

    return results


def _parse_colon_line_whitelist(line: str, knowledge_base: CheckpointKnowledgeBase) -> Optional[list[dict]]:
    """
    Parse a colon-delimited line with whitelist validation.

    This is based on the original parse_colon_line but validates against
    the knowledge base and strict rules.

    Returns list of dicts (one per direction if dual-direction) or None.
    """
    original_line = line.strip()
    if not original_line or ":" not in original_line:
        return None

    try:
        colon_idx = original_line.index(":")
        name_part = original_line[:colon_idx].strip()
        status_part = original_line[colon_idx + 1:].strip()

        if not name_part or not status_part:
            return None

        # Clean the name: remove emojis and parenthetical content
        name_clean = _strip_emojis(name_part)
        name_clean = re.sub(r"\([^)]*\)", "", name_clean)
        name_clean = re.sub(r"[.,،؟?!;()\[\]{}\"\u2018\u2019'…\-–—/\\|]", " ", name_clean)
        name_clean = " ".join(name_clean.split()).strip()

        if not name_clean or len(name_clean) < 2:
            return None

        if len(name_clean.split()) > 5:
            return None

        # Extract direction before looking up the checkpoint
        name_for_lookup, extracted_direction = _extract_direction_before_parse(name_clean)

        # Truncate at Arabic conjunction words (ونظيف, وسالك, etc.)
        name_words = _truncate_at_conjunction(name_for_lookup.split())
        name_for_lookup = " ".join(name_words).strip()
        if not name_for_lookup:
            return None

        # Validate name
        is_valid, reason = CheckpointStrictValidator.validate_name(name_for_lookup)
        if not is_valid:
            log.debug(f"Rejected name '{name_for_lookup}': {reason}")
            return None

        # Look up in whitelist
        canonical_key = knowledge_base.find_checkpoint(name_for_lookup)
        if not canonical_key:
            log.debug(f"Unknown checkpoint: '{name_for_lookup}'")
            return None

        # Use the canonical name_ar from KB as name_raw for clean display
        kb_cp = knowledge_base.get_checkpoint(canonical_key)
        display_name = kb_cp["name_ar"] if kb_cp else name_for_lookup

        # Extract status from the status_part
        status, status_raw = _extract_emoji_status(status_part)
        if not status:
            status_words = _strip_emojis(status_part).split()
            if status_words:
                status, status_raw = _find_any_status(status_words)

        if not status:
            return None

        # Validate the full parsed record
        is_valid, reason = CheckpointStrictValidator.validate_parsed_checkpoint(
            name_for_lookup, status, extracted_direction
        )
        if not is_valid:
            log.debug(f"Rejected parsed checkpoint: {reason}")
            return None

        return [{
            "canonical_key": canonical_key,
            "name_raw": display_name,
            "status": status,
            "status_raw": status_raw,
            "direction": extracted_direction,
            "raw_line": original_line,
        }]

    except Exception as e:
        log.debug(f"Error parsing colon line: {e}")
        return None


def _parse_line_whitelist(line: str, knowledge_base: CheckpointKnowledgeBase) -> Optional[dict]:
    """
    Parse a word-based checkpoint line with whitelist validation.

    Flow:
    1. Clean text (remove emojis, punctuation)
    2. Extract direction words and remove from consideration
    3. Extract status (emoji or word-based) and track which words to exclude
    4. Build name from remaining words
    5. Validate name against strict rules
    6. Look up in whitelist
    7. Return if found and valid
    """
    original_line = line.strip()
    if not original_line:
        return None

    # Remove emojis first
    line_clean = _strip_emojis(original_line)
    if not line_clean:
        return None

    # Remove punctuation for word parsing
    line_clean = re.sub(r"[.:;،\-–—]", " ", line_clean)
    line_clean = re.sub(r"\([^)]*\)", "", line_clean)
    line_clean = " ".join(line_clean.split()).strip()

    if not line_clean:
        return None

    words = line_clean.split()

    # Step 1: Extract direction from the full text (and remove direction words)
    direction_extracted, extracted_direction = _extract_direction_before_parse(line_clean)
    words_no_direction = direction_extracted.split()

    # Step 2: Look for word-based status first (more specific than emojis)
    status = None
    status_raw = None
    status_word_indices = set()  # indices of words that are status words

    if words_no_direction:
        for i, w in enumerate(words_no_direction):
            w_norm = _normalise(w)
            if _is_status_word(w_norm):
                status_word_indices.add(i)
                # Use this word status (prefer word-based status over emoji)
                status = STATUS_MAP.get(w_norm) if w_norm in {_normalise(k) for k in STATUS_MAP} else None
                if status:
                    # Find the actual original word
                    for k, v in STATUS_MAP.items():
                        if _normalise(k) == w_norm:
                            status_raw = w
                            break
                    break  # Use the first status word found

    # Step 3: If no word-based status, extract emoji status
    if not status:
        status, status_raw = _extract_emoji_status(original_line)

    # Allow single-word lines only if they have emoji status
    if len(words) < 2 and not status:
        return None

    if not status:
        log.debug(f"No status found in line: {original_line}")
        return None

    # Step 4: Build name from words, excluding direction and status words
    name_words = []
    for i, w in enumerate(words_no_direction):
        if i not in status_word_indices:
            name_words.append(w)

    if not name_words:
        return None

    # Truncate at Arabic conjunction words (ونظيف, وسالك, etc.)
    name_words = _truncate_at_conjunction(name_words)
    name_candidate = " ".join(name_words).strip()
    if len(name_candidate) < 2:
        return None

    # Step 5: Validate name
    is_valid, reason = CheckpointStrictValidator.validate_name(name_candidate)
    if not is_valid:
        log.debug(f"Rejected name '{name_candidate}': {reason}")
        return None

    # Step 6: Look up in whitelist
    canonical_key = knowledge_base.find_checkpoint(name_candidate)
    if not canonical_key:
        log.debug(f"Unknown checkpoint: '{name_candidate}'")
        return None

    # Use KB's canonical name_ar for clean display in live feed
    kb_cp = knowledge_base.get_checkpoint(canonical_key)
    display_name = kb_cp["name_ar"] if kb_cp else name_candidate

    # Step 7: Validate the full record
    is_valid, reason = CheckpointStrictValidator.validate_parsed_checkpoint(
        name_candidate, status, extracted_direction
    )
    if not is_valid:
        log.debug(f"Rejected parsed checkpoint: {reason}")
        return None

    return {
        "canonical_key": canonical_key,
        "name_raw": display_name,
        "status": status,
        "status_raw": status_raw,
        "direction": extracted_direction,
        "raw_line": original_line,
    }
