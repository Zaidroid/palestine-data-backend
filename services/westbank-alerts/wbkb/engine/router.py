"""Confidence-aware, two-layer A* router with a hard safety invariant.

Layer 1 (physical): a road exists and is *permitted* to green plates.
Layer 2 (dynamic): the checkpoints gating that road are not currently closed.

Safety invariant (asserted in validate.assert_safe): the router can NEVER return
a route that traverses a road forbidden to green plates or a settlement road,
regardless of cost or confidence. If the only path is low-confidence it is
returned but flagged "verify before travel"; if no permissible path exists it
returns verdict ``hold`` — never an improvised forbidden road.
"""
from __future__ import annotations

import heapq
import math

from . import confidence as C

# permission values that the router must NEVER traverse (the safety class)
FORBIDDEN_PERMISSIONS = {"forbidden", "settler_road", "settlement_road", "israeli_only"}

# extra minutes by live checkpoint status; "closed" blocks the edge entirely.
STATUS_PENALTY = {
    "open": 0.0, "clear": 0.0,
    "inspection": 10.0, "police": 10.0, "slow": 12.0, "partial": 8.0, "unknown": 8.0,
    "congested": 20.0, "crisis": 28.0, "idf": 26.0,
}

# severity order (low → high). Any status NOT listed is treated as "unknown" so a
# new/unexpected feed status (e.g. a vocabulary we haven't mapped) never crashes
# the router — it just degrades to the cautious default.
_SEVERITY = ["open", "clear", "partial", "unknown", "inspection", "police", "slow", "congested", "idf", "crisis", "closed"]


def _severity_rank(status: str) -> int:
    try:
        return _SEVERITY.index(status)
    except ValueError:
        return _SEVERITY.index("unknown")
RESIDENTS_ONLY_PENALTY = 30.0   # not the hard safety class, but not for through-travel
LOW_CONF_PENALTY = 15.0         # discourage (but allow) unverified roads
LOW_CONF_THRESHOLD = 0.40


def _fact(entity: dict, slot: str) -> dict | None:
    return (entity.get("facts") or {}).get(slot)


def _val(entity: dict, slot: str, default=None):
    f = _fact(entity, slot)
    return f.get("value") if f else default


def haversine_km(a: dict, b: dict) -> float:
    ca, cb = a.get("coord"), b.get("coord")
    if not ca or not cb:
        return 0.0
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (ca["lat"], ca["lng"], cb["lat"], cb["lng"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def is_forbidden(edge: dict) -> bool:
    """The single check that catches the generic-router failure mode."""
    if edge.get("passes_settlement") is True:
        return True
    return _val(edge, "permission") in FORBIDDEN_PERMISSIONS


def edge_status(edge: dict, nodes: dict, status_map: dict[str, str]) -> tuple[str, list[dict]]:
    """Worst live status across the edge's gating checkpoints, plus per-gate detail.
    A gate with no live signal defaults to the cautious ``partial``."""
    gates = _val(edge, "gating", []) or []
    worst, detail = "open", []
    for cp_id in gates:
        cp = nodes.get(cp_id, {})
        fk = cp.get("feed_key")
        st = status_map.get(fk, "partial") if fk else "open"
        detail.append({"cp": cp_id, "feed_key": fk, "status": st})
        if _severity_rank(st) > _severity_rank(worst):
            worst = st
    return worst, detail


def edge_cost(edge: dict, nodes: dict, status_map: dict[str, str], now=None) -> tuple[float | None, dict]:
    """(minutes, info). minutes is None when the edge is unusable — forbidden
    (safety), no road, or a gating checkpoint is closed (reroute)."""
    info: dict = {"flags": [], "gating": [], "permission": _val(edge, "permission"), "blocked_reason": None}

    if is_forbidden(edge):
        info["blocked_reason"] = "forbidden"
        info["flags"].append("forbidden")
        return None, info
    if _val(edge, "road_exists") is not True:
        info["blocked_reason"] = "no_road"
        return None, info

    perm = _val(edge, "permission")
    base = float(edge.get("base_minutes", 10))
    penalty = 0.0

    if perm == "residents_only":
        penalty += RESIDENTS_ONLY_PENALTY
        info["flags"].append("residents_only")

    worst, gate_detail = edge_status(edge, nodes, status_map)
    info["gating"] = gate_detail
    info["gate_status"] = worst
    if worst == "closed":
        info["blocked_reason"] = "gate_closed"
        return None, info
    penalty += STATUS_PENALTY.get(worst, 8.0)
    if worst not in ("open", "clear"):
        info["flags"].append(f"gate_{worst}")

    rf, pf = _fact(edge, "road_exists"), _fact(edge, "permission")
    conf = min(C.effective_confidence(rf, now) if rf else 1.0, C.effective_confidence(pf, now) if pf else 1.0)
    info["confidence"] = round(conf, 3)
    if conf < LOW_CONF_THRESHOLD:
        penalty += LOW_CONF_PENALTY
        info["flags"].append("low_confidence")

    return base + penalty, info


def _adjacency(edges: dict) -> dict[str, list[tuple[str, dict]]]:
    """Undirected: roads are two-way unless a oneway flag is set."""
    adj: dict[str, list[tuple[str, dict]]] = {}
    for e in edges.values():
        adj.setdefault(e["from"], []).append((e["to"], e))
        if not e.get("oneway"):
            adj.setdefault(e["to"], []).append((e["from"], e))
    return adj


def route(nodes: dict, edges: dict, src: str, dst: str, status_map: dict[str, str] | None = None, now=None) -> dict:
    status_map = status_map or {}
    if src not in nodes or dst not in nodes:
        return {"found": False, "verdict": "hold", "message": "unknown origin or destination", "path_nodes": [], "edges": []}

    adj = _adjacency(edges)
    dst_node = nodes[dst]

    def h(nid: str) -> float:
        return haversine_km(nodes.get(nid, {}), dst_node) * 1.5  # ~40 km/h admissible

    best: dict[str, float] = {src: 0.0}
    prev: dict[str, tuple[str, dict, dict]] = {}
    pq: list[tuple[float, float, str]] = [(h(src), 0.0, src)]
    seen: set[str] = set()

    while pq:
        _, g, nid = heapq.heappop(pq)
        if nid in seen:
            continue
        seen.add(nid)
        if nid == dst:
            break
        for nbr, edge in adj.get(nid, []):
            if nbr in seen:
                continue
            cost, info = edge_cost(edge, nodes, status_map, now)
            if cost is None:
                continue  # safety / closed / no-road → never traversed
            ng = g + cost
            if ng < best.get(nbr, math.inf):
                best[nbr] = ng
                prev[nbr] = (nid, edge, info)
                heapq.heappush(pq, (ng + h(nbr), ng, nbr))

    if dst not in best:
        return {
            "found": False, "verdict": "hold",
            "message": "No permissible route right now — all paths are forbidden or blocked by closed checkpoints. Hold and re-check the feed.",
            "path_nodes": [], "edges": [],
        }

    # reconstruct
    chain: list[tuple[str, dict, dict]] = []
    cur = dst
    while cur != src:
        pnode, edge, info = prev[cur]
        chain.append((cur, edge, info))
        cur = pnode
    chain.reverse()

    path_nodes = [src] + [c[0] for c in chain]
    leg_out, needs_verify, worst_gate = [], False, "open"
    order = ["open", "partial", "unknown", "inspection", "slow", "congested", "idf", "crisis"]
    for to_id, edge, info in chain:
        leg_out.append({
            "id": edge["id"], "from": edge["from"], "to": edge["to"],
            "road_ref": edge.get("road_ref"), "minutes": round(best[to_id] - best[prev[to_id][0]], 1),
            "permission": info.get("permission"), "confidence": info.get("confidence"),
            "gate_status": info.get("gate_status"), "gating": info.get("gating"), "flags": info.get("flags", []),
        })
        if "low_confidence" in info["flags"] or "residents_only" in info["flags"]:
            needs_verify = True
        gs = info.get("gate_status", "open")
        if gs in order and order.index(gs) > order.index(worst_gate):
            worst_gate = gs

    verdict = "clear" if worst_gate in ("open",) else "caution"
    if needs_verify and verdict == "clear":
        verdict = "caution"

    return {
        "found": True,
        "verdict": verdict,
        "needs_verification": needs_verify,
        "total_minutes": round(best[dst], 1),
        "path_nodes": path_nodes,
        "path_names": [nodes[n].get("name_en", n) for n in path_nodes],
        "edges": leg_out,
        "message": _verdict_message(verdict, needs_verify),
    }


def _verdict_message(verdict: str, needs_verify: bool) -> str:
    if verdict == "clear":
        return "Route looks open on current data."
    base = "Caution: congestion or restrictions reported on this route."
    return base + " Some segments are low-confidence — verify before travel." if needs_verify else base
