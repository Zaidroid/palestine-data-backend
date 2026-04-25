#!/usr/bin/env python3
"""
A1 — One-shot databank dedup migration.

For each of people_killed and people_detained:
  1. Compute entity_key for every named row (sha256 of normalized_name|age|year).
  2. For rows sharing the same entity_key, merge into one canonical row:
     - Keep the row with the most-complete name + earliest created_at.
     - Append every other row's source attribution to the merged attributions[].
     - Delete the duplicates.
  3. Backfill entity_key on every named row in place.

Aggregate rows (no name) leave entity_key NULL and stay as-is.

Idempotent — re-running on a deduped table is a no-op (no collisions to resolve).
Safe under live writes via PRAGMA busy_timeout.
"""

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "services/westbank-alerts/data/alerts.db"
_DIACRITICS_RE = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]")


def _normalize_name(s):
    if not s:
        return ""
    s = s.strip().lower()
    s = _DIACRITICS_RE.sub("", s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.split())


def entity_key(name_en, name_ar, age, date):
    name = _normalize_name(name_en) or _normalize_name(name_ar)
    if not name:
        return None
    year = (date or "")[:4] if date else ""
    raw = f"{name}|{age if age is not None else ''}|{year}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def make_attribution(row, attribution_cols):
    return {
        "source_dataset": row.get(attribution_cols.get("source_dataset", "source_dataset")),
        "source_url": row.get("source_url"),
        "source_alert_id": row.get("source_alert_id"),
        "fetched_at": row.get("created_at"),
    }


def parse_attributions(blob):
    try:
        arr = json.loads(blob) if blob else []
    except (ValueError, TypeError):
        arr = []
    return arr if isinstance(arr, list) else []


def _merge_collision_group(conn, table_name, ekey, group):
    """Pick keeper, merge attributions, DELETE losers, set keeper's
    entity_key. Returns count of rows deleted.

    Order matters: losers must be deleted BEFORE setting keeper.entity_key,
    otherwise the UNIQUE INDEX fires."""
    def completeness(r):
        score = sum(1 for f in ("name_en", "name_ar", "age", "source_url") if r.get(f))
        ts = (datetime.fromisoformat(r["created_at"]).timestamp()
              if r.get("created_at") else 0)
        return (score, -ts)
    group_sorted = sorted(group, key=completeness, reverse=True)
    keeper, losers = group_sorted[0], group_sorted[1:]

    merged = parse_attributions(keeper["attributions"])
    seen = {a.get("source_dataset") for a in merged if isinstance(a, dict)}
    for r in [keeper, *losers]:
        if r["source_dataset"] and r["source_dataset"] not in seen:
            merged.append({
                "source_dataset": r["source_dataset"],
                "source_url": r.get("source_url"),
                "source_alert_id": r.get("source_alert_id"),
                "fetched_at": r.get("created_at"),
            })
            seen.add(r["source_dataset"])
        for a in parse_attributions(r.get("attributions")):
            src = a.get("source_dataset") if isinstance(a, dict) else None
            if src and src not in seen:
                merged.append(a)
                seen.add(src)

    if losers:
        placeholders = ",".join(["?"] * len(losers))
        conn.execute(
            f"DELETE FROM {table_name} WHERE id IN ({placeholders})",
            [r["id"] for r in losers],
        )
    conn.execute(
        f"UPDATE {table_name} SET attributions = ?, entity_key = ? WHERE id = ?",
        (json.dumps(merged), ekey, keeper["id"]),
    )
    return len(losers)


def dedupe_table(conn, table_name, name_en_col, name_ar_col, age_col, date_col):
    print(f"\n[{table_name}] starting dedup", file=sys.stderr)
    # Pull every row's id + identity-relevant fields + existing attributions.
    cur = conn.execute(
        f"SELECT id, {name_en_col}, {name_ar_col}, {age_col}, {date_col}, "
        f"created_at, source_dataset, source_url, source_alert_id, attributions "
        f"FROM {table_name}"
    )
    rows = cur.fetchall()
    print(f"[{table_name}] loaded {len(rows)} rows", file=sys.stderr)

    by_ekey = defaultdict(list)
    name_only_rows = 0
    for row in rows:
        rid, name_en, name_ar, age, date, created_at, src, url, alert_id, attrs = row
        ekey = entity_key(name_en, name_ar, age, date)
        if ekey:
            by_ekey[ekey].append({
                "id": rid, "name_en": name_en, "name_ar": name_ar,
                "age": age, "created_at": created_at,
                "source_dataset": src, "source_url": url,
                "source_alert_id": alert_id, "attributions": attrs,
            })
            name_only_rows += 1
    aggregate_rows = len(rows) - name_only_rows
    print(f"[{table_name}] named={name_only_rows} aggregate={aggregate_rows}",
          file=sys.stderr)

    duplicates = {k: v for k, v in by_ekey.items() if len(v) > 1}
    print(f"[{table_name}] {len(duplicates)} entity groups with duplicates",
          file=sys.stderr)

    # Single-pass: for each entity group, atomically merge + delete losers
    # + set entity_key on keeper. Doing it in one pass avoids hitting the
    # UNIQUE constraint mid-loop (which would happen if we backfilled
    # entity_key before deleting the duplicates).
    backfill = 0
    deleted_total = 0
    for ekey, group in by_ekey.items():
        if len(group) == 1:
            # Non-collision row: just set entity_key + seed attributions if empty.
            r = group[0]
            current = parse_attributions(r.get("attributions"))
            if not current and r.get("source_dataset"):
                seeded = json.dumps([{
                    "source_dataset": r["source_dataset"],
                    "source_url": r.get("source_url"),
                    "source_alert_id": r.get("source_alert_id"),
                    "fetched_at": r.get("created_at"),
                }])
                conn.execute(
                    f"UPDATE {table_name} SET entity_key = ?, attributions = ? WHERE id = ?",
                    (ekey, seeded, r["id"]),
                )
            else:
                conn.execute(
                    f"UPDATE {table_name} SET entity_key = ? WHERE id = ?",
                    (ekey, r["id"]),
                )
            backfill += 1
            continue

        # Collision group: keep one, merge attributions, delete losers,
        # then set keeper's entity_key (delete-first ordering avoids
        # the UNIQUE constraint).
        deleted_total += _merge_collision_group(conn, table_name, ekey, group)
        backfill += 1

    print(f"[{table_name}] entity_key set on {backfill} unique entities; "
          f"deleted {deleted_total} duplicate rows", file=sys.stderr)
    conn.commit()
    final = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
    print(f"[{table_name}] DONE — deleted {deleted_total} duplicate rows; "
          f"final count {final}", file=sys.stderr)
    return final


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--dry-run", action="store_true",
                    help="Compute groups but don't write changes")
    args = ap.parse_args()

    if args.dry_run:
        print("DRY RUN — no writes", file=sys.stderr)
        # In-memory copy
        src = sqlite3.connect(str(args.db))
        conn = sqlite3.connect(":memory:")
        src.backup(conn)
        src.close()
    else:
        conn = sqlite3.connect(str(args.db), timeout=30)
        conn.execute("PRAGMA busy_timeout = 30000")
        conn.execute("PRAGMA journal_mode = WAL")

    # Verify the new columns exist before running.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(people_killed)").fetchall()}
    if "entity_key" not in cols or "attributions" not in cols:
        print("FATAL: people_killed missing entity_key/attributions columns. "
              "Restart the alerts container first to apply init_databank migration.",
              file=sys.stderr)
        sys.exit(2)

    dedupe_table(conn, "people_killed",
                 "name_en", "name_ar", "age", "date")
    dedupe_table(conn, "people_detained",
                 "name_en", "name_ar", "age", "date_arrested")
    conn.close()
    print("\nALL TABLES DEDUPED.")


if __name__ == "__main__":
    main()
