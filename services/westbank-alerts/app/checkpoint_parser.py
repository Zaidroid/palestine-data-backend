"""
Checkpoint status parser for Palestinian Arabic crowd/admin messages.

Detection strategies (applied per-line, with fallback):
  1. Colon-format — admin lists: `checkpoint_name: ✅ status` or `name: ❌ مغلق`
  2. Word-based   — structured lines: [name tokens...] [status token]
  3. Emoji-based  — lines with ✅/🔴 etc. as status indicators

Source types:
  admin  — structured multi-line list, one checkpoint per line, high confidence
  crowd  — free-text single messages, lower confidence

Admin message formats (from real channel data):
  Format A (colon + emoji):
    بزاريا: ✅ سالك بالاتجاهين
    ياسوف: ❌ مغلق
    عناب (عنبتا): الداخل: سالك - الخارج مغلق

  Format B (word-based):
    انشيه سالكه
    مراح رياح مغلق
    بيت فوريك مغلق❌️❌️

  Format C (pure emoji):
    ✅✅فرش الهوى سالك
    حوارة ✅

Crowd message format:
  حوارة ✅
  🔴 حوارة
  العش سالك
"""

import re
import logging
from typing import Optional

from .checkpoint_aliases import CHECKPOINT_ALIASES

log = logging.getLogger("checkpoint_parser")


# ── Status vocabulary ─────────────────────────────────────────────────────────

STATUS_MAP: dict[str, str] = {
    # Open
    "سالك":    "open",
    "سالكه":   "open",
    "سالكة":   "open",
    "سالكين":  "open",
    "مفتوح":   "open",
    "مفتوحه":  "open",
    "مفتوحة":  "open",
    "مفتوحين": "open",
    "فاتح":    "open",
    "فاتحه":   "open",
    "فاتحة":   "open",
    "فتح":     "open",

    # Closed
    "مغلق":    "closed",
    "مغلقه":   "closed",
    "مغلقة":   "closed",
    "مغلقين":  "closed",
    "مقفل":    "closed",
    "مقفله":   "closed",
    "مسكر":    "closed",
    "مسكره":   "closed",
    "موقوف":   "closed",
    "موقف":    "closed",
    "مسدود":   "closed",
    "مسدوده":  "closed",

    # Congested
    "زحمه":    "congested",
    "زحمة":    "congested",
    "ازمه":    "congested",
    "ازمة":    "congested",
    "أزمة":    "congested",
    "مزحوم":   "congested",
    "ضاغط":    "congested",
    "ضغط":     "congested",
    "مزدحم":   "congested",
    "مزدحمه":  "congested",
    "ازدحام":  "congested",

    # Slow
    "بطيء":    "slow",
    "بطئ":     "slow",
    "بطيئ":    "slow",

    # Military presence
    "جيش":     "military",
    "عسكر":    "military",
    "مداهمه":  "military",
    "مداهمة":  "military",
}

_STATUS_MAP_NORMALISED: set[str] | None = None

def _get_status_normalised() -> set[str]:
    global _STATUS_MAP_NORMALISED
    if _STATUS_MAP_NORMALISED is None:
        _STATUS_MAP_NORMALISED = {_normalise(k) for k in STATUS_MAP}
    return _STATUS_MAP_NORMALISED

STATUS_BIGRAMS: dict[str, str] = {
    "فيه جيش":   "military",
    "عليه جيش":  "military",
    "معهم جيش":  "military",
    "فيه عسكر":  "military",
    "فيه ضغط":   "congested",
    "فيه زحمه":  "congested",
    "فيه زحمة":  "congested",
    "مش سالك":   "closed",
    "مش فاتح":   "closed",
    "غير سالك":  "closed",
}

# ── Emoji status map ──────────────────────────────────────────────────────────

EMOJI_STATUS: dict[str, str] = {
    "✅": "open",
    "🟢": "open",
    "🔴": "closed",
    "🚫": "closed",
    "⛔": "closed",
    "❌": "closed",
    "🟠": "congested",
    "🟡": "slow",
    "🟣": "military",
}

_STATUS_EMOJIS = set(EMOJI_STATUS.keys())
_EMOJI_RE = re.compile("|".join(re.escape(e) for e in EMOJI_STATUS.keys()))

# Regex to match ALL emoji characters (status + decorative + variation selectors)
_ALL_EMOJI_RE = re.compile(
    "|".join(re.escape(e) for e in EMOJI_STATUS.keys())
    + r"|[\U0001F300-\U0001F9FF\U00002600-\U000027BF\U0000FE00-\U0000FEFF"
    r"\U0001FA00-\U0001FA6F\U0001FA70-\U0001FAFF\u200d\uFE0F]+"
)

# ── Direction words ───────────────────────────────────────────────────────────

DIRECTION_WORDS: set[str] = {
    "الداخل", "الخارج", "للداخل", "للخارج", "لداخل", "لخارج",
    "داخل", "خارج", "بالاتجاهين",
    "دخول", "خروج", "للدخول", "للخروج",
}
_DIRECTION_NORMALISED: set[str] | None = None

def _get_direction_normalised() -> set[str]:
    global _DIRECTION_NORMALISED
    if _DIRECTION_NORMALISED is None:
        _DIRECTION_NORMALISED = {_normalise(w) for w in DIRECTION_WORDS}
    return _DIRECTION_NORMALISED


# Direction word → canonical direction mapping
_INBOUND_WORDS = {"الداخل", "للداخل", "لداخل", "داخل", "دخول", "للدخول"}
_OUTBOUND_WORDS = {"الخارج", "للخارج", "لخارج", "خارج", "خروج", "للخروج"}
_BOTH_WORDS = {"بالاتجاهين"}

_INBOUND_NORMALISED: set[str] | None = None
_OUTBOUND_NORMALISED: set[str] | None = None
_BOTH_NORMALISED: set[str] | None = None


def _get_inbound_norm() -> set[str]:
    global _INBOUND_NORMALISED
    if _INBOUND_NORMALISED is None:
        _INBOUND_NORMALISED = {_normalise(w) for w in _INBOUND_WORDS}
    return _INBOUND_NORMALISED


def _get_outbound_norm() -> set[str]:
    global _OUTBOUND_NORMALISED
    if _OUTBOUND_NORMALISED is None:
        _OUTBOUND_NORMALISED = {_normalise(w) for w in _OUTBOUND_WORDS}
    return _OUTBOUND_NORMALISED


def _get_both_norm() -> set[str]:
    global _BOTH_NORMALISED
    if _BOTH_NORMALISED is None:
        _BOTH_NORMALISED = {_normalise(w) for w in _BOTH_WORDS}
    return _BOTH_NORMALISED


def _classify_direction(word: str) -> Optional[str]:
    """Map an Arabic direction word to inbound/outbound/both or None."""
    w = _normalise(word)
    if w in _get_inbound_norm():
        return "inbound"
    if w in _get_outbound_norm():
        return "outbound"
    if w in _get_both_norm():
        return "both"
    return None


def _extract_direction_from_words(words: list[str]) -> Optional[str]:
    """Find the first direction word in a word list and return its direction."""
    for w in words:
        d = _classify_direction(w)
        if d:
            return d
    return None


# ── Checkpoint type detection ────────────────────────────────────────────────

_TYPE_PREFIXES: list[tuple[str, str]] = [
    ("بوابه ", "gate"),
    ("بوابات ", "gate"),
    ("شرطه ", "police"),
    ("اشارات ", "traffic_signal"),
    ("اشاره ", "traffic_signal"),
    ("دوار ", "roundabout"),
    ("جسر ", "bridge"),
    ("مدخل ", "entrance"),
    ("التفافي ", "bypass_road"),
    ("نفق ", "tunnel"),
    ("حاجز ", "checkpoint"),
    ("معبر ", "crossing"),
]
_TYPE_PREFIXES_NORM: list[tuple[str, str]] | None = None


def _get_type_prefixes_norm() -> list[tuple[str, str]]:
    global _TYPE_PREFIXES_NORM
    if _TYPE_PREFIXES_NORM is None:
        _TYPE_PREFIXES_NORM = [(_normalise(prefix), cp_type) for prefix, cp_type in _TYPE_PREFIXES]
    return _TYPE_PREFIXES_NORM


def detect_checkpoint_type(name: str) -> str:
    """Detect checkpoint type from Arabic name prefix."""
    norm = _normalise(name)
    for prefix, cp_type in _get_type_prefixes_norm():
        if norm.startswith(prefix):
            return cp_type
    return "checkpoint"

# ── Greeting prefixes ────────────────────────────────────────────────────────

GREETING_PREFIXES: list[list[str]] = [
    ["صباح", "الخير"],
    ["يسعد", "صباحك"],
    ["يسعد", "اوقاتك"],
    ["يسعد", "مساك"],
    ["السلام", "عليكم"],
    ["الله", "يسعد", "صباحك"],
    ["اخوي"],
    ["اخي"],
    ["مشرفنا"],
]

# ── Filler words ─────────────────────────────────────────────────────────────

FILLER_WORDS: set[str] = {
    "الحمدلله", "الحمد", "لله", "الله", "يعينكم", "يعطيكم", "العافيه",
    "العافية", "شباب", "يا", "اخوان", "اخواني", "ياشباب", "ياجماعه",
    "ياجماعة", "جماعه", "جماعة", "مشكورين", "شكرا", "يسلمو",
    "كيف", "شو", "هل", "وين", "ايش",
    "حاجز", "الحاجز", "حالياً", "حاليا", "هلا", "هلأ", "الان", "الآن",
    "تقريبا", "تقريباً", "اليوم", "صباح", "الخير", "مساء",
    "في", "على", "من", "عند", "الى", "إلى",
    # Generic nouns / quality adjectives — not location names
    "الفندق", "فندق", "نظيف", "نظيفه", "نظيفة", "نظيفين",
    "هادئ", "هادئه", "هادئة", "هادئين",
    "طبيعي", "طبيعيه", "طبيعية",
    "ومفتوح", "ومفتوحه", "ومفتوحة",
}

_FILLER_NORMALISED: set[str] | None = None

def _get_filler_normalised() -> set[str]:
    global _FILLER_NORMALISED
    if _FILLER_NORMALISED is None:
        _FILLER_NORMALISED = {_normalise(w) for w in FILLER_WORDS}
    return _FILLER_NORMALISED

# ── Name validation ──────────────────────────────────────────────────────────

def _validate_checkpoint_name(name: str) -> bool:
    """
    Reject names that are clearly not checkpoint names:
    - Pure direction words
    - Contain status words
    - Single common Arabic word
    - Too short after normalization
    """
    if not name or len(name.strip()) < 2:
        return False

    words = name.strip().split()
    if not words:
        return False

    norm_words = [_normalise(w) for w in words]
    dir_norm = _get_direction_normalised()
    status_norm = _get_status_normalised()
    filler_norm = _get_filler_normalised()

    # All words are direction/status/filler → not a name
    non_noise = [w for w in norm_words
                 if w not in dir_norm and w not in status_norm and w not in filler_norm]
    if not non_noise:
        return False

    # Any word is a status word → contaminated name
    if any(w in status_norm for w in norm_words):
        return False

    # Single word that's a direction word
    if len(words) == 1 and norm_words[0] in dir_norm:
        return False

    # Known bad patterns: "بدون" (without) is not a name
    bad_single = {"بدون", "مع", "عند", "حتي", "الان", "هسا", "اللحظه"}
    if len(words) == 1 and norm_words[0] in bad_single:
        return False

    return True


# Lines containing these strings are headers/noise, skip them
SKIP_PATTERNS = [
    r"^\s*$",
    r"^[#\-_=*]+",
    r"^الضفة",
    r"^منطقة",
    r"^محافظة",
    r"^جنوب",
    r"^شمال",
    r"^وسط",
    r"^أولاً",
    r"^ثانياً",
    r"^ملاحظة",
    r"كافه\s+حواجز",
    r"كافة\s+حواجز",
    r"جميع\s+حواجز",
    r"باقي\s+حواجز",
    r"كامل\s+خط",
    r"^احوال\s+طرق",
    r"^احوال\s+الطرق",
]
_SKIP_RE = [re.compile(p) for p in SKIP_PATTERNS]


# ── Arabic text normalisation ─────────────────────────────────────────────────

def _normalise(text: str) -> str:
    text = re.sub(r"[\u064B-\u065F\u0670]", "", text)
    text = re.sub(r"[أإآٱ]", "ا", text)
    text = re.sub(r"ى", "ي", text)
    text = re.sub(r"ة", "ه", text)
    text = " ".join(text.split())
    return text.strip()


def _strip_emojis(text: str) -> str:
    return " ".join(_ALL_EMOJI_RE.sub(" ", text).split()).strip()


def _strip_leading_waw(key: str) -> str:
    if len(key) > 2 and key.startswith("و") and not key.startswith(("واد", "وادي")):
        return key[1:]
    return key


def _truncate_at_conjunction(words: list[str]) -> list[str]:
    """
    Stop collecting name words at the first Arabic conjunction word (و-prefix).
    Handles cases like "مدخل الفندق حجة ونظيف" → truncates at "ونظيف".
    Allows place-name prefixes: وادي, واد, وادي...
    """
    result = []
    for i, w in enumerate(words):
        if i > 0 and w.startswith("و") and len(w) > 2 and not w.startswith(("وادي", "واد")):
            break
        result.append(w)
    return result


def _strip_greeting_prefix(words: list[str]) -> list[str]:
    changed = True
    while changed:
        changed = False
        for prefix in GREETING_PREFIXES:
            plen = len(prefix)
            if len(words) > plen:
                normalised_head = [_normalise(w) for w in words[:plen]]
                normalised_prefix = [_normalise(p) for p in prefix]
                if normalised_head == normalised_prefix:
                    words = words[plen:]
                    changed = True
                    break
    return words


def _clean_name(text: str) -> str:
    """Clean a checkpoint name: strip emojis, punctuation, parenthetical aliases."""
    cleaned = _strip_emojis(text)
    # Strip parenthetical content like (عنبتا)
    cleaned = re.sub(r"\([^)]*\)", "", cleaned)
    # Remove punctuation
    cleaned = re.sub(r"[.,،؟?!:;()\[\]{}\"\u2018\u2019'…\-–—/\\|]", " ", cleaned)
    return " ".join(cleaned.split()).strip()


def make_canonical_key(name_ar: str) -> str:
    key = _normalise(name_ar).replace(" ", "_")
    key = _strip_leading_waw(key)
    return CHECKPOINT_ALIASES.get(key, key)


# ── Line-level helpers ────────────────────────────────────────────────────────

def _is_skippable(line: str) -> bool:
    for rx in _SKIP_RE:
        if rx.search(line):
            return True
    return False


def _is_status_word(word: str) -> bool:
    return word in _get_status_normalised()


def _extract_status(words: list[str]) -> tuple[str | None, str | None, int]:
    """
    Try to extract status from the end of the word list.
    Returns (canonical_status, raw_status_text, words_consumed).
    """
    if len(words) >= 2:
        bigram = " ".join(words[-2:])
        bigram_n = _normalise(bigram)
        if bigram_n in STATUS_BIGRAMS:
            return STATUS_BIGRAMS[bigram_n], bigram, 2

    last = _normalise(words[-1])
    if last in _get_status_normalised():
        for k, v in STATUS_MAP.items():
            if _normalise(k) == last:
                return v, words[-1], 1

    return None, None, 0


def _find_any_status(words: list[str]) -> tuple[str | None, str | None]:
    """Find any status word anywhere in a word list. Returns (status, raw)."""
    for w in reversed(words):
        w_norm = _normalise(w)
        if _is_status_word(w_norm):
            for k, v in STATUS_MAP.items():
                if _normalise(k) == w_norm:
                    return v, w
    return None, None


def _has_status_emoji(text: str) -> bool:
    return bool(_EMOJI_RE.search(text))


def _extract_emoji_status(text: str) -> tuple[str | None, str | None]:
    for match in _EMOJI_RE.finditer(text):
        emoji = match.group()
        return EMOJI_STATUS[emoji], emoji
    return None, None


# ── Colon-format parser ──────────────────────────────────────────────────────
# Handles admin lines like:
#   بزاريا: ✅ سالك بالاتجاهين
#   ياسوف: ❌ مغلق
#   عناب (عنبتا): الداخل: سالك - الخارج مغلق
#   بوابة كفل حارس:  مغلق بالاتجاهين ❌️❌️

def parse_colon_line(line: str) -> Optional[dict | list[dict]]:
    """
    Parse a colon-delimited checkpoint line.
    The first colon separates name from status info.

    For dual-direction lines like:
      عناب (عنبتا): الداخل: سالك - الخارج مغلق
    Returns a LIST of two dicts (one per direction).

    For single-direction or no-direction lines, returns a single dict.
    """
    original_line = line.strip()
    if not original_line or _is_skippable(original_line):
        return None

    if ":" not in original_line:
        return None

    colon_idx = original_line.index(":")
    name_part = original_line[:colon_idx].strip()
    status_part = original_line[colon_idx + 1:].strip()

    if not name_part or not status_part:
        return None

    name_clean = _clean_name(name_part)
    if not name_clean or len(name_clean) < 2:
        return None
    if len(name_clean.split()) > 5:
        return None
    if not _validate_checkpoint_name(name_clean):
        return None

    canonical = make_canonical_key(name_clean)

    # Check for dual-direction pattern: "الداخل: سالك - الخارج مغلق" or "الداخل سالك الخارج مغلق"
    dir_norm = _get_direction_normalised()
    status_words_clean = _strip_emojis(status_part)
    # Strip punctuation for direction counting (colons after direction words)
    status_words_nopunct = re.sub(r"[.:;،]", " ", status_words_clean)
    parts_words = status_words_nopunct.split()

    # Count direction words in status_part
    dir_count = sum(1 for w in parts_words if _normalise(w) in dir_norm)

    if dir_count >= 2:
        # Dual direction — split on dash or second direction word
        results = []
        # Split on " - " or "-" to get segments
        segments = re.split(r"\s*[-–—]\s*", status_part)
        if len(segments) < 2:
            # No dash — try splitting on direction words
            # Find positions of direction words
            dir_positions = []
            for i, w in enumerate(parts_words):
                if _normalise(w) in dir_norm:
                    dir_positions.append(i)
            if len(dir_positions) >= 2:
                seg1 = " ".join(parts_words[dir_positions[0]:dir_positions[1]])
                seg2 = " ".join(parts_words[dir_positions[1]:])
                segments = [seg1, seg2]

        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            seg_clean = re.sub(r"[.:;،]", " ", _strip_emojis(seg))
            seg_words = seg_clean.split()
            direction = _extract_direction_from_words(seg_words)
            # Extract status from this segment
            seg_status, seg_raw = _extract_emoji_status(seg)
            if not seg_status and seg_words:
                seg_status, seg_raw = _find_any_status(seg_words)
            if seg_status:
                results.append({
                    "name_raw":      name_clean,
                    "canonical_key": canonical,
                    "status":        seg_status,
                    "status_raw":    seg_raw,
                    "direction":     direction,
                    "raw_line":      original_line,
                })

        return results if results else None

    # Single status line — check for direction
    direction = _extract_direction_from_words(parts_words)

    # Check for "بالاتجاهين" (both directions)
    if any(_normalise(w) in _get_both_norm() for w in parts_words):
        direction = "both"

    status, status_raw = _extract_emoji_status(status_part)
    if not status:
        status_words_list = _strip_emojis(status_part).split()
        if status_words_list:
            status, status_raw = _find_any_status(status_words_list)

    if not status:
        return None

    return {
        "name_raw":      name_clean,
        "canonical_key": canonical,
        "status":        status,
        "status_raw":    status_raw,
        "direction":     direction,
        "raw_line":      original_line,
    }


# ── Word-based parser ────────────────────────────────────────────────────────

def parse_line(line: str) -> Optional[dict]:
    """
    Parse one line of a checkpoint message (word-based).
    Returns dict or None.
    """
    original_line = line.strip()
    if not original_line or _is_skippable(original_line):
        return None

    # Strip emojis before word splitting
    line = _strip_emojis(original_line)
    if not line:
        return None

    # Also strip colons and punctuation for word-based parsing
    line = re.sub(r"[.:;،\-–—]", " ", line)
    line = re.sub(r"\([^)]*\)", "", line)  # strip parenthetical
    line = " ".join(line.split()).strip()

    words = line.split()
    if len(words) < 2:
        return None

    # Check for direction words → extract base name and direction
    dir_norm = _get_direction_normalised()
    dir_indices = [i for i, w in enumerate(words) if _normalise(w) in dir_norm]

    if dir_indices and dir_indices[0] > 0:
        first_non_name = dir_indices[0]
        for i in range(len(words)):
            w_norm = _normalise(words[i])
            if _is_status_word(w_norm) or w_norm in dir_norm:
                first_non_name = min(first_non_name, i)
                break
        base_name_words = words[:first_non_name]
        direction = _extract_direction_from_words(words)
        status, status_raw, consumed = _extract_status(words)
        if not status:
            status, status_raw = _find_any_status(words)
        if status and base_name_words:
            base_name_words = _strip_greeting_prefix(base_name_words)
            base_name_words = _truncate_at_conjunction(base_name_words)
            name_raw = " ".join(base_name_words).strip()
            if not name_raw or not _validate_checkpoint_name(name_raw):
                return None
            return {
                "name_raw":      name_raw,
                "canonical_key": make_canonical_key(name_raw),
                "status":        status,
                "status_raw":    status_raw,
                "direction":     direction,
                "raw_line":      original_line,
            }

    # Standard path: status at end
    status, status_raw, consumed = _extract_status(words)
    if not status:
        return None

    name_words = words[: len(words) - consumed]
    name_words = _strip_greeting_prefix(name_words)
    name_words = _truncate_at_conjunction(name_words)
    name_raw = " ".join(name_words).strip()
    if not name_raw or not _validate_checkpoint_name(name_raw):
        return None

    if len(name_raw.split()) > 4:
        return None

    # Check for "بالاتجاهين" in the status area
    direction = _extract_direction_from_words(words[len(words) - consumed:]) if consumed else None

    return {
        "name_raw":      name_raw,
        "canonical_key": make_canonical_key(name_raw),
        "status":        status,
        "status_raw":    status_raw,
        "direction":     direction,
        "raw_line":      original_line,
    }


# ── Emoji-based parser ──────────────────────────────────────────────────────

def _clean_checkpoint_name(text: str) -> str:
    """Extract a clean checkpoint name from free-text by removing noise."""
    cleaned = _strip_emojis(text)
    cleaned = re.sub(r"\([^)]*\)", "", cleaned)
    cleaned = re.sub(r"[.,،؟?!:;()\[\]{}\"\u2018\u2019'…\-–—/\\|]", " ", cleaned)

    words = cleaned.split()
    result = []
    dir_norm = _get_direction_normalised()
    for w in words:
        w_stripped = w.strip()
        if not w_stripped:
            continue
        w_norm = _normalise(w_stripped)
        if _is_status_word(w_norm):
            continue
        if w_norm in _get_filler_normalised() or w_stripped in FILLER_WORDS:
            continue
        if w_norm in dir_norm:
            continue
        result.append(w_stripped)

    # Truncate at conjunction-prefixed words (ونظيف, وسالك, etc.)
    result = _truncate_at_conjunction(result)
    return " ".join(result).strip()


def parse_emoji_line(line: str) -> Optional[dict]:
    """Parse one line using emoji-based detection."""
    line = line.strip()
    if not line:
        return None

    status, emoji = _extract_emoji_status(line)
    if not status:
        return None

    name_raw = _clean_checkpoint_name(line)

    if len(name_raw) < 2:
        return None
    if len(name_raw.split()) > 4:
        return None
    if not _validate_checkpoint_name(name_raw):
        return None

    # Check for direction context
    line_words = _strip_emojis(line).split()
    direction = _extract_direction_from_words(line_words)

    return {
        "name_raw":      name_raw,
        "canonical_key": make_canonical_key(name_raw),
        "status":        status,
        "status_raw":    emoji,
        "direction":     direction,
        "raw_line":      line,
    }


# ── Message-level parser ────────────────────────────────────────────────────

def _parse_any_line(line: str) -> Optional[dict | list[dict]]:
    """
    Try all parsing strategies on a single line, in priority order.
    May return a single dict, a list of dicts (for dual-direction lines), or None.
    """
    line_stripped = line.strip()
    if not line_stripped:
        return None

    # 1. Colon-format (most reliable for admin) — may return list for dual-direction
    if ":" in line_stripped:
        parsed = parse_colon_line(line_stripped)
        if parsed:
            return parsed

    # 2. Word-based
    parsed = parse_line(line_stripped)
    if parsed:
        return parsed

    # 3. Emoji-based fallback
    if _has_status_emoji(line_stripped):
        parsed = parse_emoji_line(line_stripped)
        if parsed:
            return parsed

    return None


def is_admin_message(text: str) -> bool:
    """
    Structural fallback: treat as admin if it's a multi-line list
    where >= 50% of non-empty lines parse as checkpoint+status.
    """
    lines = text.split("\n")
    non_empty = [l for l in lines if l.strip() and not _is_skippable(l.strip())]
    if len(non_empty) < 3:
        return False
    matched = sum(1 for l in non_empty if _parse_any_line(l) is not None)
    return matched / len(non_empty) >= 0.50


def parse_message(text: str, is_admin: bool) -> list[dict]:
    """
    Parse a full Telegram message into a list of checkpoint status updates.

    Per-line strategy with cascading fallback:
      1. Colon-format (name: emoji/status)
      2. Word-based (name status_word)
      3. Emoji-based (✅ name or name ✅)

    Returns list of parsed dicts (may be empty).
    For dual-direction lines, returns separate entries per direction.
    """
    results = []
    seen_keys: set[str] = set()

    for line in text.split("\n"):
        parsed = _parse_any_line(line)
        if parsed is None:
            continue
        # Handle both single dict and list of dicts (dual-direction)
        items = parsed if isinstance(parsed, list) else [parsed]
        for item in items:
            # For direction-aware dedup, use (key, direction) as seen key
            direction = item.get("direction") or ""
            dedup_key = f"{item['canonical_key']}:{direction}"
            if dedup_key not in seen_keys:
                results.append(item)
                seen_keys.add(dedup_key)

    return results
