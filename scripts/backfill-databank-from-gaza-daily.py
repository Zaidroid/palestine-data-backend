#!/usr/bin/env python3
"""
Backfill people_killed + people_injured (aggregate daily rows) from
public/data/gaza/daily.json — 900+ days of Gaza MoH bulletins.

Each day's daily_delta.killed → one aggregate row in people_killed
(name=NULL, count=N, source=gaza_moh_daily). Same for injured.

Idempotent: stable_id keys on (date, region, metric) so re-runs replace
without duplicating.
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
DEFAULT_SRC = REPO_ROOT / "public/data/gaza/daily.json"

ATTRIBUTION = (
    "Gaza Ministry of Health daily bulletins, mirrored by Tech4Palestine "
    "(data.techforpalestine.org), licensed CC-BY-4.0."
)
GAZA_LAT, GAZA_LNG = 31.5, 34.45  # Gaza Strip centroid


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_tables(conn):
    # Match the schema in services/westbank-alerts/app/databank.py.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS people_killed (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id       TEXT UNIQUE NOT NULL,
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
            count           INTEGER DEFAULT 1,
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
    # If the table already existed without `count`, add it.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(people_killed)").fetchall()}
    if "count" not in cols:
        conn.execute("ALTER TABLE people_killed ADD COLUMN count INTEGER DEFAULT 1")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS people_injured (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id       TEXT UNIQUE NOT NULL,
            count           INTEGER NOT NULL,
            severity_hint   TEXT,
            date            TEXT,
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
            created_at      TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_killed_date ON people_killed(date DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_killed_dataset ON people_killed(source_dataset)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_injured_date ON people_injured(date DESC)")
    conn.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--source", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()

    if not args.source.exists():
        print(f"FATAL: source not found: {args.source}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {args.source}...", file=sys.stderr)
    raw = json.loads(args.source.read_text())
    days = raw.get("data", raw) if isinstance(raw, dict) else raw
    print(f"Loaded {len(days)} daily bulletins", file=sys.stderr)

    conn = sqlite3.connect(str(args.db), timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_tables(conn)

    now = datetime.utcnow().isoformat()
    killed_rows, injured_rows = [], []
    for day in days:
        date = day.get("date")
        if not date:
            continue
        delta = day.get("daily_delta") or {}
        region = day.get("region") or "Gaza Strip"
        notes = (
            f"Gaza MoH daily bulletin for {date}. "
            f"Cumulative killed={day.get('cumulative',{}).get('killed')}, "
            f"injured={day.get('cumulative',{}).get('injured')}."
        )

        kc = delta.get("killed")
        if isinstance(kc, int) and kc > 0:
            killed_rows.append((
                stable_id("killed", "gaza_moh_daily", date, region),
                None, None, None, None,           # name_ar, name_en, age, gender
                date, "day",                      # date, date_precision
                "Gaza", region,
                GAZA_LAT, GAZA_LNG,
                "airstrike",                      # cause (overwhelmingly)
                kc,                               # count
                None,                             # source_alert_id
                "gaza_moh_daily",
                "https://data.techforpalestine.org/api/v2/casualties_daily.json",
                ATTRIBUTION,
                0.95,                             # confidence
                notes,
                now, now,
            ))

        inj = delta.get("injured")
        if isinstance(inj, int) and inj > 0:
            injured_rows.append((
                stable_id("injured", "gaza_moh_daily", date, region),
                inj, None,                         # count, severity_hint
                date,
                "Gaza", region,
                GAZA_LAT, GAZA_LNG,
                "airstrike",
                None,                              # source_alert_id
                "gaza_moh_daily",
                "https://data.techforpalestine.org/api/v2/casualties_daily.json",
                ATTRIBUTION,
                0.95,
                notes,
                now,
            ))

    print(f"Prepared {len(killed_rows)} killed-rows + {len(injured_rows)} injured-rows", file=sys.stderr)

    killed_cols = [
        "stable_id", "name_ar", "name_en", "age", "gender",
        "date", "date_precision", "place_name", "place_region",
        "lat", "lng", "cause", "count", "source_alert_id", "source_dataset",
        "source_url", "attribution_text", "confidence", "notes",
        "created_at", "updated_at",
    ]
    placeholders = ",".join(["?"] * len(killed_cols))
    update_clause = ",".join(
        f"{c}=excluded.{c}" for c in killed_cols if c not in ("stable_id", "created_at")
    )
    conn.executemany(
        f"INSERT INTO people_killed ({','.join(killed_cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}",
        killed_rows,
    )

    injured_cols = [
        "stable_id", "count", "severity_hint", "date",
        "place_name", "place_region", "lat", "lng", "cause",
        "source_alert_id", "source_dataset", "source_url",
        "attribution_text", "confidence", "notes", "created_at",
    ]
    placeholders = ",".join(["?"] * len(injured_cols))
    update_clause = ",".join(
        f"{c}=excluded.{c}" for c in injured_cols if c not in ("stable_id", "created_at")
    )
    conn.executemany(
        f"INSERT INTO people_injured ({','.join(injured_cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(stable_id) DO UPDATE SET {update_clause}",
        injured_rows,
    )
    conn.commit()

    k_total = conn.execute(
        "SELECT COUNT(*), SUM(count) FROM people_killed WHERE source_dataset='gaza_moh_daily'"
    ).fetchone()
    i_total = conn.execute(
        "SELECT COUNT(*), SUM(count) FROM people_injured WHERE source_dataset='gaza_moh_daily'"
    ).fetchone()
    print(f"DONE — gaza_moh_daily: people_killed rows={k_total[0]} (sum_count={k_total[1]}); "
          f"people_injured rows={i_total[0]} (sum_count={i_total[1]})")
    conn.close()


if __name__ == "__main__":
    main()
