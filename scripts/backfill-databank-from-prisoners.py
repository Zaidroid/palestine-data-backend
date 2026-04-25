#!/usr/bin/env python3
"""
Backfill people_detained from Addameer monthly statistics in
public/data/static/prisoners-addameer.json.

Each row in the source is one (month, metric_type) — total /
administrative / child / female. We map:
  - total           → people_detained.status = "arrested" (overall count)
  - administrative  → people_detained.status = "administrative"
  - child           → people_detained.status = "arrested", notes flag minor
  - female          → people_detained.status = "arrested", gender=female

Idempotent via stable_id on (date, metric_type).
"""

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "services/westbank-alerts/data/alerts.db"
DEFAULT_SRC = REPO_ROOT / "public/data/static/prisoners-addameer.json"

ATTRIBUTION = "Data: Addameer Prisoner Support and Human Rights Association (addameer.ps)."
SOURCE_URL = "https://www.addameer.ps/statistics"


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS people_detained (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id         TEXT UNIQUE NOT NULL,
            name_ar           TEXT,
            name_en           TEXT,
            age               INTEGER,
            gender            TEXT,
            date_arrested     TEXT,
            date_released     TEXT,
            place_name        TEXT,
            place_region      TEXT,
            lat               REAL,
            lng               REAL,
            status            TEXT DEFAULT 'arrested',
            detention_facility TEXT,
            sentence_months   INTEGER,
            count             INTEGER DEFAULT 1,
            source_alert_id   INTEGER,
            source_dataset    TEXT NOT NULL,
            source_url        TEXT,
            attribution_text  TEXT,
            confidence        REAL DEFAULT 0.7,
            notes             TEXT,
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_detained_date ON people_detained(date_arrested DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_detained_status ON people_detained(status)")
    conn.commit()


def transform(record: dict) -> dict | None:
    metric = record.get("metric_type")
    count = record.get("count")
    date = record.get("date")
    if not (metric and isinstance(count, int) and date):
        return None

    notes = (
        f"Addameer monthly aggregate ({metric}): {count} people "
        f"in detention as of {date[:7]}."
    )

    if metric == "total":
        status = "arrested"
        gender = None
    elif metric == "administrative":
        status = "administrative"
        gender = None
    elif metric == "child":
        status = "arrested"
        gender = None
        notes = "Child detainees: " + notes
    elif metric == "female":
        status = "arrested"
        gender = "female"
    else:
        return None

    sid = stable_id("detained", "addameer", date, metric)
    now = datetime.utcnow().isoformat()
    return {
        "stable_id": sid,
        "name_ar": None,
        "name_en": None,
        "age": None,
        "gender": gender,
        "date_arrested": date,
        "date_released": None,
        "place_name": "Palestine",
        "place_region": "West Bank & Gaza",
        "lat": None,
        "lng": None,
        "status": status,
        "detention_facility": None,
        "sentence_months": None,
        "count": count,
        "source_alert_id": None,
        "source_dataset": "addameer",
        "source_url": SOURCE_URL,
        "attribution_text": ATTRIBUTION,
        "confidence": 0.85,
        "notes": notes,
        "created_at": now,
        "updated_at": now,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--source", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()

    if not args.source.exists():
        print(f"FATAL: source not found: {args.source}", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(args.source.read_text())
    records = raw if isinstance(raw, list) else raw.get("data", [])
    print(f"Loaded {len(records)} Addameer rows", file=sys.stderr)

    conn = sqlite3.connect(str(args.db), timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_table(conn)

    rows = []
    for r in records:
        t = transform(r)
        if t:
            rows.append(t)
    print(f"Transformed {len(rows)} rows for people_detained", file=sys.stderr)

    cols = [
        "stable_id", "name_ar", "name_en", "age", "gender",
        "date_arrested", "date_released", "place_name", "place_region",
        "lat", "lng", "status", "detention_facility", "sentence_months",
        "count", "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at", "updated_at",
    ]
    placeholders = ",".join(["?"] * len(cols))
    update_clause = ",".join(
        f"{c}=excluded.{c}" for c in cols if c not in ("stable_id", "created_at")
    )
    sql = (
        f"INSERT INTO people_detained ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    )
    conn.executemany(sql, [[r[c] for c in cols] for r in rows])
    conn.commit()

    total = conn.execute(
        "SELECT COUNT(*), SUM(count) FROM people_detained WHERE source_dataset='addameer'"
    ).fetchone()
    print(f"DONE — addameer: people_detained rows={total[0]} (sum_count={total[1]})")
    conn.close()


if __name__ == "__main__":
    main()
