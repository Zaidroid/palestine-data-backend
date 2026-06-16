"""Bridge: serve the wbkb knowledge-base router behind /v2/route.

Confidence-gated and additive — only answers when BOTH endpoints snap to a known
KB city and the engine finds a permissible path; otherwise returns None and the
caller falls back to Valhalla. The KB is loaded read-only and cached; live
checkpoint status comes from the app's own checkpoint envelopes (in-process, no
network). The safety invariant is asserted before returning.
"""
from __future__ import annotations

import logging
import math
import sys
import time
from pathlib import Path

log = logging.getLogger("kb_service")

# make `import wbkb.*` work (wbkb/ sits beside app/ in the service root)
_SERVICE_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

try:
    from wbkb.engine import db as kbdb, router as kbrouter
    from wbkb.engine.kb_io import load_kb
    from wbkb.engine.validate import assert_safe
    from wbkb.ingestion.telegram_adapter import match_feed_key
    _AVAILABLE = True
except Exception:  # noqa: BLE001 — KB optional; never break routing if it can't load
    log.exception("wbkb import failed — kb routing disabled")
    _AVAILABLE = False

SNAP_KM = 9.0
_CACHE: dict = {"kb": None, "ts": 0.0}
_TTL = 600.0


def _km(a_lat, a_lon, b_lat, b_lon) -> float:
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a_lat, a_lon, b_lat, b_lon))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _kb():
    now = time.time()
    if _CACHE["kb"] is None or now - _CACHE["ts"] > _TTL:
        conn = kbdb.connect()
        try:
            if not kbdb.is_seeded(conn):
                return None  # not seeded yet → caller falls back to Valhalla
            nodes, edges, _ = load_kb(conn)
        finally:
            conn.close()
        _CACHE["kb"], _CACHE["ts"] = (nodes, edges), now
    return _CACHE["kb"]


def _snap_city(nodes: dict, lat: float, lon: float) -> str | None:
    best, best_km = None, SNAP_KM
    for nid, n in nodes.items():
        if n.get("type") != "city" or not n.get("coord"):
            continue
        d = _km(lat, lon, n["coord"]["lat"], n["coord"]["lng"])
        if d < best_km:
            best, best_km = nid, d
    return best


def _status_map(envelopes: list) -> dict[str, str]:
    """{feed_key: effective_status} from the app's live checkpoint envelopes."""
    out: dict[str, str] = {}
    for e in envelopes:
        name = " ".join(str(e.get(k) or "") for k in ("name_ar", "name_en", "canonical_key"))
        fk = match_feed_key(name)
        st = e.get("effective_status")
        if fk and st and fk not in out:
            out[fk] = st
    return out


def _envelope(node: dict, status: str) -> dict:
    c = node.get("coord") or {}
    return {
        "canonical_key": node["id"],
        "name_ar": node.get("name_ar"), "name_en": node.get("name_en"),
        "governorate": node.get("governorate"),
        "effective_status": status,
        "coordinates": {"lat": c.get("lat"), "lon": c.get("lng"), "precision": None},
        "live": {"status_raw": None, "confidence": "medium", "status": status},
        "freshness": {"age_hours": None},
    }


def _schematic_coords(res: dict, nodes: dict) -> tuple[list, float]:
    coords, dist_km, prev = [], 0.0, None
    for nid in res["path_nodes"]:
        c = nodes[nid].get("coord")
        if not c:
            continue
        coords.append([c["lng"], c["lat"]])
        if prev:
            dist_km += _km(prev[1], prev[0], c["lat"], c["lng"])
        prev = [c["lng"], c["lat"]]
    return coords, round(dist_km, 1)


async def _real_geometry(res: dict, nodes: dict, route_fn) -> dict | None:
    """Real road geometry from Valhalla, routed THROUGH the wbkb checkpoint
    waypoints so the drawn line follows roads and passes the correct entrance/
    gates. None on any failure → caller uses schematic coords."""
    pts = res.get("path_nodes") or []
    if len(pts) < 2:
        return None

    def latlon(nid):
        c = nodes.get(nid, {}).get("coord")
        return (c["lat"], c["lng"]) if c else None

    a, b = latlon(pts[0]), latlon(pts[-1])
    if not a or not b:
        return None
    via = [latlon(n) for n in pts[1:-1] if nodes.get(n, {}).get("type") == "checkpoint" and nodes[n].get("coord")]
    try:
        out = await route_fn([a, *via, b], alternates=0)
    except Exception:  # noqa: BLE001
        log.exception("valhalla geometry for wbkb route failed")
        return None
    return out[0] if out else None


def _shape(res: dict, nodes: dict, geom: dict | None = None) -> dict:
    """wbkb route result -> the /v2/route response contract (+ wbkb extras)."""
    if geom and geom.get("coords"):
        coords, dist_km = geom["coords"], round(geom.get("distance_km", 0.0), 1)
    else:
        coords, dist_km = _schematic_coords(res, nodes)

    onr, along = [], 0.0
    prevc = None
    seen_gate: set[str] = set()
    for leg in res["edges"]:
        c = nodes[leg["to"]].get("coord")
        if c and prevc:
            along += _km(prevc[1], prevc[0], c["lat"], c["lng"])
        if c:
            prevc = [c["lng"], c["lat"]]
        for g in leg.get("gating", []):
            cp = nodes.get(g["cp"])
            if not cp or g["cp"] in seen_gate:
                continue
            seen_gate.add(g["cp"])
            onr.append({
                "checkpoint": _envelope(cp, g.get("status") or "unknown"),
                "closed": (g.get("status") == "closed"),
                "distance_m": 0, "along_km": round(along, 2),
            })

    advisory = "OK" if res["verdict"] == "clear" else "CAUTION"
    route_obj = {
        "geometry": {"type": "LineString", "coordinates": coords},
        "distance_km": round(dist_km, 1),
        "duration_min": res.get("total_minutes"),
        "checkpoints_on_route": onr,
        "closed_count": sum(1 for o in onr if o["closed"]),
        "engine": "wbkb",
        "verdict": res["verdict"],
        "needs_verification": res.get("needs_verification", False),
    }
    return {
        "routes": [route_obj], "advisory": advisory, "rerouted": False,
        "engine": "wbkb", "verdict": res["verdict"],
        "needs_verification": res.get("needs_verification", False),
        "message": res.get("message"),
    }


def _has_verified_edge(res: dict, edges: dict) -> bool:
    for leg in res.get("edges", []):
        e = edges.get(leg["id"])
        if not e:
            continue
        for slot in ("permission", "road_exists"):
            if (e["facts"].get(slot) or {}).get("source") == "human_local":
                return True
    return False


async def plan(from_latlon: tuple[float, float], to_latlon: tuple[float, float],
               envelopes: list, route_fn=None) -> dict | None:
    """Try a KB route. Returns the /v2/route plan dict, or None to fall back.
    ``route_fn`` (valhalla_client.route) is used to draw real road geometry through
    the KB's checkpoint waypoints; without it the geometry is schematic."""
    if not _AVAILABLE:
        return None
    try:
        kb = _kb()
        if not kb:
            return None
        nodes, edges = kb
        src = _snap_city(nodes, *from_latlon)
        dst = _snap_city(nodes, *to_latlon)
        if not src or not dst or src == dst:
            return None
        res = kbrouter.route(nodes, edges, src, dst, _status_map(envelopes))
        if not res.get("found"):
            return None
        # Confidence gate: only let the KB override Valhalla on a route that has at
        # least one human-verified (ground-truth) edge. Pure model_inferred scaffold
        # corridors fall back to Valhalla (richer geometry + OCHA restriction layer)
        # until they're confirmed via the worklist.
        if not _has_verified_edge(res, edges):
            return None
        assert_safe(res, edges)        # never return a forbidden route
        geom = await _real_geometry(res, nodes, route_fn) if route_fn else None
        return _shape(res, nodes, geom)
    except Exception:  # noqa: BLE001 — any failure → Valhalla fallback
        log.exception("wbkb plan failed; falling back")
        return None
