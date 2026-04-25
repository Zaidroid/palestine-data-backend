"""
Backfill the alerts.db `incidents` table from public/data/insecurity-insight/
incidents.json (produced by scripts/sources/insecurity-insight.js).

Idempotent: UPSERT on incident_id. Re-running with no JSON change is a no-op.

Usage (host or container):
    python3 scripts/backfill-incidents-from-insecurity-insight.py [--db PATH] [--limit N]
"""
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_JSON = REPO_ROOT / "public" / "data" / "insecurity-insight" / "incidents.json"

# Default DB path: prefer the alerts service's live DB if reachable
# (mounted at /data/alerts.db inside the container), otherwise the
# local volume in services/westbank-alerts/data/alerts.db (rare).
DEFAULT_DB_CANDIDATES = [
    "/data/alerts.db",
    REPO_ROOT / "services" / "westbank-alerts" / "data" / "alerts.db",
]


def pick_db(explicit):
    if explicit:
        return Path(explicit)
    for c in DEFAULT_DB_CANDIDATES:
        p = Path(c)
        if p.exists():
            return p
    print(f"[backfill] no DB found in defaults: {DEFAULT_DB_CANDIDATES}",
          file=sys.stderr)
    sys.exit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db",   default=None)
    ap.add_argument("--json", default=str(DEFAULT_JSON))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    json_path = Path(args.json)
    if not json_path.exists():
        print(f"[backfill] {json_path} missing — run scripts/sources/insecurity-insight.js first")
        sys.exit(2)

    db_path = pick_db(args.db)
    print(f"[backfill] DB={db_path} JSON={json_path}")

    incidents = json.loads(json_path.read_text())
    if args.limit:
        incidents = incidents[: args.limit]
    print(f"[backfill] {len(incidents)} incidents to UPSERT")

    conn = sqlite3.connect(str(db_path), timeout=60)
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")

    BATCH = 200
    pending = 0
    upserted = 0

    sql = """
    INSERT INTO humanitarian_incidents (
        incident_id, date, category, country_iso, admin1,
        latitude, longitude, geo_precision, location_type,
        perpetrator_type, perpetrator_name, weapon,
        event_description, organisation_affected,
        victims_killed, victims_injured, victims_kidnapped,
        victims_arrested, victims_threatened, victims_assaulted,
        source_dataset, source_url, details_json
    ) VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?)
    ON CONFLICT(incident_id) DO UPDATE SET
        date                  = excluded.date,
        category              = excluded.category,
        admin1                = excluded.admin1,
        latitude              = excluded.latitude,
        longitude             = excluded.longitude,
        geo_precision         = excluded.geo_precision,
        location_type         = excluded.location_type,
        perpetrator_type      = excluded.perpetrator_type,
        perpetrator_name      = excluded.perpetrator_name,
        weapon                = excluded.weapon,
        event_description     = excluded.event_description,
        organisation_affected = excluded.organisation_affected,
        victims_killed        = excluded.victims_killed,
        victims_injured       = excluded.victims_injured,
        victims_kidnapped     = excluded.victims_kidnapped,
        victims_arrested      = excluded.victims_arrested,
        victims_threatened    = excluded.victims_threatened,
        victims_assaulted     = excluded.victims_assaulted,
        source_dataset        = excluded.source_dataset,
        source_url            = excluded.source_url,
        details_json          = excluded.details_json
    """

    for inc in incidents:
        v = inc.get("victims") or {}
        try:
            conn.execute(sql, (
                inc["incident_id"], inc.get("date"), inc.get("category"),
                inc.get("country_iso"), inc.get("admin1"),
                inc.get("latitude"), inc.get("longitude"),
                inc.get("geo_precision"), inc.get("location_type"),
                inc.get("perpetrator_type"), inc.get("perpetrator_name"),
                inc.get("weapon"),
                inc.get("event_description"), inc.get("organisation_affected"),
                v.get("killed"), v.get("injured"), v.get("kidnapped"),
                v.get("arrested"), v.get("threatened"), v.get("assaulted"),
                inc.get("source_dataset"), inc.get("source_url"),
                json.dumps(inc.get("details") or {}),
            ))
            upserted += 1
            pending += 1
            if pending >= BATCH:
                conn.commit()
                pending = 0
        except sqlite3.OperationalError as e:
            print(f"[backfill] OperationalError on {inc.get('incident_id')}: {e}",
                  file=sys.stderr)
            raise

    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM humanitarian_incidents").fetchone()[0]
    by_cat = dict(conn.execute(
        "SELECT category, COUNT(*) FROM humanitarian_incidents GROUP BY category"
    ).fetchall())
    conn.close()
    print(f"[backfill] {upserted} rows upserted")
    print(f"[backfill] DB now: {total} total incidents; by_category={by_cat}")


if __name__ == "__main__":
    main()
