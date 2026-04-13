"""
Strict checkpoint validator — rejects corrupted or invalid checkpoint names.

This prevents garbage data from being stored: status words, direction words,
fillers, greetings, etc. mixed into checkpoint names.
"""

import logging
from .checkpoint_parser import (
    _normalise,
    STATUS_MAP,
    EMOJI_STATUS,
    DIRECTION_WORDS,
    FILLER_WORDS,
)

log = logging.getLogger("checkpoint_strict_validator")


# Words that, if present in a checkpoint name, indicate it's corrupted/invalid
INVALID_STATUS_WORDS = {
    # From STATUS_MAP
    "سالك", "سالكه", "سالكة", "سالكين",
    "مفتوح", "مفتوحه", "مفتوحة", "مفتوحين",
    "فاتح", "فتح",
    "مغلق", "مغلقه", "مغلقة", "مغلقين",
    "مقفل", "مقفله",
    "مسكر", "مسكره",
    "موقوف", "موقف",
    "مسدود", "مسدوده",
    "زحمه", "زحمة",
    "مزحوم", "ضاغط", "ضغط", "مزدحم", "مزدحمه", "ازدحام",
    "ازمه", "ازمة", "أزمة",  # crisis/congestion (common in messages)
    "بطيء", "بطئ", "بطيئ",
    "جيش", "عسكر",
    "مداهمه", "مداهمة",
    # Road quality adjectives (نظيف = clean/clear = effectively "open")
    "نظيف", "نظيفه", "نظيفة", "نظيفين",
    "هادئ", "هادئه", "هادئة", "هادئين",
    "طبيعي", "طبيعيه", "طبيعية",
}

# Words that, if they're the ONLY thing in the name, make it invalid
INVALID_FILLER_WORDS = {
    "الحمدلله", "الحمد", "لله", "الله", "يعينكم", "يعطيكم",
    "العافيه", "العافية",
    "شباب", "يا", "اخوان", "اخواني", "ياشباب", "ياجماعه",
    "ياجماعة", "جماعه", "جماعة",
    "مشكورين", "شكرا", "يسلمو",
    "كيف", "شو", "هل", "وين", "ايش",
    "حاجز", "الحاجز",
    "حالياً", "حاليا", "هلا", "هلأ", "الان", "الآن",
    "تقريبا", "تقريباً", "اليوم", "صباح", "الخير", "مساء",
    "في", "على", "من", "عند", "الى", "إلى",
    "بدون", "مع", "عند", "حتي", "هسا", "اللحظه",
    "يعطيك", "يعطيكم",
    "اخي", "اخوي",
}

# Direction-only words
INVALID_DIRECTION_WORDS = {
    "الداخل", "الخارج", "للداخل", "للخارج", "لداخل", "لخارج",
    "داخل", "خارج",
    "دخول", "خروج", "للدخول", "للخروج",
    "بالاتجاهين",
}

# Greeting phrase starters
INVALID_GREETING_STARTS = {
    "صباح", "مساء", "يسعد", "السلام", "مشرفنا", "اخي", "اخوي",
}

# Build normalized versions once for fast lookup
_INVALID_STATUS_NORM = {_normalise(w) for w in INVALID_STATUS_WORDS}
_INVALID_FILLER_NORM = {_normalise(w) for w in INVALID_FILLER_WORDS}
_INVALID_DIRECTION_NORM = {_normalise(w) for w in INVALID_DIRECTION_WORDS}
_INVALID_GREETING_NORM = {_normalise(w) for w in INVALID_GREETING_STARTS}


class CheckpointStrictValidator:
    """
    Validate that a parsed checkpoint name is legitimate.
    """

    @staticmethod
    def validate_name(name_ar: str) -> tuple[bool, str]:
        """
        Validate a checkpoint name against strict rules.

        Returns (is_valid, reason).
        Reason is a string explaining why it's invalid (or "OK" if valid).
        """
        if not name_ar:
            return False, "empty name"

        name_stripped = name_ar.strip()
        if len(name_stripped) < 2:
            return False, "name too short"

        norm = _normalise(name_stripped)
        if len(norm) < 2:
            return False, "normalized name too short"

        words = name_stripped.split()
        words_norm = [_normalise(w) for w in words]

        # Rule 1: No status words in the name
        for w_norm in words_norm:
            if w_norm in _INVALID_STATUS_NORM:
                return False, f"contains status word: {w_norm}"

        # Rule 2: No direction-only names (unless it's a multi-word name)
        if len(words) == 1 and words_norm[0] in _INVALID_DIRECTION_NORM:
            return False, "pure direction word"

        # Rule 3: No pure filler/greeting words (single word)
        if len(words) == 1 and words_norm[0] in _INVALID_FILLER_NORM:
            return False, "pure filler/greeting word"

        # Rule 4: Not a multi-word name that's ALL filler/direction
        non_noise = [w for w_norm, w in zip(words_norm, words)
                     if w_norm not in _INVALID_DIRECTION_NORM
                     and w_norm not in _INVALID_FILLER_NORM]
        if not non_noise:
            return False, "all words are filler/direction"

        # Rule 5: Max 4 words (longer = likely a sentence)
        if len(words) > 4:
            return False, "too many words (>4)"

        # Rule 5b: Any non-first word starts with و (conjunction) and its base form
        # is a status/filler word — e.g. "ونظيف", "وسالك", "ومفتوح"
        for i, (w, w_norm) in enumerate(zip(words, words_norm)):
            if i == 0:
                continue
            if w.startswith("و") and len(w) > 2 and not w.startswith(("وادي", "واد")):
                base_norm = _normalise(w[1:])  # strip the و conjunction
                if base_norm in _INVALID_STATUS_NORM or base_norm in _INVALID_FILLER_NORM:
                    return False, f"conjunction+status/filler word: {w}"

        # Rule 6: Not a sentence (heuristic: all words are very short or all very long)
        word_lengths = [len(w) for w in words_norm]
        avg_length = sum(word_lengths) / len(word_lengths) if word_lengths else 0
        # If average word length is very high (>8), might be sentence-like
        if avg_length > 8 and len(words) > 2:
            return False, "likely sentence (high avg word length)"

        # Rule 7: Not just a number or mostly numbers
        if norm.replace("_", "").isdigit():
            return False, "pure digits"

        # Rule 8: No weird unicode or control characters
        try:
            name_stripped.encode('utf-8')
        except UnicodeEncodeError:
            return False, "invalid unicode"

        return True, "OK"

    @staticmethod
    def validate_parsed_checkpoint(name_ar: str, status: str, direction: str = None) -> tuple[bool, str]:
        """
        Validate a fully parsed checkpoint record.

        Returns (is_valid, reason).
        """
        # Validate name
        is_valid, reason = CheckpointStrictValidator.validate_name(name_ar)
        if not is_valid:
            return is_valid, f"name validation: {reason}"

        # Validate status
        if not status or status not in {"open", "closed", "congested", "slow", "military", "unknown"}:
            return False, f"invalid status: {status}"

        # Validate direction (if provided)
        if direction and direction not in {"inbound", "outbound", "both"}:
            return False, f"invalid direction: {direction}"

        return True, "OK"
