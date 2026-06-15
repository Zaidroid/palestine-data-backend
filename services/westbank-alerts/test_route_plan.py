"""Phase D — route planning orchestration (app/routers/route.py:build_route_plan).

Tests the avoid-closed reroute logic with an injected route function (no Valhalla,
no DB): a base route through closed Huwara, and — when avoid_closed is set — a
rerouted alternative that excludes it.

Run:  pytest test_route_plan.py -v
"""
from app.routers.route import build_route_plan
import asyncio


def _run(coro):
    return asyncio.run(coro)


def _cp(key, lat, lon, effective="open", permanent=None):
    return {"canonical_key": key,
            "coordinates": {"lat": lat, "lon": lon, "precision": "checkpoint"},
            "effective_status": effective, "permanent_status": permanent}


# Catalog: Atara (open) + Huwara (permanently closed)
ENVELOPES = [
    _cp("عطاره", 32.015, 35.187),
    _cp("حواره", 32.1587, 35.2538, effective="closed", permanent="closed_since:2023-10"),
]

# Route that PASSES Huwara
ROUTE_VIA_HUWARA = {"coords": [[35.187, 32.015], [35.2456, 32.1347], [35.2538, 32.1587],
                               [35.26, 32.22]], "distance_km": 40, "duration_min": 55}
# Alternative that AVOIDS Huwara (stays west)
ROUTE_AVOID = {"coords": [[35.187, 32.015], [35.18, 32.13], [35.20, 32.22]],
               "distance_km": 48, "duration_min": 70}


def _route_fn_factory():
    async def route_fn(locations, *, exclude_polygons=None, alternates=1):
        if exclude_polygons:
            return [ROUTE_AVOID]
        return [ROUTE_VIA_HUWARA]
    return route_fn


def test_base_route_lists_on_route_checkpoints_and_flags_closed():
    plan = _run(build_route_plan((32.0, 35.18), (32.22, 35.26), avoid_closed=False,
                                 envelopes=ENVELOPES, route_fn=_route_fn_factory(),
                                 corridor_m=300, box_m=200))
    primary = plan["routes"][0]
    keys = [o["checkpoint"]["canonical_key"] for o in primary["checkpoints_on_route"]]
    assert "حواره" in keys and "عطاره" in keys
    assert plan["advisory"] == "AVOID"          # a closed checkpoint sits on the route
    assert plan["rerouted"] is False


def test_avoid_closed_reroutes_around_huwara():
    plan = _run(build_route_plan((32.0, 35.18), (32.22, 35.26), avoid_closed=True,
                                 envelopes=ENVELOPES, route_fn=_route_fn_factory(),
                                 corridor_m=300, box_m=200))
    assert plan["rerouted"] is True
    primary = plan["routes"][0]
    assert primary.get("avoids_closed") is True
    closed_on_primary = [o for o in primary["checkpoints_on_route"] if o["closed"]]
    assert closed_on_primary == []              # Huwara no longer on the chosen route


def test_no_engine_route_returns_empty_plan():
    async def empty_route_fn(locations, *, exclude_polygons=None, alternates=1):
        return []

    plan = _run(build_route_plan((32.0, 35.18), (32.22, 35.26), avoid_closed=True,
                                 envelopes=ENVELOPES, route_fn=empty_route_fn,
                                 corridor_m=300, box_m=200))
    assert plan["routes"] == []
    assert plan["advisory"] == "UNKNOWN"


def test_clear_route_advisory_ok():
    async def clear_route_fn(locations, *, exclude_polygons=None, alternates=1):
        # route through Atara only (open)
        return [{"coords": [[35.187, 32.015], [35.19, 32.10]],
                 "distance_km": 12, "duration_min": 18}]

    plan = _run(build_route_plan((32.0, 35.18), (32.10, 35.19), avoid_closed=True,
                                 envelopes=ENVELOPES, route_fn=clear_route_fn,
                                 corridor_m=300, box_m=200))
    assert plan["advisory"] == "OK"
    assert plan["rerouted"] is False


def test_restriction_polys_fail_open_when_no_restricted_route():
    """Phase 2: a (possibly stale) closed segment that orphans the route must fail
    open — retry without the restriction polys so a route is still returned."""
    calls = []

    async def route_fn(locations, *, exclude_polygons=None, alternates=1):
        calls.append(bool(exclude_polygons))
        if exclude_polygons:
            return []                       # restricted route impossible
        return [{"coords": [[35.187, 32.015], [35.19, 32.10]],
                 "distance_km": 12, "duration_min": 18}]

    poly = [[[35.2, 32.1], [35.21, 32.1], [35.21, 32.11], [35.2, 32.11], [35.2, 32.1]]]
    plan = _run(build_route_plan((32.0, 35.18), (32.10, 35.19), avoid_closed=False,
                                 envelopes=ENVELOPES, route_fn=route_fn,
                                 corridor_m=300, box_m=200, restriction_polys=poly))
    assert plan["routes"], "fail-open must yield a route when restrictions orphan the destination"
    assert calls == [True, False]           # tried restricted, then retried without
