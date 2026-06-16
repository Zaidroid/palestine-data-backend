#!/usr/bin/env python3
"""Seed the SQLite KB from the compact v1.1 source graph.

Idempotent: creates the schema, inserts/refreshes node+edge rows, and seeds the
provenance facts ONLY when the facts log is empty (so re-running never duplicates
and never clobbers human confirmations). Use ``--reset`` to wipe and reseed.

    python3 build_kb.py            # seed if empty, else just refresh structure
    python3 build_kb.py --reset    # wipe facts/nodes/edges/live_status and reseed
"""
from __future__ import annotations

import json
import sys

from engine import db as DB
from engine import validate
from engine.kb_io import KB_DIR, load_kb, append_fact, export_json

SRC = KB_DIR / "_source_graph_v1_1.json"


def _seed_facts(conn, entity_kind: str, entity_id: str, facts: dict) -> None:
    for slot, arr in (facts or {}).items():
        value, source, fact_kind, date, note = arr
        append_fact(conn, entity_kind, entity_id, slot, value, source, fact_kind, f"{date}T00:00:00+00:00", note)


def seed(conn, reset: bool = False) -> dict:
    src = json.loads(SRC.read_text(encoding="utf-8"))
    DB.init_db(conn)

    if reset:
        for t in ("facts", "nodes", "edges", "live_status"):
            conn.execute(f"DELETE FROM {t}")
        conn.commit()

    # structure: always refresh node/edge rows (safe — facts carry the trust)
    for n in src.get("nodes", []):
        coord = n.get("coord") or [None, None]
        conn.execute(
            "INSERT OR REPLACE INTO nodes(id,type,subtype,name_en,name_ar,governorate,lat,lng,coord_source,status_class,feed_key,notes) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (n["id"], n.get("type"), n.get("subtype"), n.get("name_en"), n.get("name_ar"), n.get("governorate"),
             coord[0], coord[1], n.get("coord_source"), n.get("status_class"), n.get("feed_key"), n.get("notes")),
        )
    for e in src.get("edges", []):
        conn.execute(
            "INSERT OR REPLACE INTO edges(id,from_id,to_id,road_ref,corridor,class,base_minutes,passes_settlement,oneway,notes) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (e["id"], e["from"], e["to"], e.get("road_ref"), e.get("corridor"), e.get("class"),
             e.get("base_minutes"), 1 if e.get("passes_settlement") else 0, 1 if e.get("oneway") else 0, e.get("notes")),
        )
    conn.commit()

    seeded_now = False
    if not DB.is_seeded(conn):
        for n in src.get("nodes", []):
            _seed_facts(conn, "node", n["id"], n.get("facts"))
        for e in src.get("edges", []):
            _seed_facts(conn, "edge", e["id"], e.get("facts"))
        seeded_now = True

    return {"seeded_now": seeded_now}


def main(argv: list[str] | None = None) -> int:
    reset = "--reset" in (argv if argv is not None else sys.argv[1:])
    conn = DB.connect()
    try:
        info = seed(conn, reset=reset)
        nodes, edges, _ = load_kb(conn)
    finally:
        conn.close()

    export_json(nodes, edges, {"source": "wbkb.db snapshot"})
    problems = validate.validate_kb(nodes, edges)
    human = sum(1 for e in edges.values() if (e["facts"].get("permission") or {}).get("source") == "human_local")
    print(f"KB @ {DB.DB_PATH.name}: {len(nodes)} nodes, {len(edges)} edges "
          f"({'seeded' if info['seeded_now'] else 'already seeded'}{', reset' if reset else ''})")
    print(f"  human_local permission edges: {human} (the verified corridor)")
    if problems:
        print(f"  INTEGRITY PROBLEMS ({len(problems)}):")
        for p in problems:
            print(f"    - {p}")
        return 1
    print("  integrity: clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
