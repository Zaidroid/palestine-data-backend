"""
Re-run the classifier (in its current state) over every active alert in
the live DB and report what would change. Used after a classifier fix to
quantify real-world impact without needing manually-labeled data.

Three signals reported:
  1. NEW_FP — alert exists today, new classifier returns None (would
     have been filtered by today's noise rules)
  2. AREA_CHANGE — alert exists today with area X, new classifier returns
     a different area Y (typically village wins over city)
  3. TYPE_CHANGE — alert classifies as a different event_type now

Run inside the container:
    docker exec params-alerts-api python3 /app/scripts/audit_classifier_impact.py
or sample-only (faster):
    docker exec params-alerts-api python3 /app/scripts/audit_classifier_impact.py --limit 200
"""
import argparse
import asyncio
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0,
                    help="0 = all active alerts; >0 = sample most-recent N")
    ap.add_argument("--db", default="/data/alerts.db")
    ap.add_argument("--show", type=int, default=10,
                    help="Print up to N example diffs per category")
    args = ap.parse_args()

    # Bootstrap the gazetteer so geo logic resolves villages
    sys.path.insert(0, "/app")
    import app.location_knowledge_base as _lkb
    kb = _lkb.LocationKnowledgeBase()
    for path in [Path("/app/data/known_locations.json"),
                 Path("/data/known_locations.json")]:
        if path.exists():
            asyncio.run(kb.load_from_file(path))
            break
    _lkb._location_kb = kb

    from app.classifier import classify, classify_wb_operational

    def _classify(text, source):
        return classify(text, source) or classify_wb_operational(text, source)

    conn = sqlite3.connect(args.db)
    q = ("SELECT id, type, source, area, raw_text FROM alerts "
         "WHERE status = 'active' AND raw_text IS NOT NULL "
         "ORDER BY timestamp DESC")
    if args.limit:
        q += f" LIMIT {args.limit}"
    rows = conn.execute(q).fetchall()
    conn.close()

    new_fp = []
    area_change = []
    type_change = []
    unchanged = 0

    for alert_id, old_type, source, old_area, raw_text in rows:
        old_type_short = (old_type or "").split(".")[-1]
        r = _classify(raw_text, source or "")
        if r is None:
            new_fp.append((alert_id, old_type_short, old_area, raw_text))
            continue
        new_type_short = str(r["type"]).split(".")[-1]
        new_area = r.get("area")
        if new_type_short != old_type_short:
            type_change.append((alert_id, old_type_short, new_type_short,
                               old_area, new_area, raw_text))
        elif new_area != old_area:
            area_change.append((alert_id, old_type_short, old_area,
                               new_area, raw_text))
        else:
            unchanged += 1

    total = len(rows)
    print(f"\n=== Classifier impact audit on {total} active alerts ===\n")
    print(f"  Unchanged:    {unchanged:>4} ({unchanged/total*100:5.1f}%)")
    print(f"  NEW_FP:       {len(new_fp):>4} ({len(new_fp)/total*100:5.1f}%) — "
          "would now be filtered as noise")
    print(f"  AREA_CHANGE:  {len(area_change):>4} ({len(area_change)/total*100:5.1f}%) — "
          "geo extraction picks a different place")
    print(f"  TYPE_CHANGE:  {len(type_change):>4} ({len(type_change)/total*100:5.1f}%) — "
          "event_type changes")

    def _snippet(t, n=120):
        return (t or "").replace("\n", " ")[:n]

    if new_fp and args.show:
        print("\n--- NEW_FP examples ---")
        for aid, t, a, raw in new_fp[:args.show]:
            print(f"  #{aid} [{t} @ {a}] {_snippet(raw)}")

    if area_change and args.show:
        print("\n--- AREA_CHANGE examples ---")
        for aid, t, oa, na, raw in area_change[:args.show]:
            print(f"  #{aid} [{t}] {oa} -> {na}  : {_snippet(raw)}")

    if type_change and args.show:
        print("\n--- TYPE_CHANGE examples ---")
        for aid, ot, nt, oa, na, raw in type_change[:args.show]:
            print(f"  #{aid} {ot}@{oa} -> {nt}@{na}  : {_snippet(raw)}")


if __name__ == "__main__":
    main()
