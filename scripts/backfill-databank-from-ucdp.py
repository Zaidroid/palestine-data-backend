#!/usr/bin/env python3
"""
Backfill actor_actions from UCDP-GED.

Each UCDP event becomes one actor_actions row: side_a is the primary
actor (typically "Government of Israel"), action_type is derived from
the violence type, target_count from best_estimate, lat/lng + date
preserved. 7,800+ rows from 1989-2024 historical events.

Read: public/data/ucdp/conflict-events-isr.json
Write: alerts.db people_killed/injured tables AND actor_actions table.
Idempotent via stable_id.
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
DEFAULT_SRC = REPO_ROOT / "public/data/ucdp/conflict-events-isr.json"
ATTRIBUTION = "Conflict events: Uppsala Conflict Data Program (ucdp.uu.se), CC-BY-IGO."
SOURCE_URL = "https://ucdp.uu.se/"


def stable_id(*parts) -> str:
    raw = "|".join("" if p is None else str(p).strip().lower() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def ensure_actor_actions(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS actor_actions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            stable_id       TEXT UNIQUE NOT NULL,
            actor_type      TEXT NOT NULL,
            actor_name      TEXT,
            action_type     TEXT NOT NULL,
            date            TEXT NOT NULL,
            place_name      TEXT,
            place_region    TEXT,
            lat             REAL,
            lng             REAL,
            target_count    INTEGER,
            source_alert_id INTEGER,
            source_dataset  TEXT NOT NULL,
            source_url      TEXT,
            attribution_text TEXT,
            confidence      REAL DEFAULT 0.7,
            notes           TEXT,
            created_at      TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_actions_date ON actor_actions(date DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_actions_actor ON actor_actions(actor_type)")
    conn.commit()


def classify_actor(side_a: str, side_b: str) -> tuple[str, str]:
    """Return (actor_type, actor_name) for the primary aggressor."""
    a = (side_a or "").lower()
    b = (side_b or "").lower()
    if "government of israel" in a or "idf" in a or "israel" in a:
        return "idf", side_a
    if "government of israel" in b:
        return "idf", side_b
    if "settler" in a or "settler" in b:
        return "settlers", side_a if "settler" in a else side_b
    if "palestinian" in a or "hamas" in a or "pflp" in a or "fatah" in a:
        return "palestinian_armed_group", side_a
    return "unknown", side_a or side_b


def classify_action(violence_type: str, deaths: int) -> str:
    if violence_type == "one_sided":
        return "shooting" if deaths <= 5 else "raid"
    if violence_type == "non_state":
        return "armed_clash"
    if violence_type == "state_based":
        return "raid" if deaths <= 5 else "military_operation"
    return "incident"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--source", type=Path, default=DEFAULT_SRC)
    args = ap.parse_args()

    raw = json.loads(args.source.read_text())
    events = raw.get("data", [])
    print(f"[ucdp-actions] loaded {len(events)} events", file=sys.stderr)

    conn = sqlite3.connect(str(args.db), timeout=30)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    ensure_actor_actions(conn)

    rows = []
    now = datetime.utcnow().isoformat()
    for e in events:
        actor_type, actor_name = classify_actor(e.get("side_a"), e.get("side_b"))
        deaths = (e.get("deaths_a") or 0) + (e.get("deaths_b") or 0) + (e.get("deaths_civilians") or 0) + (e.get("deaths_unknown") or 0)
        action = classify_action(e.get("type_of_violence"), deaths)
        sid = stable_id("action", "ucdp", e.get("ucdp_id"))
        rows.append({
            "stable_id": sid,
            "actor_type": actor_type,
            "actor_name": actor_name,
            "action_type": action,
            "date": e.get("date"),
            "place_name": e.get("where") or e.get("adm_2"),
            "place_region": e.get("region"),
            "lat": e.get("latitude"),
            "lng": e.get("longitude"),
            "target_count": e.get("best_estimate") or deaths or None,
            "source_alert_id": None,
            "source_dataset": "ucdp_ged",
            "source_url": SOURCE_URL,
            "attribution_text": ATTRIBUTION,
            "confidence": 0.95,
            "notes": (e.get("source_headline") or "")[:500],
            "created_at": now,
        })

    cols = ["stable_id", "actor_type", "actor_name", "action_type", "date",
            "place_name", "place_region", "lat", "lng", "target_count",
            "source_alert_id", "source_dataset", "source_url",
            "attribution_text", "confidence", "notes", "created_at"]
    placeholders = ",".join(["?"] * len(cols))
    update_clause = ",".join(f"{c}=excluded.{c}" for c in cols if c not in ("stable_id", "created_at"))
    sql = f"INSERT INTO actor_actions ({','.join(cols)}) VALUES ({placeholders}) ON CONFLICT(stable_id) DO UPDATE SET {update_clause}"
    conn.executemany(sql, [[r[c] for c in cols] for r in rows])
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM actor_actions WHERE source_dataset='ucdp_ged'").fetchone()[0]
    print(f"[ucdp-actions] DONE — actor_actions rows from ucdp_ged: {total}")
    conn.close()


if __name__ == "__main__":
    main()
