#!/usr/bin/env python3
"""
Backfill: load the B'Tselem fatalities snapshot (person-level, 2000-09-29 →
2023-09-24) into the alerts service's `people_killed` table.

Source: B'Tselem's fatalities database, via the Kaggle aggregation mirrored
in the repo as a curated snapshot (data/historical/btselem-fatalities-2000-2023.csv).
Mirror integrity was validated against B'Tselem's published period totals:
Cast Lead 1,376/1,391 (98.9%), Protective Edge 2,195/2,251 (97.5%); the
Second Intifada delta (2,693 named vs ~3,189 published) reflects documented
methodology differences (deaths-of-wounds after the period, perpetrator
categories). License: CC-BY-NC (B'Tselem) — non-commercial, already gated
by the license registry.

Complementarity: this snapshot ENDS 2023-09-24; the Tech4Palestine roster
STARTS 2023-10-07 — no overlap by construction. Palestinians only are
inserted (10,092 of 11,124 rows), matching the table's existing semantics;
the full CSV (incl. Israeli fatalities) remains on disk for analysis.

Idempotent — upserts by stable_id; intra-batch and cross-source entity_key
duplicates are skipped.

Usage:
    python3 scripts/backfill-people-killed-from-btselem.py [--db PATH]
"""

import argparse
import csv
import hashlib
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "services/westbank-alerts/data/alerts.db"
CSV_PATH = REPO_ROOT / "data/historical/btselem-fatalities-2000-2023.csv"

BTSELEM_ATTRIBUTION = (
    "Data: B'Tselem fatalities database (btselem.org/statistics), CC-BY-NC. "
    "Curated 2000-2023 snapshot via Kaggle mirror, validated against "
    "B'Tselem published period totals."
)


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


import unicodedata as _ud


def _normalize_name(s):
    if not s:
        return ""
    s = s.strip().lower()
    s = _ud.normalize("NFKD", s)
    s = "".join(c for c in s if not _ud.combining(c))
    return " ".join(s.split())


def entity_key(name_en, age, date):
    name = _normalize_name(name_en)
    if not name:
        return None
    year = (date or "")[:4]
    raw = f"{name}|{age if age not in (None, '') else ''}|{year}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS people_killed (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id       TEXT UNIQUE NOT NULL,
            entity_key      TEXT UNIQUE,
            name_ar         TEXT,
            name_en         TEXT,
            age             INTEGER,
            gender          TEXT,
            date            TEXT,
            date_precision  TEXT,
            place_name      TEXT,
            place_region    TEXT,
            lat             REAL,
            lng             REAL,
            cause           TEXT,
            source_alert_id INTEGER,
            source_dataset  TEXT NOT NULL,
            source_url      TEXT,
            attribution_text TEXT,
            confidence      REAL DEFAULT 0.7,
            notes           TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_killed_date ON people_killed(date DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_killed_region ON people_killed(place_region)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_killed_dataset ON people_killed(source_dataset)")
    conn.commit()


def transform(row: dict) -> dict | None:
    if (row.get("citizenship") or "").strip() != "Palestinian":
        return None
    name = (row.get("name") or "").strip()
    date = (row.get("date_of_death") or "").strip() or (row.get("date_of_event") or "").strip()
    if not name or not date:
        return None
    age = row.get("age")
    try:
        age = int(age) if age not in (None, "") else None
    except ValueError:
        age = None
    gender = {"M": "male", "F": "female"}.get((row.get("gender") or "").strip(), (row.get("gender") or "").strip() or None)

    cause_bits = [b for b in [
        (row.get("type_of_injury") or "").strip(),
        (row.get("ammunition") or "").strip(),
    ] if b]
    killed_by = (row.get("killed_by") or "").strip()

    notes_bits = []
    if killed_by:
        notes_bits.append(f"killed by: {killed_by}")
    if (row.get("took_part_in_the_hostilities") or "").strip():
        notes_bits.append(f"hostilities participation (B'Tselem): {row['took_part_in_the_hostilities'].strip()}")
    if (row.get("notes") or "").strip():
        notes_bits.append(row["notes"].strip())

    now = datetime.now(timezone.utc).isoformat()
    return {
        "stable_id": stable_id("btselem", name, date, row.get("event_location")),
        "entity_key": entity_key(name, age, date),
        "name_ar": None,
        "name_en": name,
        "age": age,
        "gender": gender,
        "date": date,
        "date_precision": "day",
        "place_name": (row.get("event_location") or "").strip() or None,
        "place_region": (row.get("event_location_region") or "").strip() or None,
        "lat": None,
        "lng": None,
        "cause": ", ".join(cause_bits) or None,
        "source_alert_id": None,
        "source_dataset": "btselem",
        "source_url": "https://statistics.btselem.org/en/all-fatalities/by-date-of-incident",
        "attribution_text": BTSELEM_ATTRIBUTION,
        "confidence": 0.95,
        "notes": "; ".join(notes_bits) or None,
        "created_at": now,
        "updated_at": now,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    if not CSV_PATH.exists():
        print(f"FATAL: snapshot not found: {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(args.db, timeout=60)
    # The live alerts service writes to this DB continuously (5s Telegram
    # poll) — wait out its write locks instead of failing.
    conn.execute("PRAGMA busy_timeout=60000")
    ensure_table(conn)

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    transformed = []
    for r in rows:
        t = transform(r)
        if t:
            transformed.append(t)
        if args.limit and len(transformed) >= args.limit:
            break
    print(f"Transformed {len(transformed)} Palestinian fatality rows (of {len(rows)} total)", file=sys.stderr)

    has_entity_col = "entity_key" in {r[1] for r in conn.execute("PRAGMA table_info(people_killed)").fetchall()}
    existing_keys = set()
    if has_entity_col:
        cur = conn.execute("SELECT entity_key FROM people_killed WHERE entity_key IS NOT NULL")
        existing_keys = {row[0] for row in cur.fetchall()}
        print(f"Found {len(existing_keys)} existing entity_keys; skipping those in input", file=sys.stderr)

    seen_batch = set()
    to_insert = []
    for r in transformed:
        k = r.get("entity_key")
        if k and (k in existing_keys or k in seen_batch):
            continue
        if k:
            seen_batch.add(k)
        to_insert.append(r)
    print(f"  → {len(to_insert)} net-new rows to insert", file=sys.stderr)

    cols = [
        "stable_id", "entity_key", "name_ar", "name_en", "age", "gender",
        "date", "date_precision", "place_name", "place_region",
        "lat", "lng", "cause", "source_alert_id", "source_dataset",
        "source_url", "attribution_text", "confidence", "notes",
        "created_at", "updated_at",
    ]
    if not has_entity_col:
        cols = [c for c in cols if c != "entity_key"]
    placeholders = ",".join(["?"] * len(cols))
    update_clause = ",".join(f"{c}=excluded.{c}" for c in cols if c not in ("stable_id", "created_at"))
    sql = (
        f"INSERT INTO people_killed ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )

    BATCH = 1000
    for i in range(0, len(to_insert), BATCH):
        chunk = to_insert[i:i + BATCH]
        conn.executemany(sql, [[r.get(c) for c in cols] for r in chunk])
        conn.commit()
        print(f"  upserted {min(i + BATCH, len(to_insert))}/{len(to_insert)}", file=sys.stderr)

    total = conn.execute("SELECT COUNT(*) FROM people_killed WHERE source_dataset='btselem'").fetchone()[0]
    grand = conn.execute("SELECT COUNT(*) FROM people_killed").fetchone()[0]
    print(f"DONE — people_killed rows from btselem: {total}; table total: {grand}")
    conn.close()


if __name__ == "__main__":
    main()
