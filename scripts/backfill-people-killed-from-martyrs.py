#!/usr/bin/env python3
"""
One-shot backfill: load Tech4Palestine identified martyrs roster from
public/data/unified/martyrs_snapshot_2023/all-data.json into the alerts
service's `people_killed` table.

Why: the long-term databank should include the historical record from
day one, not just whatever the live classifier extracts going forward.

Idempotent — re-runs upsert by stable_id, so partial completions and
re-imports don't duplicate rows.

Usage:
    python3 scripts/backfill-people-killed-from-martyrs.py [--db PATH]

Defaults to services/westbank-alerts/data/alerts.db relative to repo root.
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
MARTYRS_JSON = REPO_ROOT / "public/data/unified/martyrs_snapshot_2023/all-data.json"


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


import re as _re_mod
import unicodedata as _ud

_DIACRITICS_RE = _re_mod.compile(r"[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]")


def _normalize_name(s):
    if not s:
        return ""
    s = s.strip().lower()
    s = _DIACRITICS_RE.sub("", s)
    s = _ud.normalize("NFKD", s)
    s = "".join(c for c in s if not _ud.combining(c))
    return " ".join(s.split())


def entity_key(name_en, name_ar, age, date):
    name = _normalize_name(name_en) or _normalize_name(name_ar)
    if not name:
        return None
    year = (date or "")[:4] if date else ""
    raw = f"{name}|{age if age is not None else ''}|{year}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_table(conn):
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


# Tech4Palestine attribution text (from src/api/data/licenses.json)
T4P_ATTRIBUTION = "Data: Tech4Palestine (data.techforpalestine.org), licensed CC-BY-4.0."


def transform(record: dict) -> dict | None:
    """Map a unified martyr record → people_killed row, or None to skip."""
    if record.get("event_type") != "identified_killed":
        return None

    name_en = record.get("name_en") or record.get("name") or ""
    name_ar = record.get("name_ar") or ""
    if not (name_en or name_ar):
        return None

    sex = (record.get("sex") or "").strip().lower()
    gender = sex if sex in ("male", "female") else "unknown"

    age = record.get("age")
    if isinstance(age, str):
        try:
            age = int(age)
        except ValueError:
            age = None

    date = record.get("date")
    if not date:
        # Tech4Palestine roster mostly lacks per-victim date of death.
        # Leave NULL rather than using a fake baseline — otherwise named
        # records pollute date-grouped queries and double-count alongside
        # the daily Gaza MoH aggregates that cover the same period.
        date = None
        date_precision = "unknown"
    else:
        date_precision = "day"

    location = record.get("location") or {}
    place_name = location.get("name")
    place_region = location.get("region")
    coords = location.get("coordinates") or []
    lat = coords[1] if len(coords) >= 2 else location.get("lat")
    lng = coords[0] if len(coords) >= 2 else location.get("lon")

    sources = record.get("sources") or []
    src = sources[0] if sources else {}
    t4p_id = record.get("t4p_id")

    sid = stable_id(
        "killed",
        "tech4palestine",
        t4p_id or "",
        name_en or name_ar,
        record.get("dob") or "",
    )

    now = datetime.utcnow().isoformat()
    return {
        "stable_id": sid,
        "name_ar": name_ar or None,
        "name_en": name_en or None,
        "age": age,
        "gender": gender,
        "date": date,
        "date_precision": date_precision,
        "place_name": place_name,
        "place_region": place_region,
        "lat": lat,
        "lng": lng,
        "cause": "airstrike",  # Tech4Palestine roster is "killed in Gaza" — overwhelmingly airstrikes
        "source_alert_id": None,
        "source_dataset": "tech4palestine",
        "source_url": src.get("url"),
        "attribution_text": T4P_ATTRIBUTION,
        "confidence": 0.95,  # named, dated entries from a curated roster
        "notes": record.get("description"),
        "created_at": now,
        "updated_at": now,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--source", type=Path, default=MARTYRS_JSON)
    ap.add_argument("--limit", type=int, default=None,
                    help="Cap rows for smoke-testing; default is all")
    args = ap.parse_args()

    if not args.source.exists():
        print(f"FATAL: source not found: {args.source}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading {args.source}...", file=sys.stderr)
    with open(args.source, "r", encoding="utf-8") as f:
        doc = json.load(f)
    records = doc.get("data", [])
    print(f"Loaded {len(records)} unified records", file=sys.stderr)

    if not args.db.parent.exists():
        args.db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(args.db), timeout=30)
    # The alerts service writes alerts.db continuously. Wait up to 30s for
    # write locks to clear instead of failing instantly with "database is
    # locked" on contention.
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_table(conn)

    transformed = []
    for r in records:
        row = transform(r)
        if row:
            row["entity_key"] = entity_key(row.get("name_en"), row.get("name_ar"),
                                           row.get("age"), row.get("date"))
            transformed.append(row)
        if args.limit and len(transformed) >= args.limit:
            break
    print(f"Transformed {len(transformed)} candidate rows", file=sys.stderr)

    # A1: skip rows whose entity is already in the table. Dedupe-databank.py
    # has merged attributions for existing entities; re-running this script
    # should only add net-new T4P entries, not duplicate existing identities.
    existing_keys = set()
    has_entity_col = "entity_key" in {r[1] for r in conn.execute("PRAGMA table_info(people_killed)").fetchall()}
    if has_entity_col:
        cur = conn.execute("SELECT entity_key FROM people_killed WHERE entity_key IS NOT NULL")
        existing_keys = {row[0] for row in cur.fetchall()}
        print(f"Found {len(existing_keys)} existing entity_keys; skipping those in input", file=sys.stderr)
    to_insert = [r for r in transformed if not r.get("entity_key") or r["entity_key"] not in existing_keys]
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
    update_clause = ",".join(
        f"{c}=excluded.{c}" for c in cols if c not in ("stable_id", "created_at")
    )
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

    cur = conn.execute("SELECT COUNT(*) FROM people_killed WHERE source_dataset='tech4palestine'")
    total = cur.fetchone()[0]
    print(f"DONE — people_killed rows from tech4palestine: {total}")
    conn.close()


if __name__ == "__main__":
    main()
