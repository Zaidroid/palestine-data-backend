"""
Checkpoint entity matcher — scans free-text messages for known checkpoint
names and extracts status from surrounding context.

Strategy:
  1. Build a trie/index of known checkpoint names (normalised)
  2. For each message, find all matches of known names
  3. For each match, look at words/emojis around it to determine status
  4. Return list of (checkpoint_key, status) pairs

This replaces the old approach of trying to parse structure from free-text.
Instead, we match against a known dictionary and read context.
"""

import json
import re
import logging
from pathlib import Path
from typing import Optional

from .checkpoint_parser import (
    _normalise, _strip_emojis, _has_status_emoji, _extract_emoji_status,
    STATUS_MAP, STATUS_BIGRAMS, EMOJI_STATUS, make_canonical_key,
    _is_skippable, _ALL_EMOJI_RE, DIRECTION_WORDS, _is_status_word,
    _get_status_normalised, _get_direction_normalised,
    parse_colon_line, _extract_status,
    _validate_checkpoint_name, _extract_direction_from_words,
    _classify_direction,
)

log = logging.getLogger("checkpoint_matcher")

# Context words that indicate status when checkpoint name is found
CONTEXT_STATUS = {
    # Military / police
    "تفتيش":    "military",
    "حاجز":     "military",
    "جيش":      "military",
    "عسكر":     "military",
    "شرطه":     "military",
    "شرطة":     "military",
    "سيارات":   "military",
    "تواجد":    "military",
    "محجوزين":  "military",
    "مداهمه":   "military",
    "مداهمة":   "military",
    # Clear / open indicators
    "نظيف":     "open",
    "فكو":      "open",
    "فتحو":     "open",
    "سالك":     "open",
    "سالكه":    "open",
    "سالكة":    "open",
    "سالكات":   "open",
    "مفتوح":    "open",
    "مفتوحه":   "open",
    "فاتح":     "open",
    "فاتحه":    "open",
    # Closed
    "مغلق":     "closed",
    "مغلقه":    "closed",
    "مغلقة":    "closed",
    "مغلقات":   "closed",
    "مقفل":     "closed",
    "مسكر":     "closed",
    "مسكره":    "closed",
    "مسدود":    "closed",
    "سكرو":     "closed",
    "اغلاق":    "closed",
    "موقوف":    "closed",
    # Congested
    "ازمه":     "congested",
    "ازمة":     "congested",
    "زحمه":     "congested",
    "زحمة":     "congested",
    "ضغط":      "congested",
    "ضاغط":     "congested",
    "وقوف":     "congested",
    # No military → open signal
    "بدون":     "open",  # بدون جيش = no military = open
}

# Emoji to status (for 🛑 which isn't in the main parser)
EXTRA_EMOJI_STATUS = {
    "🛑": "military",
}

# Negation patterns
NEGATION_WORDS = {"بدون", "فش", "ما", "مش", "مافيش", "فكو", "فتحو", "راح"}

# Pre-computed normalised lookup for CONTEXT_STATUS (avoid rebuilding per call)
_CONTEXT_STATUS_NORM: dict[str, str] = {}  # normalised_key → status
_CONTEXT_STATUS_RAW: dict[str, str] = {}   # normalised_key → original_key

def _init_context_status_cache():
    for k, v in CONTEXT_STATUS.items():
        nk = _normalise(k)
        _CONTEXT_STATUS_NORM[nk] = v
        _CONTEXT_STATUS_RAW[nk] = k

_init_context_status_cache()


class CheckpointIndex:
    """
    In-memory index of known checkpoint names for fast matching.
    Names are normalised for matching, stored with their canonical keys.
    Longer names are matched first to prevent partial matches.
    """

    def __init__(self):
        # name_normalised → canonical_key
        self._names: dict[str, str] = {}
        # All name variants including raw Arabic names
        self._name_list: list[tuple[str, str, str]] = []  # (normalised, raw, canonical_key)

    def add(self, canonical_key: str, name_ar: str, variants: list[str] = None):
        """Add a checkpoint with its name and optional variants."""
        norm = _normalise(name_ar)
        if len(norm) < 2:
            return
        self._names[norm] = canonical_key
        self._name_list.append((norm, name_ar, canonical_key))

        if variants:
            for v in variants:
                v_norm = _normalise(v)
                if len(v_norm) >= 2:
                    self._names[v_norm] = canonical_key
                    self._name_list.append((v_norm, v, canonical_key))

    def build(self):
        """Sort by name length descending so longer names match first."""
        self._name_list.sort(key=lambda x: -len(x[0]))

    def find_in_text(self, text: str) -> list[dict]:
        """
        Find all known checkpoint names in normalised text.
        Returns list of {canonical_key, name_matched, start, end}.
        Longer names are checked first. Already-matched spans are skipped.

        Also handles leading و connector (وعطارة → عطارة).
        """
        text_norm = _normalise(text)
        results = []
        used_spans = []  # (start, end) pairs already matched

        for norm_name, raw_name, canonical_key in self._name_list:
            # Skip very short names that cause false positives
            if len(norm_name) < 3:
                continue

            # Find all occurrences
            start = 0
            while True:
                idx = text_norm.find(norm_name, start)
                if idx == -1:
                    break

                end = idx + len(norm_name)

                # Check word boundaries
                before_ok = idx == 0 or text_norm[idx - 1] == " "
                after_ok = end == len(text_norm) or text_norm[end] == " "

                # Also allow match after و connector
                if not before_ok and idx >= 1 and text_norm[idx - 1] == "و":
                    waw_idx = idx - 1
                    before_waw_ok = waw_idx == 0 or text_norm[waw_idx - 1] == " "
                    if before_waw_ok:
                        before_ok = True
                        idx = waw_idx  # include the و in the matched span

                if before_ok and after_ok:
                    overlap = any(
                        not (end <= s or idx >= e)
                        for s, e in used_spans
                    )
                    if not overlap:
                        results.append({
                            "canonical_key": canonical_key,
                            "name_matched": raw_name,
                            "start": idx,
                            "end": end,
                        })
                        used_spans.append((idx, end))

                start = end

        return results

    @property
    def size(self) -> int:
        return len(set(self._names.values()))


# Global index instance — loaded once at startup
_index: Optional[CheckpointIndex] = None


def _is_clean_name(name: str) -> bool:
    """Check if a checkpoint name looks legitimate (not a sentence or garbage)."""
    import re as _re
    # Too long = sentence
    words = name.split()
    if len(words) > 4:
        return False
    # Has status words = not a name
    status_norms = _get_status_normalised()
    for w in words:
        if _normalise(w) in status_norms:
            return False
    # Has direction words = not a name (unless part of a multi-word name)
    dir_norms = _get_direction_normalised()
    if len(words) == 1 and _normalise(words[0]) in dir_norms:
        return False
    # Multi-word name that's ALL direction/status = not a name
    all_noise = all(_normalise(w) in dir_norms or _normalise(w) in status_norms for w in words)
    if all_noise:
        return False
    # Has emojis = garbage
    if _re.search(r"[\U0001F300-\U0001F9FF\U00002600-\U000027BF✅❌🔴🟢🟡🟠🟣⛔🚫🛑]", name):
        return False
    # Known bad patterns — status words in canonical keys from directory
    bad_fragments = {"سالك", "سالكه", "مغلق", "مغلقه", "بدون", "مفتوح", "مسكر", "زحمه"}
    name_norm = _normalise(name)
    name_key = name_norm.replace(" ", "_")
    for frag in bad_fragments:
        if _normalise(frag) in name_key:
            return False
    # Common filler words that aren't checkpoint names
    filler_norms = {"حتي", "اللحظه", "حاليا", "الان", "هسا", "بدون", "مع", "بحذر",
                    "في", "علي", "من", "عند", "الي"}
    if name_norm in filler_norms:
        return False
    return True


async def load_checkpoint_index() -> CheckpointIndex:
    """Load checkpoint names from DB into the matcher index.

    Only loads clean names (not sentences, not garbage).
    Also loads curated known_checkpoints.json for highest quality names.
    """
    global _index
    import json
    from pathlib import Path
    from .db_pool import get_checkpoint_db

    index = CheckpointIndex()

    # 1. Load curated checkpoints first (highest quality)
    curated_path = Path(__file__).resolve().parent.parent / "data" / "known_checkpoints.json"
    if curated_path.exists():
        with open(curated_path, "r", encoding="utf-8") as f:
            known = json.load(f)
        for cp in known:
            key = cp["canonical_key"]
            name = cp.get("name_ar", "")
            if name and len(name) >= 2:
                index.add(key, name)
                aliases = cp.get("aliases", [])
                if aliases:
                    index.add(key, name, variants=aliases)
        log.info(f"Loaded {len(known)} curated checkpoints")

    # 2. Load DB checkpoints that have received real status updates (proven real)
    async with get_checkpoint_db() as db:
        cur = await db.execute(
            """SELECT c.canonical_key, c.name_ar, c.name_en
               FROM checkpoints c
               JOIN checkpoint_status s ON s.canonical_key = c.canonical_key"""
        )
        rows = await cur.fetchall()

    for key, name_ar, name_en in rows:
        if name_ar and len(name_ar) >= 2 and _is_clean_name(name_ar):
            index.add(key, name_ar)
            # Also add short form without common prefixes
            for prefix in ("حاجز ", "بوابة ", "بوابه ", "مدخل ", "اشارات ",
                          "إشارات ", "إشارة ", "اشاره ", "طريق ", "دوار ",
                          "جسر ", "بوابات "):
                if name_ar.startswith(prefix):
                    short = name_ar[len(prefix):]
                    if len(short) >= 3:
                        index.add(key, short)

    # 3. Load from checkpoint_directory.json (entries with >=3 mentions are proven real)
    dir_path = Path(__file__).resolve().parent.parent / "data" / "checkpoint_directory.json"
    if dir_path.exists():
        try:
            with open(dir_path, "r", encoding="utf-8") as f:
                directory = json.load(f)
            # Support both {checkpoints: [...]} and raw list formats
            dir_entries = directory.get("checkpoints", directory) if isinstance(directory, dict) else directory
            dir_added = 0
            for cp in dir_entries:
                if cp.get("total_mentions", 0) < 3:
                    continue
                key = cp.get("canonical_key", "")
                name = cp.get("name_ar", "")
                if not key or not name or len(name) < 2:
                    continue
                if not _is_clean_name(name):
                    continue
                # Add all name variants from the directory (spelling frequencies captured from real messages)
                variants = [v for v in cp.get("name_variants", {}).keys()
                            if len(v) >= 2 and _is_clean_name(v)]
                index.add(key, name, variants=variants if variants else None)
                dir_added += 1
            log.info(f"Directory entries added to index: {dir_added}")
        except Exception as e:
            log.warning(f"Could not load checkpoint_directory.json: {e}")

    # 4. Add all aliases as index entries (variant name → canonical key)
    from .checkpoint_aliases import CHECKPOINT_ALIASES
    for alias_key, canonical_key in CHECKPOINT_ALIASES.items():
        # Convert alias key (underscore-separated normalised) back to name form
        alias_name = alias_key.replace("_", " ")
        # Only add if canonical key exists in index already (avoid ghost entries)
        if canonical_key in index._names.values() or any(
            canonical_key == k for k in index._names.values()
        ):
            index.add(canonical_key, alias_name)

    index.build()
    _index = index
    log.info(f"Checkpoint index loaded: {index.size} unique checkpoints, "
             f"{len(index._name_list)} name variants")
    return index


def get_index() -> Optional[CheckpointIndex]:
    return _index


def _extract_context_status(text_norm: str, match_start: int, match_end: int,
                             original_text: str) -> tuple[str | None, str | None, str | None]:
    """
    Extract status and direction from context around a matched checkpoint name.

    Looks at words and emojis within a window around the match.
    Returns (status, status_raw, direction) or (None, None, None).
    """
    text_len = len(text_norm)
    window = 60

    after_text = text_norm[match_end:match_end + window].strip()
    before_text = text_norm[max(0, match_start - window):match_start].strip()

    after_orig = original_text[match_end:match_end + window] if match_end < len(original_text) else ""
    before_orig = original_text[max(0, match_start - window):match_start] if match_start > 0 else ""
    full_context_orig = before_orig + " " + after_orig

    # 1. Check emojis in context
    emoji_status, emoji_raw = _extract_emoji_status(full_context_orig)
    if not emoji_status and "🛑" in full_context_orig:
        emoji_status, emoji_raw = "military", "🛑"

    # 2. Check status words in context (after match takes priority)
    word_status = None
    word_raw = None

    after_words = after_text.split()[:8]
    before_words = before_text.split()[-4:]

    has_negation = any(_normalise(w) in NEGATION_WORDS for w in after_words[:3])

    for w in after_words:
        w_norm = _normalise(w)
        if w_norm in _CONTEXT_STATUS_NORM:
            word_status = _CONTEXT_STATUS_NORM[w_norm]
            word_raw = w
            break
        if _is_status_word(w_norm):
            for k, v in STATUS_MAP.items():
                if _normalise(k) == w_norm:
                    word_status = v
                    word_raw = w
                    break
            break

    if not word_status:
        for w in reversed(before_words):
            w_norm = _normalise(w)
            if w_norm in _CONTEXT_STATUS_NORM:
                word_status = _CONTEXT_STATUS_NORM[w_norm]
                word_raw = w
                break

    if has_negation and word_status == "military":
        word_status = "open"
        word_raw = "بدون " + (word_raw or "")

    status = word_status or emoji_status
    raw = word_raw or emoji_raw

    # 3. Extract direction from context words
    direction = _extract_direction_from_words(after_words) or _extract_direction_from_words(before_words)

    return status, raw, direction


def match_message(text: str, index: CheckpointIndex = None) -> list[dict]:
    """
    Scan a message for known checkpoint mentions and extract status.

    This is the main entry point for processing incoming messages.
    It first tries structured parsing (colon format, word-based),
    then falls back to entity matching for free-text.

    Returns list of dicts with: canonical_key, name_raw, status, status_raw, direction, raw_line
    """
    if index is None:
        index = _index
    if index is None:
        return []

    text = text.strip()
    if not text or len(text) < 3:
        return []

    results = []
    seen_keys: set[str] = set()

    lines = text.split("\n")

    for line in lines:
        line_stripped = line.strip()
        if not line_stripped or _is_skippable(line_stripped):
            continue

        # 1. Try colon format first (structured admin lists) — may return list for dual-direction
        if ":" in line_stripped:
            parsed = parse_colon_line(line_stripped)
            if parsed is not None:
                items = parsed if isinstance(parsed, list) else [parsed]
                added = False
                for item in items:
                    direction = item.get("direction") or ""
                    dedup_key = f"{item['canonical_key']}:{direction}"
                    if dedup_key not in seen_keys:
                        results.append(item)
                        seen_keys.add(dedup_key)
                        added = True
                if added:
                    continue

        # 2. Try entity matching against known checkpoint names
        line_clean = _strip_emojis(line_stripped)
        matches = index.find_in_text(line_clean)

        if matches:
            for match in matches:
                status, status_raw, direction = _extract_context_status(
                    _normalise(line_clean), match["start"], match["end"],
                    line_stripped,
                )

                if status:
                    dir_str = direction or ""
                    dedup_key = f"{match['canonical_key']}:{dir_str}"
                    if dedup_key not in seen_keys:
                        results.append({
                            "canonical_key": match["canonical_key"],
                            "name_raw":      match["name_matched"],
                            "status":        status,
                            "status_raw":    status_raw,
                            "direction":     direction,
                            "raw_line":      line_stripped,
                        })
                        seen_keys.add(dedup_key)
            continue

        # 3. Fall back to simple word-based for unknown checkpoints
        from .checkpoint_parser import parse_line, parse_emoji_line
        parsed = parse_line(line_stripped)
        if parsed is None and _has_status_emoji(line_stripped):
            parsed = parse_emoji_line(line_stripped)
        if parsed and _validate_checkpoint_name(parsed.get("name_raw", "")):
            direction = parsed.get("direction") or ""
            dedup_key = f"{parsed['canonical_key']}:{direction}"
            if dedup_key not in seen_keys:
                results.append(parsed)
                seen_keys.add(dedup_key)

    return results
