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
from pathlib import Path
from typing import Optional
from .checkpoint_parser import _normalise

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
                canonical_key = cp.get('canonical_key', '').strip()
                name_ar = cp.get('name_ar', '').strip()
                name_en = cp.get('name_en', '').strip()

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
    path = Path(__file__).resolve().parent.parent / "data" / "known_checkpoints.json"
    await kb.load_from_file(path)
    _knowledge_base = kb
    return kb


def get_knowledge_base() -> Optional[CheckpointKnowledgeBase]:
    """Get the global knowledge base instance (may be None if not loaded)."""
    return _knowledge_base
