"""
Location Knowledge Base — indexed lookups for West Bank cities/villages/camps.

Mirrors checkpoint_knowledge_base.py pattern. Provides fast text→location
resolution for geocoding alerts and computing area-level status.
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

log = logging.getLogger("location_knowledge_base")

# Reuse the same normalization as classifier.py
_ALEF_VARIANTS = re.compile(r"[إأآٱا]")
_TAA_MARBUTA = re.compile(r"ة")
_DIACRITICS = re.compile(
    r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC"
    r"\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]"
)


def _normalize(text: str) -> str:
    t = _DIACRITICS.sub("", text)
    t = _ALEF_VARIANTS.sub("ا", t)
    t = _TAA_MARBUTA.sub("ه", t)
    return t


class LocationKnowledgeBase:
    def __init__(self):
        self.by_key: dict[str, dict] = {}
        self.by_name_norm: dict[str, str] = {}
        self.by_english: dict[str, str] = {}
        self.aliases: dict[str, str] = {}
        self.all_names: list[tuple[str, str]] = []

    async def load_from_file(self, path: Path) -> None:
        if not path.exists():
            log.warning(f"Known locations file not found: {path}")
            return

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            locations = data if isinstance(data, list) else data.get("locations", [])

            for loc in locations:
                key = loc.get("canonical_key", "").strip()
                name_ar = loc.get("name_ar", "").strip()
                name_en = loc.get("name_en", "").strip()

                if not key or not name_ar:
                    continue

                self.by_key[key] = loc

                name_norm = _normalize(name_ar)
                self.by_name_norm[name_norm] = key
                self.all_names.append((name_norm, key))

                if name_en:
                    self.by_english[name_en.lower()] = key

                for alias in loc.get("aliases", []):
                    if alias:
                        self.aliases[_normalize(alias)] = key

            self.all_names.sort(key=lambda x: -len(x[0]))

            log.info(
                f"Loaded {len(self.by_key)} locations, "
                f"{len(self.by_name_norm)} name mappings, "
                f"{len(self.aliases)} aliases"
            )
        except Exception as e:
            log.error(f"Failed to load locations from {path}: {e}", exc_info=True)

    def find_location(self, text: str) -> Optional[str]:
        """Find the best matching location key from Arabic text. Longest match wins."""
        if not text or len(text.strip()) < 2:
            return None

        normed = _normalize(text)

        # Direct match
        if normed in self.by_name_norm:
            return self.by_name_norm[normed]
        if normed in self.aliases:
            return self.aliases[normed]

        # Substring scan (longest first)
        for name_norm, key in self.all_names:
            if len(name_norm) < 3:
                continue
            if name_norm in normed:
                return key

        return None

    def get_location(self, key: str) -> Optional[dict]:
        return self.by_key.get(key)

    def get_coordinates(self, key: str) -> Optional[tuple[float, float]]:
        loc = self.by_key.get(key)
        if loc and loc.get("latitude") and loc.get("longitude"):
            return (loc["latitude"], loc["longitude"])
        return None

    def get_governorate(self, key: str) -> Optional[str]:
        loc = self.by_key.get(key)
        return loc.get("governorate") if loc else None

    def get_zone(self, key: str) -> Optional[str]:
        loc = self.by_key.get(key)
        return loc.get("zone") if loc else None

    def size(self) -> int:
        return len(self.by_key)


# Global singleton
_location_kb: Optional[LocationKnowledgeBase] = None


async def load_location_kb() -> LocationKnowledgeBase:
    global _location_kb
    kb = LocationKnowledgeBase()
    # Try /app/data (image-baked) first; fall back to /data (volume-mounted
    # alerts service data). The docker-compose mount of repo-root /data
    # over /app/data was shadowing the COPY'd known_locations.json, so the
    # mounted alerts-service data is the real source of truth in production.
    candidates = [
        Path(__file__).resolve().parent.parent / "data" / "known_locations.json",
        Path("/data/known_locations.json"),
    ]
    for path in candidates:
        if path.exists():
            await kb.load_from_file(path)
            break
    _location_kb = kb
    return kb


def get_location_kb() -> Optional[LocationKnowledgeBase]:
    return _location_kb
