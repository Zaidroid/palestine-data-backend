"""KB IO over the SQLite backbone.

The DB stores facts append-only; this module derives the *current* KB (one
winning fact per slot) and exposes append/query helpers. The in-memory shape
returned by ``load_kb`` is exactly what the pure engine (router/validate)
consumes, so the engine never touches the database.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import confidence as C
from . import db as DB

ROOT = Path(__file__).resolve().parent.parent
KB_DIR = ROOT / "kb"
DATA_DIR = DB.DATA_DIR

SLOTS_BY_KIND = {
    "node": ["exists"],
    "edge": ["road_exists", "permission", "gating"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _row_to_fact(r) -> dict:
    return {
        "value": json.loads(r["value_json"]),
        "source": r["source"],
        "fact_kind": r["fact_kind"],
        "last_verified": r["last_verified"],
        "note": r["note"],
        "recorded_at": r["recorded_at"],
        "half_life_days": C.half_life(r["fact_kind"]),
    }


def _current_facts(conn, now=None) -> dict[tuple[str, str], dict[str, dict]]:
    """(entity_kind, entity_id) -> {slot: winning_fact}. Collapses the
    append-only log via authority rank then effective confidence."""
    buckets: dict[tuple[str, str, str], list[dict]] = {}
    for r in conn.execute("SELECT * FROM facts"):
        buckets.setdefault((r["entity_kind"], r["entity_id"], r["slot"]), []).append(_row_to_fact(r))
    out: dict[tuple[str, str], dict[str, dict]] = {}
    for (kind, eid, slot), facts in buckets.items():
        out.setdefault((kind, eid), {})[slot] = C.resolve(facts, now)
    return out


def load_kb(conn=None, now=None) -> tuple[dict, dict, dict]:
    """Return (nodes_by_id, edges_by_id, metadata) — current view of the KB."""
    own = conn is None
    conn = conn or DB.connect()
    try:
        cur = _current_facts(conn, now)
        nodes: dict[str, dict] = {}
        for r in conn.execute("SELECT * FROM nodes"):
            nodes[r["id"]] = {
                "id": r["id"], "type": r["type"], "subtype": r["subtype"],
                "name_en": r["name_en"], "name_ar": r["name_ar"], "governorate": r["governorate"],
                "coord": ({"lat": r["lat"], "lng": r["lng"]} if r["lat"] is not None else None),
                "coord_source": r["coord_source"], "status_class": r["status_class"],
                "feed_key": r["feed_key"], "notes": r["notes"],
                "controls_edges": [], "facts": cur.get(("node", r["id"]), {}),
            }
        edges: dict[str, dict] = {}
        for r in conn.execute("SELECT * FROM edges"):
            edges[r["id"]] = {
                "id": r["id"], "from": r["from_id"], "to": r["to_id"], "road_ref": r["road_ref"],
                "corridor": r["corridor"], "class": r["class"], "base_minutes": r["base_minutes"],
                "passes_settlement": bool(r["passes_settlement"]), "oneway": bool(r["oneway"]),
                "notes": r["notes"], "facts": cur.get(("edge", r["id"]), {}),
            }
        # derive controls_edges from current gating (single source of truth)
        for eid, e in edges.items():
            for cp in ((e["facts"].get("gating") or {}).get("value") or []):
                if cp in nodes:
                    nodes[cp]["controls_edges"].append(eid)
        meta = {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM meta")}
        return nodes, edges, meta
    finally:
        if own:
            conn.close()


def append_fact(conn, entity_kind: str, entity_id: str, slot: str, value, source: str,
                fact_kind: str, last_verified: str, note: str = "") -> int:
    """Insert one immutable fact row. This is the ONLY way facts change — a new
    higher-authority/fresher row wins on the next load. Returns the fact_id."""
    cur = conn.execute(
        "INSERT INTO facts(entity_kind, entity_id, slot, value_json, source, fact_kind, last_verified, note, recorded_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (entity_kind, entity_id, slot, json.dumps(value, ensure_ascii=False), source, fact_kind, last_verified, note, now_iso()),
    )
    conn.commit()
    return cur.lastrowid


def fact_history(conn, entity_kind: str, entity_id: str, slot: str | None = None) -> list[dict]:
    """Full append-only history for an entity (audit trail / time travel)."""
    if slot:
        rows = conn.execute("SELECT * FROM facts WHERE entity_kind=? AND entity_id=? AND slot=? ORDER BY fact_id", (entity_kind, entity_id, slot))
    else:
        rows = conn.execute("SELECT * FROM facts WHERE entity_kind=? AND entity_id=? ORDER BY fact_id", (entity_kind, entity_id))
    return [dict(r) for r in rows]


def staleness_worklist(nodes: dict, edges: dict, now=None) -> list[dict]:
    """Every current fact whose effective confidence has decayed below threshold,
    worst first — the queue to re-confirm."""
    out: list[dict] = []
    for kind, store in (("node", nodes), ("edge", edges)):
        for ent_id, ent in store.items():
            for slot, fact in (ent.get("facts") or {}).items():
                eff = C.effective_confidence(fact, now)
                if eff < C.STALE_THRESHOLD:
                    out.append({
                        "entity_kind": kind, "entity_id": ent_id,
                        "name": ent.get("name_en") or ent.get("road_ref") or ent_id,
                        "slot": slot, "source": fact.get("source"),
                        "last_verified": fact.get("last_verified"),
                        "effective_confidence": round(eff, 3),
                    })
    out.sort(key=lambda r: r["effective_confidence"])
    return out


# ---- live status (bounded, last-wins) ----
def set_live_status(conn, feed_key: str, status: str, ts: str, channel: str | None = None) -> None:
    conn.execute(
        "INSERT INTO live_status(feed_key, status, ts, channel) VALUES(?,?,?,?) "
        "ON CONFLICT(feed_key) DO UPDATE SET status=excluded.status, ts=excluded.ts, channel=excluded.channel "
        "WHERE excluded.ts >= live_status.ts",
        (feed_key, status, ts, channel),
    )
    conn.commit()


def get_live_statuses(conn, now=None, ttl_days: float = 1.5) -> dict[str, str]:
    """{feed_key: status}, dropping signals older than the TTL so the router
    reverts to its cautious default instead of trusting a stale 'open'."""
    out: dict[str, str] = {}
    for r in conn.execute("SELECT feed_key, status, ts FROM live_status"):
        if C.age_days(r["ts"], now) <= ttl_days:
            out[r["feed_key"]] = r["status"]
    return out


def export_json(nodes: dict, edges: dict, meta: dict) -> None:
    """Write a portable snapshot of the current KB (debug / inspection only —
    the DB is the source of truth)."""
    KB_DIR.mkdir(parents=True, exist_ok=True)
    (KB_DIR / "nodes.json").write_text(json.dumps({"metadata": meta, "nodes": list(nodes.values())}, ensure_ascii=False, indent=2), encoding="utf-8")
    (KB_DIR / "edges.json").write_text(json.dumps({"metadata": meta, "edges": list(edges.values())}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    nodes, edges, _ = load_kb()
    wl = staleness_worklist(nodes, edges)
    print(f"staleness worklist — {len(wl)} facts below confidence {C.STALE_THRESHOLD}\n")
    for r in wl[:60]:
        print(f"  {r['effective_confidence']:.2f}  {r['entity_id']:<22} {r['slot']:<14} {r['source']:<14} {r['name']}")
    if len(wl) > 60:
        print(f"  … and {len(wl) - 60} more")
