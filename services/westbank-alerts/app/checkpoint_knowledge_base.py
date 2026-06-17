"""
Checkpoint Knowledge Base — single source of truth for all known checkpoints.

Loads from known_checkpoints.json and provides fast indexed lookups by:
- Canonical key (primary)
- Normalized name (for matching incoming messages)
- English name
- Aliases (variant spellings from the curated list)
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional
from .checkpoint_parser import _normalise


def _collapse_elongation(s: str) -> str:
    """Collapse runs of 2+ identical characters to one — social-media letter
    stretching (المربععه → المربعه, بحححرررري → بحري)."""
    return re.sub(r"(.)\1+", r"\1", s)

log = logging.getLogger("checkpoint_knowledge_base")


class CheckpointKnowledgeBase:
    """
    Whitelist of known checkpoints with indexed lookups.

    All normalisation uses checkpoint_parser._normalise() for consistency
    with the rest of the system.
    """

    def __init__(self):
        # canonical_key → full checkpoint dict
        self.by_canonical_key: dict[str, dict] = {}

        # normalised_name → canonical_key (fast lookup for incoming messages)
        self.by_name_norm: dict[str, str] = {}

        # english_name_lower → canonical_key
        self.by_english: dict[str, str] = {}

        # alias (normalised) → canonical_key
        self.aliases: dict[str, str] = {}

        # All names sorted by length DESC (for fuzzy matching)
        # (normalised_name, canonical_key)
        self.all_names: list[tuple[str, str]] = []

    async def load_from_file(self, path: Path) -> None:
        """
        Load known checkpoints from JSON file and build all indexes.

        Expected format:
        [
            {
                "canonical_key": "حواره",
                "name_ar": "حوارة",
                "name_en": "Huwara",
                "region": "nablus",
                "checkpoint_type": "checkpoint",
                "latitude": 32.1587,
                "longitude": 35.2538,
                "aliases": ["حواره", "حوارة"]  # optional
            },
            ...
        ]
        """
        if not path.exists():
            log.warning(f"Known checkpoints file not found: {path}")
            return

        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Handle both raw list and {checkpoints: [...]} format
            checkpoints = data if isinstance(data, list) else data.get('checkpoints', [])

            for cp in checkpoints:
                canonical_key = (cp.get('canonical_key') or '').strip()
                name_ar = (cp.get('name_ar') or '').strip()
                name_en = (cp.get('name_en') or '').strip()

                if not canonical_key or not name_ar:
                    log.warning(f"Skipping checkpoint with missing key or Arabic name: {cp}")
                    continue

                # Store full checkpoint data
                self.by_canonical_key[canonical_key] = cp

                # Index by normalized name
                name_norm = _normalise(name_ar)
                self.by_name_norm[name_norm] = canonical_key
                self.all_names.append((name_norm, canonical_key))

                # Index by English name
                if name_en:
                    name_en_lower = name_en.lower()
                    self.by_english[name_en_lower] = canonical_key

                # Index aliases (if provided)
                aliases = cp.get('aliases', [])
                if isinstance(aliases, list):
                    for alias in aliases:
                        if alias:
                            alias_norm = _normalise(alias)
                            self.aliases[alias_norm] = canonical_key

            # Sort by name length descending (longer names match first, avoid false positives)
            self.all_names.sort(key=lambda x: -len(x[0]))

            log.info(
                f"Loaded {len(self.by_canonical_key)} checkpoints, "
                f"{len(self.by_name_norm)} normalized name mappings, "
                f"{len(self.aliases)} aliases"
            )

        except Exception as e:
            log.error(f"Failed to load known checkpoints from {path}: {e}", exc_info=True)

    def find_checkpoint(self, name_ar: str) -> Optional[str]:
        """
        Find a known checkpoint by Arabic name.

        Returns the canonical_key if found, None otherwise.

        Tries in order:
        1. Direct exact match (after normalization)
        2. Alias lookup
        3. Fuzzy substring match (longer names first)
        """
        if not name_ar or len(name_ar.strip()) < 2:
            return None

        name_norm = _normalise(name_ar)

        # 1. Direct normalized match
        if name_norm in self.by_name_norm:
            return self.by_name_norm[name_norm]

        # 2. Check aliases
        if name_norm in self.aliases:
            return self.aliases[name_norm]

        # 3. Fuzzy substring match (longer names first to avoid false positives)
        for norm_known, canonical_key in self.all_names:
            if len(norm_known) < 3:
                continue
            known_words = norm_known.split()
            input_words = name_norm.split()

            if norm_known in name_norm:
                # Known name is substring of incoming text — only accept if the
                # incoming text is not much longer (prevents "الفندق" matching
                # "مدخل الفندق حجة ونظيف" which has 3 extra unrelated words)
                extra_words = len(input_words) - len(known_words)
                if extra_words > len(known_words):
                    # Input has more than double the words — too loose a match
                    continue
                return canonical_key

            if name_norm in norm_known:
                # Incoming is substring of known — always accept
                return canonical_key

        # ── Phase 3b: noise-robust recovery. ADDITIVE — only reached when exact /
        # alias / substring all missed, and resolves ONLY to an exact whitelist
        # name (no open-ended fuzzy), so existing matches are unchanged and there
        # is no wrong-checkpoint risk.

        # 3.5 De-elongation retry: collapse stretched letters and re-match
        # (المربععه بحري → المربعه ...).
        deelong = _collapse_elongation(name_norm)
        if deelong != name_norm:
            if deelong in self.by_name_norm:
                return self.by_name_norm[deelong]
            if deelong in self.aliases:
                return self.aliases[deelong]
            for norm_known, canonical_key in self.all_names:
                if len(norm_known) >= 3 and norm_known in deelong:
                    extra = len(deelong.split()) - len(norm_known.split())
                    if extra <= len(norm_known.split()):
                        return canonical_key

        # 4. Distinctive whole-token match: a known single-token name of >= 4 chars
        # appearing as a complete token in the (de-elongated) text recovers a real
        # whitelisted checkpoint surrounded by status/prefix noise
        # (عطارة البرج فتحت الان → عطاره). The >= 4 chars + whole-token gate avoids
        # short-substring false positives ("تل" inside "مقاتلو").
        tokens = set(deelong.split())
        for norm_known, canonical_key in self.all_names:
            if len(norm_known) >= 4 and " " not in norm_known and norm_known in tokens:
                return canonical_key

        return None

    def get_checkpoint(self, canonical_key: str) -> Optional[dict]:
        """
        Return full checkpoint object if it exists in the whitelist.
        Returns None if not found.
        """
        return self.by_canonical_key.get(canonical_key)

    def is_known(self, canonical_key: str) -> bool:
        """
        Check if a canonical_key is in the whitelist.
        """
        return canonical_key in self.by_canonical_key

    def all_canonical_keys(self) -> list[str]:
        """Return all known canonical keys."""
        return list(self.by_canonical_key.keys())

    def size(self) -> int:
        """Return number of known checkpoints."""
        return len(self.by_canonical_key)


# Global instance — loaded once at startup
_knowledge_base: Optional[CheckpointKnowledgeBase] = None


async def load_knowledge_base() -> CheckpointKnowledgeBase:
    """
    Load the checkpoint knowledge base from disk.
    Should be called once during application startup.
    """
    global _knowledge_base
    kb = CheckpointKnowledgeBase()
    # Same shadowing issue as load_location_kb: prefer the image-baked path,
    # fall back to /data (volume-mounted alerts service data).
    candidates = [
        Path(__file__).resolve().parent.parent / "data" / "known_checkpoints.json",
        Path("/data/known_checkpoints.json"),
    ]
    for path in candidates:
        if path.exists():
            await kb.load_from_file(path)
            break
    _knowledge_base = kb
    return kb


def get_knowledge_base() -> Optional[CheckpointKnowledgeBase]:
    """Get the global knowledge base instance (may be None if not loaded)."""
    return _knowledge_base


def filter_to_known(checkpoints: list, kb: Optional[CheckpointKnowledgeBase]) -> list:
    """Serve-time guard (F3): expose only checkpoints in the curated whitelist.

    Hides un-curated / junk rows (e.g. a chatter line that became a row) from the
    public map + list WITHOUT deleting them. Fail-open: if the KB isn't loaded yet,
    return everything rather than blank the map.

    Imported static-base layers (source_layer osm/ocha/manual) are always allowed
    through — they're authoritative geographic obstacles, not chatter junk.
    """
    if kb is None:
        return checkpoints
    return [c for c in checkpoints
            if c.get("source_layer") in ("osm", "ocha", "manual")
            or kb.is_known(c.get("canonical_key"))]
