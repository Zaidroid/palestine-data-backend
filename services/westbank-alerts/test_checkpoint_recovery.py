"""Phase 3b: recover real WHITELISTED checkpoints buried in social-media noise.

The live candidate capture (3a) revealed that much of the 67% "coverage gap" is
not unknown checkpoints — it's known ones the strict matcher dropped because the
name carried noise: letter elongation (المربععه), trailing status words
(عطارة البرج فتحت الان), entrance prefixes (على مدخل ترمسعيا).

These are purely-additive recovery steps in find_checkpoint: they fire ONLY when
exact/alias/substring all miss, and only resolve to an EXACT whitelist name (no
open-ended fuzzy), so existing matches are unchanged and there is no
wrong-checkpoint risk. Garbage and too-short tokens must still miss.
"""
import os
os.environ.setdefault("API_SECRET_KEY", "test-secret-key-0123456789abcdef")

from app.checkpoint_knowledge_base import CheckpointKnowledgeBase
from app.checkpoint_parser import _normalise


def _kb():
    kb = CheckpointKnowledgeBase()
    rows = [
        ("عطاره", "عطارة", "Atara"),
        ("المربعه", "المربعة", "Al-Murabbaa"),
        ("ترمسعيا", "ترمسعيا", "Turmus Ayya"),
        ("بيتا", "بيتا", "Beita"),  # 4-char name, for the distinctive-token guard
    ]
    for ck, name_ar, name_en in rows:
        cp = {"canonical_key": ck, "name_ar": name_ar, "name_en": name_en,
              "region": "x", "checkpoint_type": "checkpoint", "latitude": 32.0, "longitude": 35.0}
        kb.by_canonical_key[ck] = cp
        n = _normalise(name_ar)
        kb.by_name_norm[n] = ck
        kb.all_names.append((n, ck))
    kb.all_names.sort(key=lambda x: -len(x[0]))
    return kb


def test_clean_names_still_match_exactly():
    kb = _kb()
    assert kb.find_checkpoint("عطارة") == "عطاره"
    assert kb.find_checkpoint("ترمسعيا") == "ترمسعيا"


def test_recovers_letter_elongation():
    # المربععه (doubled ع) + garbled suffix → Al-Murabba'a.
    assert _kb().find_checkpoint("المربععه بحححرررري") == "المربعه"


def test_recovers_trailing_status_words():
    # عطارة + "البرج فتحت الان" (the tower opened now) → Atara.
    assert _kb().find_checkpoint("عطارة البرج فتحت الان") == "عطاره"


def test_recovers_entrance_prefix():
    # "على مدخل" (at the entrance of) + ترمسعيا → Turmus Ayya.
    assert _kb().find_checkpoint("على مدخل ترمسعيا") == "ترمسعيا"


def test_garbage_fragments_still_miss():
    kb = _kb()
    for junk in ["صار في", "وفي", "اندماج", "الوضع هادئ"]:
        assert kb.find_checkpoint(junk) is None, junk


def test_short_token_not_distinctive_enough():
    # A <4-char token must not match as a distinctive whole-token (avoids the
    # "تل inside مقاتلو" class of false positive). "في" is 2 chars.
    kb = _kb()
    assert kb.find_checkpoint("شيء ما في مكان") is None
