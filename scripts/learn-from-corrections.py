#!/usr/bin/env python3
"""
A2 — admin correction → classifier feedback loop.

Scans alerts WHERE status='retracted', groups by (channel, type), and
when ≥7 retractions exist for a combo writes a -0.10 weight_delta into
keyword_weight_overrides (clamped to -0.30 cumulative). The classifier
loads that table on startup; new alerts of the same (channel, type)
land with reduced confidence.

Idempotent — re-running on the same data updates the same row rather
than stacking.

Run nightly via refresh-data.sh.
"""

import argparse
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "services/westbank-alerts/data/alerts.db"
RETRACTION_THRESHOLD = 7
DELTA_PER_TIER = -0.10
MAX_DELTA = -0.30


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--threshold", type=int, default=RETRACTION_THRESHOLD)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"FATAL: {args.db} not found", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(str(args.db), timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")

    # Make sure the table exists (in case the alerts service hasn't run init yet).
    conn.execute("""
        CREATE TABLE IF NOT EXISTS keyword_weight_overrides (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            channel       TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            weight_delta  REAL NOT NULL,
            basis         TEXT,
            updated_at    TEXT NOT NULL,
            UNIQUE(channel, event_type)
        )
    """)
    conn.commit()

    cur = conn.execute(
        "SELECT source, type FROM alerts WHERE status = 'retracted' AND source IS NOT NULL AND type IS NOT NULL"
    )
    grouped = defaultdict(int)
    for source, alert_type in cur.fetchall():
        grouped[(source.lower().lstrip("@"), alert_type)] += 1

    print(f"[learn] {len(grouped)} (channel, type) combos with retractions",
          file=sys.stderr)

    eligible = {k: c for k, c in grouped.items() if c >= args.threshold}
    print(f"[learn] {len(eligible)} eligible (≥{args.threshold} retractions)",
          file=sys.stderr)

    if args.dry_run:
        for (ch, et), count in sorted(eligible.items(), key=lambda x: -x[1]):
            print(f"  would-update  {ch:<20} {et:<22} {count} retractions")
        return

    now = datetime.utcnow().isoformat()
    written = 0
    for (channel, event_type), count in eligible.items():
        # Compute new delta tier: -0.10 per multiple of threshold, clamped.
        tiers = count // args.threshold
        new_delta = max(MAX_DELTA, DELTA_PER_TIER * tiers)
        basis = f"{count} retractions through {now[:10]}"
        conn.execute(
            """INSERT INTO keyword_weight_overrides
               (channel, event_type, weight_delta, basis, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(channel, event_type) DO UPDATE SET
                   weight_delta = excluded.weight_delta,
                   basis        = excluded.basis,
                   updated_at   = excluded.updated_at""",
            (channel, event_type, new_delta, basis, now),
        )
        written += 1
        print(f"  updated  {channel:<20} {event_type:<22} delta={new_delta:+.2f} ({count} retractions)",
              file=sys.stderr)
    conn.commit()
    conn.close()
    print(f"[learn] DONE — {written} keyword_weight_overrides rows written")


if __name__ == "__main__":
    main()
