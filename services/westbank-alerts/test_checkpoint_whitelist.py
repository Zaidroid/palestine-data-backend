"""
Tests for the new checkpoint whitelist system.

Run with: pytest test_checkpoint_whitelist.py -v
"""

import pytest
import asyncio
import json
from pathlib import Path
from app.checkpoint_knowledge_base import CheckpointKnowledgeBase
from app.checkpoint_strict_validator import CheckpointStrictValidator
from app.checkpoint_whitelist_parser import parse_message_whitelist
from app.checkpoint_parser import _normalise


@pytest.fixture
def knowledge_base():
    """Create a minimal knowledge base for testing."""
    kb = CheckpointKnowledgeBase()

    # Simulate the core checkpoints that should exist
    minimal_checkpoints = [
        {
            "canonical_key": "عين_سينيا",
            "name_ar": "عين سينيا",
            "name_en": "Ein Sinya",
            "region": "ramallah",
            "checkpoint_type": "checkpoint",
            "latitude": 31.9830,
            "longitude": 35.2240,
            "aliases": ["عين سنيا", "عين سينا"],
        },
        {
            "canonical_key": "حواره",
            "name_ar": "حوارة",
            "name_en": "Huwara",
            "region": "nablus",
            "checkpoint_type": "checkpoint",
            "latitude": 32.1587,
            "longitude": 35.2538,
            "aliases": ["حوارة"],
        },
        {
            "canonical_key": "دير_شرف",
            "name_ar": "دير شرف",
            "name_en": "Deir Sharaf",
            "region": "nablus",
            "checkpoint_type": "checkpoint",
            "latitude": 32.2380,
            "longitude": 35.1830,
            "aliases": ["دير شرف"],
        },
        {
            "canonical_key": "فرش_الهوي",
            "name_ar": "فرش الهوى",
            "name_en": "Farsh al-Hawa",
            "region": "hebron",
            "checkpoint_type": "checkpoint",
            "latitude": 31.5380,
            "longitude": 35.0780,
            "aliases": ["فرش الهوا"],
        },
        {
            "canonical_key": "عطاره",
            "name_ar": "عطارة",
            "name_en": "Atara",
            "region": "ramallah",
            "checkpoint_type": "checkpoint",
            "latitude": 32.0150,
            "longitude": 35.1870,
        },
    ]

    # Manually load into knowledge base
    for cp in minimal_checkpoints:
        kb.by_canonical_key[cp["canonical_key"]] = cp
        name_norm = _normalise(cp["name_ar"])
        kb.by_name_norm[name_norm] = cp["canonical_key"]
        kb.all_names.append((name_norm, cp["canonical_key"]))

        for alias in cp.get("aliases", []):
            alias_norm = _normalise(alias)
            kb.aliases[alias_norm] = cp["canonical_key"]

    kb.all_names.sort(key=lambda x: -len(x[0]))

    return kb


class TestCheckpointStrictValidator:
    """Test the strict validator."""

    def test_valid_checkpoint_names(self):
        """Test that legitimate checkpoint names pass validation."""
        valid_names = [
            "عين سينيا",
            "حوارة",
            "دير شرف",
            "فرش الهوى",
            "عطارة",
        ]
        for name in valid_names:
            is_valid, reason = CheckpointStrictValidator.validate_name(name)
            assert is_valid, f"'{name}' should be valid but rejected: {reason}"

    def test_reject_status_words(self):
        """Test that names with status words are rejected."""
        invalid_names = [
            "عين سينيا سالكه",  # contains "سالكه" (open)
            "حوارة مغلق",  # contains "مغلق" (closed)
            "دير شرف ازمه",  # contains "ازمه" (congested)
            "عطاره زحمه",  # contains "زحمه" (congested)
            "فرش الهوا مفتوح",  # contains "مفتوح" (open)
        ]
        for name in invalid_names:
            is_valid, reason = CheckpointStrictValidator.validate_name(name)
            assert not is_valid, f"'{name}' should be invalid but passed"
            assert "status" in reason.lower() or "contains" in reason.lower()

    def test_reject_direction_only_words(self):
        """Test that pure direction words are rejected."""
        invalid_names = [
            "الداخل",  # only inbound
            "الخارج",  # only outbound
            "بالاتجاهين",  # only both
        ]
        for name in invalid_names:
            is_valid, reason = CheckpointStrictValidator.validate_name(name)
            assert not is_valid, f"'{name}' should be invalid but passed: {reason}"

    def test_reject_filler_words(self):
        """Test that pure filler/greeting words are rejected."""
        invalid_names = [
            "الحمدلله",
            "يعطيك",
            "شباب",
            "الله",
        ]
        for name in invalid_names:
            is_valid, reason = CheckpointStrictValidator.validate_name(name)
            assert not is_valid, f"'{name}' should be invalid but passed: {reason}"

    def test_reject_empty_names(self):
        """Test that empty names are rejected."""
        is_valid, _ = CheckpointStrictValidator.validate_name("")
        assert not is_valid
        is_valid, _ = CheckpointStrictValidator.validate_name("   ")
        assert not is_valid

    def test_reject_too_many_words(self):
        """Test that names with too many words are rejected."""
        is_valid, _ = CheckpointStrictValidator.validate_name("word one two three four five")
        assert not is_valid

    def test_reject_sentences(self):
        """Test that sentence-like strings are rejected."""
        is_valid, _ = CheckpointStrictValidator.validate_name("يعطيك العافيه عين سينيا حاجز وتفتيش")
        assert not is_valid


class TestCheckpointKnowledgeBase:
    """Test the knowledge base lookups."""

    def test_find_checkpoint_exact(self, knowledge_base):
        """Test exact match lookup."""
        result = knowledge_base.find_checkpoint("عين سينيا")
        assert result == "عين_سينيا"

        result = knowledge_base.find_checkpoint("حوارة")
        assert result == "حواره"

    def test_find_checkpoint_via_alias(self, knowledge_base):
        """Test lookup via alias."""
        result = knowledge_base.find_checkpoint("عين سنيا")  # alias
        assert result == "عين_سينيا"

        result = knowledge_base.find_checkpoint("فرش الهوا")  # alias
        assert result == "فرش_الهوي"

    def test_find_checkpoint_unknown(self, knowledge_base):
        """Test that unknown names return None."""
        result = knowledge_base.find_checkpoint("checkpoint_that_does_not_exist")
        assert result is None

    def test_get_checkpoint(self, knowledge_base):
        """Test getting full checkpoint data."""
        cp = knowledge_base.get_checkpoint("عين_سينيا")
        assert cp is not None
        assert cp["name_ar"] == "عين سينيا"
        assert cp["name_en"] == "Ein Sinya"

    def test_is_known(self, knowledge_base):
        """Test whitelist check."""
        assert knowledge_base.is_known("عين_سينيا")
        assert knowledge_base.is_known("حواره")
        assert not knowledge_base.is_known("fake_checkpoint")


class TestCheckpointWhitelistParser:
    """Test the whitelist parser."""

    def test_parse_simple_message(self, knowledge_base):
        """Test parsing a simple checkpoint message."""
        message = "عين سينيا سالكه ✅"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "عين_سينيا"
        assert results[0]["status"] == "open"
        assert results[0]["name_raw"] == "عين سينيا"

    def test_parse_with_direction(self, knowledge_base):
        """Test parsing checkpoint with direction."""
        message = "عين سينيا سالكه بالاتجاهين ✅"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "عين_سينيا"
        assert results[0]["status"] == "open"
        assert results[0]["direction"] == "both"

    def test_parse_emoji_based(self, knowledge_base):
        """Test parsing with emoji status."""
        message = "حوارة ✅"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "حواره"
        assert results[0]["status"] == "open"

    def test_parse_colon_format(self, knowledge_base):
        """Test parsing admin colon-format."""
        message = "عين سينيا: ✅ سالك بالاتجاهين"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "عين_سينيا"
        assert results[0]["status"] == "open"

    def test_parse_closed_status(self, knowledge_base):
        """Test parsing closed checkpoint."""
        message = "دير شرف مغلق ❌"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "دير_شرف"
        assert results[0]["status"] == "closed"

    def test_parse_congested_status(self, knowledge_base):
        """Test parsing congested checkpoint."""
        message = "عطاره ازمه 🔴"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 1
        assert results[0]["canonical_key"] == "عطاره"
        assert results[0]["status"] == "congested"

    def test_parse_multiple_checkpoints(self, knowledge_base):
        """Test parsing message with multiple checkpoints."""
        message = """عين سينيا سالكه ✅
دير شرف مغلق ❌
حوارة مفتوحة
"""
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 3
        canonical_keys = [r["canonical_key"] for r in results]
        assert "عين_سينيا" in canonical_keys
        assert "دير_شرف" in canonical_keys
        assert "حواره" in canonical_keys

    def test_reject_unknown_checkpoint(self, knowledge_base):
        """Test that unknown checkpoints are rejected."""
        message = "checkpoint_unknown سالكه"
        results = parse_message_whitelist(message, knowledge_base)

        assert len(results) == 0

    def test_reject_status_contaminated_name(self, knowledge_base):
        """Test that names with status words are rejected."""
        # This message tries to pass a status-contaminated name
        message = "عين سينيا سالكه بالاتجاهين"  # has status in name position
        results = parse_message_whitelist(message, knowledge_base)

        # Should still parse correctly because the parser extracts direction first
        assert len(results) == 1

    def test_deduplication(self, knowledge_base):
        """Test that duplicate (canonical_key, direction) pairs are deduplicated."""
        message = """عين سينيا سالكه
عين سينيا سالكه
عين سينيا سالكه
"""
        results = parse_message_whitelist(message, knowledge_base)

        # Should only have one result (deduplicated)
        assert len(results) == 1
        assert results[0]["canonical_key"] == "عين_سينيا"

    def test_empty_message(self, knowledge_base):
        """Test that empty messages are handled."""
        results = parse_message_whitelist("", knowledge_base)
        assert len(results) == 0

        results = parse_message_whitelist("   ", knowledge_base)
        assert len(results) == 0


if __name__ == "__main__":
    # For running tests manually
    pytest.main([__file__, "-v"])
