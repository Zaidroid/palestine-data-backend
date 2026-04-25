"""
Re-classify all alerts in alerts.db with the current classifier and
update the stored row in place.

  - NEW_FP   → set status='retracted', correction_note='backfill_classifier_v2'
  - Type/area change → update type, severity, area, lat/lng, geo_precision,
                       geo_source_phrase, title, title_ar, confidence,
                       source_reliability, zone, count, temporal_certainty
  - Unchanged → no write

Run --dry-run first to preview, then without --dry-run to apply.

    docker cp ... params-alerts-api:/tmp/audit/backfill_classifier_v2.py
    docker exec params-alerts-api python3 /tmp/audit/backfill_classifier_v2.py --dry-run
    docker exec params-alerts-api python3 /tmp/audit/backfill_classifier_v2.py
"""
import argparse
import asyncio
import sqlite3
import sys
from pathlib import Path

NOTE = "backfill_classifier_v2_2026-04-25"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="/data/alerts.db")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--show", type=int, default=5,
                    help="Print up to N example diffs per category")
    args = ap.parse_args()

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

    conn = sqlite3.connect(args.db, timeout=60)
    conn.execute("PRAGMA busy_timeout = 60000")
    conn.execute("PRAGMA journal_mode = WAL")
    BATCH = 50  # commit every N updates so the live writer can interleave

    rows = conn.execute(
        "SELECT id, type, source, area, severity, raw_text, status "
        "FROM alerts WHERE raw_text IS NOT NULL"
    ).fetchall()
    pending = 0

    new_fp_examples = []
    type_change_examples = []
    area_change_examples = []
    new_fp = type_change = area_change = unchanged = errors = 0

    def _short(v):
        return (v or "").split(".")[-1]

    def _snippet(t, n=110):
        return (t or "").replace("\n", " ")[:n]

    for r in rows:
        alert_id, old_type, source, old_area, old_sev, raw, old_status = r
        old_type_s = _short(old_type)
        try:
            res = _classify(raw, source or "")
        except Exception:
            errors += 1
            continue

        if res is None:
            if old_status == "active":
                if not args.dry_run:
                    conn.execute(
                        "UPDATE alerts SET status='retracted', "
                        "correction_note=? WHERE id = ?",
                        (NOTE, alert_id),
                    )
                    pending += 1
                    if pending >= BATCH:
                        conn.commit()
                        pending = 0
                new_fp += 1
                if len(new_fp_examples) < args.show:
                    new_fp_examples.append(
                        f"  #{alert_id} [{old_type_s} @ {old_area}] {_snippet(raw)}"
                    )
            continue

        new_type_s = _short(str(res["type"]))
        new_area = res.get("area")
        new_sev_s = _short(str(res["severity"])) if res.get("severity") else None
        new_lat = res.get("latitude")
        new_lng = res.get("longitude")
        new_geo_prec = res.get("geo_precision")
        new_geo_phrase = res.get("geo_source_phrase")
        new_title = res.get("title")
        new_title_ar = res.get("title_ar")
        new_conf = res.get("confidence")
        new_rel = res.get("source_reliability")
        new_zone = res.get("zone")
        new_count = res.get("count")
        new_temp = res.get("temporal_certainty")

        type_diff = new_type_s != old_type_s
        area_diff = new_area != old_area

        if type_diff or area_diff:
            if not args.dry_run:
                conn.execute(
                    """UPDATE alerts SET
                         type = ?,
                         severity = ?,
                         area = ?,
                         latitude = ?,
                         longitude = ?,
                         geo_precision = ?,
                         geo_source_phrase = ?,
                         title = ?,
                         title_ar = ?,
                         confidence = ?,
                         source_reliability = ?,
                         zone = ?,
                         count = ?,
                         temporal_certainty = ?
                       WHERE id = ?""",
                    (new_type_s, new_sev_s, new_area, new_lat, new_lng,
                     new_geo_prec, new_geo_phrase, new_title, new_title_ar,
                     new_conf, new_rel, new_zone, new_count, new_temp,
                     alert_id),
                )
                pending += 1
                if pending >= BATCH:
                    conn.commit()
                    pending = 0
            if type_diff:
                type_change += 1
                if len(type_change_examples) < args.show:
                    type_change_examples.append(
                        f"  #{alert_id} {old_type_s}@{old_area} -> "
                        f"{new_type_s}@{new_area}  : {_snippet(raw)}"
                    )
            else:
                area_change += 1
                if len(area_change_examples) < args.show:
                    area_change_examples.append(
                        f"  #{alert_id} [{new_type_s}] {old_area} -> "
                        f"{new_area}  : {_snippet(raw)}"
                    )
        else:
            unchanged += 1

    if not args.dry_run:
        conn.commit()
    conn.close()

    mode = "DRY-RUN" if args.dry_run else "APPLIED"
    print(f"\n=== Backfill {mode} on {len(rows)} alerts ===\n")
    print(f"  Unchanged:           {unchanged:>5}")
    print(f"  Retracted (NEW_FP):  {new_fp:>5}")
    print(f"  Type changed:        {type_change:>5}")
    print(f"  Area changed:        {area_change:>5}")
    print(f"  Errors:              {errors:>5}")
    if new_fp_examples:
        print("\n--- NEW_FP examples ---")
        for ex in new_fp_examples:
            print(ex)
    if type_change_examples:
        print("\n--- TYPE_CHANGE examples ---")
        for ex in type_change_examples:
            print(ex)
    if area_change_examples:
        print("\n--- AREA_CHANGE examples ---")
        for ex in area_change_examples:
            print(ex)


if __name__ == "__main__":
    main()
