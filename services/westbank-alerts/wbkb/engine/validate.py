"""KB integrity checks + the safety invariant assertion.

``validate_kb`` returns a list of integrity problems (empty == clean).
``assert_safe`` raises if a returned route ever traverses a forbidden/settlement
edge — the single guard tested in tests/test_pipeline.py.
"""
from __future__ import annotations

from . import router


class SafetyViolation(AssertionError):
    pass


def validate_kb(nodes: dict, edges: dict) -> list[str]:
    problems: list[str] = []
    for eid, e in edges.items():
        if e.get("from") not in nodes:
            problems.append(f"edge {eid}: from '{e.get('from')}' is not a node")
        if e.get("to") not in nodes:
            problems.append(f"edge {eid}: to '{e.get('to')}' is not a node")
        gating = ((e.get("facts") or {}).get("gating") or {}).get("value") or []
        for cp in gating:
            if cp not in nodes:
                problems.append(f"edge {eid}: gating checkpoint '{cp}' is not a node")
        for slot in ("road_exists", "permission"):
            if slot not in (e.get("facts") or {}):
                problems.append(f"edge {eid}: missing required fact '{slot}'")
    for nid, n in nodes.items():
        for ce in n.get("controls_edges") or []:
            if ce not in edges:
                problems.append(f"node {nid}: controls_edges references unknown edge '{ce}'")
        if "exists" not in (n.get("facts") or {}):
            problems.append(f"node {nid}: missing required fact 'exists'")
    return problems


def assert_safe(result: dict, edges: dict) -> None:
    """Raise SafetyViolation if any edge in the returned route is forbidden."""
    if not result.get("found"):
        return
    for leg in result.get("edges", []):
        e = edges.get(leg["id"])
        if e is not None and router.is_forbidden(e):
            raise SafetyViolation(f"route traverses forbidden edge {leg['id']}")
