"""Retroactive re-classification after F1 (siren geo-restrict) + F4 (byline).
Re-runs the CURRENT classifier over recent west_bank_siren / journalist_targeted
alerts and re-types the rows whose classification changed (e.g. a Jordan/Bahrain
siren stored as west_bank_siren now classifies as regional_attack, so it leaves
the default WB/Gaza feed). Dry-run by default — pass --apply to write.

Run in-container:
  docker exec params-alerts-api python /app/scripts/retype_after_f1f4.py [--days 7] [--apply]
Local (snapshot):
  AUDIT_DB=/path/alerts.db python scripts/retype_after_f1f4.py --days 30
"""
import argparse, os, sqlite3, sys
# app package: the service root (…/services/westbank-alerts) in the repo, or /app
# in the container (this script may be docker-cp'd to /tmp, so add both).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, "/app")
from app.classifier import classify, classify_wb_operational, is_security_relevant

# only re-type WITHIN these — narrow blast radius (the two types F1/F4 fix)
TARGET_TYPES = ("west_bank_siren", "journalist_targeted")


def reclassify(raw, source):
    c = None
    if is_security_relevant(raw):
        c = classify(raw, source)
    if c is None:
        c = classify_wb_operational(raw, source)
    if not c:
        return None
    t = c.get("type")
    return t.value if hasattr(t, "value") else t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    db_path = os.environ.get("AUDIT_DB", "/data/alerts.db")
    con = sqlite3.connect(db_path, timeout=60)
    con.execute("PRAGMA busy_timeout=60000")   # live service holds write locks
    con.row_factory = sqlite3.Row
    rows = con.execute(
        f"""SELECT id, type, source, raw_text FROM alerts
            WHERE type IN ({','.join('?'*len(TARGET_TYPES))})
              AND timestamp >= datetime('now', ?)""",
        (*TARGET_TYPES, f"-{args.days} days"),
    ).fetchall()

    changes = []
    for r in rows:
        new = reclassify(r["raw_text"] or "", r["source"] or "")
        if new and new != r["type"]:
            changes.append((r["id"], r["type"], new, (r["raw_text"] or "")[:60]))

    print(f"scanned {len(rows)} {TARGET_TYPES} rows (last {args.days}d); {len(changes)} would re-type")
    from collections import Counter
    print("transitions:", dict(Counter(f"{o}->{n}" for _, o, n, _ in changes)))
    for _id, old, new, txt in changes[:40]:
        print(f"  #{_id} {old} -> {new}: {txt}")

    if args.apply and changes:
        for _id, _old, new, _txt in changes:
            con.execute("UPDATE alerts SET type=? WHERE id=?", (new, _id))
        con.commit()
        print(f"APPLIED: re-typed {len(changes)} rows.")
    elif not args.apply:
        print("DRY RUN — pass --apply to write.")
    con.close()


if __name__ == "__main__":
    main()
