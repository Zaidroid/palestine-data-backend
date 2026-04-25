#!/usr/bin/env python3
"""
Backfill structures_damaged from /unified/infrastructure all-data.json.

Each infrastructure_damage record becomes one structures_damaged row.
Tech4Palestine's source data flattens into "0 units of infrastructure"
placeholders for many days, but the records still carry date + region
so we keep them as low-confidence aggregate signals.

Read: public/data/unified/infrastructure/all-data.json
Write: alerts.db structures_damaged table.
Idempotent via stable_id on (date, region, source).
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
DEFAULT_SRC = REPO_ROOT / "public/data/unified/infrastructure/all-data.json"


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_table(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS structures_damaged (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id       TEXT UNIQUE NOT NULL,
            type            TEXT,
            owner_name      TEXT,
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
    conn.execute("CREATE INDEX IF NOT EXISTS idx_structures_date ON structures_damaged(date DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_structures_type ON structures_damaged(type)")
    conn.commit()


def transform(record):
    detail = record.get("infrastructure_detail") or {}
    structure_type = detail.get("type") or "unknown"
    if structure_type == "unknown":
        structure_type = "infrastructure"
    cause = "airstrike" if (record.get("location") or {}).get("region") == "Gaza Strip" else "raid_damage"
    sid = stable_id("structure", record.get("id"))
    loc = record.get("location") or {}
    coords = loc.get("coordinates") or []
    lat = coords[1] if len(coords) >= 2 else loc.get("lat")
    lng = coords[0] if len(coords) >= 2 else loc.get("lon")
    sources = record.get("sources") or []
    src_name = (sources[0].get("name") if sources else None) or "Tech4Palestine"
    src_url = (sources[0].get("url") if sources else None)
    return {
        "stable_id": sid,
        "type": structure_type,
        "owner_name": None,
        "date": record.get("date"),
        "place_name": loc.get("name"),
        "place_region": loc.get("region"),
        "lat": lat,
        "lng": lng,
        "cause": cause,
        "source_alert_id": None,
        "source_dataset": "tech4palestine_infrastructure",
        "source_url": src_url,
        "attribution_text": (
            f"Data: {src_name} (CC-BY-4.0)."
        ),
        "confidence": 0.7,
        "notes": (record.get("description") or "")[:500],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--source", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()

    raw = json.loads(args.source.read_text())
    records = raw.get("data", [])
    print(f"[infra-backfill] loaded {len(records)} infrastructure records", file=sys.stderr)
    rows = [transform(r) for r in records if r.get("event_type") == "infrastructure_damage"]
    print(f"[infra-backfill] transformed {len(rows)} structures_damaged rows", file=sys.stderr)

    conn = sqlite3.connect(str(args.db), timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_table(conn)
    now = datetime.utcnow().isoformat()
    for r in rows:
        r["created_at"] = now

    cols = ["stable_id", "type", "owner_name", "date", "place_name", "place_region",
            "lat", "lng", "cause", "source_alert_id", "source_dataset",
            "source_url", "attribution_text", "confidence", "notes", "created_at"]
    placeholders = ",".join(["?"] * len(cols))
    update_clause = ",".join(f"{c}=excluded.{c}" for c in cols if c not in ("stable_id", "created_at"))
    sql = f"INSERT INTO structures_damaged ({','.join(cols)}) VALUES ({placeholders}) ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    conn.executemany(sql, [[r[c] for c in cols] for r in rows])
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM structures_damaged").fetchone()[0]
    print(f"[infra-backfill] DONE — structures_damaged total rows: {total}")
    conn.close()


if __name__ == "__main__":
    main()
