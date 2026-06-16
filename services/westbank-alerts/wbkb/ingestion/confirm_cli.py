"""Human confirmation loop — the apex authority that drives the KB to accuracy.

Every confirmation is appended as an immutable ``human_local`` fact row, so it
wins on the next load and the prior belief is preserved in history.

Batch:  python3 -m ingestion.confirm_cli data/confirmations.json
  confirmations.json = [{ "entity": "edge"|"node", "id": "...", "slot": "...",
                          "value": <any>, "note": "..." }]
Interactive (no arg): walks the staleness worklist and prompts y/n/skip.
"""
from __future__ import annotations

import json
import sys

from engine import db as DB
from engine.kb_io import load_kb, append_fact, staleness_worklist, now_iso


def _kind_for(entity_kind: str, slot: str) -> str:
    if slot == "exists":
        return "node_exists_intermittent"
    return {"road_exists": "edge_road_exists", "permission": "edge_permission", "gating": "edge_gating"}.get(slot, "edge_permission")


def apply_confirmations(items: list[dict], conn=None) -> dict:
    own = conn is None
    conn = conn or DB.connect()
    try:
        nodes, edges, _ = load_kb(conn)
        applied = 0
        for it in items:
            kind = it.get("entity", "edge")
            store = nodes if kind == "node" else edges
            if it["id"] not in store:
                print(f"  ! unknown {kind} '{it['id']}' — skipped")
                continue
            append_fact(conn, kind, it["id"], it["slot"], it["value"], "human_local",
                        _kind_for(kind, it["slot"]), now_iso(), it.get("note", "human confirmation"))
            applied += 1
        return {"submitted": len(items), "applied": applied}
    finally:
        if own:
            conn.close()


def interactive(conn=None) -> dict:
    own = conn is None
    conn = conn or DB.connect()
    try:
        nodes, edges, _ = load_kb(conn)
        wl = staleness_worklist(nodes, edges)
        if not wl:
            print("worklist empty — nothing stale to confirm.")
            return {"applied": 0}
        applied = 0
        print(f"{len(wl)} stale facts. [Enter]=still true · n=mark false · s=skip · q=quit\n")
        for r in wl:
            store = nodes if r["entity_kind"] == "node" else edges
            cur = store[r["entity_id"]]["facts"][r["slot"]]["value"]
            ans = input(f"  {r['entity_id']} · {r['slot']} ({r['name']}) [{r['effective_confidence']}] confirm? ").strip().lower()
            if ans == "q":
                break
            if ans == "s":
                continue
            value = cur if ans == "" else False
            append_fact(conn, r["entity_kind"], r["entity_id"], r["slot"], value, "human_local",
                        _kind_for(r["entity_kind"], r["slot"]), now_iso(), "interactive confirmation")
            applied += 1
        return {"applied": applied}
    finally:
        if own:
            conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(json.dumps(apply_confirmations(json.loads(open(sys.argv[1], encoding="utf-8").read())), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(interactive(), ensure_ascii=False, indent=2))
