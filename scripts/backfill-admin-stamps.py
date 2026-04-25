"""
Backfill admin1/admin2 stamps onto every existing alert via point-in-
polygon against OCHA cod-ab-pse polygons.

Idempotent: only updates rows where the new value differs.
Skips rows with NULL lat/lng (nothing to stamp).

Usage (host or container):
    python3 scripts/backfill-admin-stamps.py [--db PATH] [--dry-run]
"""
import argparse
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# Two ways to find the alerts service code:
#   - host run: services/westbank-alerts is the package root
#   - container run: /app is the package root (set via Dockerfile WORKDIR)
for candidate in [REPO_ROOT / "services" / "westbank-alerts", Path("/app")]:
    if (candidate / "app" / "admin_lookup.py").exists():
        sys.path.insert(0, str(candidate))
        break

from app import admin_lookup  # noqa: E402


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
    ap.add_argument("--db", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db_path = pick_db(args.db)
    print(f"[backfill] DB={db_path}")

    admin_lookup.init()
    if not admin_lookup._admin1_features:
        print("[backfill] admin polygons not loaded — aborting", file=sys.stderr)
        sys.exit(2)

    conn = sqlite3.connect(str(db_path), timeout=60)
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")

    rows = conn.execute(
        "SELECT id, latitude, longitude, admin1, admin2 FROM alerts "
        "WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    ).fetchall()
    print(f"[backfill] {len(rows)} alerts with coords")

    BATCH = 200
    pending = 0
    changed = 0
    unchanged = 0

    for alert_id, lat, lng, old_a1, old_a2 in rows:
        a1, a2 = admin_lookup.point_to_admin(lat, lng)
        if a1 == old_a1 and a2 == old_a2:
            unchanged += 1
            continue
        if not args.dry_run:
            conn.execute(
                "UPDATE alerts SET admin1 = ?, admin2 = ? WHERE id = ?",
                (a1, a2, alert_id),
            )
            pending += 1
            if pending >= BATCH:
                conn.commit()
                pending = 0
        changed += 1

    if not args.dry_run:
        conn.commit()

    by_a1 = dict(conn.execute(
        "SELECT admin1, COUNT(*) FROM alerts WHERE admin1 IS NOT NULL GROUP BY admin1"
    ).fetchall())
    by_a2 = dict(conn.execute(
        "SELECT admin2, COUNT(*) FROM alerts WHERE admin2 IS NOT NULL "
        "GROUP BY admin2 ORDER BY 2 DESC LIMIT 10"
    ).fetchall())
    conn.close()

    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"[backfill] {mode}")
    print(f"  changed:   {changed}")
    print(f"  unchanged: {unchanged}")
    print(f"  by admin1: {by_a1}")
    print(f"  top admin2: {by_a2}")


if __name__ == "__main__":
    main()
