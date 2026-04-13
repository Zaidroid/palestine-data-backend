#!/usr/bin/env python3
"""
Migration script to clean up the checkpoint database.

This script:
1. Identifies all checkpoints in the DB that don't exist in known_checkpoints.json
2. Attempts to fuzzy-match them to known checkpoints
3. Merges status updates from orphaned entries into the correct canonical keys
4. Removes duplicates (same canonical_key + direction)
5. Generates a report of changes made

Usage:
    python checkpoint_migration.py [--dry-run] [--verbose]

Options:
    --dry-run   Show what would be done without making changes
    --verbose   Show detailed matching/merge information
"""

import asyncio
import sqlite3
import json
import logging
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass

from app.checkpoint_parser import _normalise
from app.checkpoint_knowledge_base import CheckpointKnowledgeBase

logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
log = logging.getLogger(__name__)


@dataclass
class MigrationStats:
    """Track migration statistics."""
    total_checkpoints_before: int = 0
    total_checkpoints_after: int = 0
    unknown_checkpoints: int = 0
    merged_entries: int = 0
    removed_duplicates: int = 0
    fuzzy_matches: int = 0
    unmatched: int = 0


class CheckpointMigrator:
    """Handle checkpoint database migration and cleanup."""

    def __init__(self, db_path: Path, knowledge_base: CheckpointKnowledgeBase, dry_run: bool = False, verbose: bool = False):
        self.db_path = db_path
        self.kb = knowledge_base
        self.dry_run = dry_run
        self.verbose = verbose
        self.stats = MigrationStats()
        self.conn: Optional[sqlite3.Connection] = None
        self.unmatched_names: List[str] = []

    async def run(self):
        """Execute the full migration."""
        log.info(f"Starting checkpoint migration ({'DRY RUN' if self.dry_run else 'LIVE'})")

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row

        try:
            # Count before
            cur = self.conn.cursor()
            cur.execute("SELECT COUNT(DISTINCT canonical_key) FROM checkpoints")
            self.stats.total_checkpoints_before = cur.fetchone()[0]
            log.info(f"Checkpoints before: {self.stats.total_checkpoints_before}")

            # Find unknown checkpoints
            unknown_keys = await self._find_unknown_checkpoints()
            self.stats.unknown_checkpoints = len(unknown_keys)
            log.info(f"Unknown checkpoints: {self.stats.unknown_checkpoints}")

            if unknown_keys:
                # Try to fuzzy-match and merge
                await self._merge_unknown_checkpoints(unknown_keys)

                # Remove duplicates
                await self._remove_duplicates()

            # Count after
            if not self.dry_run:
                cur.execute("SELECT COUNT(DISTINCT canonical_key) FROM checkpoints")
                self.stats.total_checkpoints_after = cur.fetchone()[0]
            else:
                self.stats.total_checkpoints_after = self.stats.total_checkpoints_before - self.stats.merged_entries

            log.info(f"Checkpoints after: {self.stats.total_checkpoints_after}")
            self._print_report()

        finally:
            if self.conn:
                if self.dry_run:
                    self.conn.rollback()
                else:
                    self.conn.commit()
                self.conn.close()

    async def _find_unknown_checkpoints(self) -> List[str]:
        """Find all canonical_keys that don't exist in knowledge base."""
        cur = self.conn.cursor()
        cur.execute("SELECT DISTINCT canonical_key FROM checkpoints")
        all_keys = [row[0] for row in cur.fetchall()]

        known_keys = set(self.kb.all_canonical_keys())
        unknown = [k for k in all_keys if k not in known_keys]

        log.info(f"Found {len(unknown)} unknown checkpoint keys")
        return unknown

    async def _merge_unknown_checkpoints(self, unknown_keys: List[str]):
        """
        Try to fuzzy-match unknown checkpoints to known ones and merge updates.
        """
        log.info("Attempting to fuzzy-match unknown checkpoints...")

        for unknown_key in unknown_keys:
            # Get a sample of the actual names used for this key
            cur = self.conn.cursor()
            cur.execute(
                "SELECT DISTINCT name_raw FROM checkpoint_updates WHERE canonical_key = ? LIMIT 5",
                (unknown_key,)
            )
            sample_names = [row[0] for row in cur.fetchall()]

            if not sample_names:
                self.stats.unmatched += 1
                self.unmatched_names.append(unknown_key)
                continue

            # Try to find best match in knowledge base
            best_match: Optional[str] = None
            for name in sample_names:
                match = self.kb.find_checkpoint(name)
                if match:
                    best_match = match
                    break

            if best_match:
                # Merge updates from unknown_key to best_match
                await self._merge_updates(unknown_key, best_match)
                self.stats.fuzzy_matches += 1
                if self.verbose:
                    log.info(f"  Matched: {unknown_key} → {best_match}")
            else:
                self.stats.unmatched += 1
                self.unmatched_names.append(unknown_key)
                if self.verbose:
                    log.info(f"  Unmatched: {unknown_key} (names: {sample_names})")

    async def _merge_updates(self, from_key: str, to_key: str):
        """Merge all checkpoint_updates from one key to another."""
        cur = self.conn.cursor()

        # Get all updates from the unknown key
        cur.execute(
            "SELECT * FROM checkpoint_updates WHERE canonical_key = ?",
            (from_key,)
        )
        rows = cur.fetchall()
        count = len(rows)

        if self.dry_run:
            log.info(f"  [DRY] Would merge {count} updates: {from_key} → {to_key}")
            self.stats.merged_entries += count
            return

        # Update canonical_key in checkpoint_updates
        cur.execute(
            "UPDATE checkpoint_updates SET canonical_key = ? WHERE canonical_key = ?",
            (to_key, from_key)
        )

        # Remove the old checkpoint entry
        cur.execute("DELETE FROM checkpoints WHERE canonical_key = ?", (from_key,))

        # Remove the old checkpoint_status entry
        cur.execute("DELETE FROM checkpoint_status WHERE canonical_key = ?", (from_key,))

        self.stats.merged_entries += count
        log.info(f"  Merged {count} updates: {from_key} → {to_key}")

    async def _remove_duplicates(self):
        """Remove duplicate (canonical_key, direction) pairs, keeping most recent."""
        cur = self.conn.cursor()

        # Find duplicates in checkpoint_status
        cur.execute(
            """
            SELECT canonical_key, direction, COUNT(*) as cnt
            FROM checkpoint_status
            GROUP BY canonical_key, direction
            HAVING cnt > 1
            """
        )

        duplicates = cur.fetchall()
        if not duplicates:
            return

        log.info(f"Found {len(duplicates)} duplicate (key, direction) pairs")

        for key, direction, cnt in duplicates:
            # Keep the most recent, delete others
            cur.execute(
                """
                SELECT rowid FROM checkpoint_status
                WHERE canonical_key = ? AND direction = ?
                ORDER BY last_updated DESC
                LIMIT 1
                """,
                (key, direction)
            )
            keep_rowid = cur.fetchone()[0] if cur.fetchone() else None

            if keep_rowid:
                cur.execute(
                    """
                    DELETE FROM checkpoint_status
                    WHERE canonical_key = ? AND direction = ? AND rowid != ?
                    """,
                    (key, direction, keep_rowid)
                )
                self.stats.removed_duplicates += (cnt - 1)

        if not self.dry_run:
            log.info(f"Removed {self.stats.removed_duplicates} duplicate entries")

    def _print_report(self):
        """Print migration summary report."""
        log.info("\n" + "=" * 60)
        log.info("MIGRATION REPORT")
        log.info("=" * 60)
        log.info(f"Checkpoints before:      {self.stats.total_checkpoints_before}")
        log.info(f"Checkpoints after:       {self.stats.total_checkpoints_after}")
        log.info(f"Reduction:               {self.stats.total_checkpoints_before - self.stats.total_checkpoints_after}")
        log.info(f"\nActions taken:")
        log.info(f"  Fuzzy-matched:         {self.stats.fuzzy_matches}")
        log.info(f"  Entries merged:        {self.stats.merged_entries}")
        log.info(f"  Duplicates removed:    {self.stats.removed_duplicates}")
        log.info(f"  Unmatched (kept):      {self.stats.unmatched}")

        if self.unmatched_names:
            log.warning(f"\n{len(self.unmatched_names)} checkpoints could not be matched:")
            for name in sorted(self.unmatched_names)[:20]:
                log.warning(f"  - {name}")
            if len(self.unmatched_names) > 20:
                log.warning(f"  ... and {len(self.unmatched_names) - 20} more")

        log.info("=" * 60)


async def main():
    """Main entry point."""
    import sys

    dry_run = "--dry-run" in sys.argv
    verbose = "--verbose" in sys.argv

    db_path = Path(__file__).parent / "data" / "checkpoints.db"
    kb_path = Path(__file__).parent / "data" / "known_checkpoints.json"

    # Load knowledge base
    kb = CheckpointKnowledgeBase()
    await kb.load_from_file(kb_path)
    log.info(f"Loaded {kb.size()} known checkpoints from {kb_path}")

    # Run migration
    migrator = CheckpointMigrator(db_path, kb, dry_run=dry_run, verbose=verbose)
    await migrator.run()


if __name__ == "__main__":
    asyncio.run(main())
