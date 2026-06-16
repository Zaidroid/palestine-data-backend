#!/usr/bin/env python3
"""One entrypoint over the SQLite backbone:
   build -> (confirm) -> ingest feed -> route -> validate.

Uses real files from data/ when present (feed.json, confirmations.json), else a
small demo feed. Shows the Ramallah -> Nablus route entering Nablus via the REAL
entrance (Murabba'a / ...), never via Huwwara.
"""
from __future__ import annotations

import json

import build_kb
from engine import db as DB
from engine import router, validate
from engine.kb_io import load_kb, staleness_worklist, get_live_statuses, DATA_DIR
from ingestion import confirm_cli, telegram_adapter


def _load_json(name, default):
    p = DATA_DIR / name
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default


def main() -> int:
    print("=" * 64)
    print("West Bank Routing KB — build · ingest · route · validate")
    print("=" * 64)

    # 1. build / seed (idempotent)
    build_kb.main([])

    conn = DB.connect()
    try:
        # 2. human confirmations (apex authority), if dropped in data/
        confirmations = _load_json("confirmations.json", [])
        if confirmations:
            print("\nconfirmations:", confirm_cli.apply_confirmations(confirmations, conn))

        # 3. live feed -> live_status table
        demo_feed = [
            {"text": "حاجز حوارة مسكر بالكامل", "channel": "demo"},   # Huwwara closed (irrelevant — no entrance edge)
            {"text": "المربعة سالك", "channel": "demo"},               # real Nablus entrance open
            {"text": "عطارة ازمة خانقة", "channel": "demo"},           # congestion on the corridor
        ]
        feed = _load_json("feed.json", demo_feed)
        print("\nfeed:", telegram_adapter.ingest_to_db(feed, conn))
        status_map = get_live_statuses(conn)
        print("live statuses:", json.dumps(status_map, ensure_ascii=False))

        # 4. route Ramallah -> Nablus
        nodes, edges, _ = load_kb(conn)
    finally:
        conn.close()

    res = router.route(nodes, edges, "city_ramallah", "city_nablus", status_map)
    print("\nRamallah -> Nablus")
    print(f"  verdict: {res['verdict']}  ·  {res.get('total_minutes')} min  ·  {res['message']}")
    if res["found"]:
        print("  path:", " -> ".join(res["path_names"]))
        entry = res["edges"][-1]
        print(f"  enters Nablus via: {entry['from']}  (edge {entry['id']}, {entry.get('road_ref')})")
        assert "cp_huwwara" not in res["path_nodes"], "ROUTING BUG: route used Huwwara"

    # 5. validate (integrity + safety invariant)
    problems = validate.validate_kb(nodes, edges)
    validate.assert_safe(res, edges)
    print(f"\nintegrity: {'clean' if not problems else str(len(problems)) + ' problems'}")
    print("safety invariant: route contains no forbidden edge ✓")
    wl = staleness_worklist(nodes, edges)
    print(f"staleness worklist: {len(wl)} facts to verify (run `python3 -m engine.kb_io` to list)")
    print(f"db: {DB.DB_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
