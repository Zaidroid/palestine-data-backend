#!/usr/bin/env python3
"""
Seed checkpoints from a JSON directory file.

Usage:
  # From known checkpoints (curated with geo data)
  python seed_checkpoints.py

  # From history analyzer output
  python seed_checkpoints.py --file data/checkpoint_directory.json

The script handles both formats:
  - known_checkpoints.json: list of checkpoint objects with lat/lng
  - checkpoint_directory.json: history analyzer output with nested structure
"""

import asyncio
import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app.checkpoint_db import init_checkpoint_db, bulk_seed_checkpoints

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("seed_checkpoints")


async def main():
    parser = argparse.ArgumentParser(description="Seed checkpoint DB from JSON file.")
    parser.add_argument("--file", "-f", type=str, default="data/known_checkpoints.json",
                        help="Path to checkpoint JSON (default: data/known_checkpoints.json)")
    args = parser.parse_args()

    json_path = Path(args.file)
    if not json_path.exists():
        log.error(f"File not found: {json_path}")
        sys.exit(1)

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle both formats: list (known_checkpoints) or dict (history analyzer)
    if isinstance(data, list):
        checkpoints = data
    else:
        checkpoints = data.get("checkpoints", [])

    if not checkpoints:
        log.error("No checkpoints found in the JSON file.")
        sys.exit(1)

    log.info(f"Loaded {len(checkpoints)} checkpoints from {json_path}")

    await init_checkpoint_db()

    entries = []
    for cp in checkpoints:
        entries.append({
            "canonical_key": cp["canonical_key"],
            "name_ar": cp.get("name_ar", ""),
            "name_en": cp.get("name_en"),
            "region": cp.get("region"),
            "latitude": cp.get("latitude"),
            "longitude": cp.get("longitude"),
        })

    result = await bulk_seed_checkpoints(entries)

    log.info(f"Done! Inserted: {result['inserted']}, Updated: {result['updated']}")
    log.info(f"Total checkpoints in directory: {result['total']}")


if __name__ == "__main__":
    asyncio.run(main())
